//go:build windows

package process

import (
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"project-launch-service/internal/state"
)

func windowsChildRequest(t *testing.T, directory string, detached bool) StartRequest {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	request := StartRequest{
		ProjectID: "project", ScriptID: "script", Label: "Child test", Cwd: directory,
		Command: `"` + executable + `" -test.run=^TestSupervisorKeepsRunningWhileChildOutlivesLauncher$`,
		Env: map[string]string{
			"PROJECT_LAUNCH_CHILD_HELPER":  "1",
			"PROJECT_LAUNCH_CHILD_READY":   filepath.Join(directory, "ready"),
			"PROJECT_LAUNCH_CHILD_RELEASE": filepath.Join(directory, "release"),
		},
		IdempotencyKey: "child-test", RequestFingerprint: "child-test",
	}
	if detached {
		request.Env["PROJECT_LAUNCH_CHILD_DETACHED_OUTPUT"] = "1"
	}
	return request
}

func waitForWindowsChild(t *testing.T, request StartRequest) int {
	t.Helper()
	deadline := time.After(4 * time.Second)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		contents, err := os.ReadFile(request.Env["PROJECT_LAUNCH_CHILD_READY"])
		if err == nil {
			pid, err := strconv.Atoi(string(contents))
			if err == nil && pid > 0 {
				return pid
			}
		}
		select {
		case <-deadline:
			t.Fatal("child did not report its PID")
		case <-ticker.C:
		}
	}
}

func releaseWindowsChild(t *testing.T, request StartRequest) {
	t.Helper()
	if err := os.WriteFile(request.Env["PROJECT_LAUNCH_CHILD_RELEASE"], nil, 0600); err != nil {
		t.Error(err)
	}
	contents, _ := os.ReadFile(request.Env["PROJECT_LAUNCH_CHILD_READY"])
	pid, _ := strconv.Atoi(string(contents))
	if pid > 0 {
		if child, err := os.FindProcess(pid); err == nil {
			_, _ = child.Wait()
		}
	}
}

func waitForWindowsLauncherExit(t *testing.T, run state.Run) {
	t.Helper()
	deadline := time.After(4 * time.Second)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		matches, err := processIdentityMatches(run.PID, run.ProcessIdentity)
		if err == nil && !matches {
			return
		}
		select {
		case <-deadline:
			t.Fatal("launcher did not exit")
		case <-ticker.C:
		}
	}
}

func TestSupervisorWindowsStopsChildAfterLauncherExit(t *testing.T) {
	for _, scenario := range []struct {
		name     string
		detached bool
		action   string
	}{
		{name: "inherited-output", action: "stop"},
		{name: "detached-output", detached: true, action: "stop"},
		{name: "natural-exit", detached: true, action: "release"},
		{name: "automation-stop", detached: true, action: "automation"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			store := openStore(t)
			supervisor, err := NewSupervisor(store)
			if err != nil {
				t.Fatal(err)
			}
			request := windowsChildRequest(t, t.TempDir(), scenario.detached)
			t.Cleanup(func() { releaseWindowsChild(t, request) })
			run, _, err := supervisor.Start(request)
			if err != nil {
				t.Fatal(err)
			}
			pid := waitForWindowsChild(t, request)
			waitForWindowsLauncherExit(t, run)
			supervisor.mutex.Lock()
			group := supervisor.processes[run.ID].group.(*windowsProcessGroup)
			supervisor.mutex.Unlock()
			if err := syscall.PostQueuedCompletionStatus(group.port, 4, 1, nil); err != nil {
				t.Fatal(err)
			}
			<-time.After(3 * outputDrainTimeout)
			current, _ := store.Run(run.ID)
			if !current.Status.IsActive() || !processExists(pid) || hasEvent(store.EventsAfter(0).Events, run.ID, "exit", "") {
				t.Fatalf("live child was completed: %#v", current)
			}
			want := state.RunStatusStopped
			switch scenario.action {
			case "release":
				releaseWindowsChild(t, request)
				want = state.RunStatusExited
			case "automation":
				if _, err := supervisor.StopAutomation(run.ID); err != nil {
					t.Fatal(err)
				}
				want = state.RunStatusExited
			default:
				if _, err := supervisor.Stop(run.ID); err != nil {
					t.Fatal(err)
				}
			}
			completed := waitForRunStatus(t, store, run.ID, want)
			if completed.StoppedByUser != (scenario.action == "stop") || completed.AutomationExitMatched != (scenario.action == "automation") {
				t.Fatalf("incorrect stop flags: %#v", completed)
			}
			if processExists(pid) {
				t.Fatal("stopped run left its child alive")
			}
		})
	}
}
