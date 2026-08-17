package state

import (
	"errors"
	"os"
	"testing"
	"time"
)

func TestDiscoveryRequiresProcessIdentity(t *testing.T) {
	discovery := Discovery{
		ProtocolVersion: ProtocolVersion,
		ServiceVersion:  "test",
		InstanceID:      "instance",
		PID:             os.Getpid(),
		StartedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Host:            "127.0.0.1",
		Port:            12345,
		TokenPath:       TokenPath(t.TempDir()),
	}

	if err := discovery.Validate(); err == nil {
		t.Fatal("discovery without a process identity was accepted")
	}
}

func TestRemoveStaleDiscoveryOnlyRemovesWhenIdentityIsAbsent(t *testing.T) {
	stateDir := t.TempDir()
	discovery := Discovery{
		ProtocolVersion: ProtocolVersion,
		ServiceVersion:  "test",
		InstanceID:      "instance",
		PID:             os.Getpid(),
		ProcessIdentity: "identity",
		StartedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Host:            "127.0.0.1",
		Port:            12345,
		TokenPath:       TokenPath(stateDir),
	}
	if err := WriteDiscovery(stateDir, discovery); err != nil {
		t.Fatalf("write discovery: %v", err)
	}

	if err := RemoveStaleDiscovery(stateDir, func(pid int, identity string) (bool, error) {
		if pid != discovery.PID || identity != discovery.ProcessIdentity {
			t.Fatalf("identity check received pid=%d identity=%q", pid, identity)
		}
		return true, nil
	}); err != nil {
		t.Fatalf("preserve owned discovery: %v", err)
	}
	if _, err := ReadDiscovery(stateDir); err != nil {
		t.Fatalf("owned discovery was removed: %v", err)
	}

	if err := RemoveStaleDiscovery(stateDir, func(int, string) (bool, error) { return false, nil }); err != nil {
		t.Fatalf("remove stale discovery: %v", err)
	}
	if _, err := os.Stat(DiscoveryPath(stateDir)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale discovery still exists or could not be checked: %v", err)
	}
}
