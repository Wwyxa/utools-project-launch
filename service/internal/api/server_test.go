package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	serviceprocess "project-launch-service/internal/process"
	"project-launch-service/internal/scheduler"
	"project-launch-service/internal/state"
)

func TestStateIncludesSchedulerHealth(t *testing.T) {
	store, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}
	schedulerRuntime, err := scheduler.New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}
	handler, err := NewHandler(Config{
		Token:           "test-token",
		ProtocolVersion: 1,
		ServiceVersion:  "test",
		InstanceID:      "test-instance",
		PID:             1,
		ProcessIdentity: "test-identity",
		StartedAt:       time.Now().UTC(),
		Supervisor:      supervisor,
		Scheduler:       schedulerRuntime,
	})
	if err != nil {
		t.Fatalf("create handler: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/v1/state", nil)
	request.Header.Set(AuthorizationHeader, "Bearer test-token")
	request.Header.Set(ProtocolHeader, "1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("state response status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Scheduler scheduler.SchedulerHealth `json:"scheduler"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode state response: %v", err)
	}
	if payload.Scheduler.State != scheduler.SchedulerStateRunning {
		t.Fatalf("scheduler state = %q, want %q", payload.Scheduler.State, scheduler.SchedulerStateRunning)
	}
}

func TestStartRunReturnsTypedConflictForActiveProjectScript(t *testing.T) {
	store, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}
	runID, err := state.NewRunID()
	if err != nil {
		t.Fatalf("create run id: %v", err)
	}
	cwd := t.TempDir()
	if _, created, err := store.CreateRun(state.Run{
		ID:        runID,
		ProjectID: "project-1",
		ScriptID:  "script-1",
		Command:   "echo existing",
		Cwd:       cwd,
		Status:    state.RunStatusRunning,
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, "existing-key", "existing-fingerprint"); err != nil || !created {
		t.Fatalf("create active run: created=%t err=%v", created, err)
	}
	schedulerRuntime, err := scheduler.New(store, supervisor)
	if err != nil {
		t.Fatalf("create scheduler: %v", err)
	}
	handler, err := NewHandler(Config{
		Token:           "test-token",
		ProtocolVersion: 1,
		ServiceVersion:  "test",
		InstanceID:      "test-instance",
		PID:             1,
		ProcessIdentity: "test-identity",
		StartedAt:       time.Now().UTC(),
		Supervisor:      supervisor,
		Scheduler:       schedulerRuntime,
	})
	if err != nil {
		t.Fatalf("create handler: %v", err)
	}

	requestBody := fmt.Sprintf(`{"projectId":"project-1","scriptId":"script-1","command":"echo duplicate","cwd":%q,"env":{},"label":"duplicate"}`, cwd)
	request := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(requestBody))
	request.Header.Set(AuthorizationHeader, "Bearer test-token")
	request.Header.Set(ProtocolHeader, "1")
	request.Header.Set(IdempotencyHeader, "new-key")
	request.Header.Set("Content-Type", jsonContentType)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("start response status = %d, want %d; body=%s", response.Code, http.StatusConflict, response.Body.String())
	}
	var payload errorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode conflict response: %v", err)
	}
	if payload.Code != "active_run_conflict" {
		t.Fatalf("conflict code = %q, want active_run_conflict", payload.Code)
	}
}
