package main

import (
	"embed"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func getWebviewUserDataPath() string {
	appdata := os.Getenv("APPDATA")
	if appdata == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			appdata = filepath.Join(home, "AppData", "Roaming")
		}
	}
	if appdata != "" {
		dir := filepath.Join(appdata, "inChat", "webview")
		_ = os.MkdirAll(dir, 0755)
		return dir
	}
	return ""
}

func main() {
	// WebRTC flags:
	// 1. --disable-features=WebRtcHideLocalIpsWithMdns: expose direct host LAN IPs instead of masked .local candidates
	// 2. --use-fake-ui-for-media-stream: automatically grant microphone and webcam permissions to the app without blocking prompt
	// 3. --autoplay-policy=no-user-gesture-required: allow instant audio/video playback for incoming calls
	requiredArgs := []string{
		"--disable-features=WebRtcHideLocalIpsWithMdns",
		"--use-fake-ui-for-media-stream",
		"--autoplay-policy=no-user-gesture-required",
	}
	currentArgs := os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
	for _, arg := range requiredArgs {
		if !strings.Contains(currentArgs, arg) {
			if currentArgs != "" {
				currentArgs += " "
			}
			currentArgs += arg
		}
	}
	_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", currentArgs)

	app := newApp()

	err := wails.Run(&options.App{
		Title:         "inChat",
		Width:         1180,
		Height:        760,
		MinWidth:      920,
		MinHeight:     600,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "inChat-LAN-P2P-Setiawan-2026",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				app.showWindow()
			},
		},
		AssetServer:   &assetserver.Options{Assets: assets},
		OnStartup:     app.startup,
		OnBeforeClose: app.beforeClose,
		OnShutdown:    app.shutdown,
		Bind:          []interface{}{app},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WebviewUserDataPath:   getWebviewUserDataPath(),
		},
	})

	if err != nil {
		println("inChat startup error:", err.Error())
	}
}
