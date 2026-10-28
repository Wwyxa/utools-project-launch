//go:build !windows

package process

func RunConsoleStopHelper(arguments []string) (bool, error) {
	return false, nil
}
