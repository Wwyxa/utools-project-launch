//go:build windows

package state

import (
	"fmt"
	"syscall"
	"unsafe"
)

const (
	moveFileReplaceExisting = 0x00000001
	moveFileWriteThrough    = 0x00000008
)

var moveFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")

func replaceFileAtomic(sourcePath string, targetPath string) error {
	source, err := syscall.UTF16PtrFromString(sourcePath)
	if err != nil {
		return fmt.Errorf("encode temporary path: %w", err)
	}
	target, err := syscall.UTF16PtrFromString(targetPath)
	if err != nil {
		return fmt.Errorf("encode target path: %w", err)
	}

	result, _, callErr := moveFileEx.Call(
		uintptr(unsafe.Pointer(source)),
		uintptr(unsafe.Pointer(target)),
		moveFileReplaceExisting|moveFileWriteThrough,
	)
	if result == 0 {
		return fmt.Errorf("replace target file: %w", callErr)
	}

	return nil
}
