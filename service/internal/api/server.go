package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	serviceprocess "project-launch-service/internal/process"
	"project-launch-service/internal/scheduler"
	"project-launch-service/internal/state"
)

const (
	AuthorizationHeader   = "Authorization"
	ProtocolHeader        = "X-Protocol-Version"
	IdempotencyHeader     = "Idempotency-Key"
	MaxRequestBodyBytes   = 64 * 1024
	maxEventResponseBytes = 192 * 1024
	maxSyncResponseBytes  = 512 * 1024
	jsonContentType       = "application/json"
	requestBodyMediaType  = "application/json"
)

type Config struct {
	Token           string
	ProtocolVersion int
	ServiceVersion  string
	InstanceID      string
	PID             int
	ProcessIdentity string
	StartedAt       time.Time
	RequestShutdown func()
	HasActiveRuns   func() bool
	Supervisor      *serviceprocess.Supervisor
	Scheduler       *scheduler.Runtime
}

type Handler struct {
	config       Config
	shutdownOnce sync.Once
}

type healthResponse struct {
	ProtocolVersion int    `json:"protocolVersion"`
	ServiceVersion  string `json:"serviceVersion"`
	InstanceID      string `json:"instanceId"`
	PID             int    `json:"pid"`
	ProcessIdentity string `json:"processIdentity"`
	StartedAt       string `json:"startedAt"`
}

type syncResponse struct {
	Health healthResponse   `json:"health"`
	State  serviceSnapshot  `json:"state"`
	Events state.EventBatch `json:"events"`
}

type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type runRequest struct {
	ProjectID       string            `json:"projectId"`
	ScriptID        string            `json:"scriptId"`
	Command         string            `json:"command"`
	Cwd             string            `json:"cwd"`
	Env             map[string]string `json:"env"`
	Label           string            `json:"label"`
	AutomationRunID string            `json:"automationRunId,omitempty"`
}

type inputRequest struct {
	Input string `json:"input"`
}

type runResponse struct {
	Run     state.Run `json:"run"`
	Created bool      `json:"created"`
}

type automationConfigRequest struct {
	Revision uint64          `json:"revision"`
	Config   json.RawMessage `json:"config"`
}

type logsResponse struct {
	Logs []state.LogDescriptor `json:"logs"`
}

type clearLogsRequest struct {
	RunID *string `json:"runId"`
}

type serviceSnapshot struct {
	state.Snapshot
	Automation state.AutomationState     `json:"automation"`
	Scheduler  scheduler.SchedulerHealth `json:"scheduler"`
}

func NewHandler(config Config) (*Handler, error) {
	if strings.TrimSpace(config.Token) == "" {
		return nil, errors.New("service token is required")
	}
	if config.ProtocolVersion <= 0 {
		return nil, errors.New("protocol version must be positive")
	}
	if strings.TrimSpace(config.ServiceVersion) == "" {
		return nil, errors.New("service version is required")
	}
	if strings.TrimSpace(config.InstanceID) == "" {
		return nil, errors.New("instance id is required")
	}
	if config.PID <= 0 {
		return nil, errors.New("pid must be positive")
	}
	if strings.TrimSpace(config.ProcessIdentity) == "" {
		return nil, errors.New("process identity is required")
	}
	if config.StartedAt.IsZero() {
		return nil, errors.New("start time is required")
	}
	if config.Supervisor == nil {
		return nil, errors.New("process supervisor is required")
	}
	if config.Scheduler == nil {
		return nil, errors.New("automation scheduler is required")
	}

	return &Handler{config: config}, nil
}

func (handler *Handler) ServeHTTP(responseWriter http.ResponseWriter, request *http.Request) {
	if !handler.authorize(responseWriter, request) {
		return
	}

	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/v1/health":
		handler.writeJSON(responseWriter, http.StatusOK, handler.healthResponse())
	case request.Method == http.MethodGet && request.URL.Path == "/v1/state":
		handler.writeJSON(responseWriter, http.StatusOK, handler.serviceSnapshot())
	case request.Method == http.MethodGet && request.URL.Path == "/v1/sync":
		handler.handleSync(responseWriter, request)
	case request.Method == http.MethodGet && request.URL.Path == "/v1/log-retention":
		handler.handleLogRetention(responseWriter, request)
	case request.Method == http.MethodPut && request.URL.Path == "/v1/log-retention":
		handler.handleLogRetention(responseWriter, request)
	case request.Method == http.MethodGet && request.URL.Path == "/v1/logs":
		handler.handleLogs(responseWriter, request)
	case request.Method == http.MethodPost && request.URL.Path == "/v1/logs/clear":
		handler.handleClearLogs(responseWriter, request)
	case request.Method == http.MethodPut && request.URL.Path == "/v1/automation/config":
		handler.handleAutomationConfig(responseWriter, request)
	case request.Method == http.MethodGet && request.URL.Path == "/v1/events":
		handler.handleEvents(responseWriter, request)
	case request.Method == http.MethodPost && request.URL.Path == "/v1/runs":
		handler.handleStartRun(responseWriter, request)
	case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/v1/runs/"):
		handler.handleRunLog(responseWriter, request)
	case request.Method == http.MethodPost && strings.HasPrefix(request.URL.Path, "/v1/runs/"):
		handler.handleRunAction(responseWriter, request)
	case request.Method == http.MethodPost && request.URL.Path == "/v1/shutdown":
		if !handler.requireJSON(responseWriter, request) {
			return
		}
		if _, ok := handler.readJSON(responseWriter, request, &struct{}{}); !ok {
			return
		}
		if handler.config.HasActiveRuns != nil && handler.config.HasActiveRuns() {
			handler.writeError(responseWriter, http.StatusConflict, "active_runs", "Stop managed processes before shutting down the service.")
			return
		}
		handler.writeJSON(responseWriter, http.StatusAccepted, map[string]bool{"accepted": true})
		if handler.config.RequestShutdown != nil {
			handler.shutdownOnce.Do(func() {
				go handler.config.RequestShutdown()
			})
		}
	default:
		handler.writeError(responseWriter, http.StatusNotFound, "not_found", "The requested service endpoint does not exist.")
	}
}

func (handler *Handler) SupervisorSnapshot() state.Snapshot {
	return handler.config.Supervisor.StoreSnapshot()
}

func (handler *Handler) healthResponse() healthResponse {
	return healthResponse{
		ProtocolVersion: handler.config.ProtocolVersion,
		ServiceVersion:  handler.config.ServiceVersion,
		InstanceID:      handler.config.InstanceID,
		PID:             handler.config.PID,
		ProcessIdentity: handler.config.ProcessIdentity,
		StartedAt:       handler.config.StartedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (handler *Handler) serviceSnapshot() serviceSnapshot {
	return serviceSnapshot{
		Snapshot:   handler.config.Supervisor.StoreSnapshot(),
		Automation: handler.config.Scheduler.AutomationSnapshot(),
		Scheduler:  handler.config.Scheduler.Health(),
	}
}

func (handler *Handler) handleSync(responseWriter http.ResponseWriter, request *http.Request) {
	after, err := eventCursorAfter(request)
	if err != nil {
		handler.writeError(responseWriter, http.StatusBadRequest, "invalid_cursor", "The event cursor must be a non-negative integer.")
		return
	}
	events := handler.SupervisorEventsAfter(after)
	snapshot := handler.serviceSnapshot()
	handler.writeBoundedJSON(responseWriter, http.StatusOK, syncResponse{
		Health: handler.healthResponse(),
		State:  snapshot,
		Events: events,
	}, maxSyncResponseBytes)
}

func (handler *Handler) handleAutomationConfig(responseWriter http.ResponseWriter, request *http.Request) {
	if !handler.requireJSON(responseWriter, request) {
		return
	}
	var payload automationConfigRequest
	if _, ok := handler.readJSON(responseWriter, request, &payload); !ok {
		return
	}
	updated, err := handler.config.Scheduler.ReplaceConfiguration(payload.Revision, payload.Config)
	if err != nil {
		if errors.Is(err, state.ErrAutomationRevisionConflict) {
			handler.writeError(responseWriter, http.StatusConflict, "automation_revision_conflict", err.Error())
			return
		}
		handler.writeError(responseWriter, http.StatusBadRequest, "automation_config_invalid", err.Error())
		return
	}
	handler.writeJSON(responseWriter, http.StatusOK, updated)
}

func (handler *Handler) handleLogRetention(responseWriter http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodGet {
		status, err := handler.config.Supervisor.LogRetentionStatus()
		if err != nil {
			handler.writeError(responseWriter, http.StatusInternalServerError, "log_retention_failed", err.Error())
			return
		}
		handler.writeJSON(responseWriter, http.StatusOK, status)
		return
	}

	if !handler.requireJSON(responseWriter, request) {
		return
	}
	var policy state.LogRetentionPolicy
	if _, ok := handler.readJSON(responseWriter, request, &policy); !ok {
		return
	}
	status, err := handler.config.Supervisor.UpdateLogRetention(policy)
	if err != nil {
		if errors.Is(err, state.ErrLogRetentionPolicyInvalid) {
			handler.writeError(responseWriter, http.StatusBadRequest, "invalid_log_retention", err.Error())
			return
		}
		handler.writeError(responseWriter, http.StatusInternalServerError, "log_retention_failed", err.Error())
		return
	}
	handler.writeJSON(responseWriter, http.StatusOK, status)
}

func (handler *Handler) handleLogs(responseWriter http.ResponseWriter, request *http.Request) {
	projectID := strings.TrimSpace(request.URL.Query().Get("projectId"))
	if projectID == "" {
		handler.writeError(responseWriter, http.StatusBadRequest, "invalid_project_id", "A projectId query parameter is required.")
		return
	}
	logs, err := handler.config.Supervisor.RetainedLogDescriptors(projectID)
	if err != nil {
		handler.writeError(responseWriter, http.StatusInternalServerError, "logs_list_failed", err.Error())
		return
	}
	handler.writeJSON(responseWriter, http.StatusOK, logsResponse{Logs: logs})
}

func (handler *Handler) handleClearLogs(responseWriter http.ResponseWriter, request *http.Request) {
	if !handler.requireJSON(responseWriter, request) {
		return
	}
	var payload clearLogsRequest
	if _, ok := handler.readJSON(responseWriter, request, &payload); !ok {
		return
	}
	var (
		result state.LogClearResult
		err    error
	)
	if payload.RunID == nil {
		result, err = handler.config.Supervisor.ClearPersistedLogs()
	} else {
		runID := strings.TrimSpace(*payload.RunID)
		if !isSafeRunID(runID) {
			handler.writeError(responseWriter, http.StatusBadRequest, "invalid_run_id", "runId must be a 32-character lowercase hexadecimal identifier.")
			return
		}
		result, err = handler.config.Supervisor.ClearPersistedLogsForRun(runID)
	}
	if err != nil {
		handler.writeError(responseWriter, http.StatusInternalServerError, "logs_clear_failed", err.Error())
		return
	}
	handler.writeJSON(responseWriter, http.StatusOK, result)
}

func (handler *Handler) handleEvents(responseWriter http.ResponseWriter, request *http.Request) {
	after, err := eventCursorAfter(request)
	if err != nil {
		handler.writeError(responseWriter, http.StatusBadRequest, "invalid_cursor", "The event cursor must be a non-negative integer.")
		return
	}
	handler.writeJSON(responseWriter, http.StatusOK, handler.SupervisorEventsAfter(after))
}

func eventCursorAfter(request *http.Request) (uint64, error) {
	afterText := request.URL.Query().Get("after")
	if afterText == "" {
		afterText = "0"
	}
	return strconv.ParseUint(afterText, 10, 64)
}

func (handler *Handler) SupervisorEventsAfter(after uint64) state.EventBatch {
	return handler.config.Supervisor.EventsAfterPage(after, maxEventResponseBytes)
}

func (handler *Handler) handleStartRun(responseWriter http.ResponseWriter, request *http.Request) {
	if !handler.requireJSON(responseWriter, request) {
		return
	}
	var payload runRequest
	if _, ok := handler.readJSON(responseWriter, request, &payload); !ok {
		return
	}
	idempotencyKey := request.Header.Get(IdempotencyHeader)
	if strings.TrimSpace(idempotencyKey) == "" {
		handler.writeError(responseWriter, http.StatusBadRequest, "missing_idempotency_key", "Run requests require an Idempotency-Key header.")
		return
	}

	run, created, err := handler.config.Supervisor.Start(serviceprocess.StartRequest{
		ProjectID:          payload.ProjectID,
		ScriptID:           payload.ScriptID,
		Command:            payload.Command,
		Cwd:                payload.Cwd,
		Env:                payload.Env,
		Label:              payload.Label,
		AutomationRunID:    payload.AutomationRunID,
		IdempotencyKey:     idempotencyKey,
		RequestFingerprint: handler.config.Supervisor.Fingerprint(fingerprintRunRequest(payload)),
	})
	if err != nil {
		if errors.Is(err, state.ErrIdempotencyConflict) {
			handler.writeError(responseWriter, http.StatusConflict, "idempotency_conflict", "The Idempotency-Key was already used for another run request.")
			return
		}
		if errors.Is(err, state.ErrActiveRunConflict) {
			handler.writeError(responseWriter, http.StatusConflict, "active_run_conflict", "An active run already exists for this project and script.")
			return
		}
		handler.writeError(responseWriter, http.StatusBadRequest, "run_start_failed", err.Error())
		return
	}

	status := http.StatusCreated
	if !created {
		status = http.StatusOK
	}
	handler.writeJSON(responseWriter, status, runResponse{Run: run, Created: created})
}

func (handler *Handler) handleRunAction(responseWriter http.ResponseWriter, request *http.Request) {
	remainingPath := strings.TrimPrefix(request.URL.Path, "/v1/runs/")
	pathParts := strings.Split(remainingPath, "/")
	if len(pathParts) != 2 || !isSafeRunID(pathParts[0]) {
		handler.writeError(responseWriter, http.StatusNotFound, "not_found", "The requested run endpoint does not exist.")
		return
	}

	switch pathParts[1] {
	case "input":
		if !handler.requireJSON(responseWriter, request) {
			return
		}
		var payload inputRequest
		if _, ok := handler.readJSON(responseWriter, request, &payload); !ok {
			return
		}
		result, err := handler.config.Supervisor.SendInput(pathParts[0], payload.Input)
		if err != nil {
			handler.writeError(responseWriter, http.StatusInternalServerError, "input_failed", err.Error())
			return
		}
		handler.writeJSON(responseWriter, http.StatusOK, result)
	case "stop":
		if !handler.requireJSON(responseWriter, request) {
			return
		}
		if _, ok := handler.readJSON(responseWriter, request, &struct{}{}); !ok {
			return
		}
		run, err := handler.config.Supervisor.Stop(pathParts[0])
		if err != nil {
			if strings.Contains(err.Error(), "was not found") {
				handler.writeError(responseWriter, http.StatusNotFound, "run_not_found", "The selected run no longer exists.")
				return
			}
			handler.writeError(responseWriter, http.StatusConflict, "stop_failed", err.Error())
			return
		}
		handler.writeJSON(responseWriter, http.StatusAccepted, run)
	default:
		handler.writeError(responseWriter, http.StatusNotFound, "not_found", "The requested run endpoint does not exist.")
	}
}

func (handler *Handler) handleRunLog(responseWriter http.ResponseWriter, request *http.Request) {
	remainingPath := strings.TrimPrefix(request.URL.Path, "/v1/runs/")
	pathParts := strings.Split(remainingPath, "/")
	if len(pathParts) != 2 || pathParts[1] != "log" || !isSafeRunID(pathParts[0]) {
		handler.writeError(responseWriter, http.StatusNotFound, "not_found", "The requested run endpoint does not exist.")
		return
	}

	beforeOffset, paged, err := parseRunLogPage(request)
	if err != nil {
		handler.writeError(responseWriter, http.StatusBadRequest, "invalid_log_page", err.Error())
		return
	}
	var runLog state.RunLog
	if paged {
		runLog, err = handler.config.Supervisor.RunLogPage(pathParts[0], beforeOffset)
	} else {
		runLog, err = handler.config.Supervisor.RunLog(pathParts[0])
	}
	if err != nil {
		if errors.Is(err, state.ErrRunLogUnavailable) {
			handler.writeError(responseWriter, http.StatusNotFound, "run_log_unavailable", "The retained log for this run is no longer available.")
			return
		}
		if errors.Is(err, state.ErrRunLogPageInvalid) {
			handler.writeError(responseWriter, http.StatusBadRequest, "invalid_log_page", err.Error())
			return
		}
		handler.writeError(responseWriter, http.StatusInternalServerError, "run_log_failed", err.Error())
		return
	}
	handler.writeJSON(responseWriter, http.StatusOK, runLog)
}

func parseRunLogPage(request *http.Request) (int64, bool, error) {
	values, paged := request.URL.Query()["before"]
	if !paged {
		return 0, false, nil
	}
	if len(values) != 1 || strings.TrimSpace(values[0]) == "" {
		return 0, false, fmt.Errorf("%w: before must be one non-negative byte offset", state.ErrRunLogPageInvalid)
	}
	beforeOffset, err := strconv.ParseInt(values[0], 10, 64)
	if err != nil || beforeOffset < 0 {
		return 0, false, fmt.Errorf("%w: before must be one non-negative byte offset", state.ErrRunLogPageInvalid)
	}
	return beforeOffset, true, nil
}

func (handler *Handler) authorize(responseWriter http.ResponseWriter, request *http.Request) bool {
	expectedAuthorization := "Bearer " + handler.config.Token
	providedAuthorization := request.Header.Get(AuthorizationHeader)
	if subtle.ConstantTimeCompare([]byte(providedAuthorization), []byte(expectedAuthorization)) != 1 {
		handler.writeError(responseWriter, http.StatusUnauthorized, "unauthorized", "A valid local service token is required.")
		return false
	}

	providedVersion, err := strconv.Atoi(request.Header.Get(ProtocolHeader))
	if err != nil || providedVersion != handler.config.ProtocolVersion {
		handler.writeError(
			responseWriter,
			http.StatusUpgradeRequired,
			"protocol_mismatch",
			fmt.Sprintf("This plugin supports Project Launch Service protocol %d.", handler.config.ProtocolVersion),
		)
		return false
	}

	return true
}

func (handler *Handler) requireJSON(responseWriter http.ResponseWriter, request *http.Request) bool {
	contentType := request.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, requestBodyMediaType) {
		handler.writeError(responseWriter, http.StatusUnsupportedMediaType, "unsupported_media_type", "Requests must use application/json.")
		return false
	}

	return true
}

func (handler *Handler) readJSON(responseWriter http.ResponseWriter, request *http.Request, destination any) (any, bool) {
	if request.ContentLength > MaxRequestBodyBytes {
		handler.writeError(responseWriter, http.StatusRequestEntityTooLarge, "request_too_large", "The request body exceeds the service limit.")
		return nil, false
	}
	request.Body = http.MaxBytesReader(responseWriter, request.Body, MaxRequestBodyBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			handler.writeError(responseWriter, http.StatusRequestEntityTooLarge, "request_too_large", "The request body exceeds the service limit.")
			return nil, false
		}
		if errors.Is(err, io.EOF) {
			handler.writeError(responseWriter, http.StatusBadRequest, "invalid_request", "The request body must contain one JSON value.")
			return nil, false
		}
		handler.writeError(responseWriter, http.StatusBadRequest, "invalid_request", "The request body must be valid JSON.")
		return nil, false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		handler.writeError(responseWriter, http.StatusBadRequest, "invalid_request", "The request body must contain one JSON value.")
		return nil, false
	}
	return destination, true
}

func fingerprintRunRequest(payload runRequest) string {
	environmentKeys := make([]string, 0, len(payload.Env))
	for key := range payload.Env {
		environmentKeys = append(environmentKeys, key)
	}
	sort.Strings(environmentKeys)
	contents := strings.Builder{}
	contents.WriteString(payload.ProjectID)
	contents.WriteByte('\x00')
	contents.WriteString(payload.ScriptID)
	contents.WriteByte('\x00')
	contents.WriteString(payload.Command)
	contents.WriteByte('\x00')
	contents.WriteString(payload.Cwd)
	contents.WriteByte('\x00')
	contents.WriteString(payload.Label)
	contents.WriteByte('\x00')
	contents.WriteString(payload.AutomationRunID)
	for _, key := range environmentKeys {
		contents.WriteByte('\x00')
		contents.WriteString(key)
		contents.WriteByte('=')
		contents.WriteString(payload.Env[key])
	}
	return contents.String()
}

func isSafeRunID(runID string) bool {
	if len(runID) != 32 {
		return false
	}
	for _, character := range runID {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func (handler *Handler) writeError(responseWriter http.ResponseWriter, status int, code string, message string) {
	handler.writeJSON(responseWriter, status, errorResponse{Code: code, Message: message})
}

func (handler *Handler) writeJSON(responseWriter http.ResponseWriter, status int, value any) {
	responseWriter.Header().Set("Content-Type", jsonContentType)
	responseWriter.WriteHeader(status)
	_ = json.NewEncoder(responseWriter).Encode(value)
}

func (handler *Handler) writeBoundedJSON(responseWriter http.ResponseWriter, status int, value any, maxBytes int) {
	encoded, err := json.Marshal(value)
	if err != nil {
		handler.writeError(responseWriter, http.StatusInternalServerError, "response_encoding_failed", "The service response could not be encoded.")
		return
	}
	if maxBytes > 0 && len(encoded)+1 > maxBytes {
		handler.writeError(responseWriter, http.StatusRequestEntityTooLarge, "response_too_large", "The service response exceeds the response size limit.")
		return
	}
	responseWriter.Header().Set("Content-Type", jsonContentType)
	responseWriter.WriteHeader(status)
	_, _ = responseWriter.Write(append(encoded, '\n'))
}
