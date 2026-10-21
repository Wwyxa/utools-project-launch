//go:build windows

package process

import (
	"syscall"
	"unicode/utf16"
	"unicode/utf8"
	"unsafe"
)

const windowsGB18030CodePage = 54936

var (
	kernel32                = syscall.NewLazyDLL("kernel32.dll")
	multiByteToWideCharProc = kernel32.NewProc("MultiByteToWideChar")
)

func decodeProcessOutput(output []byte) string {
	if utf8.Valid(output) {
		return string(output)
	}
	return decodeLegacyProcessOutput(output)
}

func decodeLegacyProcessOutput(output []byte) string {
	decoded, ok := decodeGB18030Output(output)
	if ok {
		return decoded
	}
	return string(output)
}

func completeLegacyOutputPrefix(output []byte) int {
	for offset := 0; offset < len(output); {
		if output[offset] < 0x81 || output[offset] > 0xfe {
			offset++
			continue
		}
		if offset+1 == len(output) {
			return offset
		}
		size := 2
		if output[offset+1] >= '0' && output[offset+1] <= '9' {
			size = 4
		}
		if offset+size > len(output) {
			return offset
		}
		offset += size
	}
	return len(output)
}

func decodeGB18030Output(output []byte) (string, bool) {
	if len(output) == 0 {
		return "", true
	}
	length, _, _ := multiByteToWideCharProc.Call(
		uintptr(windowsGB18030CodePage),
		0,
		uintptr(unsafe.Pointer(&output[0])),
		uintptr(len(output)),
		0,
		0,
	)
	if length == 0 {
		return "", false
	}
	utf16Output := make([]uint16, int(length))
	written, _, _ := multiByteToWideCharProc.Call(
		uintptr(windowsGB18030CodePage),
		0,
		uintptr(unsafe.Pointer(&output[0])),
		uintptr(len(output)),
		uintptr(unsafe.Pointer(&utf16Output[0])),
		length,
	)
	if written != length {
		return "", false
	}
	return string(utf16.Decode(utf16Output)), true
}
