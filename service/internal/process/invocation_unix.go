//go:build !windows

package process

import (
	"os"
	"path/filepath"
	"runtime"
)

func shellCommandInvocation(command string) commandInvocation {
	shellPath := os.Getenv("SHELL")
	if shellPath == "" {
		if runtime.GOOS == "darwin" {
			shellPath = "/bin/zsh"
		} else {
			shellPath = "/bin/sh"
		}
	}
	shellName := filepath.Base(shellPath)
	arguments := []string{"-ilc", command}
	if shellName == "sh" {
		arguments = []string{"-lc", command}
	}
	return commandInvocation{executable: shellPath, args: arguments}
}

func isWindowsEnvironment() bool {
	return false
}
