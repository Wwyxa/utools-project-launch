//go:build windows

package process

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const consoleStopArgument = "--internal-console-stop"

func requestWindowsConsoleStop(processIDs []int) bool {
	executable, err := os.Executable()
	if err != nil {
		return false
	}
	arguments := []string{consoleStopArgument}
	for _, pid := range processIDs {
		if identity, err := processIdentity(pid); err == nil {
			arguments = append(arguments, strconv.Itoa(pid)+"="+identity)
		}
	}
	if len(arguments) == 1 {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	helper := exec.CommandContext(ctx, executable, arguments...)
	helper.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	return helper.Run() == nil
}

func RunConsoleStopHelper(arguments []string) (bool, error) {
	if len(arguments) == 0 || arguments[0] != consoleStopArgument {
		return false, nil
	}
	allowed := make(map[uint32]syscall.Handle)
	defer func() {
		for _, handle := range allowed {
			_ = syscall.CloseHandle(handle)
		}
	}()
	for _, argument := range arguments[1:] {
		parts := strings.SplitN(argument, "=", 2)
		if len(parts) != 2 {
			return true, errors.New("invalid console target")
		}
		pid, err := strconv.Atoi(parts[0])
		if err != nil || pid <= 0 {
			return true, errors.New("invalid console process identifier")
		}
		handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
		if err != nil {
			continue
		}
		identity, identityErr := processIdentityFromHandle(handle)
		if identityErr != nil || identity != parts[1] {
			_ = syscall.CloseHandle(handle)
			continue
		}
		allowed[uint32(pid)] = handle
	}
	kernel := syscall.NewLazyDLL("kernel32.dll")
	freeConsole := kernel.NewProc("FreeConsole")
	attachConsole := kernel.NewProc("AttachConsole")
	setHandler := kernel.NewProc("SetConsoleCtrlHandler")
	generateEvent := kernel.NewProc("GenerateConsoleCtrlEvent")
	getMembers := kernel.NewProc("GetConsoleProcessList")
	acknowledged := make(chan struct{}, 1)
	handler := syscall.NewCallback(func(event uint32) uintptr {
		if event != 0 {
			return 0
		}
		select {
		case acknowledged <- struct{}{}:
		default:
		}
		return 1
	})
	signalled := make(map[uint32]bool)
	sent := false
	for pid := range allowed {
		if signalled[pid] {
			continue
		}
		_, _, _ = freeConsole.Call()
		if attached, _, _ := attachConsole.Call(uintptr(pid)); attached == 0 {
			continue
		}
		_, _, _ = setHandler.Call(0, 0)
		if installed, _, _ := setHandler.Call(handler, 1); installed == 0 {
			continue
		}
		members := make([]uint32, 4096)
		count, _, _ := getMembers.Call(uintptr(unsafe.Pointer(&members[0])), uintptr(len(members)))
		safe := count > 0 && count <= uintptr(len(members))
		for index := uintptr(0); index < count && safe; index++ {
			if members[index] != uint32(os.Getpid()) && allowed[members[index]] == 0 {
				safe = false
			}
		}
		if !safe {
			continue
		}
		if delivered, _, _ := generateEvent.Call(0, 0); delivered != 0 {
			sent = true
			for _, member := range members[:count] {
				signalled[member] = true
			}
			select {
			case <-acknowledged:
			case <-time.After(time.Second):
			}
		}
	}
	_, _, _ = freeConsole.Call()
	if !sent {
		return true, errors.New("no managed console accepted the stop signal")
	}
	return true, nil
}
