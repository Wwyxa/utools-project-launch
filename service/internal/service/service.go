package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"project-launch-service/internal/api"
	serviceprocess "project-launch-service/internal/process"
	"project-launch-service/internal/scheduler"
	"project-launch-service/internal/state"
)

type Config struct {
	StateDir string
	Version  string
}

type Service struct {
	config Config

	mutex         sync.Mutex
	diagnosticsMu sync.RWMutex
	diagnostics   *diagnosticLogger
	listener      net.Listener
	httpServer    *http.Server
	discovery     state.Discovery
	directoryLock *state.DirectoryLock
	store         *state.Store
	supervisor    *serviceprocess.Supervisor
	scheduler     *scheduler.Runtime
	schedulerStop context.CancelFunc
	started       bool
	shutdownErr   error
	stopOnce      sync.Once
	done          chan struct{}
}

func New(config Config) (*Service, error) {
	if strings.TrimSpace(config.StateDir) == "" {
		return nil, errors.New("state directory is required")
	}
	if strings.TrimSpace(config.Version) == "" {
		return nil, errors.New("service version is required")
	}

	return &Service{
		config: config,
		done:   make(chan struct{}),
	}, nil
}

func (service *Service) Start() error {
	service.mutex.Lock()
	defer service.mutex.Unlock()
	if service.started {
		return errors.New("service is already running")
	}
	closeDiagnostics := false
	if service.diagnostics == nil {
		diagnostics, err := openDiagnosticLogger(service.config.StateDir)
		if err != nil {
			return err
		}
		service.diagnosticsMu.Lock()
		service.diagnostics = diagnostics
		service.diagnosticsMu.Unlock()
		closeDiagnostics = true
		defer func() {
			if closeDiagnostics {
				service.diagnosticsMu.Lock()
				service.diagnostics = nil
				service.diagnosticsMu.Unlock()
				_ = diagnostics.close()
			}
		}()
	}
	service.log("start.begin", map[string]any{"stateDir": service.config.StateDir})

	directoryLock, err := state.AcquireDirectoryLock(service.config.StateDir)
	if err != nil {
		service.log("start.failed", map[string]any{"stage": "directory_lock", "error": err.Error()})
		return fmt.Errorf("acquire service directory lock: %w", err)
	}
	closeDirectoryLock := true
	defer func() {
		if closeDirectoryLock {
			_ = directoryLock.Close()
		}
	}()
	if err := state.RemoveStaleDiscovery(service.config.StateDir, serviceprocess.ProcessIdentityMatches); err != nil {
		service.log("start.failed", map[string]any{"stage": "stale_discovery", "error": err.Error()})
		return fmt.Errorf("validate existing discovery: %w", err)
	}
	if _, err := os.Stat(state.DiscoveryPath(service.config.StateDir)); err == nil {
		return state.ErrServiceAlreadyRunning
	} else if !errors.Is(err, os.ErrNotExist) {
		service.log("start.failed", map[string]any{"stage": "discovery_check", "error": err.Error()})
		return fmt.Errorf("check existing discovery: %w", err)
	}

	store, err := state.Open(service.config.StateDir)
	if err != nil {
		service.log("start.failed", map[string]any{"stage": "state_open", "error": err.Error()})
		return err
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		service.log("start.failed", map[string]any{"stage": "supervisor", "error": err.Error()})
		return err
	}
	service.log("runs.recovered", map[string]any{"activeRunCount": len(store.ActiveRuns())})
	schedulerRuntime, err := scheduler.New(store, supervisor)
	if err != nil {
		service.log("start.failed", map[string]any{"stage": "scheduler", "error": err.Error()})
		return err
	}

	token, err := state.LoadOrCreateToken(service.config.StateDir)
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		service.log("start.failed", map[string]any{"stage": "listener", "error": err.Error()})
		return fmt.Errorf("listen on loopback: %w", err)
	}
	processIdentity, err := serviceprocess.CurrentProcessIdentity()
	if err != nil {
		_ = listener.Close()
		return fmt.Errorf("read service process identity: %w", err)
	}

	instanceID, err := state.NewInstanceID()
	if err != nil {
		_ = listener.Close()
		return err
	}
	startedAt := time.Now().UTC()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		_ = listener.Close()
		return errors.New("service listener does not expose a TCP address")
	}
	discovery := state.Discovery{
		ProtocolVersion: state.ProtocolVersion,
		ServiceVersion:  service.config.Version,
		InstanceID:      instanceID,
		PID:             os.Getpid(),
		ProcessIdentity: processIdentity,
		StartedAt:       startedAt.Format(time.RFC3339Nano),
		Host:            "127.0.0.1",
		Port:            address.Port,
		TokenPath:       state.TokenPath(service.config.StateDir),
	}

	handler, err := api.NewHandler(api.Config{
		Token:           token,
		ProtocolVersion: state.ProtocolVersion,
		ServiceVersion:  service.config.Version,
		InstanceID:      instanceID,
		PID:             os.Getpid(),
		ProcessIdentity: processIdentity,
		StartedAt:       startedAt,
		RequestShutdown: func() {
			shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = service.Shutdown(shutdownContext)
		},
		HasActiveRuns: supervisor.HasActiveRuns,
		Supervisor:    supervisor,
		Scheduler:     schedulerRuntime,
	})
	if err != nil {
		_ = listener.Close()
		return err
	}

	httpServer := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	if err := state.WriteDiscovery(service.config.StateDir, discovery); err != nil {
		_ = listener.Close()
		service.log("start.failed", map[string]any{"stage": "discovery_write", "error": err.Error()})
		return err
	}

	service.listener = listener
	service.httpServer = httpServer
	service.discovery = discovery
	service.directoryLock = directoryLock
	service.store = store
	service.supervisor = supervisor
	service.scheduler = schedulerRuntime
	service.started = true
	closeDirectoryLock = false

	go service.serve()
	schedulerContext, schedulerCancel := context.WithCancel(context.Background())
	service.schedulerStop = schedulerCancel
	go service.runScheduler(schedulerRuntime, schedulerContext)
	service.log("start.ready", map[string]any{
		"instanceId": discovery.InstanceID,
		"pid":        discovery.PID,
		"port":       discovery.Port,
	})
	closeDiagnostics = false
	return nil
}

func (service *Service) Done() <-chan struct{} {
	return service.done
}

func (service *Service) URL() string {
	service.mutex.Lock()
	defer service.mutex.Unlock()
	if !service.started {
		return ""
	}

	return fmt.Sprintf("http://%s:%d", service.discovery.Host, service.discovery.Port)
}

func (service *Service) Shutdown(shutdownContext context.Context) error {
	service.log("shutdown.requested", nil)
	service.stopOnce.Do(func() {
		service.shutdownErr = service.shutdown(shutdownContext)
		close(service.done)
	})

	return service.shutdownErr
}

func (service *Service) serve() {
	defer func() {
		if recovered := recover(); recovered != nil {
			service.log("panic", map[string]any{"goroutine": "http_server", "value": fmt.Sprint(recovered)})
			_ = service.Shutdown(context.Background())
		}
	}()
	service.mutex.Lock()
	httpServer := service.httpServer
	service.mutex.Unlock()
	if httpServer == nil {
		return
	}

	if err := httpServer.Serve(service.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		service.log("listener.error", map[string]any{"error": err.Error()})
		service.stopOnce.Do(func() {
			shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			service.shutdownErr = service.shutdown(shutdownContext)
			close(service.done)
		})
	}
}

func (service *Service) runScheduler(runtime *scheduler.Runtime, ctx context.Context) {
	defer func() {
		if recovered := recover(); recovered != nil {
			service.log("panic", map[string]any{"goroutine": "scheduler", "value": fmt.Sprint(recovered)})
			_ = service.Shutdown(context.Background())
		}
	}()
	runtime.Run(ctx)
}

func (service *Service) shutdown(shutdownContext context.Context) error {
	service.log("shutdown.begin", nil)
	service.mutex.Lock()
	httpServer := service.httpServer
	schedulerStop := service.schedulerStop
	supervisor := service.supervisor
	service.schedulerStop = nil
	service.mutex.Unlock()
	if httpServer == nil {
		if supervisor == nil {
			return nil
		}
		return supervisor.Close()
	}

	if schedulerStop != nil {
		schedulerStop()
	}
	err := httpServer.Shutdown(shutdownContext)
	if supervisor != nil {
		err = errors.Join(err, supervisor.Close())
	}
	return service.cleanupDiscovery(err)
}

func (service *Service) cleanupDiscovery(shutdownErr error) error {
	service.mutex.Lock()
	discovery := service.discovery
	directoryLock := service.directoryLock
	service.started = false
	service.directoryLock = nil
	service.mutex.Unlock()

	cleanupErr := state.RemoveDiscoveryIfOwnedBy(service.config.StateDir, discovery)
	if directoryLock != nil {
		cleanupErr = errors.Join(cleanupErr, directoryLock.Close())
	}
	service.log("shutdown.complete", map[string]any{"error": errorText(cleanupErr)})
	service.diagnosticsMu.Lock()
	diagnostics := service.diagnostics
	service.diagnostics = nil
	service.diagnosticsMu.Unlock()
	if diagnostics != nil {
		cleanupErr = errors.Join(cleanupErr, diagnostics.close())
	}
	if shutdownErr != nil && cleanupErr != nil {
		return errors.Join(shutdownErr, cleanupErr)
	}
	if shutdownErr != nil {
		return shutdownErr
	}
	return cleanupErr
}

func (service *Service) log(event string, fields map[string]any) {
	service.diagnosticsMu.RLock()
	diagnostics := service.diagnostics
	service.diagnosticsMu.RUnlock()
	if diagnostics != nil {
		diagnostics.write(event, fields)
	}
}

func errorText(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}
