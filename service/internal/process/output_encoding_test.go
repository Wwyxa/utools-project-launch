package process

import (
	"runtime"
	"strings"
	"testing"
)

func TestProcessOutputDecoderPreservesSplitCharacters(t *testing.T) {
	tests := []struct {
		name   string
		output []byte
		want   string
	}{
		{name: "utf8", output: []byte("ready \u9879\u76ee\U0001f600\nPassword: "), want: "ready \u9879\u76ee\U0001f600\nPassword: "},
	}
	if runtime.GOOS == "windows" {
		tests = append(tests, struct {
			name   string
			output []byte
			want   string
		}{name: "gb18030", output: []byte{0xcf, 0xee, 0xc4, 0xbf, 0xc6, 0xf4, 0xb6, 0xaf, 0x90, 0x30, 0x81, 0x30}, want: "\u9879\u76ee\u542f\u52a8\U00010000"})
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for split := 0; split <= len(test.output); split++ {
				decoder := processOutputDecoder{}
				got := decoder.decode(test.output[:split], false) + decoder.decode(test.output[split:], true)
				if got != test.want {
					t.Fatalf("split %d: got %q, want %q", split, got, test.want)
				}
			}
			decoder := processOutputDecoder{}
			var got strings.Builder
			for _, value := range test.output {
				got.WriteString(decoder.decode([]byte{value}, false))
			}
			got.WriteString(decoder.decode(nil, true))
			if got.String() != test.want {
				t.Fatalf("bytewise: got %q, want %q", got.String(), test.want)
			}
		})
	}
}

func TestDecodeProcessOutputFallsBackToGB18030OnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("GB18030 process output fallback is Windows-specific")
	}

	output := []byte{0x74, 0x65, 0x73, 0x74, 0x31, 0x31, 0x31, 0x20, 0xcf, 0xee, 0xc4, 0xbf, 0xc6, 0xf4, 0xb6, 0xaf}
	if got, want := decodeProcessOutput(output), "test111 \u9879\u76ee\u542f\u52a8"; got != want {
		t.Fatalf("decodeProcessOutput() = %q, want %q", got, want)
	}
}
