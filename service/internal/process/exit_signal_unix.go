//go:build !windows

package process

import (
	"errors"
	"os/exec"
	"syscall"
)

func exitSignal(waitErr error) string {
	var exitError *exec.ExitError
	if !errors.As(waitErr, &exitError) {
		return ""
	}
	status, ok := exitError.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() {
		return ""
	}
	return status.Signal().String()
}
