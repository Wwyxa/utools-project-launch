package process

import "os"

func CurrentProcessIdentity() (string, error) {
	return processIdentity(os.Getpid())
}

func ProcessIdentityMatches(pid int, expected string) (bool, error) {
	return processIdentityMatches(pid, expected)
}
