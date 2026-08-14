package scheduler

import (
	"context"
	"encoding/json"
	"runtime"
	"strings"
	"testing"
	"time"

	serviceprocess "project-launch-service/internal/process"
	"project-launch-service/internal/state"
)

func TestSchedulerExecutesDuePlanOnce(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}
	runtime, err := New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}

	config, err := json.Marshal(Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "scheduled-project",
			Name: "Scheduled project",
			Path: stateDir,
			Env:  map[string]string{},
			Scripts: []ScriptConfig{{
				ID:      "scheduled-script",
				Name:    "Scheduled script",
				Command: "echo scheduled-once",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:        "scheduled-task",
				Name:      "Scheduled task",
				Enabled:   true,
				ScriptIDs: []string{"scheduled-script"},
				DailyPlans: []DailyPlan{{
					Date: time.Now().UTC().Format("2006-01-02"),
					Entries: []PlanEntry{{
						ID:        "due-entry",
						PlannedAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano),
						Status:    "pending",
					}},
				}},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler: %v", err)
	}
	waitForExecution(t, store, "scheduled-project", "scheduled-task", "due-entry", state.AutomationExecutionCompleted)

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler again: %v", err)
	}
	if runs := supervisor.StoreSnapshot().Runs; len(runs) != 1 {
		t.Fatalf("run count = %d, want 1 after repeat scheduler pass", len(runs))
	}
}

func TestSchedulerMarksExpiredGracePlanMissed(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}
	runtime, err := New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}

	config, err := json.Marshal(Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "missed-project",
			Name: "Missed project",
			Path: stateDir,
			Env:  map[string]string{},
			Scripts: []ScriptConfig{{
				ID:      "missed-script",
				Name:    "Missed script",
				Command: "echo should-not-run",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:                 "missed-task",
				Name:               "Missed task",
				Enabled:            true,
				MissedPolicy:       "grace-run",
				MissedGraceMinutes: 0,
				ScriptIDs:          []string{"missed-script"},
				DailyPlans: []DailyPlan{{
					Date: time.Now().UTC().Format("2006-01-02"),
					Entries: []PlanEntry{{
						ID:        "expired-entry",
						PlannedAt: time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano),
						Status:    "pending",
					}},
				}},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler: %v", err)
	}

	waitForExecution(t, store, "missed-project", "missed-task", "expired-entry", state.AutomationExecutionMissed)
	if runs := supervisor.StoreSnapshot().Runs; len(runs) != 0 {
		t.Fatalf("run count = %d, want no command for an expired grace plan", len(runs))
	}
}

func TestSchedulerFailsRecoveredAutomationExecutionWithoutRerunningIt(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	runID, err := state.NewRunID()
	if err != nil {
		t.Fatalf("create run id: %v", err)
	}
	run, created, err := store.CreateRun(state.Run{
		ID:              runID,
		ProjectID:       "recovered-project",
		ScriptID:        "recovered-script",
		Label:           "Recovered project / script",
		Command:         "echo should-not-rerun",
		Cwd:             stateDir,
		PID:             999999,
		Status:          state.RunStatusRunning,
		StartedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		ProcessIdentity: "stale-process-identity",
		AutomationRunID: "recovered-execution",
	}, "recovered-idempotency", "recovered-fingerprint")
	if err != nil || !created {
		t.Fatalf("create recovered run: run=%#v created=%t err=%v", run, created, err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1,"projects":[]}`)); err != nil {
		t.Fatalf("persist automation config: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, state.AutomationExecution{
		ID:          "recovered-execution",
		ProjectID:   run.ProjectID,
		TaskID:      "recovered-task",
		PlanEntryID: "recovered-entry",
		Status:      state.AutomationExecutionRunning,
		ActiveRunID: run.ID,
	}); err != nil || !claimed {
		t.Fatalf("claim recovered execution: claimed=%t err=%v", claimed, err)
	}

	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("recover process supervisor: %v", err)
	}
	runtime, err := New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("reconcile recovered automation execution: %v", err)
	}

	executions := store.Automation().Executions
	if len(executions) != 1 || executions[0].Status != state.AutomationExecutionFailed {
		t.Fatalf("automation executions = %#v, want one failed recovered execution", executions)
	}
	if len(executions[0].ScriptResults) != 1 || executions[0].ScriptResults[0].ScriptID != run.ScriptID {
		t.Fatalf("recovered script results = %#v, want recorded recovered script", executions[0].ScriptResults)
	}
	if len(supervisor.StoreSnapshot().Runs) != 1 {
		t.Fatalf("run count = %d, want no duplicate launch", len(supervisor.StoreSnapshot().Runs))
	}
}

func TestSchedulerStopsWhenConfiguredOutputMatches(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}
	runtime, err := New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}

	config, err := json.Marshal(Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "output-project",
			Name: "Output project",
			Path: stateDir,
			Env:  map[string]string{},
			Scripts: []ScriptConfig{{
				ID:      "output-script",
				Name:    "Output script",
				Command: outputMatchCommand(),
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:        "output-task",
				Name:      "Output task",
				Enabled:   true,
				ScriptIDs: []string{"output-script"},
				ExitConfigs: []ExitConfig{{
					ScriptID:  "output-script",
					Enabled:   true,
					MatchText: "SERVICE_READY",
				}},
				DailyPlans: []DailyPlan{{
					Date: time.Now().UTC().Format("2006-01-02"),
					Entries: []PlanEntry{{
						ID:        "output-entry",
						PlannedAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano),
						Status:    "pending",
					}},
				}},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}

	startedAt := time.Now()
	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler: %v", err)
	}
	waitForExecution(t, store, "output-project", "output-task", "output-entry", state.AutomationExecutionCompleted)
	if elapsed := time.Since(startedAt); elapsed > 2*time.Second {
		t.Fatalf("output match completion took %s, want command to stop before natural completion", elapsed)
	}

	runs := supervisor.StoreSnapshot().Runs
	if len(runs) != 1 || !runs[0].AutomationExitMatched {
		t.Fatalf("runs = %#v, want automation exit match marker", runs)
	}
}

func TestSchedulerSendsConfiguredInputSteps(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}
	runtime, err := New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}

	config, err := json.Marshal(Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "input-project",
			Name: "Input project",
			Path: stateDir,
			Env:  map[string]string{},
			Scripts: []ScriptConfig{{
				ID:      "input-script",
				Name:    "Input script",
				Command: inputCommand(),
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:        "input-task",
				Name:      "Input task",
				Enabled:   true,
				ScriptIDs: []string{"input-script"},
				InputConfigs: []InputConfig{{
					ScriptID: "input-script",
					Steps: []InputStep{{
						Mode:    "delay",
						Value:   "from-service",
						DelayMS: 0,
					}},
				}},
				DailyPlans: []DailyPlan{{
					Date: time.Now().UTC().Format("2006-01-02"),
					Entries: []PlanEntry{{
						ID:        "input-entry",
						PlannedAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano),
						Status:    "pending",
					}},
				}},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler: %v", err)
	}
	waitForExecution(t, store, "input-project", "input-task", "input-entry", state.AutomationExecutionCompleted)

	if !hasOutput(store.EventsAfter(0).Events, "input-script", "RECEIVED:from-service") {
		t.Fatalf("automation input was not delivered: %#v", store.EventsAfter(0).Events)
	}
}

func outputMatchCommand() string {
	if runtime.GOOS == "windows" {
		return "echo SERVICE_READY & ping -n 5 127.0.0.1 >nul"
	}
	return "echo SERVICE_READY; sleep 4"
}

func inputCommand() string {
	if runtime.GOOS == "windows" {
		return "set /p value= & call echo RECEIVED:^%value^%"
	}
	return "read value; echo RECEIVED:$value"
}

func hasOutput(events []state.Event, scriptID string, contents string) bool {
	for _, event := range events {
		if event.ScriptID == scriptID && event.Type == "stdout" && strings.Contains(event.Message, contents) {
			return true
		}
	}
	return false
}

func waitForExecution(
	t *testing.T,
	store *state.Store,
	projectID string,
	taskID string,
	planEntryID string,
	want state.AutomationExecutionStatus,
) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		for _, execution := range store.Automation().Executions {
			if execution.ProjectID == projectID && execution.TaskID == taskID && execution.PlanEntryID == planEntryID {
				if execution.Status == want {
					return
				}
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("automation execution %s/%s/%s did not reach %q: %#v", projectID, taskID, planEntryID, want, store.Automation().Executions)
}
