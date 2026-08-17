//go:build windows

package process

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

const (
	processQueryLimitedInformation = 0x1000
	processStillActive             = 259
)

func processIdentity(pid int) (string, error) {
	if pid <= 0 {
		return "", errors.New("process identifier is invalid")
	}
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return "", fmt.Errorf("open process for identity: %w", err)
	}
	defer syscall.CloseHandle(handle)

	return processIdentityFromHandle(handle)
}

func processIdentityForStartedProcess(process *os.Process) (string, error) {
	if process == nil {
		return "", errors.New("process is required")
	}

	return processIdentity(process.Pid)
}

func processIdentityFromHandle(handle syscall.Handle) (string, error) {
	var creationTime syscall.Filetime
	var exitTime syscall.Filetime
	var kernelTime syscall.Filetime
	var userTime syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &creationTime, &exitTime, &kernelTime, &userTime); err != nil {
		return "", fmt.Errorf("read process start time: %w", err)
	}
	startTicks := uint64(creationTime.HighDateTime)<<32 | uint64(creationTime.LowDateTime)
	if startTicks == 0 {
		return "", errors.New("process start time is invalid")
	}

	return "windows:" + strconv.FormatUint(startTicks, 10), nil
}

func processIdentityMatches(pid int, expected string) (bool, error) {
	if strings.TrimSpace(expected) == "" {
		return false, nil
	}
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		if !processExists(pid) {
			return false, nil
		}
		return false, fmt.Errorf("open process for identity: %w", err)
	}
	defer syscall.CloseHandle(handle)

	running, err := processHandleIsRunning(handle)
	if err != nil {
		return false, err
	}
	if !running {
		return false, nil
	}
	actual, err := processIdentityFromHandle(handle)
	if err != nil {
		return false, err
	}
	running, err = processHandleIsRunning(handle)
	if err != nil {
		return false, err
	}
	if !running {
		return false, nil
	}
	return actual == expected, nil
}

func processHandleIsRunning(handle syscall.Handle) (bool, error) {
	var exitCode uint32
	if err := syscall.GetExitCodeProcess(handle, &exitCode); err != nil {
		return false, fmt.Errorf("read process exit status: %w", err)
	}
	return exitCode == processStillActive, nil
}
