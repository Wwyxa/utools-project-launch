//go:build windows

package process

import (
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"project-launch-service/internal/state"
)

func TestMain(tests *testing.M) {
	if handled, err := RunConsoleStopHelper(os.Args[1:]); handled {
		if err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(tests.Run())
}

func TestSupervisorWindowsGracefulStop(t *testing.T) {
	if os.Getenv("PROJECT_LAUNCH_SIGNAL_HELPER") == "1" {
		interrupted := make(chan os.Signal, 1)
		signal.Notify(interrupted, os.Interrupt)
		if err := os.WriteFile(os.Getenv("PROJECT_LAUNCH_SIGNAL_READY"), nil, 0600); err != nil {
			os.Exit(2)
		}
		select {
		case <-interrupted:
			if os.Getenv("PROJECT_LAUNCH_SIGNAL_IGNORE") != "1" {
				if err := os.WriteFile(os.Getenv("PROJECT_LAUNCH_SIGNAL_CLEAN"), []byte("clean"), 0600); err != nil {
					os.Exit(3)
				}
				return
			}
		case <-time.After(20 * time.Second):
			return
		}
		<-time.After(20 * time.Second)
		return
	}
	for _, ignore := range []bool{false, true} {
		t.Run(strconv.FormatBool(ignore), func(t *testing.T) {
			store := openStore(t)
			supervisor, err := NewSupervisor(store)
			if err != nil {
				t.Fatal(err)
			}
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			directory := t.TempDir()
			request := testStartRequest(t, `"`+executable+`" -test.run=^TestSupervisorWindowsGracefulStop$`)
			request.Env["PROJECT_LAUNCH_SIGNAL_HELPER"] = "1"
			request.Env["PROJECT_LAUNCH_SIGNAL_READY"] = filepath.Join(directory, "ready")
			request.Env["PROJECT_LAUNCH_SIGNAL_CLEAN"] = filepath.Join(directory, "clean")
			if ignore {
				request.Env["PROJECT_LAUNCH_SIGNAL_IGNORE"] = "1"
			}
			run, _, err := supervisor.Start(request)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _, _ = supervisor.Stop(run.ID) })
			deadline := time.After(5 * time.Second)
			ticker := time.NewTicker(20 * time.Millisecond)
			defer ticker.Stop()
			for {
				if _, err := os.Stat(request.Env["PROJECT_LAUNCH_SIGNAL_READY"]); err == nil {
					break
				}
				select {
				case <-deadline:
					t.Fatal("signal helper did not become ready")
				case <-ticker.C:
				}
			}
			started := time.Now()
			if _, err := supervisor.Stop(run.ID); err != nil {
				t.Fatal(err)
			}
			waitForRunStatus(t, store, run.ID, state.RunStatusStopped)
			contents, cleanErr := os.ReadFile(request.Env["PROJECT_LAUNCH_SIGNAL_CLEAN"])
			if ignore {
				if time.Since(started) < processStopGracePeriod || !os.IsNotExist(cleanErr) {
					t.Fatalf("unresponsive process was not escalated after grace period: %v", cleanErr)
				}
			} else if cleanErr != nil || string(contents) != "clean" {
				t.Fatalf("graceful stop did not execute cleanup: %q, %v", contents, cleanErr)
			}
			events := store.EventsAfter(0).Events
			if hasEvent(events, run.ID, "stderr", "forcing remaining processes") != ignore {
				t.Fatalf("forced stop diagnostic mismatch: %#v", events)
			}
		})
	}
}

func TestSupervisorWindowsPreservesGUIChildren(t *testing.T) {
	if os.Getenv("PROJECT_LAUNCH_GUI_LAUNCHER") == "1" {
		child := exec.Command(os.Getenv("PROJECT_LAUNCH_GUI_EXECUTABLE"), "-test.run=^TestSupervisorLongRunningChildHelper$")
		child.Env = append(os.Environ(), "PROJECT_LAUNCH_LONG_RUNNING_CHILD=1")
		if err := child.Start(); err != nil {
			os.Exit(2)
		}
		if os.Getenv("PROJECT_LAUNCH_GUI_HOLD_LAUNCHER") == "1" {
			<-time.After(8 * time.Second)
		}
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	guiExecutable := filepath.Join(t.TempDir(), "desktop-helper.exe")
	build := exec.Command("go", "test", "-c", "-ldflags=-H=windowsgui", "-o", guiExecutable, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build GUI helper: %v\n%s", err, output)
	}
	for _, action := range []string{"stop", "exit", "recovered-stop"} {
		t.Run(action, func(t *testing.T) {
			store := openStore(t)
			supervisor, err := NewSupervisor(store)
			if err != nil {
				t.Fatal(err)
			}
			request := windowsChildRequest(t, t.TempDir(), true)
			request.Command = `"` + executable + `" -test.run=^TestSupervisorWindowsPreservesGUIChildren$`
			request.Env["PROJECT_LAUNCH_GUI_LAUNCHER"] = "1"
			request.Env["PROJECT_LAUNCH_GUI_EXECUTABLE"] = guiExecutable
			if action != "exit" {
				request.Env["PROJECT_LAUNCH_GUI_HOLD_LAUNCHER"] = "1"
			}
			t.Cleanup(func() { releaseWindowsChild(t, request) })
			run, _, err := supervisor.Start(request)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _, _ = supervisor.Stop(run.ID) })
			pid := waitForWindowsChild(t, request)
			want := state.RunStatusStopped
			switch action {
			case "exit":
				want = state.RunStatusExited
			case "recovered-stop":
				err = terminateProcessTree(run.PID)
				want = state.RunStatusFailed
			default:
				_, err = supervisor.Stop(run.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			waitForRunStatus(t, store, run.ID, want)
			if !processExists(pid) {
				t.Fatal("script lifecycle terminated its GUI child")
			}
		})
	}
}

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
