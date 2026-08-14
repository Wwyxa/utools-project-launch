package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"project-launch-service/internal/api"
	"project-launch-service/internal/state"
)

func TestExecutableReconnectsToPersistedRunAfterServiceRestart(t *testing.T) {
	serviceBinary := buildServiceExecutable(t)
	stateDir := t.TempDir()
	firstProcess := startExecutableService(t, serviceBinary, stateDir)
	firstDiscovery, token := waitForExecutableDiscovery(t, stateDir)

	run := startExecutableRun(t, firstDiscovery, token, stateDir)
	t.Cleanup(func() { terminateTestProcessTree(run.PID) })
	if run.Status != state.RunStatusRunning || run.PID <= 0 || run.ProcessIdentity == "" {
		t.Fatalf("started run = %#v, want an identified running process", run)
	}

	if err := firstProcess.Process.Kill(); err != nil {
		t.Fatalf("terminate first service process: %v", err)
	}
	if err := firstProcess.Wait(); err != nil {
		t.Logf("first service process exited after forced termination: %v", err)
	}

	secondProcess := startExecutableService(t, serviceBinary, stateDir)
	secondDiscovery, reconnectedToken := waitForDifferentDiscovery(t, stateDir, firstDiscovery.InstanceID)
	if reconnectedToken != token {
		t.Fatalf("service token changed across restart")
	}
	defer func() {
		if secondProcess.ProcessState == nil || !secondProcess.ProcessState.Exited() {
			_ = secondProcess.Process.Kill()
			_ = secondProcess.Wait()
		}
	}()

	snapshot := getState(t, secondDiscovery, token)
	reconnectedRun, found := findRun(snapshot.Runs, run.ID)
	if !found {
		t.Fatalf("reconnected state did not contain run %q: %#v", run.ID, snapshot)
	}
	if !reconnectedRun.Status.IsActive() {
		t.Fatalf("reconnected run = %#v, want active status", reconnectedRun)
	}

	stopResponse := serviceRequest(t, secondDiscovery, token, http.MethodPost, "/v1/runs/"+run.ID+"/stop", []byte("{}"), "")
	defer stopResponse.Body.Close()
	if stopResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("stop response status = %d, want %d", stopResponse.StatusCode, http.StatusAccepted)
	}
	waitForRunStatusViaAPI(t, secondDiscovery, token, run.ID, state.RunStatusStopped)

	shutdownResponse := serviceRequest(t, secondDiscovery, token, http.MethodPost, "/v1/shutdown", []byte("{}"), "")
	defer shutdownResponse.Body.Close()
	if shutdownResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("shutdown response status = %d, want %d", shutdownResponse.StatusCode, http.StatusAccepted)
	}
	waitForProcessExit(t, secondProcess)
}

func buildServiceExecutable(t *testing.T) string {
	t.Helper()
	_, sourcePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve executable test path")
	}
	moduleDir := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), "..", ".."))
	executableName := "project-launch-service"
	if runtime.GOOS == "windows" {
		executableName += ".exe"
	}
	executablePath := filepath.Join(t.TempDir(), executableName)
	command := exec.Command("go", "build", "-o", executablePath, "./cmd/project-launch-service")
	command.Dir = moduleDir
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("build service executable: %v\n%s", err, output)
	}
	return executablePath
}

func startExecutableService(t *testing.T, executablePath string, stateDir string) *exec.Cmd {
	t.Helper()
	command := exec.Command(executablePath, "--state-dir", stateDir)
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Start(); err != nil {
		t.Fatalf("start service executable: %v", err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil || !command.ProcessState.Exited() {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
		if output.Len() > 0 {
			t.Logf("service executable output: %s", output.String())
		}
	})
	return command
}

func terminateTestProcessTree(pid int) {
	if pid <= 0 {
		return
	}
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill.exe", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
		return
	}
	_ = exec.Command("kill", "-KILL", "-"+strconv.Itoa(pid)).Run()
}

func waitForExecutableDiscovery(t *testing.T, stateDir string) (state.Discovery, string) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		discovery, discoveryErr := state.ReadDiscovery(stateDir)
		token, tokenErr := state.LoadOrCreateToken(stateDir)
		if discoveryErr == nil && tokenErr == nil {
			return discovery, token
		}
		time.Sleep(25 * time.Millisecond)
	}
	discovery, discoveryErr := state.ReadDiscovery(stateDir)
	_, tokenErr := state.LoadOrCreateToken(stateDir)
	t.Fatalf("service discovery did not become ready: discovery=%v token=%v", discoveryErr, tokenErr)
	return discovery, ""
}

func waitForDifferentDiscovery(t *testing.T, stateDir string, previousInstanceID string) (state.Discovery, string) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		discovery, discoveryErr := state.ReadDiscovery(stateDir)
		token, tokenErr := state.LoadOrCreateToken(stateDir)
		if discoveryErr == nil && tokenErr == nil && discovery.InstanceID != previousInstanceID {
			return discovery, token
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("service discovery did not reconnect with a new instance")
	return state.Discovery{}, ""
}

func startExecutableRun(t *testing.T, discovery state.Discovery, token string, stateDir string) state.Run {
	t.Helper()
	command := "sleep 15"
	if runtime.GOOS == "windows" {
		command = "ping -n 15 127.0.0.1 >nul"
	}
	payload, err := json.Marshal(map[string]any{
		"projectId": "reconnect-project",
		"scriptId":  "reconnect-script",
		"command":   command,
		"cwd":       stateDir,
		"env":       map[string]string{},
		"label":     "Reconnect test",
	})
	if err != nil {
		t.Fatalf("encode run request: %v", err)
	}
	response := serviceRequest(t, discovery, token, http.MethodPost, "/v1/runs", payload, "reconnect-idempotency-key")
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("start run response status = %d, want %d", response.StatusCode, http.StatusCreated)
	}
	var result struct {
		Run state.Run `json:"run"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode start run response: %v", err)
	}
	return result.Run
}

func getState(t *testing.T, discovery state.Discovery, token string) state.Snapshot {
	t.Helper()
	response := serviceRequest(t, discovery, token, http.MethodGet, "/v1/state", nil, "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("state response status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	var snapshot state.Snapshot
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode state response: %v", err)
	}
	return snapshot
}

func waitForRunStatusViaAPI(t *testing.T, discovery state.Discovery, token string, runID string, expected state.RunStatus) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if run, found := findRun(getState(t, discovery, token).Runs, runID); found && run.Status == expected {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("run %q did not reach status %q", runID, expected)
}

func serviceRequest(t *testing.T, discovery state.Discovery, token string, method string, path string, body []byte, idempotencyKey string) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(context.Background(), method, fmt.Sprintf("http://%s:%d%s", discovery.Host, discovery.Port, path), reader)
	if err != nil {
		t.Fatalf("create service request: %v", err)
	}
	request.Header.Set(api.AuthorizationHeader, "Bearer "+token)
	request.Header.Set(api.ProtocolHeader, fmt.Sprint(discovery.ProtocolVersion))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(idempotencyKey) != "" {
		request.Header.Set(api.IdempotencyHeader, idempotencyKey)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("perform service request: %v", err)
	}
	return response
}

func waitForProcessExit(t *testing.T, process *exec.Cmd) {
	t.Helper()
	exit := make(chan error, 1)
	go func() {
		exit <- process.Wait()
	}()
	select {
	case <-time.After(8 * time.Second):
		t.Fatal("service executable did not exit after shutdown")
	case err := <-exit:
		if err != nil && !strings.Contains(err.Error(), "signal") {
			t.Fatalf("service executable exit error: %v", err)
		}
	}
}

func findRun(runs []state.Run, runID string) (state.Run, bool) {
	for _, run := range runs {
		if run.ID == runID {
			return run, true
		}
	}
	return state.Run{}, false
}
