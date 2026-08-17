//go:build windows

package process

import (
	"errors"
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

func configureCommandProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow,
		HideWindow:    true,
	}
}

func terminateProcessTree(pid int) error {
	if pid <= 0 {
		return errors.New("process identifier is invalid")
	}

	processIDs, err := windowsProcessTreePIDs(pid)
	if err != nil {
		return fmt.Errorf("snapshot process tree: %w", err)
	}

	var terminationErrors []error
	for index := len(processIDs) - 1; index >= 0; index-- {
		processID := processIDs[index]
		handle, openErr := syscall.OpenProcess(syscall.PROCESS_TERMINATE, false, uint32(processID))
		if openErr != nil {
			if processExists(processID) {
				terminationErrors = append(terminationErrors, fmt.Errorf("open process %d for termination: %w", processID, openErr))
			}
			continue
		}

		terminateErr := syscall.TerminateProcess(handle, 1)
		_ = syscall.CloseHandle(handle)
		if terminateErr != nil && processExists(processID) {
			terminationErrors = append(terminationErrors, fmt.Errorf("terminate process %d: %w", processID, terminateErr))
		}
	}
	if len(terminationErrors) > 0 {
		return errors.Join(terminationErrors...)
	}
	return nil
}

func processExists(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(handle)
	running, err := processHandleIsRunning(handle)
	return err == nil && running
}

func windowsProcessTreePIDs(rootPID int) ([]int, error) {
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer syscall.CloseHandle(snapshot)

	childrenByParent := make(map[uint32][]int)
	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := syscall.Process32First(snapshot, &entry); err != nil {
		return nil, err
	}
	for {
		childrenByParent[entry.ParentProcessID] = append(childrenByParent[entry.ParentProcessID], int(entry.ProcessID))
		err := syscall.Process32Next(snapshot, &entry)
		if errors.Is(err, syscall.ERROR_NO_MORE_FILES) {
			break
		}
		if err != nil {
			return nil, err
		}
	}

	processIDs := []int{rootPID}
	queue := []int{rootPID}
	seen := map[int]struct{}{rootPID: {}}
	for len(queue) > 0 {
		parentPID := queue[0]
		queue = queue[1:]
		for _, childPID := range childrenByParent[uint32(parentPID)] {
			if _, found := seen[childPID]; found {
				continue
			}
			seen[childPID] = struct{}{}
			processIDs = append(processIDs, childPID)
			queue = append(queue, childPID)
		}
	}
	return processIDs, nil
}
