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
		ProtocolVersion: state.ProtocolVersion,
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
	request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
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

func TestSyncIncludesHealthStateAndEvents(t *testing.T) {
	store, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close state: %v", err)
		}
	})
	if _, err := store.AppendEvent(state.Event{
		Type:      "stdout",
		RunID:     "11111111111111111111111111111111",
		ProjectID: "sync-project",
		ScriptID:  "sync-script",
		Message:   "sync output",
	}); err != nil {
		t.Fatalf("append sync event: %v", err)
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
		ProtocolVersion: state.ProtocolVersion,
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

	request := httptest.NewRequest(http.MethodGet, "/v1/sync?after=0", nil)
	request.Header.Set(AuthorizationHeader, "Bearer test-token")
	request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("sync response status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Health healthResponse   `json:"health"`
		State  serviceSnapshot  `json:"state"`
		Events state.EventBatch `json:"events"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode sync response: %v", err)
	}
	if payload.Health.InstanceID != "test-instance" || payload.Health.ProtocolVersion != state.ProtocolVersion {
		t.Fatalf("sync health = %#v, want current service identity", payload.Health)
	}
	if payload.State.Scheduler.State != scheduler.SchedulerStateRunning {
		t.Fatalf("sync scheduler state = %q, want %q", payload.State.Scheduler.State, scheduler.SchedulerStateRunning)
	}
	if len(payload.Events.Events) != 1 || payload.Events.Events[0].Message != "sync output" {
		t.Fatalf("sync events = %#v, want the retained event", payload.Events.Events)
	}
}

func TestJSONMutationRejectsEmptyBody(t *testing.T) {
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
		ProtocolVersion: state.ProtocolVersion,
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
	request := httptest.NewRequest(http.MethodPost, "/v1/logs/clear", strings.NewReader(""))
	request.Header.Set(AuthorizationHeader, "Bearer test-token")
	request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
	request.Header.Set("Content-Type", jsonContentType)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("empty body status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var payload errorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode empty body error: %v", err)
	}
	if payload.Code != "invalid_request" {
		t.Fatalf("empty body error code = %q, want invalid_request", payload.Code)
	}
}

func TestSyncRejectsOversizedCompleteResponse(t *testing.T) {
	store, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	for index := 0; index < state.MaxRunHistory; index++ {
		runID := fmt.Sprintf("%032x", index+1)
		if _, created, err := store.CreateRun(state.Run{
			ID:        runID,
			ProjectID: fmt.Sprintf("project-%03d", index),
			ScriptID:  "script",
			Command:   strings.Repeat("x", 4096),
			Status:    state.RunStatusExited,
		}, "sync-size-key-"+runID, "sync-size-fingerprint-"+runID); err != nil || !created {
			t.Fatalf("create oversized sync run %d: created=%t err=%v", index, created, err)
		}
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
		ProtocolVersion: state.ProtocolVersion,
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
	request := httptest.NewRequest(http.MethodGet, "/v1/sync?after=0", nil)
	request.Header.Set(AuthorizationHeader, "Bearer test-token")
	request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized sync status = %d, want %d", response.Code, http.StatusRequestEntityTooLarge)
	}
	var payload errorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode oversized sync error: %v", err)
	}
	if payload.Code != "response_too_large" {
		t.Fatalf("oversized sync error code = %q, want response_too_large", payload.Code)
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
		ProtocolVersion: state.ProtocolVersion,
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
	request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
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

func TestLogRetentionRoutesGetUpdateAndValidate(t *testing.T) {
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
		ProtocolVersion: state.ProtocolVersion,
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

	serve := func(method string, path string, body string, authenticated bool) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		if authenticated {
			request.Header.Set(AuthorizationHeader, "Bearer test-token")
			request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
		}
		if body != "" {
			request.Header.Set("Content-Type", jsonContentType)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	unauthorized := serve(http.MethodGet, "/v1/log-retention", "", false)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized retention status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	response := serve(http.MethodGet, "/v1/log-retention", "", true)
	if response.Code != http.StatusOK {
		t.Fatalf("get retention status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var current state.LogRetentionStatus
	if err := json.Unmarshal(response.Body.Bytes(), &current); err != nil {
		t.Fatalf("decode retention status: %v", err)
	}
	if current.Policy != state.DefaultLogRetentionPolicy() {
		t.Fatalf("default policy = %#v, want %#v", current.Policy, state.DefaultLogRetentionPolicy())
	}

	updatedPolicy := state.DefaultLogRetentionPolicy()
	updatedPolicy.Persist = false
	contents, err := json.Marshal(updatedPolicy)
	if err != nil {
		t.Fatalf("encode updated policy: %v", err)
	}
	response = serve(http.MethodPut, "/v1/log-retention", string(contents), true)
	if response.Code != http.StatusOK {
		t.Fatalf("update retention status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &current); err != nil {
		t.Fatalf("decode updated retention status: %v", err)
	}
	if current.Policy != updatedPolicy {
		t.Fatalf("updated policy = %#v, want %#v", current.Policy, updatedPolicy)
	}

	invalidPolicy := updatedPolicy
	invalidPolicy.MaxCompletedRunsPerProject = 0
	contents, err = json.Marshal(invalidPolicy)
	if err != nil {
		t.Fatalf("encode invalid policy: %v", err)
	}
	response = serve(http.MethodPut, "/v1/log-retention", string(contents), true)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid retention status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var failure errorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &failure); err != nil {
		t.Fatalf("decode invalid retention response: %v", err)
	}
	if failure.Code != "invalid_log_retention" {
		t.Fatalf("invalid retention code = %q, want invalid_log_retention", failure.Code)
	}
}

func TestLogRoutesListRetainedLogsAndClearPersistedLogs(t *testing.T) {
	store, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	const (
		completedRunID = "11111111111111111111111111111111"
		otherRunID     = "22222222222222222222222222222222"
	)
	for _, run := range []state.Run{
		{ID: completedRunID, ProjectID: "project", ScriptID: "completed", Label: "Completed", Command: "echo complete", Cwd: t.TempDir(), Status: state.RunStatusExited, StartedAt: "2026-08-16T00:00:00Z", EndedAt: "2026-08-16T00:01:00Z"},
		{ID: otherRunID, ProjectID: "project", ScriptID: "completed", Label: "Other", Command: "echo other", Cwd: t.TempDir(), Status: state.RunStatusExited, StartedAt: "2026-08-16T00:00:00Z", EndedAt: "2026-08-16T00:02:00Z"},
	} {
		if _, created, err := store.CreateRun(run, run.ID+"-key", run.ID+"-fingerprint"); err != nil || !created {
			t.Fatalf("create %s run: created=%t err=%v", run.ID, created, err)
		}
	}
	for _, event := range []state.Event{
		{Type: "stdout", RunID: completedRunID, ProjectID: "project", ScriptID: "completed", Message: "completed output"},
		{Type: "stdout", RunID: otherRunID, ProjectID: "project", ScriptID: "completed", Message: "other output"},
	} {
		if _, err := store.AppendEvent(event); err != nil {
			t.Fatalf("append output: %v", err)
		}
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
		ProtocolVersion: state.ProtocolVersion,
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
	serve := func(method string, path string, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set(AuthorizationHeader, "Bearer test-token")
		request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
		if body != "" {
			request.Header.Set("Content-Type", jsonContentType)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	response := serve(http.MethodGet, "/v1/logs?projectId=project", "")
	if response.Code != http.StatusOK {
		t.Fatalf("list logs status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var listed logsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode listed logs: %v", err)
	}
	if len(listed.Logs) != 2 {
		t.Fatalf("listed logs = %#v, want both retained logs", listed.Logs)
	}

	invalid := serve(http.MethodGet, "/v1/logs", "")
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("missing project id status = %d, want %d", invalid.Code, http.StatusBadRequest)
	}
	invalidScope := serve(http.MethodPost, "/v1/logs/clear", `{"runId":""}`)
	if invalidScope.Code != http.StatusBadRequest {
		t.Fatalf("invalid run scope status = %d, want %d; body=%s", invalidScope.Code, http.StatusBadRequest, invalidScope.Body.String())
	}

	response = serve(http.MethodPost, "/v1/logs/clear", fmt.Sprintf(`{"runId":%q}`, completedRunID))
	if response.Code != http.StatusOK {
		t.Fatalf("clear run log status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var cleared state.LogClearResult
	if err := json.Unmarshal(response.Body.Bytes(), &cleared); err != nil {
		t.Fatalf("decode clear result: %v", err)
	}
	if cleared.DeletedCount != 1 || cleared.ReleasedBytes <= 0 {
		t.Fatalf("run clear result = %#v, want one deleted completed log and released bytes", cleared)
	}
	response = serve(http.MethodGet, "/v1/logs?projectId=project", "")
	if response.Code != http.StatusOK {
		t.Fatalf("list logs after script clear status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode logs after script clear: %v", err)
	}
	if len(listed.Logs) != 1 || listed.Logs[0].RunID != otherRunID || !listed.Logs[0].Available {
		t.Fatalf("listed logs after run clear = %#v, want the other retained run of the same script", listed.Logs)
	}

	response = serve(http.MethodPost, "/v1/logs/clear", `{}`)
	if response.Code != http.StatusOK {
		t.Fatalf("clear all logs status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &cleared); err != nil {
		t.Fatalf("decode global clear result: %v", err)
	}
	if cleared.DeletedCount != 1 || cleared.ReleasedBytes <= 0 {
		t.Fatalf("global clear result = %#v, want remaining log deleted", cleared)
	}
}

func TestRunLogPageRouteReturnsTailAndRejectsInvalidOffsets(t *testing.T) {
	store, err := state.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close state store: %v", err)
		}
	})
	const runID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, created, err := store.CreateRun(state.Run{
		ID:        runID,
		ProjectID: "project",
		ScriptID:  "script",
		Status:    state.RunStatusExited,
	}, "paged-route-idempotency", "paged-route-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	for index := 0; index < 24; index++ {
		if _, err := store.AppendEvent(state.Event{
			Type:      "stdout",
			RunID:     runID,
			ProjectID: "project",
			ScriptID:  "script",
			Message:   strings.Repeat(string(rune('a'+rune(index))), 16*1024),
		}); err != nil {
			t.Fatalf("append output %d: %v", index, err)
		}
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush output: %v", err)
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
		ProtocolVersion: state.ProtocolVersion,
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
	serve := func(path string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set(AuthorizationHeader, "Bearer test-token")
		request.Header.Set(ProtocolHeader, fmt.Sprint(state.ProtocolVersion))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	response := serve("/v1/runs/" + runID + "/log?before=0")
	if response.Code != http.StatusOK {
		t.Fatalf("tail log status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var newest state.RunLog
	if err := json.Unmarshal(response.Body.Bytes(), &newest); err != nil {
		t.Fatalf("decode newest page: %v", err)
	}
	if !newest.HasMore || newest.NextOffset <= 0 || len(newest.Events) == 0 {
		t.Fatalf("newest page = %#v, want a bounded page with older output", newest)
	}
	response = serve(fmt.Sprintf("/v1/runs/%s/log?before=%d", runID, newest.NextOffset))
	if response.Code != http.StatusOK {
		t.Fatalf("older log status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var older state.RunLog
	if err := json.Unmarshal(response.Body.Bytes(), &older); err != nil {
		t.Fatalf("decode older page: %v", err)
	}
	if len(older.Events) == 0 || older.Events[len(older.Events)-1].Cursor >= newest.Events[0].Cursor {
		t.Fatalf("older page = %#v, newest page = %#v; want ordered non-overlapping pages", older, newest)
	}

	invalid := serve("/v1/runs/" + runID + "/log?before=not-a-number")
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid page status = %d, want %d; body=%s", invalid.Code, http.StatusBadRequest, invalid.Body.String())
	}
	var failure errorResponse
	if err := json.Unmarshal(invalid.Body.Bytes(), &failure); err != nil {
		t.Fatalf("decode invalid page response: %v", err)
	}
	if failure.Code != "invalid_log_page" {
		t.Fatalf("invalid page code = %q, want invalid_log_page", failure.Code)
	}
}
