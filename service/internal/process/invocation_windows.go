//go:build windows

package process

import "os"

func shellCommandInvocation(command string) commandInvocation {
	commandInterpreter := os.Getenv("ComSpec")
	if commandInterpreter == "" {
		commandInterpreter = "cmd.exe"
	}
	return commandInvocation{
		executable: commandInterpreter,
		args:       []string{"/d", "/s", "/c", command},
	}
}

func isWindowsEnvironment() bool {
	return true
}
