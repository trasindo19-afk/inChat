# Building inChat

## Prerequisites

- Go 1.26.8 or a compatible Go release available on `PATH`
- Node.js and npm
- Windows 10/11 x64
- Microsoft Edge WebView2 Runtime

> Wails v2.10.2 binding generation is not compatible with the Go 1.27.1 toolchain used during the first build attempt. Use Go 1.26.8 for the current Wails build.

## Frontend

From the project root:

```powershell
npm.cmd install
npm.cmd run build
```

The production frontend is written to `frontend/dist/`.

## Go development

Install dependencies and run the Wails development build:

```powershell
go mod tidy
wails dev
```

If the Wails CLI is not installed globally, use:

```powershell
go run github.com/wailsapp/wails/v2/cmd/wails@v2.10.2 dev
```

## Windows portable/build output

```powershell
wails build -platform windows/amd64 -nsis
```

The Wails build output is normally written to:

```text
build/bin/inChat.exe
build/bin/inChat-amd64-installer.exe
```

The installer command requires `makensis.exe` from NSIS on `PATH`. The current portable artifact is:

```text
build/bin/inChat-0.1.0-portable.zip
```

## LAN test

1. Build and run `inChat.exe` on two Windows PCs.
2. Put both PCs on the same LAN or VPN.
3. Allow `inChat.exe` through Windows Firewall when prompted.
4. Confirm both devices appear in the peer list.
5. Select the other peer and send a message.
6. Test voice/video calls and screen sharing.
7. Use Diagnostics if discovery is blocked.

## Current MVP limitations

- UDP broadcast discovery may not work on networks with multicast/client isolation disabled.
- Manual peer IP fallback is not yet exposed in the UI.
- File transfer currently uses a bounded base64 payload in the control channel and is limited to 25 MB.
- Group calls are not implemented.
- RDP is not implemented yet.
- The peer handshake is designed for a trusted LAN and still needs a full security review before production use.
