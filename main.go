package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := newApp()

	err := wails.Run(&options.App{
		Title:         "inChat",
		Width:         1180,
		Height:        760,
		MinWidth:      920,
		MinHeight:     600,
		AssetServer:   &assetserver.Options{Assets: assets},
		OnStartup:     app.startup,
		OnBeforeClose: app.beforeClose,
		OnShutdown:    app.shutdown,
		Bind:          []interface{}{app},
		Windows:       &windows.Options{WebviewIsTransparent: false},
	})

	if err != nil {
		println("inChat startup error:", err.Error())
	}
}
