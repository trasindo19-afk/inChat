//go:build windows

package main

import (
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassExW         = user32.NewProc("RegisterClassExW")
	procCreateWindowExW          = user32.NewProc("CreateWindowExW")
	procDefWindowProcW           = user32.NewProc("DefWindowProcW")
	procShellNotifyIconW         = shell32.NewProc("Shell_NotifyIconW")
	procCreatePopupMenu          = user32.NewProc("CreatePopupMenu")
	procAppendMenuW              = user32.NewProc("AppendMenuW")
	procDestroyMenu              = user32.NewProc("DestroyMenu")
	procTrackPopupMenu           = user32.NewProc("TrackPopupMenu")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procGetCursorPos             = user32.NewProc("GetCursorPos")
	procPostMessageW             = user32.NewProc("PostMessageW")
	procGetMessageW              = user32.NewProc("GetMessageW")
	procTranslateMessage         = user32.NewProc("TranslateMessage")
	procDispatchMessageW         = user32.NewProc("DispatchMessageW")
	procDestroyWindow            = user32.NewProc("DestroyWindow")
	procGetModuleHandleW         = kernel32.NewProc("GetModuleHandleW")
	procCreateIconFromResourceEx = user32.NewProc("CreateIconFromResourceEx")
	procDestroyIcon              = user32.NewProc("DestroyIcon")
	procGetSystemMetrics         = user32.NewProc("GetSystemMetrics")
	procRegisterWindowMessageW   = user32.NewProc("RegisterWindowMessageW")
)

const (
	wmUserTray = 0x0400 + 100 // WM_USER + 100
	smCXSmIcon = 49
	smCYSmIcon = 50

	nimAdd        = 0x00000000
	nimModify     = 0x00000001
	nimDelete     = 0x00000002
	nimSetVersion = 0x00000004

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004
	nifInfo    = 0x00000010
	niifInfo   = 0x00000001

	wmLButtonUp     = 0x0202
	wmLButtonDblClk = 0x0203
	wmRButtonUp     = 0x0205
	wmContextMenu   = 0x007B

	tpmLeftAlign   = 0x0000
	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100
	tpmNoNotify    = 0x0080

	mfString    = 0x00000000
	mfSeparator = 0x00000800
)

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type notifyIconData struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         [16]byte
	hBalloonIcon     uintptr
}

type point struct {
	x, y int32
}

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type winTray struct {
	app        *App
	hwnd       uintptr
	hicon      uintptr
	uid        uint32
	menuOpen   bool
	mu         sync.Mutex
	taskbarMsg uint32
}

var (
	activeTrayMu sync.RWMutex
	activeTray   *winTray
)

func trayWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	activeTrayMu.RLock()
	t := activeTray
	activeTrayMu.RUnlock()

	if t == nil || t.hwnd != hwnd {
		ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
		return ret
	}

	if t.taskbarMsg != 0 && message == t.taskbarMsg {
		t.addIcon()
		return 0
	}

	switch message {
	case wmUserTray:
		event := lParam & 0xFFFF
		switch event {
		case wmLButtonUp, wmLButtonDblClk:
			t.app.showWindow()
			return 0
		case wmRButtonUp, wmContextMenu:
			t.showContextMenu()
			return 0
		}
	}

	ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return ret
}

func (t *winTray) showContextMenu() {
	t.mu.Lock()
	if t.menuOpen {
		t.mu.Unlock()
		return
	}
	t.menuOpen = true
	t.mu.Unlock()

	defer func() {
		t.mu.Lock()
		t.menuOpen = false
		t.mu.Unlock()
	}()

	hmenu, _, _ := procCreatePopupMenu.Call()
	if hmenu == 0 {
		return
	}
	defer procDestroyMenu.Call(hmenu)

	sShow, _ := windows.UTF16PtrFromString("Show inChat")
	sQuit, _ := windows.UTF16PtrFromString("Quit inChat")

	procAppendMenuW.Call(hmenu, uintptr(mfString), 1, uintptr(unsafe.Pointer(sShow)))
	procAppendMenuW.Call(hmenu, uintptr(mfSeparator), 0, 0)
	procAppendMenuW.Call(hmenu, uintptr(mfString), 2, uintptr(unsafe.Pointer(sQuit)))

	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))

	// Bring top-level window to foreground so menu dismisses cleanly on outside click
	procSetForegroundWindow.Call(t.hwnd)

	ret, _, _ := procTrackPopupMenu.Call(
		hmenu,
		uintptr(tpmLeftAlign|tpmRightButton|tpmReturnCmd|tpmNoNotify),
		uintptr(pt.x),
		uintptr(pt.y),
		0,
		t.hwnd,
		0,
	)

	// Post WM_NULL to ensure proper dismissal
	procPostMessageW.Call(t.hwnd, 0, 0, 0)

	switch ret {
	case 1:
		t.app.showWindow()
	case 2:
		t.app.requestQuit()
	}
}

func (t *winTray) ShowNotification(title, message string) {
	if t.hwnd == 0 {
		return
	}
	nid := notifyIconData{
		cbSize:      uint32(unsafe.Sizeof(notifyIconData{})),
		hWnd:        t.hwnd,
		uID:         t.uid,
		uFlags:      nifInfo,
		dwInfoFlags: niifInfo,
	}
	if title != "" {
		titleUTF, err := windows.UTF16FromString(title)
		if err == nil {
			maxLen := len(nid.szInfoTitle) - 1
			if len(titleUTF) > maxLen {
				titleUTF = titleUTF[:maxLen]
			}
			copy(nid.szInfoTitle[:], titleUTF)
		}
	}
	if message != "" {
		msgUTF, err := windows.UTF16FromString(message)
		if err == nil {
			maxLen := len(nid.szInfo) - 1
			if len(msgUTF) > maxLen {
				msgUTF = msgUTF[:maxLen]
			}
			copy(nid.szInfo[:], msgUTF)
		}
	}
	procShellNotifyIconW.Call(uintptr(nimModify), uintptr(unsafe.Pointer(&nid)))
}

func (t *winTray) addIcon() {
	if t.hwnd == 0 {
		return
	}
	nid := notifyIconData{
		cbSize:           uint32(unsafe.Sizeof(notifyIconData{})),
		hWnd:             t.hwnd,
		uID:              t.uid,
		uFlags:           nifMessage | nifIcon | nifTip,
		uCallbackMessage: wmUserTray,
		hIcon:            t.hicon,
	}
	copy(nid.szTip[:], windows.StringToUTF16("inChat — LAN P2P"))

	// On Windows boot, the shell notification area may still be initializing.
	// If NIM_ADD returns 0, retry asynchronously up to 10 times at 1-second intervals.
	ret, _, _ := procShellNotifyIconW.Call(uintptr(nimAdd), uintptr(unsafe.Pointer(&nid)))
	if ret != 0 {
		nid.uVersion = 4 // NOTIFYICON_VERSION_4
		procShellNotifyIconW.Call(uintptr(nimSetVersion), uintptr(unsafe.Pointer(&nid)))
		return
	}

	go func() {
		for i := 0; i < 10; i++ {
			time.Sleep(1 * time.Second)
			t.mu.Lock()
			hwnd := t.hwnd
			t.mu.Unlock()
			if hwnd == 0 {
				return
			}
			r, _, _ := procShellNotifyIconW.Call(uintptr(nimAdd), uintptr(unsafe.Pointer(&nid)))
			if r != 0 {
				nid.uVersion = 4
				procShellNotifyIconW.Call(uintptr(nimSetVersion), uintptr(unsafe.Pointer(&nid)))
				return
			}
		}
	}()
}

func (t *winTray) deleteIcon() {
	if t.hwnd == 0 {
		return
	}
	nid := notifyIconData{
		cbSize: uint32(unsafe.Sizeof(notifyIconData{})),
		hWnd:   t.hwnd,
		uID:    t.uid,
	}
	procShellNotifyIconW.Call(uintptr(nimDelete), uintptr(unsafe.Pointer(&nid)))
}

func createTrayIcon() uintptr {
	if len(trayIcon) == 0 {
		return 0
	}
	cx, _, _ := procGetSystemMetrics.Call(uintptr(smCXSmIcon))
	cy, _, _ := procGetSystemMetrics.Call(uintptr(smCYSmIcon))
	if cx == 0 {
		cx = 16
	}
	if cy == 0 {
		cy = 16
	}
	hicon, _, _ := procCreateIconFromResourceEx.Call(
		uintptr(unsafe.Pointer(&trayIcon[0])),
		uintptr(len(trayIcon)),
		1,          // fIcon = TRUE
		0x00030000, // dwVer = 0x00030000
		cx,
		cy,
		0, // lrDefaultColor
	)
	return hicon
}

func (a *App) startTray() {
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		hinst, _, _ := procGetModuleHandleW.Call(0)
		className, _ := windows.UTF16PtrFromString("inChatTrayClass")

		wc := wndClassExW{
			cbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
			lpfnWndProc:   syscall.NewCallback(trayWndProc),
			hInstance:     hinst,
			lpszClassName: className,
		}
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

		hwnd, _, _ := procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(className)),
			0,
			0,
			0, 0, 0, 0,
			0, // Top-level hidden window
			0,
			hinst,
			0,
		)
		if hwnd == 0 {
			a.emitError("tray", fmt.Errorf("CreateWindowExW failed"))
			return
		}

		hicon := createTrayIcon()

		var taskbarMsg uint32
		tbName, err := windows.UTF16PtrFromString("TaskbarCreated")
		if err == nil {
			ret, _, _ := procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(tbName)))
			taskbarMsg = uint32(ret)
			procChangeWindowMessageFilterEx := user32.NewProc("ChangeWindowMessageFilterEx")
			if procChangeWindowMessageFilterEx.Find() == nil && taskbarMsg != 0 {
				procChangeWindowMessageFilterEx.Call(hwnd, uintptr(taskbarMsg), 1 /* MSGFLT_ALLOW */, 0)
			}
		}

		t := &winTray{
			app:        a,
			hwnd:       hwnd,
			hicon:      hicon,
			uid:        1001,
			taskbarMsg: taskbarMsg,
		}

		activeTrayMu.Lock()
		activeTray = t
		activeTrayMu.Unlock()

		a.mu.Lock()
		a.tray = t
		a.mu.Unlock()

		defer func() {
			a.mu.Lock()
			a.tray = nil
			a.mu.Unlock()

			activeTrayMu.Lock()
			if activeTray == t {
				activeTray = nil
			}
			activeTrayMu.Unlock()

			t.deleteIcon()
			if t.hicon != 0 {
				procDestroyIcon.Call(t.hicon)
				t.hicon = 0
			}
			if t.hwnd != 0 {
				procDestroyWindow.Call(t.hwnd)
				t.hwnd = 0
			}
		}()

		t.addIcon()

		var m msg
		for {
			ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(ret) <= 0 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
	}()
}

func (a *App) stopTray() {
	activeTrayMu.Lock()
	t := activeTray
	activeTray = nil
	activeTrayMu.Unlock()

	if t != nil {
		t.deleteIcon()
		if t.hwnd != 0 {
			procPostMessageW.Call(t.hwnd, 0x0012, 0, 0) // WM_QUIT
		}
	}
}
