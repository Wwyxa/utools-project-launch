package process

import (
	"runtime"
	"testing"
)

func TestDecodeProcessOutputFallsBackToGB18030OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("GB18030 process output fallback is Windows-specific")
	}

	output := []byte{0x74, 0x65, 0x73, 0x74, 0x31, 0x31, 0x31, 0x20, 0xcf, 0xee, 0xc4, 0xbf, 0xc6, 0xf4, 0xb6, 0xaf}
	if got, want := decodeProcessOutput(output), "test111 \u9879\u76ee\u542f\u52a8"; got != want {
		t.Fatalf("decodeProcessOutput() = %q, want %q", got, want)
	}
}
