package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"project-launch-service/internal/service"
)

var version = "dev"

func main() {
	var stateDir string
	flag.StringVar(&stateDir, "state-dir", "", "directory for Project Launch Service state")
	flag.Parse()

	if stateDir == "" {
		fmt.Fprintln(os.Stderr, "--state-dir is required")
		os.Exit(2)
	}

	runtime, err := service.New(service.Config{
		StateDir: stateDir,
		Version:  version,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Project Launch Service configuration error: %v\n", err)
		os.Exit(2)
	}

	if err := runtime.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Project Launch Service failed to start: %v\n", err)
		os.Exit(1)
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	select {
	case <-runtime.Done():
	case <-signals:
		shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := runtime.Shutdown(shutdownContext); err != nil && !errors.Is(err, context.Canceled) {
			fmt.Fprintf(os.Stderr, "Project Launch Service shutdown error: %v\n", err)
			os.Exit(1)
		}
	}
}
