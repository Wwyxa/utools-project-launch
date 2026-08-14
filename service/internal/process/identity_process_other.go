//go:build !windows

package process

import "os"

func processIdentityForProcess(process *os.Process) (string, error) {
	return processIdentity(process.Pid)
}
