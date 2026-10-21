//go:build windows

package process

import (
	"errors"
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const jobQueryInterval = 30000

var (
	jobKernel32         = syscall.NewLazyDLL("kernel32.dll")
	createJobObject     = jobKernel32.NewProc("CreateJobObjectW")
	assignProcessToJob  = jobKernel32.NewProc("AssignProcessToJobObject")
	queryJobInformation = jobKernel32.NewProc("QueryInformationJobObject")
	setJobInformation   = jobKernel32.NewProc("SetInformationJobObject")
	terminateJobObject  = jobKernel32.NewProc("TerminateJobObject")
	thread32First       = jobKernel32.NewProc("Thread32First")
	thread32Next        = jobKernel32.NewProc("Thread32Next")
	openThread          = jobKernel32.NewProc("OpenThread")
	resumeThread        = jobKernel32.NewProc("ResumeThread")
)

type windowsProcessGroup struct {
	mutex  sync.Mutex
	handle syscall.Handle
	port   syscall.Handle
}

type jobCompletionPort struct {
	key  uintptr
	port syscall.Handle
}

type jobAccounting struct {
	userTime, kernelTime, periodUserTime, periodKernelTime           int64
	pageFaults, totalProcesses, activeProcesses, terminatedProcesses uint32
}

func newWindowsProcessGroup() (*windowsProcessGroup, error) {
	handle, _, callErr := createJobObject.Call(0, 0)
	if handle == 0 {
		return nil, fmt.Errorf("create job: %w", callErr)
	}
	group := &windowsProcessGroup{handle: syscall.Handle(handle)}
	if err := group.attachCompletionPort(); err != nil {
		group.close()
		return nil, err
	}
	return group, nil
}

func startProcessGroup(command *exec.Cmd) (processGroup, error) {
	group, err := newWindowsProcessGroup()
	if err != nil {
		return nil, err
	}
	command.SysProcAttr.CreationFlags |= 0x00000004
	if err := command.Start(); err != nil {
		group.close()
		return nil, err
	}
	process, err := syscall.OpenProcess(0x0100|syscall.PROCESS_TERMINATE, false, uint32(command.Process.Pid))
	if err == nil {
		result, _, callErr := assignProcessToJob.Call(uintptr(group.handle), uintptr(process))
		_ = syscall.CloseHandle(process)
		if result == 0 {
			err = fmt.Errorf("assign suspended process to job: %w", callErr)
		}
	}
	if err == nil {
		err = resumeCommandProcess(command.Process.Pid)
	}
	if err != nil {
		_ = group.stop()
		_ = command.Process.Kill()
		_ = command.Wait()
		group.close()
		return nil, err
	}
	return group, nil
}

func resumeCommandProcess(pid int) error {
	snapshot, err := syscall.CreateToolhelp32Snapshot(0x00000004, 0)
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(snapshot)
	entry := struct {
		size, usage, threadID, ownerPID uint32
		basePriority, deltaPriority     int32
		flags                           uint32
	}{}
	entry.size = uint32(unsafe.Sizeof(entry))
	result, _, callErr := thread32First.Call(uintptr(snapshot), uintptr(unsafe.Pointer(&entry)))
	for result != 0 {
		if entry.ownerPID == uint32(pid) {
			handle, _, openErr := openThread.Call(0x0002, 0, uintptr(entry.threadID))
			if handle == 0 {
				return openErr
			}
			resumed, _, resumeErr := resumeThread.Call(handle)
			_ = syscall.CloseHandle(syscall.Handle(handle))
			if uint32(resumed) == 0xffffffff {
				return resumeErr
			}
			return nil
		}
		entry.size = uint32(unsafe.Sizeof(entry))
		result, _, callErr = thread32Next.Call(uintptr(snapshot), uintptr(unsafe.Pointer(&entry)))
	}
	return fmt.Errorf("find suspended process thread: %w", callErr)
}

func (group *windowsProcessGroup) attachCompletionPort() error {
	port, err := syscall.CreateIoCompletionPort(syscall.InvalidHandle, 0, 0, 1)
	if err != nil {
		return err
	}
	info := jobCompletionPort{key: 1, port: port}
	if result, _, callErr := setJobInformation.Call(uintptr(group.handle), 7, uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info)); result == 0 {
		syscall.CloseHandle(port)
		return fmt.Errorf("attach job completion port: %w", callErr)
	}
	group.port = port
	return nil
}

func (group *windowsProcessGroup) alive() (bool, error) {
	group.mutex.Lock()
	defer group.mutex.Unlock()
	if group.handle == 0 {
		return false, errors.New("run job is closed")
	}
	accounting := jobAccounting{}
	if result, _, callErr := queryJobInformation.Call(uintptr(group.handle), 1, uintptr(unsafe.Pointer(&accounting)), unsafe.Sizeof(accounting), 0); result == 0 {
		return false, fmt.Errorf("query job processes: %w", callErr)
	}
	return accounting.activeProcesses != 0, nil
}

func (group *windowsProcessGroup) wait() error {
	group.mutex.Lock()
	port := group.port
	group.mutex.Unlock()
	for {
		alive, err := group.alive()
		if err != nil || !alive {
			return err
		}
		deadline := time.Now().Add(jobQueryInterval * time.Millisecond)
		for {
			var message uint32
			var key uint32
			var overlapped *syscall.Overlapped
			remaining := time.Until(deadline)
			if remaining <= 0 {
				break
			}
			err := syscall.GetQueuedCompletionStatus(port, &message, &key, &overlapped, uint32(remaining.Milliseconds()+1))
			if err != nil && !errors.Is(err, syscall.Errno(258)) {
				return fmt.Errorf("wait for job completion: %w", err)
			}
			if err != nil || message == 4 {
				break
			}
		}
	}
}

func (group *windowsProcessGroup) stop() error {
	group.mutex.Lock()
	defer group.mutex.Unlock()
	if group.handle == 0 {
		return errors.New("run job is closed")
	}
	if result, _, callErr := terminateJobObject.Call(uintptr(group.handle), 1); result == 0 {
		return fmt.Errorf("terminate run job: %w", callErr)
	}
	return nil
}

func (group *windowsProcessGroup) close() {
	group.mutex.Lock()
	defer group.mutex.Unlock()
	if group.handle != 0 {
		_ = syscall.CloseHandle(group.handle)
		group.handle = 0
	}
	if group.port != 0 {
		_ = syscall.CloseHandle(group.port)
		group.port = 0
	}
}
