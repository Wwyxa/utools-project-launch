package main

import "testing"

func TestServiceVersionPrefersLinkedVersion(t *testing.T) {
	originalVersion := version
	t.Cleanup(func() {
		version = originalVersion
	})
	version = "v1.7.6"

	if got := serviceVersion(); got != "v1.7.6" {
		t.Fatalf("service version = %q, want linked version", got)
	}
}

func TestServiceVersionDoesNotExposeDevelopmentDefault(t *testing.T) {
	originalVersion := version
	t.Cleanup(func() {
		version = originalVersion
	})
	version = "dev"

	if got := serviceVersion(); got == "dev" {
		t.Fatal("service version must not expose the development default")
	}
}
