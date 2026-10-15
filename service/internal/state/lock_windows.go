//go:build windows

package state

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	lockfileFailImmediately = 0x00000001
	lockfileExclusiveLock   = 0x00000002
	handleFlagInherit       = 0x00000001
	errorLockViolation      = syscall.Errno(33)
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	lockFileExProc   = kernel32.NewProc("LockFileEx")
	unlockFileExProc = kernel32.NewProc("UnlockFileEx")
)

func runtimeWriterAlive(pid int) bool {
	if pid <= 0 {
		return true
	}
	handle, err := syscall.OpenProcess(0x1000, false, uint32(pid))
	if err != nil {
		return err != syscall.Errno(87)
	}
	defer syscall.CloseHandle(handle)
	var code uint32
	if err := syscall.GetExitCodeProcess(handle, &code); err != nil {
		return true
	}
	return code == 259
}

func acquireFileLock(file *os.File) error {
	if err := syscall.SetHandleInformation(syscall.Handle(file.Fd()), handleFlagInherit, 0); err != nil {
		return fmt.Errorf("disable service directory lock inheritance: %w", err)
	}

	overlapped := syscall.Overlapped{}
	result, _, callErr := lockFileExProc.Call(
		file.Fd(),
		lockfileFailImmediately|lockfileExclusiveLock,
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if result != 0 {
		return nil
	}
	if callErr == errorLockViolation {
		return ErrServiceAlreadyRunning
	}
	return fmt.Errorf("lock service directory: %w", callErr)
}

func releaseFileLock(file *os.File) error {
	overlapped := syscall.Overlapped{}
	result, _, callErr := unlockFileExProc.Call(
		file.Fd(),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if result != 0 {
		return nil
	}
	return fmt.Errorf("unlock service directory: %w", callErr)
}
