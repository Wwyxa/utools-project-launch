//go:build windows

package process

import (
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

func configureCommandProcess(command *exec.Cmd) {}

func terminateProcessTree(pid int) error {
	if pid <= 0 {
		return errors.New("process identifier is invalid")
	}
	output, err := exec.Command("taskkill.exe", "/PID", strconv.Itoa(pid), "/T", "/F").CombinedOutput()
	if err != nil && processExists(pid) {
		return fmt.Errorf("taskkill failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func processExists(pid int) bool {
	output, err := exec.Command("tasklist.exe", "/FI", fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH").CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(string(output), fmt.Sprintf("\"%d\"", pid))
}
