package process

import (
	"io"
	"os"
	"os/exec"
	"strings"
)

type commandInvocation struct {
	executable string
	args       []string
}

func newCommand(request StartRequest) (*exec.Cmd, io.WriteCloser, io.ReadCloser, io.ReadCloser, error) {
	invocation := shellCommandInvocation(request.Command)
	command := exec.Command(invocation.executable, invocation.args...)
	command.Dir = request.Cwd
	command.Env = mergedEnvironment(request.Env)
	configureCommandProcess(command)

	stdinReader, stdin, err := os.Pipe()
	if err != nil {
		return nil, nil, nil, nil, err
	}
	command.Stdin = stdinReader
	stdout, stdoutWriter, err := os.Pipe()
	if err != nil {
		_ = stdinReader.Close()
		_ = stdin.Close()
		return nil, nil, nil, nil, err
	}
	command.Stdout = stdoutWriter
	stderr, stderrWriter, err := os.Pipe()
	if err != nil {
		_ = stdinReader.Close()
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stdoutWriter.Close()
		return nil, nil, nil, nil, err
	}
	command.Stderr = stderrWriter

	return command, stdin, stdout, stderr, nil
}

func closeCommandOutputWriters(command *exec.Cmd) {
	if closer, ok := command.Stdin.(io.Closer); ok {
		_ = closer.Close()
	}
	if closer, ok := command.Stdout.(io.Closer); ok {
		_ = closer.Close()
	}
	if closer, ok := command.Stderr.(io.Closer); ok {
		_ = closer.Close()
	}
}

func mergedEnvironment(overrides map[string]string) []string {
	values := make(map[string]string, len(os.Environ())+len(overrides))
	keys := make([]string, 0, len(os.Environ())+len(overrides))
	seen := make(map[string]bool, len(os.Environ())+len(overrides))
	caseInsensitive := isWindowsEnvironment()

	add := func(key string, value string) {
		normalizedKey := key
		if caseInsensitive {
			normalizedKey = strings.ToUpper(key)
		}
		if !seen[normalizedKey] {
			seen[normalizedKey] = true
			keys = append(keys, normalizedKey)
		}
		values[normalizedKey] = key + "=" + value
	}

	for _, entry := range os.Environ() {
		key, value, found := strings.Cut(entry, "=")
		if found {
			add(key, value)
		}
	}
	for key, value := range overrides {
		add(key, value)
	}

	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, values[key])
	}
	return result
}
