//go:build darwin

package process

import (
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

func processIdentity(pid int) (string, error) {
	if pid <= 0 {
		return "", errors.New("process identifier is invalid")
	}
	output, err := exec.Command("ps", "-o", "lstart=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return "", fmt.Errorf("read process start time: %w", err)
	}
	startedAt := strings.TrimSpace(string(output))
	if startedAt == "" {
		return "", errors.New("process start time is missing")
	}

	return "darwin:" + startedAt, nil
}

func processIdentityMatches(pid int, expected string) (bool, error) {
	if strings.TrimSpace(expected) == "" {
		return false, nil
	}
	actual, err := processIdentity(pid)
	if err != nil {
		return false, err
	}
	return actual == expected, nil
}
