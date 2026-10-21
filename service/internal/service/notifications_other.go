package service

import "github.com/gen2brain/beeep"

func init() {
	beeep.AppName = notificationAppName
}

func sendNativeNotification(notification taskNotification) error {
	return beeep.Notify(notification.Title, notification.Body, "")
}
