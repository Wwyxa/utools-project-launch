//go:build windows

package service

import (
	_ "embed"
	"os"
	"path/filepath"

	"git.sr.ht/~jackmordaunt/go-toast"
)

//go:embed assets/logo.png
var notificationLogoPNG []byte

// notificationIconPath materializes the embedded plugin logo so the toast XML
// (appLogoOverride) and the registered AppUserModelId IconUri can reference it.
// It degrades to no icon when the temp file cannot be written.
func notificationIconPath() string {
	if len(notificationLogoPNG) == 0 {
		return ""
	}
	iconPath := filepath.Join(os.TempDir(), "project-launch-service-notification.png")
	if err := os.WriteFile(iconPath, notificationLogoPNG, 0o644); err != nil {
		return ""
	}
	return iconPath
}

// sendNativeNotification shows a Windows toast with the default notification
// sound and the plugin logo. beeep is bypassed here because it forces silent
// toasts on Windows (Audio is hard-coded to toast.Silent unless urgent).
func sendNativeNotification(notification taskNotification) error {
	n := toast.Notification{
		AppID:    notificationAppName,
		Title:    notification.Title,
		Body:     notification.Body,
		Duration: toast.Short,
		Audio:    toast.Default,
		Icon:     notificationIconPath(),
	}
	return n.Push()
}
