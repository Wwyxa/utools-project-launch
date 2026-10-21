package service

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"time"

	"project-launch-service/internal/scheduler"
	"project-launch-service/internal/state"
)

type taskNotification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

const notificationAppName = "\u5f00\u53d1\u5de5\u4f5c\u53f0"

var errNotificationBusy = errors.New("notification backend is still busy")

type notificationRequest struct {
	ctx          context.Context
	notification taskNotification
	result       chan error
}

type notificationSender struct {
	busy   sync.Mutex
	once   sync.Once
	jobs   chan notificationRequest
	notify func(taskNotification) error
}

func newNotificationSender(notify func(taskNotification) error) *notificationSender {
	return &notificationSender{jobs: make(chan notificationRequest), notify: notify}
}

var desktopNotifications = newNotificationSender(sendNativeNotification)

func (sender *notificationSender) send(ctx context.Context, notification taskNotification) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !sender.busy.TryLock() {
		return errNotificationBusy
	}
	sender.once.Do(func() { go sender.run() })
	request := notificationRequest{ctx: ctx, notification: notification, result: make(chan error, 1)}
	select {
	case sender.jobs <- request:
	case <-ctx.Done():
		sender.busy.Unlock()
		return ctx.Err()
	}
	select {
	case err := <-request.result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (sender *notificationSender) run() {
	if runtime.GOOS == "windows" {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
	}
	for request := range sender.jobs {
		err := request.ctx.Err()
		if err == nil {
			err = sender.notify(request.notification)
		}
		sender.busy.Unlock()
		request.result <- err
	}
}

func (service *Service) startNotifications(ctx context.Context, schedulerRuntime *scheduler.Runtime) {
	queue := make(chan taskNotification, 32)
	schedulerRuntime.NotifyCompletion = func(task scheduler.TaskConfig, execution state.AutomationExecution) {
		if !task.NotifyEnabled {
			return
		}
		body := task.Name + ": " + string(execution.Status)
		if execution.Reason != "" {
			body += ": " + execution.Reason
		}
		message := []rune(body)
		if len(message) > 1024 {
			body = string(message[:1024])
		}
		select {
		case queue <- taskNotification{Title: notificationAppName, Body: body}:
		default:
			service.log("notification.failed", map[string]any{"executionId": execution.ID, "reason": "queue_full"})
		}
	}
	go service.runNotifications(ctx, queue, sendNotification)
}

func sendNotification(ctx context.Context, notification taskNotification) error {
	return desktopNotifications.send(ctx, notification)
}

func (service *Service) runNotifications(ctx context.Context, queue <-chan taskNotification, send func(context.Context, taskNotification) error) {
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-queue:
			if !ok || ctx.Err() != nil {
				return
			}
			notifyContext, cancel := context.WithTimeout(ctx, 8*time.Second)
			err := send(notifyContext, notification)
			cancel()
			if err != nil {
				service.log("notification.failed", map[string]any{"platform": runtime.GOOS, "reason": err.Error()})
			}
		}
	}
}
