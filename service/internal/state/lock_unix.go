//go:build !windows

package state

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

func acquireFileLock(file *os.File) error {
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		if errors.Is(err, syscall.EAGAIN) || errors.Is(err, syscall.EWOULDBLOCK) {
			return ErrServiceAlreadyRunning
		}
		return fmt.Errorf("lock service directory: %w", err)
	}
	return nil
}

func releaseFileLock(file *os.File) error {
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_UN); err != nil {
		return fmt.Errorf("unlock service directory: %w", err)
	}
	return nil
}
