package state

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteFileAtomicReplacesTargetAndCleansTemporaryFiles(t *testing.T) {
	directory := t.TempDir()
	targetPath := filepath.Join(directory, "state.json")
	if err := os.WriteFile(targetPath, []byte("old"), 0o600); err != nil {
		t.Fatalf("write initial target: %v", err)
	}

	if err := writeFileAtomic(targetPath, []byte("new"), 0o600); err != nil {
		t.Fatalf("write target atomically: %v", err)
	}
	contents, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("read replaced target: %v", err)
	}
	if string(contents) != "new" {
		t.Fatalf("target contents = %q, want %q", contents, "new")
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("list target directory: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".project-launch-service-") {
			t.Fatalf("temporary file was not cleaned up: %q", entry.Name())
		}
	}
}
