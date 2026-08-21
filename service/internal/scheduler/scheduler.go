package scheduler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	serviceprocess "project-launch-service/internal/process"
	"project-launch-service/internal/state"
)

const (
	SchemaVersion             = 1
	ScheduleAlgorithmVersion  = 1
	materializedPlanLookahead = 1
	materializedPlanRetention = 7
	maxAutomationDailyEntries = 1440
	maxAutomationUpcoming     = 100
	minutesPerDay             = 24 * 60
)

type SchedulerState string

const (
	SchedulerStateRunning  SchedulerState = "running"
	SchedulerStateDegraded SchedulerState = "degraded"
)

type SchedulerHealth struct {
	State         SchedulerState `json:"state"`
	LastRunAt     string         `json:"lastRunAt,omitempty"`
	LastSuccessAt string         `json:"lastSuccessAt,omitempty"`
	LastError     string         `json:"lastError,omitempty"`
}

type Config struct {
	SchemaVersion int             `json:"schemaVersion"`
	Revision      uint64          `json:"revision"`
	Projects      []ProjectConfig `json:"projects"`
}

type ProjectConfig struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Path            string            `json:"path"`
	Env             map[string]string `json:"env"`
	Scripts         []ScriptConfig    `json:"scripts"`
	AutomationTasks []TaskConfig      `json:"automationTasks"`
}

type ScriptConfig struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
	Cwd     string `json:"cwd"`
}

type TaskConfig struct {
	ID                       string           `json:"id"`
	Name                     string           `json:"name"`
	Enabled                  bool             `json:"enabled"`
	ScriptIDs                []string         `json:"scriptIds"`
	ContinuousScriptIDs      []string         `json:"continuousScriptIds"`
	Schedule                 *ScheduleConfig  `json:"schedule,omitempty"`
	ScheduleAlgorithmVersion int              `json:"scheduleAlgorithmVersion,omitempty"`
	RunEarlyEntryID          string           `json:"runEarlyEntryId,omitempty"`
	ManualRun                *ManualRunConfig `json:"manualRun,omitempty"`
	MissedPolicy             string           `json:"missedPolicy"`
	MissedGraceMinutes       int              `json:"missedGraceMinutes"`
	MaxScriptRuntimeMinutes  int              `json:"maxScriptRuntimeMinutes"`
	InputConfigs             []InputConfig    `json:"inputConfigs"`
	ExitConfigs              []ExitConfig     `json:"exitConfigs"`
}

type ScheduleConfig struct {
	Type               string `json:"type"`
	StartTime          string `json:"startTime,omitempty"`
	WindowStart        string `json:"windowStart,omitempty"`
	WindowEnd          string `json:"windowEnd,omitempty"`
	DailyCount         int    `json:"dailyCount"`
	IntervalMinutes    int    `json:"intervalMinutes,omitempty"`
	MinIntervalMinutes int    `json:"minIntervalMinutes,omitempty"`
	MaxIntervalMinutes int    `json:"maxIntervalMinutes,omitempty"`
}

type ManualRunConfig struct {
	ID        string `json:"id"`
	PlannedAt string `json:"plannedAt"`
}

type InputConfig struct {
	ScriptID string      `json:"scriptId"`
	Steps    []InputStep `json:"steps"`
}

type InputStep struct {
	ID        string `json:"id"`
	Mode      string `json:"mode"`
	Value     string `json:"value"`
	DelayMS   int    `json:"delayMs"`
	MatchText string `json:"matchText"`
	TimeoutMS int    `json:"timeoutMs"`
}

type ExitConfig struct {
	ScriptID  string `json:"scriptId"`
	Enabled   bool   `json:"enabled"`
	MatchText string `json:"matchText"`
}

type Runtime struct {
	store              *state.Store
	supervisor         *serviceprocess.Supervisor
	replaceMu          sync.Mutex
	executionMu        sync.Mutex
	inFlightExecutions map[string]struct{}
	healthMu           sync.RWMutex
	health             SchedulerHealth
	wake               chan struct{}
}

const (
	schedulerIdleWakeDelay          = 24 * time.Hour
	schedulerFuturePlanRecheckDelay = 30 * time.Second
	schedulerRetryInitialDelay      = time.Second
	schedulerRetryMaximumDelay      = time.Minute
	recoveredRunPollInterval        = 500 * time.Millisecond
	defaultMaxScriptRuntime         = 30 * time.Minute
	defaultOutputMatchWait          = 30 * time.Second
	maxAutomationOutputTailLen      = 64 * 1024
	maxSchedulerHealthErrorLen      = 512
)

func New(store *state.Store, supervisor *serviceprocess.Supervisor) (*Runtime, error) {
	if store == nil {
		return nil, errors.New("runtime state store is required")
	}
	if supervisor == nil {
		return nil, errors.New("process supervisor is required")
	}

	return &Runtime{
		store:              store,
		supervisor:         supervisor,
		inFlightExecutions: make(map[string]struct{}),
		wake:               make(chan struct{}, 1),
		health: SchedulerHealth{
			State: SchedulerStateRunning,
		},
	}, nil
}

func (runtime *Runtime) Health() SchedulerHealth {
	runtime.healthMu.RLock()
	defer runtime.healthMu.RUnlock()

	return runtime.health
}

func (runtime *Runtime) AutomationSnapshot() state.AutomationState {
	automation := runtime.store.Automation()
	if automation.Revision == 0 || len(automation.Config) == 0 {
		automation.Plans = nil
		return automation
	}

	config, err := decodeConfig(automation.Config)
	if err != nil || config.Revision != automation.Revision {
		automation.Plans = nil
		return automation
	}
	plans := automation.Plans
	if len(plans) == 0 {
		fallbackPlans, _, _, materializeErr := materializedAutomationPlans(config, time.Now().UTC(), automation.PendingSubmissions)
		if materializeErr == nil {
			plans = fallbackPlans
		}
	}
	automation.Upcoming = automationUpcomingEntries(config, plans, time.Now().UTC())
	automation.Plans = nil
	return automation
}

func (runtime *Runtime) ReplaceConfiguration(revision uint64, rawConfig json.RawMessage) (state.AutomationState, error) {
	config, err := decodeConfig(rawConfig)
	if err != nil {
		return state.AutomationState{}, err
	}
	if revision == 0 || config.Revision != revision {
		return state.AutomationState{}, errors.New("automation configuration revision does not match the requested revision")
	}
	runtime.replaceMu.Lock()
	defer runtime.replaceMu.Unlock()

	current := runtime.store.Automation()
	if current.Revision == revision && bytes.Equal(current.Config, rawConfig) {
		runtime.clearHealthError()
		return current, nil
	}

	updated, err := runtime.store.ReplaceAutomationWithSubmissions(
		revision,
		rawConfig,
		automationSubmissionsFromConfig(config),
	)
	if err != nil {
		return state.AutomationState{}, err
	}
	runtime.clearHealthError()
	runtime.signalWake()
	return updated, nil
}

func automationSubmissionsFromConfig(config Config) []state.AutomationSubmission {
	submissions := make([]state.AutomationSubmission, 0)
	for _, project := range config.Projects {
		for _, task := range project.AutomationTasks {
			if task.ManualRun != nil {
				submissions = append(submissions, state.AutomationSubmission{
					Kind:        state.AutomationSubmissionManual,
					ProjectID:   project.ID,
					TaskID:      task.ID,
					PlanEntryID: task.ManualRun.ID,
					PlannedAt:   task.ManualRun.PlannedAt,
				})
			}
			if task.RunEarlyEntryID != "" {
				submissions = append(submissions, state.AutomationSubmission{
					Kind:        state.AutomationSubmissionEarly,
					ProjectID:   project.ID,
					TaskID:      task.ID,
					PlanEntryID: task.RunEarlyEntryID,
				})
			}
		}
	}
	return submissions
}

func (runtime *Runtime) Run(ctx context.Context) {
	if ctx == nil {
		return
	}

	delay := time.Duration(0)
	failures := 0
	for {
		if delay > 0 && !runtime.waitForNextIteration(ctx, delay) {
			return
		}

		nextDelay, err := runtime.runIteration(ctx)
		if errors.Is(err, context.Canceled) {
			return
		}
		if err != nil {
			failures++
			delay = schedulerRetryDelay(failures)
			continue
		}
		failures = 0
		delay = nextDelay
	}
}

func (runtime *Runtime) RunOnce(ctx context.Context) error {
	_, err := runtime.runIteration(ctx)
	return err
}

func (runtime *Runtime) runIteration(ctx context.Context) (time.Duration, error) {
	runtime.markIterationStarted()
	delay, err := runtime.runOnce(ctx)
	if err == nil {
		runtime.markIterationSucceeded()
	} else if !errors.Is(err, context.Canceled) {
		runtime.markIterationFailed(err)
	}
	return delay, err
}

func (runtime *Runtime) waitForNextIteration(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
	}()

	select {
	case <-ctx.Done():
		return false
	case <-runtime.wake:
		return true
	case <-timer.C:
		return true
	}
}

func (runtime *Runtime) signalWake() {
	select {
	case runtime.wake <- struct{}{}:
	default:
	}
}

func (runtime *Runtime) startExecution(
	execution state.AutomationExecution,
	project ProjectConfig,
	task TaskConfig,
	scripts map[string]ScriptConfig,
) {
	runtime.executionMu.Lock()
	runtime.inFlightExecutions[execution.ID] = struct{}{}
	runtime.executionMu.Unlock()

	go runtime.execute(execution, project, task, scripts)
}

func (runtime *Runtime) executionInFlight(executionID string) bool {
	runtime.executionMu.Lock()
	defer runtime.executionMu.Unlock()

	_, found := runtime.inFlightExecutions[executionID]
	return found
}

func (runtime *Runtime) finishExecution(executionID string) {
	runtime.executionMu.Lock()
	delete(runtime.inFlightExecutions, executionID)
	runtime.executionMu.Unlock()
}

func schedulerRetryDelay(failures int) time.Duration {
	delay := schedulerRetryInitialDelay
	for index := 1; index < failures && delay < schedulerRetryMaximumDelay; index++ {
		if delay > schedulerRetryMaximumDelay/2 {
			return schedulerRetryMaximumDelay
		}
		delay *= 2
	}
	return delay
}

func (runtime *Runtime) runOnce(ctx context.Context) (time.Duration, error) {
	if ctx == nil {
		return 0, errors.New("scheduler context is required")
	}
	recoveredRuns, err := runtime.supervisor.ReconcileRecoveredRuns()
	if err != nil {
		return 0, fmt.Errorf("reconcile recovered process state: %w", err)
	}

	automation := runtime.store.Automation()
	if automation.Revision == 0 {
		return runtime.nextWakeDelay(time.Now().UTC(), Config{}), nil
	}
	if len(automation.Config) == 0 {
		return 0, errors.New("persisted automation configuration is missing")
	}

	config, err := decodeConfig(automation.Config)
	if err != nil {
		return 0, fmt.Errorf("parse persisted automation configuration: %w", err)
	}
	if config.Revision != automation.Revision {
		return 0, errors.New("persisted automation configuration revision is inconsistent")
	}

	now := time.Now().UTC()
	automation, err = runtime.materializeAutomationPlans(automation.Revision, config, now, automation.PendingSubmissions)
	if err != nil {
		return 0, fmt.Errorf("materialize automation plans: %w", err)
	}
	if err := runtime.reconcileRecoveredAutomationExecutions(recoveredRuns); err != nil {
		return 0, err
	}
	for _, scheduled := range automationPlanEntries(config, automation.Plans) {
		project := scheduled.Project
		task := scheduled.Task
		entry := scheduled.Entry
		if entry.Status != state.AutomationPlanEntryPending || (!task.Enabled && !entry.RunEarly) {
			continue
		}
		plannedAt, err := time.Parse(time.RFC3339Nano, entry.PlannedAt)
		if err != nil {
			return 0, fmt.Errorf("parse planned time for %s/%s/%s: %w", project.ID, task.ID, entry.ID, err)
		}
		if plannedAt.After(now) && !entry.RunEarly {
			continue
		}
		if !entry.RunEarly && shouldMarkMissed(task, plannedAt, now) {
			if err := runtime.recordMissedExecution(automation.Revision, project, task, entry, now); err != nil {
				return 0, err
			}
			continue
		}
		if err := ctx.Err(); err != nil {
			return 0, err
		}

		scripts := make(map[string]ScriptConfig, len(project.Scripts))
		for _, script := range project.Scripts {
			scripts[script.ID] = script
		}
		execution, claimed, err := runtime.store.ClaimAutomationExecution(automation.Revision, state.AutomationExecution{
			ID:                 executionID(project.ID, task.ID, entry.ID),
			ProjectID:          project.ID,
			TaskID:             task.ID,
			PlanEntryID:        entry.ID,
			PlannedAt:          entry.PlannedAt,
			Status:             state.AutomationExecutionRunning,
			CurrentScriptIndex: 0,
			StartedAt:          time.Now().UTC().Format(time.RFC3339Nano),
			ScriptResults:      []state.AutomationScriptResult{},
		})
		if err != nil {
			return 0, fmt.Errorf("claim scheduled execution: %w", err)
		}
		if claimed {
			runtime.startExecution(execution, project, task, scripts)
		}
	}

	return runtime.nextWakeDelay(now, config), nil
}

type scheduledAutomationEntry struct {
	Project ProjectConfig
	Task    TaskConfig
	Entry   state.AutomationPlanEntry
}

func (runtime *Runtime) materializeAutomationPlans(
	revision uint64,
	config Config,
	now time.Time,
	pendingSubmissions []state.AutomationSubmission,
) (state.AutomationState, error) {
	plans, tasks, retainAfter, err := materializedAutomationPlans(config, now, pendingSubmissions)
	if err != nil {
		return state.AutomationState{}, err
	}
	return runtime.store.ReconcileAutomationPlans(revision, plans, tasks, retainAfter)
}

func materializedAutomationPlans(
	config Config,
	now time.Time,
	pendingSubmissions []state.AutomationSubmission,
) ([]state.AutomationPlan, []state.AutomationPlanTask, string, error) {
	nowLocal := now.In(time.Local)
	submissions := append(automationSubmissionsFromConfig(config), pendingSubmissions...)
	activeTasks := make([]state.AutomationPlanTask, 0)
	plans := make([]state.AutomationPlan, 0)
	for _, project := range config.Projects {
		for _, task := range project.AutomationTasks {
			activeTasks = append(activeTasks, state.AutomationPlanTask{ProjectID: project.ID, TaskID: task.ID})
			for offset := 0; offset <= materializedPlanLookahead; offset++ {
				date := nowLocal.AddDate(0, 0, offset).Format("2006-01-02")
				plan, err := generateScheduleDailyPlan(task, date)
				if err != nil {
					return nil, nil, "", fmt.Errorf("materialize schedule for %s/%s: %w", project.ID, task.ID, err)
				}
				plan.ProjectID = project.ID
				plans = append(plans, plan)
			}
			for _, submission := range submissions {
				if submission.ProjectID != project.ID || submission.TaskID != task.ID {
					continue
				}
				switch submission.Kind {
				case state.AutomationSubmissionManual:
					updatedPlans, err := appendManualAutomationPlan(plans, project.ID, task.ID, ManualRunConfig{
						ID:        submission.PlanEntryID,
						PlannedAt: submission.PlannedAt,
					})
					if err != nil {
						return nil, nil, "", fmt.Errorf("materialize manual run for %s/%s: %w", project.ID, task.ID, err)
					}
					plans = updatedPlans
				case state.AutomationSubmissionEarly:
					markAutomationPlanEntryRunEarly(plans, project.ID, task.ID, submission.PlanEntryID)
				}
			}
		}
	}
	retainAfter := nowLocal.AddDate(0, 0, -materializedPlanRetention).Format("2006-01-02")
	return plans, activeTasks, retainAfter, nil
}

func appendManualAutomationPlan(
	plans []state.AutomationPlan,
	projectID string,
	taskID string,
	manualRun ManualRunConfig,
) ([]state.AutomationPlan, error) {
	plannedAt, err := time.Parse(time.RFC3339Nano, manualRun.PlannedAt)
	if err != nil {
		return nil, err
	}
	entry := state.AutomationPlanEntry{
		ID:        manualRun.ID,
		PlannedAt: manualRun.PlannedAt,
		Status:    state.AutomationPlanEntryPending,
		RunEarly:  true,
	}
	date := plannedAt.In(time.Local).Format("2006-01-02")
	for planIndex := range plans {
		plan := &plans[planIndex]
		if plan.ProjectID != projectID || plan.TaskID != taskID || plan.Date != date {
			continue
		}
		for entryIndex := range plan.Entries {
			if plan.Entries[entryIndex].ID == entry.ID {
				plan.Entries[entryIndex] = entry
				return plans, nil
			}
		}
		plan.Entries = append(plan.Entries, entry)
		return plans, nil
	}
	return append(plans, state.AutomationPlan{
		ProjectID: projectID,
		TaskID:    taskID,
		Date:      date,
		Entries:   []state.AutomationPlanEntry{entry},
	}), nil
}

func markAutomationPlanEntryRunEarly(plans []state.AutomationPlan, projectID string, taskID string, entryID string) {
	for planIndex := range plans {
		plan := &plans[planIndex]
		if plan.ProjectID != projectID || plan.TaskID != taskID {
			continue
		}
		for entryIndex := range plan.Entries {
			if plan.Entries[entryIndex].ID == entryID {
				plan.Entries[entryIndex].RunEarly = true
				return
			}
		}
	}
}

func automationPlanEntries(config Config, plans []state.AutomationPlan) []scheduledAutomationEntry {
	projects := make(map[string]ProjectConfig, len(config.Projects))
	tasks := make(map[string]TaskConfig)
	for _, project := range config.Projects {
		projects[project.ID] = project
		for _, task := range project.AutomationTasks {
			tasks[project.ID+"\x00"+task.ID] = task
		}
	}

	entries := make([]scheduledAutomationEntry, 0)
	for _, plan := range plans {
		project, found := projects[plan.ProjectID]
		if !found {
			continue
		}
		task, found := tasks[plan.ProjectID+"\x00"+plan.TaskID]
		if !found {
			continue
		}
		for _, entry := range plan.Entries {
			entries = append(entries, scheduledAutomationEntry{Project: project, Task: task, Entry: entry})
		}
	}
	return entries
}

func automationUpcomingEntries(
	config Config,
	plans []state.AutomationPlan,
	now time.Time,
) []state.AutomationUpcoming {
	upcoming := make([]state.AutomationUpcoming, 0)
	for _, scheduled := range automationPlanEntries(config, plans) {
		if !scheduled.Task.Enabled || scheduled.Entry.Status != state.AutomationPlanEntryPending {
			continue
		}
		plannedAt, err := time.Parse(time.RFC3339Nano, scheduled.Entry.PlannedAt)
		if err != nil || !plannedAt.After(now) {
			continue
		}
		upcoming = append(upcoming, state.AutomationUpcoming{
			ProjectID:   scheduled.Project.ID,
			TaskID:      scheduled.Task.ID,
			PlanEntryID: scheduled.Entry.ID,
			PlannedAt:   scheduled.Entry.PlannedAt,
		})
	}
	sort.Slice(upcoming, func(left, right int) bool {
		if upcoming[left].PlannedAt != upcoming[right].PlannedAt {
			return upcoming[left].PlannedAt < upcoming[right].PlannedAt
		}
		if upcoming[left].ProjectID != upcoming[right].ProjectID {
			return upcoming[left].ProjectID < upcoming[right].ProjectID
		}
		if upcoming[left].TaskID != upcoming[right].TaskID {
			return upcoming[left].TaskID < upcoming[right].TaskID
		}
		return upcoming[left].PlanEntryID < upcoming[right].PlanEntryID
	})
	if len(upcoming) > maxAutomationUpcoming {
		upcoming = upcoming[:maxAutomationUpcoming]
	}
	return upcoming
}

func (runtime *Runtime) nextWakeDelay(now time.Time, config Config) time.Duration {
	delay := schedulerIdleWakeDelay
	hasFuturePlan := false
	if runtime.supervisor.HasRecoveredRuns() {
		delay = recoveredRunPollInterval
	}

	automation := runtime.store.Automation()
	claimedEntries := make(map[string]struct{}, len(automation.Executions))
	activeProjects := make(map[string]struct{})
	for _, execution := range automation.Executions {
		claimedEntries[execution.ID] = struct{}{}
		if execution.Status == state.AutomationExecutionRunning {
			activeProjects[execution.ProjectID] = struct{}{}
		}
	}

	plans := automation.Plans
	if len(plans) == 0 {
		fallbackPlans, _, _, err := materializedAutomationPlans(config, now, automation.PendingSubmissions)
		if err == nil {
			plans = fallbackPlans
		}
	}
	for _, scheduled := range automationPlanEntries(config, plans) {
		project := scheduled.Project
		task := scheduled.Task
		entry := scheduled.Entry
		if _, active := activeProjects[project.ID]; active {
			continue
		}
		if entry.Status != state.AutomationPlanEntryPending || (!task.Enabled && !entry.RunEarly) {
			continue
		}
		if _, claimed := claimedEntries[executionID(project.ID, task.ID, entry.ID)]; claimed {
			continue
		}
		plannedAt, err := time.Parse(time.RFC3339Nano, entry.PlannedAt)
		if err != nil {
			continue
		}
		if entry.RunEarly || !plannedAt.After(now) {
			return schedulerRetryInitialDelay
		}
		hasFuturePlan = true
		if candidate := plannedAt.Sub(now); candidate < delay {
			delay = candidate
		}
	}

	if hasFuturePlan && delay > schedulerFuturePlanRecheckDelay {
		return schedulerFuturePlanRecheckDelay
	}
	return delay
}

func (runtime *Runtime) markIterationStarted() {
	runtime.healthMu.Lock()
	defer runtime.healthMu.Unlock()

	runtime.health.LastRunAt = time.Now().UTC().Format(time.RFC3339Nano)
}

func (runtime *Runtime) markIterationSucceeded() {
	runtime.healthMu.Lock()
	defer runtime.healthMu.Unlock()

	runtime.health.State = SchedulerStateRunning
	runtime.health.LastSuccessAt = runtime.health.LastRunAt
	runtime.health.LastError = ""
}

func (runtime *Runtime) markIterationFailed(err error) {
	runtime.healthMu.Lock()
	defer runtime.healthMu.Unlock()

	runtime.health.State = SchedulerStateDegraded
	runtime.health.LastError = boundedSchedulerError(err)
}

func (runtime *Runtime) clearHealthError() {
	runtime.healthMu.Lock()
	defer runtime.healthMu.Unlock()

	runtime.health.State = SchedulerStateRunning
	runtime.health.LastError = ""
}

func boundedSchedulerError(err error) string {
	if err == nil {
		return ""
	}

	message := strings.Map(func(character rune) rune {
		switch character {
		case '\r', '\n', '\t':
			return ' '
		default:
			if character < 0x20 {
				return ' '
			}
			return character
		}
	}, strings.TrimSpace(err.Error()))
	runes := []rune(message)
	if len(runes) > maxSchedulerHealthErrorLen {
		return string(runes[:maxSchedulerHealthErrorLen])
	}
	return message
}

func (runtime *Runtime) reconcileRecoveredAutomationExecutions(recoveredRuns []state.Run) error {
	recoveredByExecution := make(map[string]state.Run, len(recoveredRuns))
	for _, run := range recoveredRuns {
		if run.AutomationRunID != "" {
			recoveredByExecution[run.AutomationRunID] = run
		}
	}

	for _, execution := range runtime.store.Automation().Executions {
		if execution.Status != state.AutomationExecutionRunning {
			continue
		}
		if run, active := runtime.supervisor.FindAutomationRun(execution.ID); active {
			if execution.ActiveRunID == run.ID {
				continue
			}
			if _, err := runtime.store.UpdateAutomationExecution(execution.ID, func(current *state.AutomationExecution) {
				current.ActiveRunID = run.ID
			}); err != nil {
				return fmt.Errorf("restore active run for automation execution %q: %w", execution.ID, err)
			}
			continue
		}
		if runtime.executionInFlight(execution.ID) {
			continue
		}

		run, recovered := recoveredByExecution[execution.ID]
		reason := "Project Launch Service restarted before this scheduled task could be safely resumed, so it was not resumed to avoid duplicate execution."
		if recovered {
			reason = "Project Launch Service restarted while this scheduled task was running, so it was stopped and not resumed to avoid duplicate execution."
		}
		if _, err := runtime.store.UpdateAutomationExecution(execution.ID, func(current *state.AutomationExecution) {
			current.ActiveRunID = ""
			if recovered {
				result := scriptResult(run)
				result.Status = state.AutomationScriptFailed
				result.Reason = reason
				current.CurrentScriptIndex++
				current.ScriptResults = append(current.ScriptResults, result)
			}
			current.Status = state.AutomationExecutionFailed
			current.Reason = reason
			current.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
		}); err != nil {
			return fmt.Errorf("reconcile recovered automation execution %q: %w", execution.ID, err)
		}
	}

	return nil
}

func (runtime *Runtime) recordMissedExecution(
	revision uint64,
	project ProjectConfig,
	task TaskConfig,
	entry state.AutomationPlanEntry,
	now time.Time,
) error {
	_, _, err := runtime.store.ClaimAutomationExecution(revision, state.AutomationExecution{
		ID:            executionID(project.ID, task.ID, entry.ID),
		ProjectID:     project.ID,
		TaskID:        task.ID,
		PlanEntryID:   entry.ID,
		PlannedAt:     entry.PlannedAt,
		Status:        state.AutomationExecutionMissed,
		EndedAt:       now.UTC().Format(time.RFC3339Nano),
		Reason:        "The scheduled time was missed before the service became available.",
		ScriptResults: []state.AutomationScriptResult{},
	})
	if err != nil {
		return fmt.Errorf("record missed scheduled execution: %w", err)
	}
	return nil
}

func (runtime *Runtime) execute(
	execution state.AutomationExecution,
	project ProjectConfig,
	task TaskConfig,
	scripts map[string]ScriptConfig,
) {
	defer runtime.finishExecution(execution.ID)

	for index, scriptID := range task.ScriptIDs {
		script, found := scripts[scriptID]
		if !found {
			runtime.failExecution(execution.ID, index, scriptID, state.Run{}, "The scheduled task references an unavailable script.")
			return
		}
		continueAfterInput := isContinuousScript(task, script.ID)
		if continueAfterInput {
			if activeRun, active := runtime.supervisor.FindActiveScriptRun(project.ID, script.ID); active && activeRun.Status == state.RunStatusRunning {
				if err := runtime.recordContinuousScriptStarted(
					execution.ID,
					index,
					script.ID,
					activeRun.StartedAt,
					"The continuous script is already running.",
				); err != nil {
					return
				}
				continue
			}
		}
		label := runLabel(project, script)
		run, _, err := runtime.supervisor.Start(serviceprocess.StartRequest{
			ProjectID:          project.ID,
			ScriptID:           script.ID,
			Command:            script.Command,
			Cwd:                script.Cwd,
			Env:                project.Env,
			Label:              label,
			AutomationRunID:    execution.ID,
			IdempotencyKey:     fmt.Sprintf("automation:%s:%d", execution.ID, index),
			RequestFingerprint: launchFingerprint(runtime.store, execution.ID, project, script, label),
		})
		if err != nil {
			runtime.failExecution(execution.ID, index, script.ID, run, err.Error())
			return
		}

		if _, err := runtime.store.UpdateAutomationExecution(execution.ID, func(current *state.AutomationExecution) {
			current.CurrentScriptIndex = index
			current.ActiveRunID = run.ID
		}); err != nil {
			return
		}

		finishedRun, found, controlResult, inputReady := runtime.waitForRun(
			run.ID,
			controlsFor(task, script.ID, run.StartedAt),
			continueAfterInput,
		)
		if !found {
			runtime.failExecution(execution.ID, index, script.ID, run, "The scheduled process record is unavailable.")
			return
		}
		if inputReady {
			if err := runtime.recordContinuousScriptStarted(
				execution.ID,
				index,
				script.ID,
				finishedRun.StartedAt,
				"The continuous script started and completed its automation input.",
			); err != nil {
				return
			}
			continue
		}

		result := scriptResult(finishedRun)
		if controlResult != nil {
			result.Status = controlResult.Status
			result.Reason = controlResult.Reason
		}
		if _, err := runtime.store.UpdateAutomationExecution(execution.ID, func(current *state.AutomationExecution) {
			current.CurrentScriptIndex = index + 1
			current.ActiveRunID = ""
			current.ScriptResults = append(current.ScriptResults, result)
		}); err != nil {
			return
		}
		if result.Status != state.AutomationScriptCompleted {
			runtime.completeExecution(execution.ID, state.AutomationExecutionFailed, result.Reason)
			return
		}
	}

	runtime.completeExecution(execution.ID, state.AutomationExecutionCompleted, "")
}

func (runtime *Runtime) recordContinuousScriptStarted(
	executionID string,
	scriptIndex int,
	scriptID string,
	startedAt string,
	reason string,
) error {
	_, err := runtime.store.UpdateAutomationExecution(executionID, func(current *state.AutomationExecution) {
		current.CurrentScriptIndex = scriptIndex + 1
		current.ActiveRunID = ""
		current.ScriptResults = append(current.ScriptResults, state.AutomationScriptResult{
			ScriptID:  scriptID,
			Status:    state.AutomationScriptStarted,
			StartedAt: startedAt,
			Reason:    reason,
		})
	})
	return err
}

func (runtime *Runtime) failExecution(
	executionID string,
	scriptIndex int,
	scriptID string,
	run state.Run,
	reason string,
) {
	endedAt := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := runtime.store.UpdateAutomationExecution(executionID, func(current *state.AutomationExecution) {
		current.CurrentScriptIndex = scriptIndex
		current.ActiveRunID = run.ID
		current.ScriptResults = append(current.ScriptResults, state.AutomationScriptResult{
			ScriptID:  scriptID,
			Status:    state.AutomationScriptFailed,
			StartedAt: run.StartedAt,
			EndedAt:   endedAt,
			Reason:    reason,
		})
		current.Status = state.AutomationExecutionFailed
		current.Reason = reason
		current.EndedAt = endedAt
	}); err == nil {
		runtime.signalWake()
	}
}

func (runtime *Runtime) completeExecution(
	executionID string,
	status state.AutomationExecutionStatus,
	reason string,
) {
	endedAt := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := runtime.store.UpdateAutomationExecution(executionID, func(current *state.AutomationExecution) {
		current.Status = status
		current.Reason = reason
		current.EndedAt = endedAt
		current.ActiveRunID = ""
	}); err == nil {
		runtime.signalWake()
	}
}

type automationRunControls struct {
	inputSteps []InputStep
	exitMatch  string
	deadline   time.Time
}

type automationControlResult struct {
	Status state.AutomationScriptResultStatus
	Reason string
}

func controlsFor(task TaskConfig, scriptID string, startedAt string) automationRunControls {
	started, err := time.Parse(time.RFC3339Nano, startedAt)
	if err != nil {
		started = time.Now().UTC()
	}
	return automationRunControls{
		inputSteps: inputStepsFor(task, scriptID),
		exitMatch:  outputExitMatch(task, scriptID),
		deadline:   started.Add(maxScriptRuntime(task)),
	}
}

func (runtime *Runtime) waitForRun(
	runID string,
	controls automationRunControls,
	returnAfterInput bool,
) (state.Run, bool, *automationControlResult, bool) {
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	lastCursor := uint64(0)
	controller := newAutomationController(runtime.supervisor, runID, controls)

	for {
		run, found := runtime.supervisor.Run(runID)
		if !found || !run.Status.IsActive() {
			return run, found, controller.result, false
		}
		batch := runtime.supervisor.EventsAfter(lastCursor)
		lastCursor = batch.LatestCursor
		controller.observe(batch.Events)
		controller.advance(time.Now().UTC())
		if returnAfterInput && controller.inputComplete && !controller.stopRequested && controller.result == nil {
			return run, true, nil, true
		}
		<-ticker.C
	}
}

type automationController struct {
	supervisor    *serviceprocess.Supervisor
	runID         string
	controls      automationRunControls
	stepIndex     int
	stepStartedAt time.Time
	output        string
	inputComplete bool
	stopRequested bool
	result        *automationControlResult
}

func newAutomationController(
	supervisor *serviceprocess.Supervisor,
	runID string,
	controls automationRunControls,
) *automationController {
	return &automationController{
		supervisor:    supervisor,
		runID:         runID,
		controls:      controls,
		stepStartedAt: time.Now().UTC(),
		inputComplete: len(controls.inputSteps) == 0,
	}
}

func (controller *automationController) observe(events []state.Event) {
	for _, event := range events {
		if event.RunID != controller.runID || (event.Type != "stdout" && event.Type != "stderr") {
			continue
		}
		controller.output += event.Message + "\n"
		if len(controller.output) > maxAutomationOutputTailLen {
			controller.output = controller.output[len(controller.output)-maxAutomationOutputTailLen:]
		}
	}
}

func (controller *automationController) advance(now time.Time) {
	if controller.stopRequested || controller.result != nil {
		return
	}
	if !now.Before(controller.controls.deadline) {
		controller.stopWithResult(
			state.AutomationScriptTimeout,
			"The scheduled process exceeded its configured runtime limit.",
		)
		return
	}

	for !controller.inputComplete {
		step := controller.controls.inputSteps[controller.stepIndex]
		switch step.Mode {
		case "delay":
			if now.Before(controller.stepStartedAt.Add(time.Duration(step.DelayMS) * time.Millisecond)) {
				return
			}
			if !controller.sendInput(step.Value) {
				return
			}
			controller.advanceStep(now)
		case "output-match":
			if strings.Contains(controller.output, step.MatchText) {
				if !controller.sendInput(step.Value) {
					return
				}
				controller.advanceStep(now)
				continue
			}
			if !now.Before(controller.stepStartedAt.Add(outputMatchTimeout(step))) {
				controller.stopWithResult(
					state.AutomationScriptFailed,
					"The scheduled process did not produce the configured input-match output in time.",
				)
			}
			return
		default:
			controller.stopWithResult(state.AutomationScriptFailed, "The automation input step is invalid.")
			return
		}
	}

	if controller.controls.exitMatch != "" && strings.Contains(controller.output, controller.controls.exitMatch) {
		controller.stopForOutputMatch()
	}
}

func (controller *automationController) advanceStep(now time.Time) {
	controller.stepIndex += 1
	controller.stepStartedAt = now
	controller.inputComplete = controller.stepIndex >= len(controller.controls.inputSteps)
}

func (controller *automationController) sendInput(value string) bool {
	result, err := controller.supervisor.SendInput(controller.runID, value)
	if err == nil && result.Sent {
		return true
	}

	reason := "The scheduled process no longer accepts automation input."
	if err != nil {
		reason = fmt.Sprintf("Send automation input: %v", err)
	} else if result.Message != "" {
		reason = result.Message
	}
	controller.stopWithResult(state.AutomationScriptFailed, reason)
	return false
}

func (controller *automationController) stopWithResult(
	status state.AutomationScriptResultStatus,
	reason string,
) {
	if controller.stopRequested || controller.result != nil {
		return
	}
	controller.stopRequested = true
	controller.result = &automationControlResult{Status: status, Reason: reason}
	if _, err := controller.supervisor.Stop(controller.runID); err != nil {
		controller.result.Status = state.AutomationScriptFailed
		controller.result.Reason = fmt.Sprintf("%s Stop scheduled process: %v", reason, err)
	}
}

func (controller *automationController) stopForOutputMatch() {
	if controller.stopRequested || controller.result != nil {
		return
	}
	controller.stopRequested = true
	if _, err := controller.supervisor.StopAutomation(controller.runID); err != nil {
		controller.result = &automationControlResult{
			Status: state.AutomationScriptFailed,
			Reason: fmt.Sprintf("Stop scheduled process after output match: %v", err),
		}
	}
}

func outputExitMatch(task TaskConfig, scriptID string) string {
	for _, config := range task.ExitConfigs {
		if config.ScriptID == scriptID && config.Enabled && strings.TrimSpace(config.MatchText) != "" {
			return config.MatchText
		}
	}
	return ""
}

func decodeConfig(rawConfig json.RawMessage) (Config, error) {
	if len(rawConfig) == 0 {
		return Config{}, errors.New("automation configuration is required")
	}

	var config Config
	if err := json.Unmarshal(rawConfig, &config); err != nil {
		return Config{}, fmt.Errorf("decode automation configuration: %w", err)
	}
	if err := validateConfig(config); err != nil {
		return Config{}, err
	}
	return config, nil
}

func validateConfig(config Config) error {
	if config.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported automation schema version %d", config.SchemaVersion)
	}
	if config.Revision == 0 {
		return errors.New("automation configuration revision must be positive")
	}

	for _, project := range config.Projects {
		for _, task := range project.AutomationTasks {
			if task.Enabled && len(task.ScriptIDs) == 0 {
				return fmt.Errorf("automation task %q has no scripts", task.ID)
			}
			if task.MissedGraceMinutes < 0 {
				return fmt.Errorf("automation task %q has a negative missed-run grace period", task.ID)
			}
			if task.MaxScriptRuntimeMinutes < 0 {
				return fmt.Errorf("automation task %q has a negative script runtime limit", task.ID)
			}
			if task.ScheduleAlgorithmVersion != ScheduleAlgorithmVersion {
				return fmt.Errorf("automation task %q has unsupported schedule algorithm version %d", task.ID, task.ScheduleAlgorithmVersion)
			}
			if err := validateScheduleConfig(task.Schedule); err != nil {
				return fmt.Errorf("automation task %q has invalid schedule: %w", task.ID, err)
			}
			if err := validateManualRunConfig(task.ManualRun); err != nil {
				return fmt.Errorf("automation task %q has invalid manual run: %w", task.ID, err)
			}
			selectedScriptIDs := make(map[string]struct{}, len(task.ScriptIDs))
			for _, scriptID := range task.ScriptIDs {
				selectedScriptIDs[scriptID] = struct{}{}
			}
			for _, scriptID := range task.ContinuousScriptIDs {
				if _, selected := selectedScriptIDs[scriptID]; !selected {
					return fmt.Errorf("automation task %q configures a continuous script that is not selected", task.ID)
				}
			}
			switch normalizedMissedPolicy(task) {
			case "grace-run", "run-now", "mark-missed":
			default:
				return fmt.Errorf("automation task %q has an unsupported missed-run policy", task.ID)
			}
			for _, inputConfig := range task.InputConfigs {
				if strings.TrimSpace(inputConfig.ScriptID) == "" {
					return fmt.Errorf("automation task %q has an input configuration without a script", task.ID)
				}
				for _, step := range inputConfig.Steps {
					switch step.Mode {
					case "delay":
						if step.DelayMS < 0 {
							return fmt.Errorf("automation task %q has a negative input delay", task.ID)
						}
					case "output-match":
						if strings.TrimSpace(step.MatchText) == "" || step.TimeoutMS < 0 {
							return fmt.Errorf("automation task %q has an invalid output-match input step", task.ID)
						}
					default:
						return fmt.Errorf("automation task %q has an unsupported input step", task.ID)
					}
				}
			}
			for _, exitConfig := range task.ExitConfigs {
				if exitConfig.Enabled && (strings.TrimSpace(exitConfig.ScriptID) == "" || strings.TrimSpace(exitConfig.MatchText) == "") {
					return fmt.Errorf("automation task %q has an invalid output exit configuration", task.ID)
				}
				if exitConfig.Enabled && isContinuousScript(task, exitConfig.ScriptID) {
					return fmt.Errorf("automation task %q configures output exit for a continuous script", task.ID)
				}
			}
		}
	}

	return nil
}

func validateScheduleConfig(schedule *ScheduleConfig) error {
	if schedule == nil {
		return errors.New("schedule is required")
	}
	if schedule.DailyCount < 1 || schedule.DailyCount > maxAutomationDailyEntries {
		return fmt.Errorf("daily count must be between 1 and %d", maxAutomationDailyEntries)
	}

	switch schedule.Type {
	case "fixed":
		startMinutes, err := parseScheduleTime(schedule.StartTime)
		if err != nil {
			return fmt.Errorf("fixed start time: %w", err)
		}
		if schedule.IntervalMinutes < 1 {
			return errors.New("fixed interval must be positive")
		}
		if schedule.DailyCount > 1 && schedule.IntervalMinutes > (minutesPerDay-1-startMinutes)/(schedule.DailyCount-1) {
			return errors.New("fixed schedule exceeds the day")
		}
	case "random":
		windowStart, err := parseScheduleTime(schedule.WindowStart)
		if err != nil {
			return fmt.Errorf("random window start: %w", err)
		}
		windowEnd, err := parseScheduleTime(schedule.WindowEnd)
		if err != nil {
			return fmt.Errorf("random window end: %w", err)
		}
		if windowEnd <= windowStart {
			return errors.New("random window must have a positive span")
		}
		if schedule.MinIntervalMinutes < 0 || schedule.MaxIntervalMinutes < schedule.MinIntervalMinutes {
			return errors.New("random interval bounds are invalid")
		}
		span := windowEnd - windowStart
		if schedule.DailyCount > 1 && schedule.MinIntervalMinutes > span/(schedule.DailyCount-1) {
			return errors.New("random window cannot contain the requested minimum interval")
		}
	default:
		return fmt.Errorf("unsupported schedule type %q", schedule.Type)
	}

	return nil
}

func validateManualRunConfig(manualRun *ManualRunConfig) error {
	if manualRun == nil {
		return nil
	}
	if strings.TrimSpace(manualRun.ID) == "" {
		return errors.New("id is required")
	}
	if _, err := time.Parse(time.RFC3339Nano, manualRun.PlannedAt); err != nil {
		return fmt.Errorf("planned time must use RFC3339: %w", err)
	}
	return nil
}

func parseScheduleTime(value string) (int, error) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 || len(parts[0]) < 1 || len(parts[0]) > 2 || len(parts[1]) != 2 {
		return 0, errors.New("must use HH:mm")
	}
	hours, hourErr := strconv.Atoi(parts[0])
	minutes, minuteErr := strconv.Atoi(parts[1])
	if hourErr != nil || minuteErr != nil || hours < 0 || hours > 23 || minutes < 0 || minutes > 59 {
		return 0, errors.New("must be within one day")
	}
	return hours*60 + minutes, nil
}

func generateScheduleDailyPlan(task TaskConfig, date string) (state.AutomationPlan, error) {
	if err := validateScheduleConfig(task.Schedule); err != nil {
		return state.AutomationPlan{}, err
	}
	if task.ScheduleAlgorithmVersion != ScheduleAlgorithmVersion {
		return state.AutomationPlan{}, fmt.Errorf("unsupported schedule algorithm version %d", task.ScheduleAlgorithmVersion)
	}

	minutes, err := scheduleMinutes(task.ID, date, *task.Schedule)
	if err != nil {
		return state.AutomationPlan{}, err
	}
	plan := state.AutomationPlan{
		TaskID:  task.ID,
		Date:    date,
		Entries: make([]state.AutomationPlanEntry, 0, len(minutes)),
	}
	for index, minute := range minutes {
		plannedAt, err := scheduledTimestamp(date, minute)
		if err != nil {
			return state.AutomationPlan{}, err
		}
		plan.Entries = append(plan.Entries, state.AutomationPlanEntry{
			ID:        schedulePlanEntryID(task.ID, date, task.ScheduleAlgorithmVersion, index),
			PlannedAt: plannedAt,
			Status:    state.AutomationPlanEntryPending,
			RunEarly:  task.RunEarlyEntryID == schedulePlanEntryID(task.ID, date, task.ScheduleAlgorithmVersion, index),
		})
	}
	return plan, nil
}

func scheduleMinutes(taskID string, date string, schedule ScheduleConfig) ([]int, error) {
	switch schedule.Type {
	case "fixed":
		startMinutes, err := parseScheduleTime(schedule.StartTime)
		if err != nil {
			return nil, err
		}
		minutes := make([]int, schedule.DailyCount)
		for index := range minutes {
			minutes[index] = startMinutes + index*schedule.IntervalMinutes
		}
		return minutes, nil
	case "random":
		return randomScheduleMinutes(taskID, date, schedule)
	default:
		return nil, fmt.Errorf("unsupported schedule type %q", schedule.Type)
	}
}

func randomScheduleMinutes(taskID string, date string, schedule ScheduleConfig) ([]int, error) {
	startMinutes, err := parseScheduleTime(schedule.WindowStart)
	if err != nil {
		return nil, err
	}
	endMinutes, err := parseScheduleTime(schedule.WindowEnd)
	if err != nil {
		return nil, err
	}
	if schedule.DailyCount == 1 {
		random := seededScheduleRandom(taskID + ":" + date + ":0")
		return []int{startMinutes + int(random()*float64(maxInt(1, endMinutes-startMinutes+1)))}, nil
	}

	random := seededScheduleRandom(fmt.Sprintf("%s:%s:%d", taskID, date, schedule.DailyCount))
	span := endMinutes - startMinutes
	maximumInterval := minInt(schedule.MaxIntervalMinutes, span)
	minimumTotalGap := (schedule.DailyCount - 1) * schedule.MinIntervalMinutes
	maximumTotalGap := (schedule.DailyCount - 1) * maximumInterval
	totalGap := minimumTotalGap + int(random()*float64(minInt(maximumTotalGap, span)-minimumTotalGap+1))
	remainingExtra := totalGap - minimumTotalGap
	intervalRange := maximumInterval - schedule.MinIntervalMinutes
	gaps := make([]int, 0, schedule.DailyCount-1)
	for index := 0; index < schedule.DailyCount-1; index++ {
		remainingGaps := schedule.DailyCount - 1 - index
		maximumExtraForGap := minInt(intervalRange, remainingExtra)
		reservedExtra := maxInt(0, remainingExtra-(remainingGaps-1)*intervalRange)
		extra := reservedExtra + int(random()*float64(maximumExtraForGap-reservedExtra+1))
		gaps = append(gaps, schedule.MinIntervalMinutes+extra)
		remainingExtra -= extra
	}

	minutes := make([]int, 0, schedule.DailyCount)
	minutes = append(minutes, startMinutes+int(random()*float64(span-totalGap+1)))
	for _, gap := range gaps {
		minutes = append(minutes, minutes[len(minutes)-1]+gap)
	}
	return minutes, nil
}

func scheduledTimestamp(date string, minutes int) (string, error) {
	day, err := time.Parse("2006-01-02", date)
	if err != nil {
		return "", fmt.Errorf("parse schedule date: %w", err)
	}
	if minutes < 0 || minutes >= minutesPerDay {
		return "", errors.New("schedule minute is outside one day")
	}
	plannedAt := time.Date(day.Year(), day.Month(), day.Day(), minutes/60, minutes%60, 0, 0, time.Local)
	return plannedAt.UTC().Format("2006-01-02T15:04:05.000Z"), nil
}

func schedulePlanEntryID(taskID string, date string, algorithmVersion int, index int) string {
	return fmt.Sprintf("%s:%s:v%d:%d", taskID, date, algorithmVersion, index)
}

func seededScheduleRandom(seed string) func() float64 {
	hash := uint32(2166136261)
	for _, character := range utf16.Encode([]rune(seed)) {
		hash ^= uint32(character)
		hash *= 16777619
	}

	return func() float64 {
		hash += 0x6d2b79f5
		value := hash
		value = (value ^ (value >> 15)) * (value | 1)
		value ^= value + (value^(value>>7))*(value|61)
		return float64(value^(value>>14)) / 4294967296
	}
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func shouldMarkMissed(task TaskConfig, plannedAt time.Time, now time.Time) bool {
	if !plannedAt.Before(now) {
		return false
	}

	switch normalizedMissedPolicy(task) {
	case "mark-missed":
		return true
	case "grace-run":
		return now.Sub(plannedAt) > missedGracePeriod(task)
	default:
		return false
	}
}

func normalizedMissedPolicy(task TaskConfig) string {
	if task.MissedPolicy == "" {
		return "grace-run"
	}
	return task.MissedPolicy
}

func missedGracePeriod(task TaskConfig) time.Duration {
	if task.MissedPolicy == "" {
		return 5 * time.Minute
	}
	return time.Duration(task.MissedGraceMinutes) * time.Minute
}

func maxScriptRuntime(task TaskConfig) time.Duration {
	if task.MaxScriptRuntimeMinutes == 0 {
		return defaultMaxScriptRuntime
	}
	return time.Duration(task.MaxScriptRuntimeMinutes) * time.Minute
}

func inputStepsFor(task TaskConfig, scriptID string) []InputStep {
	for _, config := range task.InputConfigs {
		if config.ScriptID == scriptID {
			return append([]InputStep(nil), config.Steps...)
		}
	}
	return nil
}

func isContinuousScript(task TaskConfig, scriptID string) bool {
	for _, configuredScriptID := range task.ContinuousScriptIDs {
		if configuredScriptID == scriptID {
			return true
		}
	}
	return false
}

func outputMatchTimeout(step InputStep) time.Duration {
	if step.TimeoutMS == 0 {
		return defaultOutputMatchWait
	}
	return time.Duration(step.TimeoutMS) * time.Millisecond
}

func executionID(projectID string, taskID string, planEntryID string) string {
	return stableHash("automation-execution", projectID, taskID, planEntryID)
}

func launchFingerprint(store *state.Store, executionID string, project ProjectConfig, script ScriptConfig, label string) string {
	env, _ := json.Marshal(project.Env)
	return store.Fingerprint("automation-launch", executionID, project.ID, script.ID, script.Command, script.Cwd, label, string(env))
}

func stableHash(parts ...string) string {
	payload, _ := json.Marshal(parts)
	hash := sha256.Sum256(payload)
	return hex.EncodeToString(hash[:])
}

func runLabel(project ProjectConfig, script ScriptConfig) string {
	projectName := strings.TrimSpace(project.Name)
	if projectName == "" {
		projectName = project.ID
	}
	scriptName := strings.TrimSpace(script.Name)
	if scriptName == "" {
		scriptName = script.ID
	}
	return projectName + " / " + scriptName
}

func scriptResult(run state.Run) state.AutomationScriptResult {
	result := state.AutomationScriptResult{
		ScriptID:  run.ScriptID,
		StartedAt: run.StartedAt,
		EndedAt:   run.EndedAt,
	}

	switch run.Status {
	case state.RunStatusExited:
		result.Status = state.AutomationScriptCompleted
	case state.RunStatusStopped:
		result.Status = state.AutomationScriptStopped
		result.Reason = "The scheduled process was stopped."
	default:
		result.Status = state.AutomationScriptFailed
		result.Reason = run.Error
		if result.Reason == "" {
			result.Reason = "The scheduled process did not complete successfully."
		}
	}

	return result
}
