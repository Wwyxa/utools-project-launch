package state

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const LockFileName = "service.lock"

var ErrServiceAlreadyRunning = errors.New("another Project Launch Service instance is already using this service directory")

type DirectoryLock struct {
	file *os.File
}

func LockPath(stateDir string) string {
	return filepath.Join(stateDir, LockFileName)
}

func AcquireDirectoryLock(stateDir string) (*DirectoryLock, error) {
	if err := EnsureDirectory(stateDir); err != nil {
		return nil, err
	}

	file, err := os.OpenFile(LockPath(stateDir), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open service directory lock: %w", err)
	}
	if err := acquireFileLock(file); err != nil {
		_ = file.Close()
		return nil, err
	}

	return &DirectoryLock{file: file}, nil
}

func (lock *DirectoryLock) Close() error {
	if lock == nil || lock.file == nil {
		return nil
	}

	file := lock.file
	lock.file = nil
	return errors.Join(releaseFileLock(file), file.Close())
}
