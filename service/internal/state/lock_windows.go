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
