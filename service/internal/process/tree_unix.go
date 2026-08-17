//go:build !windows

package process

import (
	"errors"
	"fmt"
	"os/exec"
	"syscall"
	"time"
)

const processStopGracePeriod = 3500 * time.Millisecond

func configureCommandProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateProcessTree(pid int) error {
	if pid <= 0 {
		return errors.New("process identifier is invalid")
	}
	if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil && err != syscall.ESRCH {
		if fallbackErr := syscall.Kill(pid, syscall.SIGTERM); fallbackErr != nil && fallbackErr != syscall.ESRCH {
			return fmt.Errorf("send SIGTERM to process tree: %w", err)
		}
	}

	deadline := time.Now().Add(processStopGracePeriod)
	for time.Now().Before(deadline) {
		if !processGroupExists(pid) {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil && err != syscall.ESRCH {
		if fallbackErr := syscall.Kill(pid, syscall.SIGKILL); fallbackErr != nil && fallbackErr != syscall.ESRCH {
			return fmt.Errorf("send SIGKILL to process tree: %w", err)
		}
	}

	return nil
}

func processGroupExists(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(-pid, 0)
	return err == nil || err == syscall.EPERM
}
