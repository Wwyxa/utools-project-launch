package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const diagnosticLogFileName = "service.log"

type diagnosticLogger struct {
	mutex sync.Mutex
	file  *os.File
}

func openDiagnosticLogger(stateDir string) (*diagnosticLogger, error) {
	file, err := os.OpenFile(filepath.Join(stateDir, diagnosticLogFileName), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open service diagnostic log: %w", err)
	}
	return &diagnosticLogger{file: file}, nil
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
	if logger.file == nil {
		return
	}
	_, _ = logger.file.Write(append(contents, '\n'))
	_ = logger.file.Sync()
}

func (logger *diagnosticLogger) close() error {
	if logger == nil || logger.file == nil {
		return nil
	}
	logger.mutex.Lock()
	defer logger.mutex.Unlock()
	err := logger.file.Close()
	logger.file = nil
	return err
}
