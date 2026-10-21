//go:build !windows

package process

func decodeProcessOutput(output []byte) string {
	return string(output)
}

func completeLegacyOutputPrefix(output []byte) int {
	return len(output)
}

func decodeLegacyProcessOutput(output []byte) string {
	return string(output)
}
