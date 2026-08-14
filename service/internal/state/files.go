package state

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	TokenFileName     = "token"
	DiscoveryFileName = "discovery.json"
	StateFileName     = "state.json"
)

func EnsureDirectory(stateDir string) error {
	if strings.TrimSpace(stateDir) == "" {
		return errors.New("state directory is required")
	}

	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}

	if runtime.GOOS != "windows" {
		if err := os.Chmod(stateDir, 0o700); err != nil {
			return fmt.Errorf("restrict state directory permissions: %w", err)
		}
	}

	return nil
}

func TokenPath(stateDir string) string {
	return filepath.Join(stateDir, TokenFileName)
}

func DiscoveryPath(stateDir string) string {
	return filepath.Join(stateDir, DiscoveryFileName)
}

func StatePath(stateDir string) string {
	return filepath.Join(stateDir, StateFileName)
}

func LoadOrCreateToken(stateDir string) (string, error) {
	if err := EnsureDirectory(stateDir); err != nil {
		return "", err
	}

	tokenPath := TokenPath(stateDir)
	tokenBytes, err := os.ReadFile(tokenPath)
	if err == nil {
		if runtime.GOOS != "windows" {
			if err := os.Chmod(tokenPath, 0o600); err != nil {
				return "", fmt.Errorf("restrict service token permissions: %w", err)
			}
		}
		return validateToken(tokenBytes)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read service token: %w", err)
	}

	randomBytes := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, randomBytes); err != nil {
		return "", fmt.Errorf("generate service token: %w", err)
	}
	token := hex.EncodeToString(randomBytes)
	if err := writeFileAtomic(tokenPath, []byte(token+"\n"), 0o600); err != nil {
		return "", fmt.Errorf("write service token: %w", err)
	}

	return token, nil
}

func NewInstanceID() (string, error) {
	randomBytes := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, randomBytes); err != nil {
		return "", fmt.Errorf("generate instance id: %w", err)
	}

	return hex.EncodeToString(randomBytes), nil
}

func validateToken(tokenBytes []byte) (string, error) {
	token := strings.TrimSpace(string(tokenBytes))
	if len(token) != 64 {
		return "", errors.New("service token has an invalid length")
	}
	if _, err := hex.DecodeString(token); err != nil {
		return "", errors.New("service token is not hexadecimal")
	}

	return token, nil
}

func writeFileAtomic(targetPath string, contents []byte, permissions os.FileMode) (err error) {
	directory := filepath.Dir(targetPath)
	temporaryFile, err := os.CreateTemp(directory, ".project-launch-service-*")
	if err != nil {
		return err
	}
	temporaryPath := temporaryFile.Name()
	closed := false
	defer func() {
		if !closed {
			closeErr := temporaryFile.Close()
			if err == nil && closeErr != nil {
				err = closeErr
			}
		}
		if removeErr := os.Remove(temporaryPath); err == nil && removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			err = removeErr
		}
	}()

	if err := temporaryFile.Chmod(permissions); err != nil {
		return err
	}
	if _, err := temporaryFile.Write(contents); err != nil {
		return err
	}
	if err := temporaryFile.Sync(); err != nil {
		return err
	}
	if err := temporaryFile.Close(); err != nil {
		return err
	}
	closed = true
	if err := replaceFileAtomic(temporaryPath, targetPath); err != nil {
		return err
	}
	if err := syncDirectory(directory); err != nil {
		return err
	}

	return nil
}
