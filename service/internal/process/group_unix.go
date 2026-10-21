//go:build !windows

package process

import "os/exec"

func startProcessGroup(command *exec.Cmd) (processGroup, error) {
	return nil, command.Start()
}
