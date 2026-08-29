//go:build !windows

package process

func decodeProcessOutput(output []byte) string {
	return string(output)
}
