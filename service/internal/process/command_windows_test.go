//go:build windows

package process

import (
	"os"
	"syscall"
	"testing"
)

func TestNewCommandIsolatesWindowsConsole(t *testing.T) {
	command, stdin, stdout, stderr, err := newCommand(StartRequest{
		Command: "echo service-output",
		Cwd:     t.TempDir(),
		Env:     map[string]string{},
	})
	if err != nil {
		t.Fatalf("create command: %v", err)
	}
	defer stdin.Close()
	defer stdout.Close()
	defer stderr.Close()

	if command.SysProcAttr == nil {
		t.Fatal("Windows service command must configure process attributes")
	}
	if !command.SysProcAttr.HideWindow {
		t.Fatal("Windows service command must hide its console window")
	}
	requiredFlags := uint32(syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow)
	if command.SysProcAttr.CreationFlags&requiredFlags != requiredFlags {
		t.Fatalf("creation flags = %#x, want %#x", command.SysProcAttr.CreationFlags, requiredFlags)
	}
}

func TestWindowsProcessTreeIncludesRoot(t *testing.T) {
	processIDs, err := windowsProcessTreePIDs(os.Getpid())
	if err != nil {
		t.Fatalf("enumerate current process tree: %v", err)
	}
	if len(processIDs) == 0 || processIDs[0] != os.Getpid() {
		t.Fatalf("process tree = %#v, want root pid %d", processIDs, os.Getpid())
	}
}
