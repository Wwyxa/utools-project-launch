//go:build linux

package process

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func processIdentity(pid int) (string, error) {
	if pid <= 0 {
		return "", errors.New("process identifier is invalid")
	}
	bootID, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return "", fmt.Errorf("read system boot identity: %w", err)
	}
	statContents, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return "", fmt.Errorf("read process identity: %w", err)
	}
	closingName := strings.LastIndex(string(statContents), ")")
	if closingName < 0 {
		return "", errors.New("process stat format is invalid")
	}
	fields := strings.Fields(string(statContents)[closingName+1:])
	if len(fields) <= 19 {
		return "", errors.New("process stat start time is missing")
	}
	startTicks := fields[19]
	if _, err := strconv.ParseUint(startTicks, 10, 64); err != nil {
		return "", errors.New("process stat start time is invalid")
	}

	return "linux:" + strings.TrimSpace(string(bootID)) + ":" + startTicks, nil
}

func processIdentityMatches(pid int, expected string) (bool, error) {
	if strings.TrimSpace(expected) == "" {
		return false, nil
	}
	actual, err := processIdentity(pid)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	return actual == expected, nil
}
