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
	isProcessInJob      = jobKernel32.NewProc("IsProcessInJob")
	thread32First       = jobKernel32.NewProc("Thread32First")
	thread32Next        = jobKernel32.NewProc("Thread32Next")
	openThread          = jobKernel32.NewProc("OpenThread")
	resumeThread        = jobKernel32.NewProc("ResumeThread")
)

type windowsProcessGroup struct {
	mutex          sync.Mutex
	handle         syscall.Handle
	port           syscall.Handle
	rootPID        int
	guiExecutables map[string]bool
}

type jobCompletionPort struct {
	key  uintptr
	port syscall.Handle
}

func newWindowsProcessGroup() (*windowsProcessGroup, error) {
	handle, _, callErr := createJobObject.Call(0, 0)
	if handle == 0 {
		return nil, fmt.Errorf("create job: %w", callErr)
	}
	group := &windowsProcessGroup{handle: syscall.Handle(handle), guiExecutables: make(map[string]bool)}
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
	group.rootPID = command.Process.Pid
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
	processIDs, err := group.scriptProcessPIDs()
	return len(processIDs) != 0, err
}

func (group *windowsProcessGroup) scriptProcessPIDs() ([]int, error) {
	for capacity := 32; ; capacity *= 2 {
		buffer := make([]uintptr, capacity+2)
		length := uintptr(8) + uintptr(capacity)*unsafe.Sizeof(uintptr(0))
		result, _, callErr := queryJobInformation.Call(uintptr(group.handle), 3, uintptr(unsafe.Pointer(&buffer[0])), length, 0)
		counts := (*[2]uint32)(unsafe.Pointer(&buffer[0]))
		if (result == 0 && errors.Is(callErr, syscall.ERROR_MORE_DATA)) || counts[0] > uint32(capacity) {
			continue
		}
		if result == 0 {
			return nil, fmt.Errorf("query job process identifiers: %w", callErr)
		}
		identifiers := unsafe.Slice((*uintptr)(unsafe.Add(unsafe.Pointer(&buffer[0]), 8)), int(counts[1]))
		processIDs := make([]int, 0, len(identifiers))
		for _, pid := range identifiers {
			processIDs = append(processIDs, int(pid))
		}
		return windowsScriptProcessPIDs(processIDs, group.rootPID, group.guiExecutables)
	}
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
			if err != nil || message == 4 || message == 7 || message == 8 {
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
	deadline := time.Now().Add(5 * time.Second)
	for {
		processIDs, err := group.scriptProcessPIDs()
		if err != nil || len(processIDs) == 0 {
			return err
		}
		if time.Now().After(deadline) {
			return errors.New("timed out stopping script job members")
		}
		if err := terminateWindowsProcessIDs(processIDs, group.handle); err != nil {
			return err
		}
	}
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
