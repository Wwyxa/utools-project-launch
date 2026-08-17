//go:build !windows

package state

import "os"

func replaceFileAtomic(sourcePath string, targetPath string) error {
	return os.Rename(sourcePath, targetPath)
}
