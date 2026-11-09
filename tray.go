package main

import (
	"context"
	_ "embed"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed frontend/src/inchat.png
var trayIcon []byte

type trayNotifier interface {
	ShowNotification(title, message string)
}

func (a *App) notify(title, message string) {
	a.mu.RLock()
	tray := a.tray
	a.mu.RUnlock()
	if tray != nil {
		tray.ShowNotification(title, message)
	}
}

func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowShow(a.ctx)
	wailsruntime.WindowUnminimise(a.ctx)
	wailsruntime.WindowSetAlwaysOnTop(a.ctx, true)
	wailsruntime.WindowSetAlwaysOnTop(a.ctx, false)
}

func (a *App) hideWindow() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowHide(a.ctx)
}

func (a *App) requestQuit() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	if a.ctx != nil {
		wailsruntime.Quit(a.ctx)
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.RLock()
	quitting := a.quitting
	a.mu.RUnlock()
	if quitting {
		return false
	}
	wailsruntime.WindowHide(ctx)
	return true
}
