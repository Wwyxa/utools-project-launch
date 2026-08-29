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
	decoded, ok := decodeGB18030Output(output)
	if ok {
		return decoded
	}
	return string(output)
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
