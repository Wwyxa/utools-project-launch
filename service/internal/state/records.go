package state

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type RuntimeRecord struct {
	SchemaVersion     int                  `json:"schemaVersion"`
	Source            string               `json:"source"`
	RunID             string               `json:"runId"`
	ProjectID         string               `json:"projectId"`
	ScriptID          string               `json:"scriptId"`
	Label             string               `json:"label"`
	Command           string               `json:"command,omitempty"`
	Status            RunStatus            `json:"status"`
	StartedAt         string               `json:"startedAt"`
	EndedAt           string               `json:"endedAt,omitempty"`
	Truncated         bool                 `json:"truncated"`
	WriterPID         int                  `json:"writerPid,omitempty"`
	AutomationRunID   string               `json:"automationRunId,omitempty"`
	DurableWriteError string               `json:"durableWriteError,omitempty"`
	Cleared           bool                 `json:"cleared,omitempty"`
	Execution         *AutomationExecution `json:"execution,omitempty"`
}

type runtimeRecordPolicy struct {
	SchemaVersion int                `json:"schemaVersion"`
	Policy        LogRetentionPolicy `json:"policy"`
}

func (store *Store) acquireRecordMaintenanceLocked() (func(), bool, error) {
	if store.runtimeDir == "" {
		return func() {}, true, nil
	}
	directory := filepath.Join(store.runtimeDir, "maintenance.lock")
	if err := os.Mkdir(directory, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			contents, readErr := os.ReadFile(filepath.Join(directory, "owner.json"))
			var owner struct {
				PID int `json:"pid"`
			}
			if readErr != nil || json.Unmarshal(contents, &owner) != nil || runtimeWriterAlive(owner.PID) {
				return func() {}, false, nil
			}
			if err := os.RemoveAll(directory); err != nil {
				return nil, false, err
			}
			if err := os.Mkdir(directory, 0o700); err != nil {
				if errors.Is(err, os.ErrExist) {
					return func() {}, false, nil
				}
				return nil, false, err
			}
		} else {
			return nil, false, err
		}
	}
	nonce, err := NewRunID()
	if err != nil {
		_ = os.Remove(directory)
		return nil, false, err
	}
	owner, err := json.Marshal(struct {
		PID   int    `json:"pid"`
		Nonce string `json:"nonce"`
	}{os.Getpid(), nonce})
	if err != nil {
		_ = os.Remove(directory)
		return nil, false, err
	}
	if err := writeFileAtomic(filepath.Join(directory, "owner.json"), owner, 0o600); err != nil {
		_ = os.RemoveAll(directory)
		return nil, false, err
	}
	return func() { _ = os.RemoveAll(directory) }, true, nil
}

func DefaultRuntimeDirectory(stateDir string) string {
	return filepath.Join(filepath.Dir(filepath.Clean(stateDir)), "runtime")
}

func OpenWithRuntimeRecords(stateDir, runtimeDir string) (*Store, error) {
	if runtimeDir == "" {
		runtimeDir = DefaultRuntimeDirectory(stateDir)
	}
	return openStore(stateDir, runtimeDir)
}

func (store *Store) recordPath(runID string) string {
	return filepath.Join(store.logDirectoryPath(), runID+".json")
}

func (store *Store) initializeRuntimeRecordsLocked() error {
	if store.runtimeDir == "" {
		return nil
	}
	for _, directory := range []string{store.runtimeDir, store.logDirectoryPath()} {
		if info, err := os.Lstat(directory); err == nil && !info.IsDir() {
			return errors.New("common runtime directory must be a directory")
		}
		if err := EnsureDirectory(directory); err != nil {
			return err
		}
	}
	policyPath := filepath.Join(store.runtimeDir, "policy.v1.json")
	if _, err := os.Stat(policyPath); errors.Is(err, os.ErrNotExist) {
		encoded, err := json.Marshal(runtimeRecordPolicy{SchemaVersion: 1, Policy: DefaultLogRetentionPolicy()})
		if err != nil {
			return err
		}
		file, err := os.OpenFile(policyPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
		if err == nil {
			_, writeErr := file.Write(encoded)
			syncErr := file.Sync()
			closeErr := file.Close()
			if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
				return err
			}
		}
	}
	if err := store.refreshRuntimeRecordPolicyLocked(); err != nil {
		return err
	}
	return store.persistRuntimeRecordsLocked()
}

func (store *Store) refreshRuntimeRecordPolicyLocked() error {
	if store.runtimeDir == "" {
		return nil
	}
	policyPath := filepath.Join(store.runtimeDir, "policy.v1.json")
	info, err := os.Lstat(policyPath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("common policy must be a regular file")
	}
	if store.policyInfo != nil &&
		os.SameFile(store.policyInfo, info) &&
		store.policyInfo.ModTime().Equal(info.ModTime()) &&
		store.policyInfo.Size() == info.Size() {
		return nil
	}
	contents, err := os.ReadFile(policyPath)
	if err != nil {
		return fmt.Errorf("read common log policy: %w", err)
	}
	var envelope runtimeRecordPolicy
	if err := json.Unmarshal(contents, &envelope); err != nil {
		return err
	}
	if envelope.SchemaVersion != 1 {
		return errors.New("unsupported common log policy schema")
	}
	if err := validateLogRetentionPolicy(envelope.Policy); err != nil {
		return err
	}
	store.data.LogRetention = envelope.Policy
	store.policyInfo = info
	return nil
}

func (store *Store) persistRuntimeRecordsLocked() error {
	if store.runtimeDir == "" {
		return nil
	}
	for _, run := range store.data.Runs {
		if run.ID == store.stagedTerminalRunID {
			continue
		}
		if !isSafeRunID(run.ID) {
			continue
		}
		if !store.data.LogRetention.Persist {
			if _, err := os.Stat(store.recordPath(run.ID)); errors.Is(err, os.ErrNotExist) {
				continue
			}
		}
		record := RuntimeRecord{SchemaVersion: 1, Source: "service", RunID: run.ID, ProjectID: run.ProjectID,
			ScriptID: run.ScriptID, Label: run.Label, Command: run.Command, Status: run.Status,
			StartedAt: run.StartedAt, EndedAt: run.EndedAt, Truncated: run.OutputTruncated,
			WriterPID: os.Getpid(), AutomationRunID: run.AutomationRunID, DurableWriteError: run.DurableWriteError}
		contents, err := json.Marshal(record)
		if err != nil {
			return err
		}
		if store.recordSnapshots[run.ID] == string(contents) {
			continue
		}
		previous, err := os.ReadFile(store.recordPath(run.ID))
		if err == nil {
			var existing RuntimeRecord
			if err := json.Unmarshal(previous, &existing); err != nil {
				return err
			}
			if existing.Cleared {
				continue
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := writeFileAtomic(store.recordPath(run.ID), contents, 0o600); err != nil {
			return err
		}
		store.recordSnapshots[run.ID] = string(contents)
	}
	return store.persistAutomationRecordsLocked()
}

func (store *Store) markRuntimeRecordClearedLocked(runID string) error {
	if store.runtimeDir == "" {
		return nil
	}
	contents, err := os.ReadFile(store.recordPath(runID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var record RuntimeRecord
	if err := json.Unmarshal(contents, &record); err != nil {
		return err
	}
	record.Cleared = true
	record.Command = ""
	record.Label = ""
	record.Execution = nil
	record.DurableWriteError = ""
	record.AutomationRunID = ""
	contents, err = json.Marshal(record)
	if err != nil {
		return err
	}
	return writeFileAtomic(store.recordPath(runID), contents, 0o600)
}

func (store *Store) commonRecordUsageLocked() (int64, error) {
	entries, err := os.ReadDir(store.logDirectoryPath())
	if err != nil {
		return 0, err
	}
	var total int64
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".log" {
			continue
		}
		info, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return 0, err
		}
		if !info.Mode().IsRegular() {
			return 0, errors.New("common run log must be a regular file")
		}
		total += info.Size()
	}
	return total, nil
}

func (store *Store) maintainCommonRecordsLocked() error {
	if store.runtimeDir == "" || time.Since(store.lastCommonMaintenance) < time.Second {
		return nil
	}
	release, acquired, err := store.acquireRecordMaintenanceLocked()
	if err != nil {
		return err
	}
	if !acquired {
		return nil
	}
	defer release()
	store.lastCommonMaintenance = time.Now()
	entries, err := os.ReadDir(store.logDirectoryPath())
	if err != nil {
		return err
	}
	total, err := store.commonRecordUsageLocked()
	if err != nil {
		return err
	}
	records := []RuntimeRecord{}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		contents, err := os.ReadFile(filepath.Join(store.logDirectoryPath(), entry.Name()))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		var record RuntimeRecord
		if err := json.Unmarshal(contents, &record); err != nil {
			return err
		}
		if record.SchemaVersion != 1 || !isSafeRunID(record.RunID) || entry.Name() != record.RunID+".json" {
			return errors.New("invalid common runtime record")
		}
		if record.Status.IsActive() && !runtimeWriterAlive(record.WriterPID) {
			record.Status = RunStatusLost
			encoded, err := json.Marshal(record)
			if err != nil {
				return err
			}
			if err := writeFileAtomic(store.recordPath(record.RunID), encoded, 0o600); err != nil {
				return err
			}
		}
		if record.Status.IsActive() || record.Cleared {
			continue
		}
		records = append(records, record)
	}
	sort.Slice(records, func(left, right int) bool {
		leftTime, _ := time.Parse(time.RFC3339Nano, records[left].EndedAt)
		rightTime, _ := time.Parse(time.RFC3339Nano, records[right].EndedAt)
		return leftTime.Before(rightTime)
	})
	counts := map[string]int{}
	for _, record := range records {
		counts[record.ProjectID]++
	}
	for _, record := range records {
		logPath := filepath.Join(store.logDirectoryPath(), record.RunID+".log")
		info, err := os.Stat(logPath)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if total <= store.data.LogRetention.MaxBytesTotal && counts[record.ProjectID] <= store.data.LogRetention.MaxCompletedRunsPerProject {
			continue
		}
		if err := store.markRuntimeRecordClearedLocked(record.RunID); err != nil {
			return err
		}
		if err := os.Remove(logPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		total -= info.Size()
		counts[record.ProjectID]--
		store.removeRetainedLogFileFromAccountingLocked(record.RunID)
	}
	return nil
}

func (store *Store) writeCommonPolicyLocked(policy LogRetentionPolicy) error {
	if store.runtimeDir == "" {
		return nil
	}
	contents, err := json.Marshal(runtimeRecordPolicy{SchemaVersion: 1, Policy: policy})
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(store.runtimeDir, "policy.v1.json"), contents, 0o600)
}

func (store *Store) persistAutomationRecordsLocked() error {
	for _, execution := range store.data.Automation.Executions {
		digest := sha256.Sum256([]byte("automation:" + execution.ID))
		runID := hex.EncodeToString(digest[:16])
		if !store.data.LogRetention.Persist {
			if _, err := os.Stat(store.recordPath(runID)); errors.Is(err, os.ErrNotExist) {
				continue
			}
		}
		startedAt := execution.StartedAt
		if startedAt == "" {
			startedAt = execution.PlannedAt
		}
		if startedAt == "" {
			startedAt = execution.EndedAt
		}
		status := RunStatusExited
		if execution.Status == AutomationExecutionRunning {
			status = RunStatusRunning
		}
		if execution.Status == AutomationExecutionFailed || execution.Status == AutomationExecutionMissed {
			status = RunStatusFailed
		}
		currentExecution := execution
		record := RuntimeRecord{SchemaVersion: 1, Source: "automation", RunID: runID,
			ProjectID: execution.ProjectID, ScriptID: "", Label: execution.TaskID, Status: status,
			StartedAt: startedAt, EndedAt: execution.EndedAt, WriterPID: os.Getpid(), Execution: &currentExecution}
		contents, err := json.Marshal(record)
		if err != nil {
			return err
		}
		if store.recordSnapshots[runID] == string(contents) {
			continue
		}
		previous, err := os.ReadFile(store.recordPath(runID))
		if err == nil {
			var existing RuntimeRecord
			if err := json.Unmarshal(previous, &existing); err != nil {
				return err
			}
			if existing.Cleared {
				continue
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if execution.Status != AutomationExecutionRunning && store.data.LogRetention.Persist {
			message := string(execution.Status)
			if execution.Reason != "" {
				message += ": " + execution.Reason
			}
			event := Event{Cursor: 1, Timestamp: execution.EndedAt, Type: "stdout", RunID: runID,
				ProjectID: execution.ProjectID, ScriptID: "", Message: message}
			if event.Timestamp == "" {
				event.Timestamp = startedAt
			}
			encoded, err := json.Marshal(event)
			if err != nil {
				return err
			}
			if err := writeFileAtomic(filepath.Join(store.logDirectoryPath(), runID+".log"), append(encoded, '\n'), 0o600); err != nil {
				return err
			}
		}
		if err := writeFileAtomic(store.recordPath(runID), contents, 0o600); err != nil {
			return err
		}
		store.recordSnapshots[runID] = string(contents)
	}
	return nil
}

func WriteRuntimeDiagnostic(runtimeDir string, record *RuntimeRecord, event *Event) error {
	if !isSafeRunID(record.RunID) {
		return errors.New("invalid diagnostic record id")
	}
	directory := filepath.Join(runtimeDir, LogDirectoryName)
	for _, target := range []string{runtimeDir, directory} {
		if info, err := os.Lstat(target); err == nil && !info.IsDir() {
			return errors.New("runtime directory must not be a link or file")
		}
		if err := EnsureDirectory(target); err != nil {
			return err
		}
	}
	policy := DefaultLogRetentionPolicy()
	contents, err := os.ReadFile(filepath.Join(runtimeDir, "policy.v1.json"))
	if err == nil {
		var envelope runtimeRecordPolicy
		if err := json.Unmarshal(contents, &envelope); err != nil {
			return err
		}
		if envelope.SchemaVersion != 1 {
			return errors.New("invalid diagnostic policy schema")
		}
		if err := validateLogRetentionPolicy(envelope.Policy); err != nil {
			return err
		}
		policy = envelope.Policy
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	metadataPath := filepath.Join(directory, record.RunID+".json")
	if !policy.Persist {
		if _, err := os.Stat(metadataPath); errors.Is(err, os.ErrNotExist) {
			return nil
		}
	} else if event != nil {
		logPath := filepath.Join(directory, record.RunID+".log")
		if info, err := os.Lstat(logPath); err == nil && !info.Mode().IsRegular() {
			return errors.New("diagnostic log must be a regular file")
		}
		encoded, err := json.Marshal(event)
		if err != nil {
			return err
		}
		file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		_, writeErr := file.Write(append(encoded, '\n'))
		syncErr := file.Sync()
		closeErr := file.Close()
		if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
			return err
		}
		truncated, err := truncateFileTail(logPath, policy.MaxBytesPerRun)
		if err != nil {
			return err
		}
		record.Truncated = record.Truncated || truncated
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return writeFileAtomic(metadataPath, encoded, 0o600)
}
