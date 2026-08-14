//go:build windows

package process

import "os"

func processIdentityForProcess(process *os.Process) (string, error) {
	return processIdentityForStartedProcess(process)
}
