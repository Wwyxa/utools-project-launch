//go:build windows

package process

import (
	"debug/pe"
	"errors"
	"fmt"
	"os/exec"
	"syscall"
	"time"
	"unsafe"
)

const createNoWindow = 0x08000000
const createNewConsole = 0x00000010
const processStopGracePeriod = 3500 * time.Millisecond

var queryFullProcessImageName = syscall.NewLazyDLL("kernel32.dll").NewProc("QueryFullProcessImageNameW")

func configureCommandProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createNewConsole,
		HideWindow:    true,
		CmdLine:       syscall.EscapeArg(command.Path) + ` /d /s /c "` + command.Args[len(command.Args)-1] + `"`,
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
	processIDs, err = windowsScriptProcessPIDs(processIDs, pid, make(map[string]bool))
	if err != nil {
		return err
	}
	if requestWindowsConsoleStop(processIDs) {
		waitForWindowsProcesses(processIDs)
	}
	return terminateWindowsProcessIDs(processIDs, 0)
}

func waitForWindowsProcesses(processIDs []int) {
	deadline := time.Now().Add(processStopGracePeriod)
	for _, pid := range processIDs {
		handle, err := syscall.OpenProcess(syscall.SYNCHRONIZE, false, uint32(pid))
		if err != nil {
			continue
		}
		remaining := time.Until(deadline)
		if remaining > 0 {
			_, _ = syscall.WaitForSingleObject(handle, uint32(remaining.Milliseconds()))
		}
		_ = syscall.CloseHandle(handle)
	}
}

func terminateWindowsProcessIDs(processIDs []int, job syscall.Handle) error {
	var terminationErrors []error
	for _, processID := range processIDs {
		handle, openErr := syscall.OpenProcess(syscall.PROCESS_TERMINATE|syscall.SYNCHRONIZE|processQueryLimitedInformation, false, uint32(processID))
		if openErr != nil {
			if processExists(processID) {
				terminationErrors = append(terminationErrors, fmt.Errorf("open process %d for termination: %w", processID, openErr))
			}
			continue
		}
		if job != 0 {
			var member int32
			result, _, callErr := isProcessInJob.Call(uintptr(handle), uintptr(job), uintptr(unsafe.Pointer(&member)))
			if result == 0 || member == 0 {
				_ = syscall.CloseHandle(handle)
				if result == 0 {
					terminationErrors = append(terminationErrors, fmt.Errorf("validate process %d job membership: %w", processID, callErr))
				}
				continue
			}
		}

		terminateErr := syscall.TerminateProcess(handle, 1)
		if terminateErr == nil {
			_, terminateErr = syscall.WaitForSingleObject(handle, 1000)
		}
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
	entries, err := windowsProcessEntries()
	if err != nil {
		return nil, err
	}
	childrenByParent := make(map[uint32][]int)
	for _, entry := range entries {
		childrenByParent[entry.ParentProcessID] = append(childrenByParent[entry.ParentProcessID], int(entry.ProcessID))
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

func windowsProcessEntries() (map[int]syscall.ProcessEntry32, error) {
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer syscall.CloseHandle(snapshot)

	entries := make(map[int]syscall.ProcessEntry32)
	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := syscall.Process32First(snapshot, &entry); err != nil {
		return nil, err
	}
	for {
		entries[int(entry.ProcessID)] = entry
		err := syscall.Process32Next(snapshot, &entry)
		if errors.Is(err, syscall.ERROR_NO_MORE_FILES) {
			break
		}
		if err != nil {
			return nil, err
		}
	}

	return entries, nil
}

func windowsScriptProcessPIDs(processIDs []int, rootPID int, guiExecutables map[string]bool) ([]int, error) {
	if len(processIDs) == 0 {
		return nil, nil
	}
	entries, err := windowsProcessEntries()
	if err != nil {
		return nil, fmt.Errorf("snapshot script processes: %w", err)
	}
	guiProcesses := make(map[int]bool, len(processIDs))
	for _, pid := range processIDs {
		if pid == rootPID || !processExists(pid) {
			guiProcesses[pid] = false
			continue
		}
		gui, err := windowsProcessIsGUI(pid, guiExecutables)
		if err != nil {
			if !processExists(pid) {
				continue
			}
			return nil, fmt.Errorf("classify script process %d: %w", pid, err)
		}
		guiProcesses[pid] = gui
	}
	selected := make([]int, 0, len(processIDs))
	for _, pid := range processIDs {
		current := pid
		seen := make(map[int]bool)
		for !guiProcesses[current] && current != rootPID && !seen[current] {
			seen[current] = true
			parent := int(entries[current].ParentProcessID)
			if _, member := guiProcesses[parent]; !member {
				break
			}
			current = parent
		}
		if !guiProcesses[current] {
			selected = append(selected, pid)
		}
	}
	return selected, nil
}

func windowsProcessIsGUI(pid int, cache map[string]bool) (bool, error) {
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false, err
	}
	defer syscall.CloseHandle(handle)
	path := make([]uint16, 32768)
	length := uint32(len(path))
	if result, _, callErr := queryFullProcessImageName.Call(uintptr(handle), 0, uintptr(unsafe.Pointer(&path[0])), uintptr(unsafe.Pointer(&length))); result == 0 {
		return false, callErr
	}
	executable := syscall.UTF16ToString(path[:length])
	if gui, found := cache[executable]; found {
		return gui, nil
	}
	image, err := pe.Open(executable)
	if err != nil {
		return false, err
	}
	defer image.Close()
	var subsystem uint16
	switch header := image.OptionalHeader.(type) {
	case *pe.OptionalHeader32:
		subsystem = header.Subsystem
	case *pe.OptionalHeader64:
		subsystem = header.Subsystem
	default:
		return false, errors.New("process image has no Windows optional header")
	}
	gui := subsystem == pe.IMAGE_SUBSYSTEM_WINDOWS_GUI
	cache[executable] = gui
	return gui, nil
}
