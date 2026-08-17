//go:build !windows && !linux && !darwin

package process

import "errors"

func processIdentity(pid int) (string, error) {
	return "", errors.New("process identity is not supported on this platform")
}

func processIdentityMatches(pid int, expected string) (bool, error) {
	return false, errors.New("process identity is not supported on this platform")
}
