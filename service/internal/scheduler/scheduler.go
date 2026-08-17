package scheduler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	serviceprocess "project-launch-service/internal/process"
	"project-launch-service/internal/state"
)

const SchemaVersion = 1

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
	ID                      string        `json:"id"`
	Name                    string        `json:"name"`
	Enabled                 bool          `json:"enabled"`
	ScriptIDs               []string      `json:"scriptIds"`
	MissedPolicy            string        `json:"missedPolicy"`
	MissedGraceMinutes      int           `json:"missedGraceMinutes"`
	MaxScriptRuntimeMinutes int           `json:"maxScriptRuntimeMinutes"`
	InputConfigs            []InputConfig `json:"inputConfigs"`
	ExitConfigs             []ExitConfig  `json:"exitConfigs"`
	DailyPlans              []DailyPlan   `json:"dailyPlans"`
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

type DailyPlan struct {
	Date    string      `json:"date"`
	Entries []PlanEntry `json:"entries"`
}

type PlanEntry struct {
	ID        string `json:"id"`
	PlannedAt string `json:"plannedAt"`
	Status    string `json:"status"`
	RunEarly  bool   `json:"runEarly,omitempty"`
}

type Runtime struct {
	store      *state.Store
	supervisor *serviceprocess.Supervisor
	replaceMu  sync.Mutex
	healthMu   sync.RWMutex
	health     SchedulerHealth
	wake       chan struct{}
}

const (
	schedulerIdleWakeDelay     = 24 * time.Hour
	schedulerRetryInitialDelay = time.Second
	schedulerRetryMaximumDelay = time.Minute
	recoveredRunPollInterval   = 500 * time.Millisecond
	defaultMaxScriptRuntime    = 30 * time.Minute
	defaultOutputMatchWait     = 30 * time.Second
	maxAutomationOutputTailLen = 64 * 1024
	maxSchedulerHealthErrorLen = 512
)

func New(store *state.Store, supervisor *serviceprocess.Supervisor) (*Runtime, error) {
	if store == nil {
		return nil, errors.New("runtime state store is required")
	}
	if supervisor == nil {
		return nil, errors.New("process supervisor is required")
	}

	return &Runtime{
		store:      store,
		supervisor: supervisor,
		wake:       make(chan struct{}, 1),
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

	updated, err := runtime.store.ReplaceAutomation(revision, rawConfig)
	if err != nil {
		return state.AutomationState{}, err
	}
	runtime.clearHealthError()
	runtime.signalWake()
	return updated, nil
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
	if err := runtime.reconcileRecoveredAutomationExecutions(recoveredRuns); err != nil {
		return 0, err
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
	for _, project := range config.Projects {
		scripts := make(map[string]ScriptConfig, len(project.Scripts))
		for _, script := range project.Scripts {
			scripts[script.ID] = script
		}
		for _, task := range project.AutomationTasks {
			for _, dailyPlan := range task.DailyPlans {
				for _, entry := range dailyPlan.Entries {
					if entry.Status != "pending" || (!task.Enabled && !entry.RunEarly) {
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
						go runtime.execute(execution, project, task, scripts)
					}
				}
			}
		}
	}

	return runtime.nextWakeDelay(now, config), nil
}

func (runtime *Runtime) nextWakeDelay(now time.Time, config Config) time.Duration {
	delay := schedulerIdleWakeDelay
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

	for _, project := range config.Projects {
		if _, active := activeProjects[project.ID]; active {
			continue
		}
		for _, task := range project.AutomationTasks {
			for _, dailyPlan := range task.DailyPlans {
				for _, entry := range dailyPlan.Entries {
					if entry.Status != "pending" || (!task.Enabled && !entry.RunEarly) {
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
					if candidate := plannedAt.Sub(now); candidate < delay {
						delay = candidate
					}
				}
			}
		}
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
	if len(recoveredRuns) == 0 {
		return nil
	}

	for _, run := range recoveredRuns {
		if run.AutomationRunID == "" {
			continue
		}
		for _, execution := range runtime.store.Automation().Executions {
			if execution.ID != run.AutomationRunID ||
				execution.Status != state.AutomationExecutionRunning ||
				execution.ActiveRunID != run.ID {
				continue
			}

			result := scriptResult(run)
			reason := "Project Launch Service restarted while this scheduled task was running, so it was not resumed to avoid duplicate execution."
			if result.Reason == "" {
				result.Reason = reason
			}
			if _, err := runtime.store.UpdateAutomationExecution(execution.ID, func(current *state.AutomationExecution) {
				current.CurrentScriptIndex++
				current.ActiveRunID = ""
				current.ScriptResults = append(current.ScriptResults, result)
				current.Status = state.AutomationExecutionFailed
				current.Reason = reason
				current.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
			}); err != nil {
				return fmt.Errorf("reconcile recovered automation execution %q: %w", execution.ID, err)
			}
		}
	}

	return nil
}

func (runtime *Runtime) recordMissedExecution(
	revision uint64,
	project ProjectConfig,
	task TaskConfig,
	entry PlanEntry,
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
	for index, scriptID := range task.ScriptIDs {
		script, found := scripts[scriptID]
		if !found {
			runtime.failExecution(execution.ID, index, scriptID, state.Run{}, "The scheduled task references an unavailable script.")
			return
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

		finishedRun, found, controlResult := runtime.waitForRun(
			run.ID,
			controlsFor(task, script.ID, run.StartedAt),
		)
		if !found {
			runtime.failExecution(execution.ID, index, script.ID, run, "The scheduled process record is unavailable.")
			return
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
) (state.Run, bool, *automationControlResult) {
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	lastCursor := uint64(0)
	controller := newAutomationController(runtime.supervisor, runID, controls)

	for {
		run, found := runtime.supervisor.Run(runID)
		if !found || !run.Status.IsActive() {
			return run, found, controller.result
		}
		batch := runtime.supervisor.EventsAfter(lastCursor)
		lastCursor = batch.LatestCursor
		controller.observe(batch.Events)
		controller.advance(time.Now().UTC())
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
			}
		}
	}

	return nil
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
