package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"project-launch-service/internal/api"
	"project-launch-service/internal/state"
)

func TestServiceWritesAndRemovesDiscovery(t *testing.T) {
	stateDir := t.TempDir()
	runtime, discovery, token := startService(t, stateDir)

	if discovery.ProtocolVersion != state.ProtocolVersion {
		t.Fatalf("protocol version = %d, want %d", discovery.ProtocolVersion, state.ProtocolVersion)
	}
	if discovery.Host != "127.0.0.1" || discovery.Port < 1 {
		t.Fatalf("unexpected discovery endpoint: %#v", discovery)
	}
	if discovery.ProcessIdentity == "" {
		t.Fatal("discovery did not persist the service process identity")
	}
	if len(token) != 64 {
		t.Fatalf("token length = %d, want 64", len(token))
	}
	if runtime.URL() != "http://127.0.0.1:"+strconvItoa(discovery.Port) {
		t.Fatalf("service URL = %q, want discovery endpoint", runtime.URL())
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := runtime.Shutdown(shutdownContext); err != nil {
		t.Fatalf("shutdown service: %v", err)
	}
	if _, err := os.Stat(state.DiscoveryPath(stateDir)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("discovery file still exists or could not be checked: %v", err)
	}
}

func TestServiceRejectsSecondInstanceForTheSameStateDirectory(t *testing.T) {
	stateDir := t.TempDir()
	_, _, _ = startService(t, stateDir)
	second, err := New(Config{StateDir: stateDir, Version: "test"})
	if err != nil {
		t.Fatalf("create second service: %v", err)
	}
	if err := second.Start(); !errors.Is(err, state.ErrServiceAlreadyRunning) {
		t.Fatalf("second service start error = %v, want state directory lock error", err)
	}
}

func TestHealthRequiresTokenAndProtocolCompatibility(t *testing.T) {
	stateDir := t.TempDir()
	runtime, discovery, token := startService(t, stateDir)

	unauthorized := request(t, runtime.URL(), http.MethodGet, "/v1/health", "", "", nil)
	defer unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.StatusCode, http.StatusUnauthorized)
	}

	incompatible := request(t, runtime.URL(), http.MethodGet, "/v1/health", token, "999", nil)
	defer incompatible.Body.Close()
	if incompatible.StatusCode != http.StatusUpgradeRequired {
		t.Fatalf("incompatible status = %d, want %d", incompatible.StatusCode, http.StatusUpgradeRequired)
	}

	health := request(t, runtime.URL(), http.MethodGet, "/v1/health", token, strconvItoa(state.ProtocolVersion), nil)
	defer health.Body.Close()
	if health.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d, want %d", health.StatusCode, http.StatusOK)
	}

	var payload struct {
		InstanceID      string `json:"instanceId"`
		PID             int    `json:"pid"`
		ProcessIdentity string `json:"processIdentity"`
	}
	if err := json.NewDecoder(health.Body).Decode(&payload); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if payload.InstanceID != discovery.InstanceID ||
		payload.PID != discovery.PID ||
		payload.ProcessIdentity != discovery.ProcessIdentity {
		t.Fatalf("health identity = %#v, want discovery %#v", payload, discovery)
	}
}

func TestShutdownRejectsOversizedRequests(t *testing.T) {
	stateDir := t.TempDir()
	runtime, _, token := startService(t, stateDir)

	requestBody := bytes.NewBufferString(strings.Repeat("x", api.MaxRequestBodyBytes+1))
	response := request(t, runtime.URL(), http.MethodPost, "/v1/shutdown", token, strconvItoa(state.ProtocolVersion), requestBody)
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized request status = %d, want %d", response.StatusCode, http.StatusRequestEntityTooLarge)
	}
}

func TestRemoveDiscoveryIfOwnedPreservesAnotherInstance(t *testing.T) {
	stateDir := t.TempDir()
	discovery := state.Discovery{
		ProtocolVersion: state.ProtocolVersion,
		ServiceVersion:  "test",
		InstanceID:      "other-instance",
		PID:             os.Getpid(),
		ProcessIdentity: "test-process-identity",
		StartedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Host:            "127.0.0.1",
		Port:            45678,
		TokenPath:       state.TokenPath(stateDir),
	}
	if err := state.WriteDiscovery(stateDir, discovery); err != nil {
		t.Fatalf("write stale discovery: %v", err)
	}
	if err := state.RemoveDiscoveryIfOwned(stateDir, "current-instance"); err != nil {
		t.Fatalf("remove discovery for different owner: %v", err)
	}
	if actual, err := state.ReadDiscovery(stateDir); err != nil || actual.InstanceID != discovery.InstanceID {
		t.Fatalf("different instance discovery was changed: %#v, %v", actual, err)
	}
}

func startService(t *testing.T, stateDir string) (*Service, state.Discovery, string) {
	t.Helper()
	runtime, err := New(Config{StateDir: stateDir, Version: "test"})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	if err := runtime.Start(); err != nil {
		t.Fatalf("start service: %v", err)
	}
	t.Cleanup(func() {
		shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = runtime.Shutdown(shutdownContext)
	})

	discovery, err := state.ReadDiscovery(stateDir)
	if err != nil {
		t.Fatalf("read discovery: %v", err)
	}
	token, err := state.LoadOrCreateToken(stateDir)
	if err != nil {
		t.Fatalf("load service token: %v", err)
	}

	return runtime, discovery, token
}

func request(
	t *testing.T,
	baseURL string,
	method string,
	path string,
	token string,
	protocolVersion string,
	body *bytes.Buffer,
) *http.Response {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader(body.Bytes())
	}
	request, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	if token != "" {
		request.Header.Set(api.AuthorizationHeader, "Bearer "+token)
	}
	if protocolVersion != "" {
		request.Header.Set(api.ProtocolHeader, protocolVersion)
	}
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("perform request: %v", err)
	}

	return response
}

func strconvItoa(value int) string {
	return strconv.Itoa(value)
}
