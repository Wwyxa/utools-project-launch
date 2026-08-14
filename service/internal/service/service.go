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
	listener      net.Listener
	httpServer    *http.Server
	discovery     state.Discovery
	directoryLock *state.DirectoryLock
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

	directoryLock, err := state.AcquireDirectoryLock(service.config.StateDir)
	if err != nil {
		return fmt.Errorf("acquire service directory lock: %w", err)
	}
	closeDirectoryLock := true
	defer func() {
		if closeDirectoryLock {
			_ = directoryLock.Close()
		}
	}()
	if err := state.RemoveStaleDiscovery(service.config.StateDir, serviceprocess.ProcessIdentityMatches); err != nil {
		return fmt.Errorf("validate existing discovery: %w", err)
	}
	if _, err := os.Stat(state.DiscoveryPath(service.config.StateDir)); err == nil {
		return state.ErrServiceAlreadyRunning
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("check existing discovery: %w", err)
	}

	store, err := state.Open(service.config.StateDir)
	if err != nil {
		return err
	}
	supervisor, err := serviceprocess.NewSupervisor(store)
	if err != nil {
		return err
	}
	schedulerRuntime, err := scheduler.New(store, supervisor)
	if err != nil {
		return err
	}

	token, err := state.LoadOrCreateToken(service.config.StateDir)
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
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
		return err
	}

	service.listener = listener
	service.httpServer = httpServer
	service.discovery = discovery
	service.directoryLock = directoryLock
	service.scheduler = schedulerRuntime
	service.started = true
	closeDirectoryLock = false

	go service.serve()
	schedulerContext, schedulerCancel := context.WithCancel(context.Background())
	service.schedulerStop = schedulerCancel
	go schedulerRuntime.Run(schedulerContext)
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
	service.stopOnce.Do(func() {
		service.shutdownErr = service.shutdown(shutdownContext)
		close(service.done)
	})

	return service.shutdownErr
}

func (service *Service) serve() {
	service.mutex.Lock()
	httpServer := service.httpServer
	service.mutex.Unlock()
	if httpServer == nil {
		return
	}

	if err := httpServer.Serve(service.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		service.stopOnce.Do(func() {
			service.shutdownErr = service.cleanupDiscovery(err)
			close(service.done)
		})
	}
}

func (service *Service) shutdown(shutdownContext context.Context) error {
	service.mutex.Lock()
	httpServer := service.httpServer
	schedulerStop := service.schedulerStop
	service.schedulerStop = nil
	service.mutex.Unlock()
	if httpServer == nil {
		return nil
	}

	if schedulerStop != nil {
		schedulerStop()
	}
	err := httpServer.Shutdown(shutdownContext)
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
	if shutdownErr != nil && cleanupErr != nil {
		return errors.Join(shutdownErr, cleanupErr)
	}
	if shutdownErr != nil {
		return shutdownErr
	}
	return cleanupErr
}
