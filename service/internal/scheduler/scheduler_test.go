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
				ID:                 "scheduled-task",
				Name:               "Scheduled task",
				Enabled:            true,
				MissedPolicy:       "grace-run",
				MissedGraceMinutes: 5,
				ScriptIDs:          []string{"scheduled-script"},
				DailyPlans: []DailyPlan{{
					Date: time.Now().UTC().Format("2006-01-02"),
					Entries: []PlanEntry{{
						ID:        "due-entry",
						PlannedAt: time.Now().Add(-3 * time.Minute).UTC().Format(time.RFC3339Nano),
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

func TestSchedulerExecutesEarlyPlanWithOriginalPlannedTime(t *testing.T) {
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

	plannedAt := time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
	config, err := json.Marshal(Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "early-project",
			Name: "Early project",
			Path: stateDir,
			Env:  map[string]string{},
			Scripts: []ScriptConfig{{
				ID:      "early-script",
				Name:    "Early script",
				Command: "echo early",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:        "early-task",
				Name:      "Early task",
				Enabled:   true,
				ScriptIDs: []string{"early-script"},
				DailyPlans: []DailyPlan{{
					Date: time.Now().UTC().Format("2006-01-02"),
					Entries: []PlanEntry{{
						ID:        "early-entry",
						PlannedAt: plannedAt,
						Status:    "pending",
						RunEarly:  true,
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
	waitForExecution(t, store, "early-project", "early-task", "early-entry", state.AutomationExecutionCompleted)

	found := false
	for _, execution := range store.Automation().Executions {
		if execution.ID != executionID("early-project", "early-task", "early-entry") {
			continue
		}
		found = true
		if execution.PlannedAt != plannedAt {
			t.Fatalf("execution planned time = %q, want %q", execution.PlannedAt, plannedAt)
		}
	}
	if !found {
		t.Fatal("early execution was not persisted")
	}
}

func TestSchedulerExecutesManualEarlyPlanForDisabledTask(t *testing.T) {
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
			ID:   "manual-disabled-project",
			Name: "Manual disabled project",
			Path: stateDir,
			Env:  map[string]string{},
			Scripts: []ScriptConfig{{
				ID:      "manual-disabled-script",
				Name:    "Manual disabled script",
				Command: "echo manual-disabled",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:        "manual-disabled-task",
				Name:      "Manual disabled task",
				Enabled:   false,
				ScriptIDs: []string{"manual-disabled-script"},
				DailyPlans: []DailyPlan{{
					Date: time.Now().UTC().Format("2006-01-02"),
					Entries: []PlanEntry{{
						ID:        "manual-disabled-entry",
						PlannedAt: time.Now().UTC().Format(time.RFC3339Nano),
						Status:    "pending",
						RunEarly:  true,
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
	waitForExecution(t, store, "manual-disabled-project", "manual-disabled-task", "manual-disabled-entry", state.AutomationExecutionCompleted)
}

func TestSchedulerContinuesAfterRecoverableErrorAndRecovers(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":2,"projects":[]}`)); err != nil {
		t.Fatalf("persist invalid scheduler revision: %v", err)
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}
	runtime, err := New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		runtime.Run(ctx)
		close(done)
	}()
	waitForSchedulerHealth(t, runtime, func(health SchedulerHealth) bool {
		return health.State == SchedulerStateDegraded && health.LastError != ""
	})

	config, err := json.Marshal(Config{SchemaVersion: 1, Revision: 2, Projects: []ProjectConfig{}})
	if err != nil {
		t.Fatalf("marshal recovered scheduler config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(2, config); err != nil {
		t.Fatalf("replace recovered scheduler config: %v", err)
	}
	waitForSchedulerHealth(t, runtime, func(health SchedulerHealth) bool {
		return health.State == SchedulerStateRunning && health.LastSuccessAt != "" && health.LastError == ""
	})

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("scheduler did not stop after context cancellation")
	}
}

func TestSchedulerWakesForConfigurationReplacement(t *testing.T) {
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
	woke := make(chan bool, 1)
	go func() {
		woke <- runtime.waitForNextIteration(context.Background(), time.Hour)
	}()

	config, err := json.Marshal(Config{SchemaVersion: 1, Revision: 1, Projects: []ProjectConfig{}})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}

	select {
	case awakened := <-woke:
		if !awakened {
			t.Fatal("configuration replacement did not wake the scheduler")
		}
	case <-time.After(time.Second):
		t.Fatal("configuration replacement did not wake the scheduler")
	}
}

func TestSchedulerNextWakeSkipsClaimedEarlyPlan(t *testing.T) {
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

	now := time.Now().UTC()
	configValue := Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "claimed-project",
			Path: stateDir,
			Scripts: []ScriptConfig{{
				ID:      "claimed-script",
				Name:    "claimed",
				Command: "echo claimed",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:        "claimed-task",
				Enabled:   true,
				ScriptIDs: []string{"claimed-script"},
				DailyPlans: []DailyPlan{{
					Entries: []PlanEntry{{
						ID:        "claimed-entry",
						PlannedAt: now.Add(time.Hour).Format(time.RFC3339Nano),
						Status:    "pending",
						RunEarly:  true,
					}},
				}},
			}},
		}},
	}
	config, err := json.Marshal(configValue)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, state.AutomationExecution{
		ID:          executionID("claimed-project", "claimed-task", "claimed-entry"),
		ProjectID:   "claimed-project",
		TaskID:      "claimed-task",
		PlanEntryID: "claimed-entry",
		Status:      state.AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim execution: claimed=%t err=%v", claimed, err)
	}

	if delay := runtime.nextWakeDelay(now, configValue); delay != schedulerIdleWakeDelay {
		t.Fatalf("next wake delay = %s, want idle delay %s", delay, schedulerIdleWakeDelay)
	}
}

func TestSchedulerRechecksFuturePlansAfterSleepRecovery(t *testing.T) {
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

	now := time.Now().UTC()
	config := Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID: "future-project",
			AutomationTasks: []TaskConfig{{
				ID:      "future-task",
				Enabled: true,
				DailyPlans: []DailyPlan{{
					Entries: []PlanEntry{{
						ID:        "future-entry",
						PlannedAt: now.Add(time.Hour).Format(time.RFC3339Nano),
						Status:    "pending",
					}},
				}},
			}},
		}},
	}

	if delay := runtime.nextWakeDelay(now, config); delay != schedulerFuturePlanRecheckDelay {
		t.Fatalf("next wake delay = %s, want future-plan recheck delay %s", delay, schedulerFuturePlanRecheckDelay)
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

func TestSchedulerContinuesAfterContinuousScriptInput(t *testing.T) {
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

	now := time.Now()
	configValue := Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "continuous-project",
			Name: "Continuous project",
			Path: stateDir,
			Env:  map[string]string{},
			Scripts: []ScriptConfig{
				{
					ID:      "continuous-script",
					Name:    "continuous",
					Command: continuousInputCommand(),
					Cwd:     stateDir,
				},
				{
					ID:      "follower-script",
					Name:    "follower",
					Command: "echo follower",
					Cwd:     stateDir,
				},
			},
			AutomationTasks: []TaskConfig{{
				ID:                  "continuous-task",
				Name:                "Continuous task",
				Enabled:             true,
				ScriptIDs:           []string{"continuous-script", "follower-script"},
				ContinuousScriptIDs: []string{"continuous-script"},
				InputConfigs: []InputConfig{{
					ScriptID: "continuous-script",
					Steps: []InputStep{{
						Mode:    "delay",
						Value:   "from-service",
						DelayMS: 0,
					}},
				}},
				DailyPlans: []DailyPlan{{
					Date: now.UTC().Format("2006-01-02"),
					Entries: []PlanEntry{
						{
							ID:        "first-entry",
							PlannedAt: now.Add(-time.Second).UTC().Format(time.RFC3339Nano),
							Status:    "pending",
						},
						{
							ID:        "second-entry",
							PlannedAt: now.Add(time.Hour).UTC().Format(time.RFC3339Nano),
							Status:    "pending",
						},
					},
				}},
			}},
		}},
	}
	config, err := json.Marshal(configValue)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler: %v", err)
	}
	waitForExecution(t, store, "continuous-project", "continuous-task", "first-entry", state.AutomationExecutionCompleted)

	deadline := time.Now().Add(time.Second)
	for !hasOutput(store.EventsAfter(0).Events, "continuous-script", "RECEIVED:from-service") && time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
	}
	if !hasOutput(store.EventsAfter(0).Events, "continuous-script", "RECEIVED:from-service") {
		t.Fatalf("continuous script did not receive automation input: %#v", store.EventsAfter(0).Events)
	}

	executions := store.Automation().Executions
	if len(executions) != 1 || len(executions[0].ScriptResults) != 2 {
		t.Fatalf("first execution results = %#v, want both scripts", executions)
	}
	if executions[0].ScriptResults[0].Status != state.AutomationScriptStarted || executions[0].ScriptResults[1].Status != state.AutomationScriptCompleted {
		t.Fatalf("first execution results = %#v, want started then completed", executions[0].ScriptResults)
	}

	var continuousRun state.Run
	continuousRuns := 0
	for _, run := range supervisor.StoreSnapshot().Runs {
		if run.ScriptID == "continuous-script" {
			continuousRuns++
			continuousRun = run
		}
	}
	if continuousRuns != 1 || !continuousRun.Status.IsActive() {
		t.Fatalf("continuous runs = %#v, want one active continuous run", supervisor.StoreSnapshot().Runs)
	}
	defer func() {
		if _, err := supervisor.Stop(continuousRun.ID); err != nil {
			t.Errorf("stop continuous run: %v", err)
			return
		}
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			run, found := store.Run(continuousRun.ID)
			if found && !run.Status.IsActive() {
				return
			}
			time.Sleep(25 * time.Millisecond)
		}
		t.Errorf("continuous run %q did not stop before test cleanup", continuousRun.ID)
	}()

	configValue.Revision = 2
	configValue.Projects[0].AutomationTasks[0].DailyPlans[0].Entries[1].PlannedAt = time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)
	config, err = json.Marshal(configValue)
	if err != nil {
		t.Fatalf("marshal second config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(2, config); err != nil {
		t.Fatalf("replace second configuration: %v", err)
	}
	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler for second entry: %v", err)
	}
	waitForExecution(t, store, "continuous-project", "continuous-task", "second-entry", state.AutomationExecutionCompleted)

	continuousRuns = 0
	for _, run := range supervisor.StoreSnapshot().Runs {
		if run.ScriptID == "continuous-script" {
			continuousRuns++
		}
	}
	if continuousRuns != 1 {
		t.Fatalf("continuous run count = %d, want one after repeated task", continuousRuns)
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

func continuousInputCommand() string {
	if runtime.GOOS == "windows" {
		return "set /p value= & call echo RECEIVED:^%value^% & ping -n 15 127.0.0.1 >nul"
	}
	return "read value; echo RECEIVED:$value; sleep 15"
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

func waitForSchedulerHealth(t *testing.T, runtime *Runtime, predicate func(SchedulerHealth) bool) {
	t.Helper()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()

	for {
		select {
		case <-ticker.C:
			if predicate(runtime.Health()) {
				return
			}
		case <-deadline.C:
			t.Fatalf("scheduler health did not reach expected state: %#v", runtime.Health())
		}
	}
}
