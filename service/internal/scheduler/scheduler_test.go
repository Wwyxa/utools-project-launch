package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
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
				ID:                       "scheduled-task",
				Name:                     "Scheduled task",
				Enabled:                  true,
				MissedPolicy:             "grace-run",
				MissedGraceMinutes:       5,
				ScriptIDs:                []string{"scheduled-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        "due-entry",
					PlannedAt: time.Now().Add(-3 * time.Minute).UTC().Format(time.RFC3339Nano),
				},
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
				ID:                       "early-task",
				Name:                     "Early task",
				Enabled:                  true,
				ScriptIDs:                []string{"early-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{ID: "early-entry", PlannedAt: plannedAt},
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
				ID:                       "manual-disabled-task",
				Name:                     "Manual disabled task",
				Enabled:                  false,
				ScriptIDs:                []string{"manual-disabled-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        "manual-disabled-entry",
					PlannedAt: time.Now().UTC().Format(time.RFC3339Nano),
				},
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
				ID:                       "claimed-task",
				Enabled:                  true,
				ScriptIDs:                []string{"claimed-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        "claimed-entry",
					PlannedAt: now.Add(time.Hour).Format(time.RFC3339Nano),
				},
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

	now := time.Date(2026, 8, 15, 10, 0, 0, 0, time.Local)
	config := Config{
		SchemaVersion: 1,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID: "future-project",
			AutomationTasks: []TaskConfig{{
				ID:                       "future-task",
				Enabled:                  true,
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "11:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
			}},
		}},
	}

	if delay := runtime.nextWakeDelay(now, config); delay != schedulerFuturePlanRecheckDelay {
		t.Fatalf("next wake delay = %s, want future-plan recheck delay %s", delay, schedulerFuturePlanRecheckDelay)
	}
}

func TestMaterializedAutomationPlansGenerateCurrentAndNextDayFromSchedule(t *testing.T) {
	now := time.Date(2026, 8, 15, 10, 0, 0, 0, time.Local).UTC()
	config := Config{
		SchemaVersion: SchemaVersion,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID: "materialized-project",
			AutomationTasks: []TaskConfig{{
				ID:                       "materialized-task",
				Enabled:                  true,
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "11:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
			}},
		}},
	}

	plans, activeTasks, retainAfter, err := materializedAutomationPlans(config, now, nil)
	if err != nil {
		t.Fatalf("materialize schedule plans: %v", err)
	}
	if len(activeTasks) != 1 || activeTasks[0] != (state.AutomationPlanTask{ProjectID: "materialized-project", TaskID: "materialized-task"}) {
		t.Fatalf("active tasks = %#v", activeTasks)
	}
	if retainAfter != "2026-08-08" {
		t.Fatalf("retain after = %q, want 2026-08-08", retainAfter)
	}
	if len(plans) != 2 {
		t.Fatalf("plan count = %d, want 2", len(plans))
	}
	if plans[0].Date != "2026-08-15" || plans[1].Date != "2026-08-16" {
		t.Fatalf("plan dates = %q, %q, want current and next local day", plans[0].Date, plans[1].Date)
	}
	for _, plan := range plans {
		if len(plan.Entries) != 1 {
			t.Fatalf("plan %q entry count = %d, want 1", plan.Date, len(plan.Entries))
		}
		if plan.Entries[0].ID != schedulePlanEntryID("materialized-task", plan.Date, ScheduleAlgorithmVersion, 0) {
			t.Fatalf("plan %q entry id = %q", plan.Date, plan.Entries[0].ID)
		}
	}

	upcoming := automationUpcomingEntries(config, plans, now)
	if len(upcoming) != 2 {
		t.Fatalf("upcoming count = %d, want 2", len(upcoming))
	}
}

func TestMaterializedAutomationPlansIncludesManualRunWithoutRendererDailyPlan(t *testing.T) {
	now := time.Date(2026, 8, 15, 10, 0, 0, 0, time.Local).UTC()
	manualPlannedAt := time.Date(2026, 8, 15, 10, 1, 0, 0, time.Local).UTC().Format(time.RFC3339Nano)
	config := Config{
		SchemaVersion: SchemaVersion,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID: "manual-project",
			AutomationTasks: []TaskConfig{{
				ID:                       "manual-task",
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "11:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{ID: "manual-entry", PlannedAt: manualPlannedAt},
			}},
		}},
	}

	plans, _, _, err := materializedAutomationPlans(config, now, nil)
	if err != nil {
		t.Fatalf("materialize plans with manual run: %v", err)
	}
	currentPlan := plans[0]
	manualEntry := currentPlan.Entries[len(currentPlan.Entries)-1]
	if manualEntry.ID != "manual-entry" || manualEntry.PlannedAt != manualPlannedAt || !manualEntry.RunEarly {
		t.Fatalf("manual entry = %#v", manualEntry)
	}
}

func TestMaterializedAutomationPlansAppliesPersistentEarlySubmission(t *testing.T) {
	now := time.Date(2026, 8, 15, 10, 0, 0, 0, time.Local).UTC()
	date := now.In(time.Local).Format("2006-01-02")
	entryID := schedulePlanEntryID("early-task", date, ScheduleAlgorithmVersion, 0)
	config := Config{
		SchemaVersion: SchemaVersion,
		Revision:      2,
		Projects: []ProjectConfig{{
			ID: "early-project",
			AutomationTasks: []TaskConfig{{
				ID:                       "early-task",
				Enabled:                  true,
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "11:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
			}},
		}},
	}

	plans, _, _, err := materializedAutomationPlans(config, now, []state.AutomationSubmission{{
		Kind:        state.AutomationSubmissionEarly,
		ProjectID:   "early-project",
		TaskID:      "early-task",
		PlanEntryID: entryID,
	}})
	if err != nil {
		t.Fatalf("materialize plans with persistent early submission: %v", err)
	}
	if !plans[0].Entries[0].RunEarly {
		t.Fatalf("early entry = %#v, want runEarly", plans[0].Entries[0])
	}
}

func TestSchedulerExecutesManualRunForDisabledTask(t *testing.T) {
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

	configValue := Config{
		SchemaVersion: SchemaVersion,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "manual-submission-project",
			Path: stateDir,
			Scripts: []ScriptConfig{{
				ID:      "manual-submission-script",
				Name:    "manual-submission",
				Command: "echo manual-submission",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:                       "manual-submission-task",
				Enabled:                  false,
				ScriptIDs:                []string{"manual-submission-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        "manual-submission-entry",
					PlannedAt: time.Now().UTC().Format(time.RFC3339Nano),
				},
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
	waitForExecution(t, store, "manual-submission-project", "manual-submission-task", "manual-submission-entry", state.AutomationExecutionCompleted)

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler again: %v", err)
	}
	if runs := supervisor.StoreSnapshot().Runs; len(runs) != 1 {
		t.Fatalf("run count = %d, want 1 after repeat scheduler pass", len(runs))
	}

	configValue.Revision = 2
	resyncedConfig, err := json.Marshal(configValue)
	if err != nil {
		t.Fatalf("marshal resynced config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(2, resyncedConfig); err != nil {
		t.Fatalf("resync completed manual config: %v", err)
	}
	if pending := store.Automation().PendingSubmissions; len(pending) != 0 {
		t.Fatalf("pending submissions = %#v, want no resubmission after completion", pending)
	}
	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler after resync: %v", err)
	}
	if runs := supervisor.StoreSnapshot().Runs; len(runs) != 1 {
		t.Fatalf("run count = %d, want 1 after completed manual resync", len(runs))
	}
}

func TestSchedulerExecutesPersistedManualSubmissionAfterConfigRefresh(t *testing.T) {
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

	manualEntryID := "persisted-manual-entry"
	config := Config{
		SchemaVersion: SchemaVersion,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID:   "persisted-manual-project",
			Path: stateDir,
			Scripts: []ScriptConfig{{
				ID:      "persisted-manual-script",
				Name:    "persisted-manual",
				Command: "echo persisted-manual",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:                       "persisted-manual-task",
				Enabled:                  false,
				ScriptIDs:                []string{"persisted-manual-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        manualEntryID,
					PlannedAt: time.Now().UTC().Format(time.RFC3339Nano),
				},
			}},
		}},
	}
	initial, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal initial config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, initial); err != nil {
		t.Fatalf("persist manual submission: %v", err)
	}
	config.Revision = 2
	config.Projects[0].AutomationTasks[0].ManualRun = nil
	refreshed, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal refreshed config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(2, refreshed); err != nil {
		t.Fatalf("replace config after renderer restart: %v", err)
	}

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("run scheduler after config refresh: %v", err)
	}
	waitForExecution(t, store, "persisted-manual-project", "persisted-manual-task", manualEntryID, state.AutomationExecutionCompleted)
	if pending := store.Automation().PendingSubmissions; len(pending) != 0 {
		t.Fatalf("pending submissions = %#v, want cleared after claim", pending)
	}
}

func TestAutomationSnapshotExposesUpcomingPlansFromScheduleRules(t *testing.T) {
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
	nextHour := time.Now().In(time.Local).Add(2 * time.Hour)
	config, err := json.Marshal(Config{
		SchemaVersion: SchemaVersion,
		Revision:      1,
		Projects: []ProjectConfig{{
			ID: "upcoming-project",
			Scripts: []ScriptConfig{{
				ID:      "upcoming-script",
				Name:    "upcoming",
				Command: "echo upcoming",
				Cwd:     stateDir,
			}},
			AutomationTasks: []TaskConfig{{
				ID:                       "upcoming-task",
				Enabled:                  true,
				ScriptIDs:                []string{"upcoming-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       nextHour.Format("15:04"),
					DailyCount:      1,
					IntervalMinutes: 1,
				},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if _, err := runtime.ReplaceConfiguration(1, config); err != nil {
		t.Fatalf("replace configuration: %v", err)
	}

	snapshot := runtime.AutomationSnapshot()
	if len(snapshot.Upcoming) == 0 {
		t.Fatal("automation snapshot is missing service-owned upcoming plans")
	}
	if snapshot.Upcoming[0].ProjectID != "upcoming-project" || snapshot.Upcoming[0].TaskID != "upcoming-task" {
		t.Fatalf("upcoming plan = %#v", snapshot.Upcoming[0])
	}
	if snapshot.Plans != nil {
		t.Fatalf("automation snapshot exposes internal plans: %#v", snapshot.Plans)
	}
}

func TestAutomationUpcomingEntriesAreGloballyCapped(t *testing.T) {
	now := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)
	entries := make([]state.AutomationPlanEntry, 1440)
	for index := range entries {
		entries[index] = state.AutomationPlanEntry{
			ID:        fmt.Sprintf("entry-%04d", index),
			PlannedAt: now.Add(time.Duration(index+1) * time.Minute).Format(time.RFC3339Nano),
			Status:    state.AutomationPlanEntryPending,
		}
	}
	config := Config{Projects: []ProjectConfig{{
		ID: "project",
		AutomationTasks: []TaskConfig{{
			ID:      "task",
			Enabled: true,
		}},
	}}}
	upcoming := automationUpcomingEntries(config, []state.AutomationPlan{{
		ProjectID: "project",
		TaskID:    "task",
		Entries:   entries,
	}}, now)
	if len(upcoming) != maxAutomationUpcoming {
		t.Fatalf("upcoming count = %d, want %d", len(upcoming), maxAutomationUpcoming)
	}
	if upcoming[0].PlanEntryID != "entry-0000" || upcoming[len(upcoming)-1].PlanEntryID != "entry-0099" {
		t.Fatalf("upcoming boundary = %#v, want first 100 entries", upcoming)
	}
}

func TestRandomScheduleMatchesCanonicalVectors(t *testing.T) {
	previousLocal := time.Local
	time.Local = time.FixedZone("UTC", 0)
	t.Cleanup(func() { time.Local = previousLocal })

	tests := []struct {
		name     string
		taskID   string
		date     string
		schedule ScheduleConfig
		minutes  []int
	}{
		{
			name:   "three entries",
			taskID: "vector-task",
			date:   "2026-08-15",
			schedule: ScheduleConfig{
				Type:               "random",
				WindowStart:        "08:00",
				WindowEnd:          "18:00",
				DailyCount:         3,
				MinIntervalMinutes: 30,
				MaxIntervalMinutes: 120,
			},
			minutes: []int{513, 553, 656},
		},
		{
			name:   "single entry",
			taskID: "vector-task",
			date:   "2026-08-15",
			schedule: ScheduleConfig{
				Type:        "random",
				WindowStart: "00:00",
				WindowEnd:   "23:59",
				DailyCount:  1,
			},
			minutes: []int{227},
		},
		{
			name:   "tight window",
			taskID: "vector-task",
			date:   "2026-08-15",
			schedule: ScheduleConfig{
				Type:               "random",
				WindowStart:        "09:00",
				WindowEnd:          "12:00",
				DailyCount:         4,
				MinIntervalMinutes: 10,
				MaxIntervalMinutes: 45,
			},
			minutes: []int{674, 690, 705, 718},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			minutes, err := randomScheduleMinutes(test.taskID, test.date, test.schedule)
			if err != nil {
				t.Fatalf("random schedule: %v", err)
			}
			if !reflect.DeepEqual(minutes, test.minutes) {
				t.Fatalf("random minutes = %#v, want %#v", minutes, test.minutes)
			}
		})
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
	now := time.Now().In(time.Local)
	scheduleTime := now.Add(-time.Minute)
	if scheduleTime.Format("2006-01-02") != now.Format("2006-01-02") {
		scheduleTime = now
	}
	expiredEntryID := schedulePlanEntryID("missed-task", now.Format("2006-01-02"), ScheduleAlgorithmVersion, 0)

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
				ID:                       "missed-task",
				Name:                     "Missed task",
				Enabled:                  true,
				MissedPolicy:             "grace-run",
				MissedGraceMinutes:       0,
				ScriptIDs:                []string{"missed-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       scheduleTime.Format("15:04"),
					DailyCount:      1,
					IntervalMinutes: 1,
				},
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

	waitForExecution(t, store, "missed-project", "missed-task", expiredEntryID, state.AutomationExecutionMissed)
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
	if executions[0].ScriptResults[0].Status != state.AutomationScriptFailed {
		t.Fatalf("recovered script status = %q, want failed", executions[0].ScriptResults[0].Status)
	}
	if len(supervisor.StoreSnapshot().Runs) != 1 {
		t.Fatalf("run count = %d, want no duplicate launch", len(supervisor.StoreSnapshot().Runs))
	}
}

func TestSchedulerFailsOrphanedRecoveredAutomationExecution(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1,"projects":[]}`)); err != nil {
		t.Fatalf("persist automation config: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, state.AutomationExecution{
		ID:          "orphaned-recovered-execution",
		ProjectID:   "orphaned-project",
		TaskID:      "orphaned-task",
		PlanEntryID: "orphaned-entry",
		Status:      state.AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim orphaned execution: claimed=%t err=%v", claimed, err)
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
		t.Fatalf("reconcile orphaned automation execution: %v", err)
	}

	executions := store.Automation().Executions
	if len(executions) != 1 || executions[0].Status != state.AutomationExecutionFailed || executions[0].ActiveRunID != "" {
		t.Fatalf("automation executions = %#v, want one failed orphaned execution", executions)
	}
	if len(supervisor.StoreSnapshot().Runs) != 0 {
		t.Fatalf("run count = %d, want no duplicate launch", len(supervisor.StoreSnapshot().Runs))
	}
}

func TestSchedulerKeepsInFlightExecutionDuringSameProcessReconcile(t *testing.T) {
	stateDir := t.TempDir()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1,"projects":[]}`)); err != nil {
		t.Fatalf("persist automation config: %v", err)
	}
	execution, claimed, err := store.ClaimAutomationExecution(1, state.AutomationExecution{
		ID:          "in-flight-execution",
		ProjectID:   "in-flight-project",
		TaskID:      "in-flight-task",
		PlanEntryID: "in-flight-entry",
		Status:      state.AutomationExecutionRunning,
	})
	if err != nil || !claimed {
		t.Fatalf("claim in-flight execution: claimed=%t err=%v", claimed, err)
	}

	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("recover process supervisor: %v", err)
	}
	runtime, err := New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}
	runtime.executionMu.Lock()
	runtime.inFlightExecutions[execution.ID] = struct{}{}
	runtime.executionMu.Unlock()
	t.Cleanup(func() {
		runtime.finishExecution(execution.ID)
	})

	if err := runtime.RunOnce(context.Background()); err != nil {
		t.Fatalf("reconcile in-flight execution: %v", err)
	}

	executions := store.Automation().Executions
	if len(executions) != 1 || executions[0].Status != state.AutomationExecutionRunning {
		t.Fatalf("automation executions = %#v, want retained in-flight execution", executions)
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
				ID:                       "output-task",
				Name:                     "Output task",
				Enabled:                  true,
				ScriptIDs:                []string{"output-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        "output-entry",
					PlannedAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano),
				},
				ExitConfigs: []ExitConfig{{
					ScriptID:  "output-script",
					Enabled:   true,
					MatchText: "SERVICE_READY",
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
				ID:                       "input-task",
				Name:                     "Input task",
				Enabled:                  true,
				ScriptIDs:                []string{"input-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        "input-entry",
					PlannedAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano),
				},
				InputConfigs: []InputConfig{{
					ScriptID: "input-script",
					Steps: []InputStep{{
						Mode:    "delay",
						Value:   "from-service",
						DelayMS: 0,
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
				ID:                       "continuous-task",
				Name:                     "Continuous task",
				Enabled:                  true,
				ScriptIDs:                []string{"continuous-script", "follower-script"},
				ContinuousScriptIDs:      []string{"continuous-script"},
				ScheduleAlgorithmVersion: ScheduleAlgorithmVersion,
				Schedule: &ScheduleConfig{
					Type:            "fixed",
					StartTime:       "23:00",
					DailyCount:      1,
					IntervalMinutes: 1,
				},
				ManualRun: &ManualRunConfig{
					ID:        "first-entry",
					PlannedAt: now.Add(-time.Second).UTC().Format(time.RFC3339Nano),
				},
				InputConfigs: []InputConfig{{
					ScriptID: "continuous-script",
					Steps: []InputStep{{
						Mode:    "delay",
						Value:   "from-service",
						DelayMS: 0,
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
	configValue.Projects[0].AutomationTasks[0].ManualRun = &ManualRunConfig{
		ID:        "second-entry",
		PlannedAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano),
	}
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
