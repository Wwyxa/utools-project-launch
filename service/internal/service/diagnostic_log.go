package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"project-launch-service/internal/state"
)

type diagnosticLogger struct {
	mutex      sync.Mutex
	runtimeDir string
	record     state.RuntimeRecord
	cursor     uint64
}

func openDiagnosticLogger(runtimeDir string) (*diagnosticLogger, error) {
	if runtimeDir == "" {
		return nil, errors.New("runtime directory is required for diagnostics")
	}
	runID, err := state.NewRunID()
	if err != nil {
		return nil, err
	}
	return &diagnosticLogger{runtimeDir: runtimeDir, record: state.RuntimeRecord{
		SchemaVersion: 1, Source: "diagnostic", RunID: runID, ProjectID: "__plugin__", ScriptID: "",
		Label: "后台执行器诊断", Status: state.RunStatusRunning, StartedAt: time.Now().UTC().Format(time.RFC3339Nano), WriterPID: os.Getpid(),
	}}, nil
}

func (logger *diagnosticLogger) write(event string, fields map[string]any) {
	if logger == nil {
		return
	}
	payload := map[string]any{
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"event":     event,
	}
	for key, value := range fields {
		payload[key] = value
	}
	contents, err := json.Marshal(payload)
	if err != nil {
		return
	}

	logger.mutex.Lock()
	defer logger.mutex.Unlock()
	logger.cursor++
	err = state.WriteRuntimeDiagnostic(logger.runtimeDir, &logger.record, &state.Event{
		Cursor: logger.cursor, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Type: "stdout",
		RunID: logger.record.RunID, ProjectID: logger.record.ProjectID, ScriptID: "", Message: string(contents),
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "Runtime diagnostic persistence failed.")
	}
}

func (logger *diagnosticLogger) close() error {
	if logger == nil {
		return nil
	}
	logger.mutex.Lock()
	defer logger.mutex.Unlock()
	logger.record.Status = state.RunStatusExited
	logger.record.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return state.WriteRuntimeDiagnostic(logger.runtimeDir, &logger.record, nil)
}
