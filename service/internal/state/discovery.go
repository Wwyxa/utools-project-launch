package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const ProtocolVersion = 1

type Discovery struct {
	ProtocolVersion int    `json:"protocolVersion"`
	ServiceVersion  string `json:"serviceVersion"`
	InstanceID      string `json:"instanceId"`
	PID             int    `json:"pid"`
	ProcessIdentity string `json:"processIdentity"`
	StartedAt       string `json:"startedAt"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	TokenPath       string `json:"tokenPath"`
}

func (discovery Discovery) Validate() error {
	if discovery.ProtocolVersion <= 0 {
		return errors.New("discovery protocol version is invalid")
	}
	if strings.TrimSpace(discovery.ServiceVersion) == "" {
		return errors.New("discovery service version is required")
	}
	if strings.TrimSpace(discovery.InstanceID) == "" {
		return errors.New("discovery instance id is required")
	}
	if discovery.PID <= 0 {
		return errors.New("discovery pid is invalid")
	}
	if strings.TrimSpace(discovery.ProcessIdentity) == "" {
		return errors.New("discovery process identity is required")
	}
	if strings.TrimSpace(discovery.TokenPath) == "" {
		return errors.New("discovery token path is required")
	}
	if _, err := time.Parse(time.RFC3339Nano, discovery.StartedAt); err != nil {
		return fmt.Errorf("discovery start time is invalid: %w", err)
	}
	address := net.ParseIP(discovery.Host)
	if address == nil || !address.IsLoopback() {
		return errors.New("discovery host must be a loopback address")
	}
	if discovery.Port < 1 || discovery.Port > 65535 {
		return errors.New("discovery port is invalid")
	}

	return nil
}

func WriteDiscovery(stateDir string, discovery Discovery) error {
	if err := EnsureDirectory(stateDir); err != nil {
		return err
	}
	if err := discovery.validateForDirectory(stateDir); err != nil {
		return err
	}

	contents, err := json.Marshal(discovery)
	if err != nil {
		return fmt.Errorf("encode discovery metadata: %w", err)
	}
	if err := writeFileAtomic(DiscoveryPath(stateDir), append(contents, '\n'), 0o600); err != nil {
		return fmt.Errorf("write discovery metadata: %w", err)
	}

	return nil
}

func ReadDiscovery(stateDir string) (Discovery, error) {
	contents, err := os.ReadFile(DiscoveryPath(stateDir))
	if err != nil {
		return Discovery{}, fmt.Errorf("read discovery metadata: %w", err)
	}

	var discovery Discovery
	if err := json.Unmarshal(contents, &discovery); err != nil {
		return Discovery{}, fmt.Errorf("parse discovery metadata: %w", err)
	}
	if err := discovery.validateForDirectory(stateDir); err != nil {
		return Discovery{}, err
	}

	return discovery, nil
}

func RemoveDiscoveryIfOwned(stateDir string, instanceID string) error {
	discovery, err := ReadDiscovery(stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if discovery.InstanceID != instanceID {
		return nil
	}

	if err := os.Remove(DiscoveryPath(stateDir)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove discovery metadata: %w", err)
	}

	return nil
}

func RemoveDiscoveryIfOwnedBy(stateDir string, owner Discovery) error {
	discovery, err := ReadDiscovery(stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if discovery.InstanceID != owner.InstanceID ||
		discovery.PID != owner.PID ||
		discovery.ProcessIdentity != owner.ProcessIdentity {
		return nil
	}

	if err := os.Remove(DiscoveryPath(stateDir)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove discovery metadata: %w", err)
	}

	return nil
}

func (discovery Discovery) validateForDirectory(stateDir string) error {
	if err := discovery.Validate(); err != nil {
		return err
	}

	expectedTokenPath, err := filepath.Abs(TokenPath(stateDir))
	if err != nil {
		return fmt.Errorf("resolve service token path: %w", err)
	}
	actualTokenPath, err := filepath.Abs(discovery.TokenPath)
	if err != nil {
		return fmt.Errorf("resolve discovery token path: %w", err)
	}
	if filepath.Clean(actualTokenPath) != filepath.Clean(expectedTokenPath) {
		return errors.New("discovery token path must point to the service token")
	}

	return nil
}

func RemoveStaleDiscovery(stateDir string, isProcessAlive func(pid int, processIdentity string) (bool, error)) error {
	if isProcessAlive == nil {
		return errors.New("process identity check is required")
	}

	discovery, err := ReadDiscovery(stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}

	alive, err := isProcessAlive(discovery.PID, discovery.ProcessIdentity)
	if err != nil {
		return fmt.Errorf("check discovered service process: %w", err)
	}
	if alive {
		return nil
	}

	if err := os.Remove(DiscoveryPath(stateDir)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove stale discovery metadata: %w", err)
	}

	return nil
}
