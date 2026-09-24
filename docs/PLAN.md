# inChat Master Plan

## 1. Objective

Build a lightweight desktop LAN application that allows trusted local peers to communicate directly, without a permanent central server or cloud account.

The product should first solve communication and media use cases, then add remote control/RDP without compromising the simplicity of the P2P model.

## 2. Product principles

1. **No central server for normal operation.** A peer may temporarily act as a signaling coordinator, but the product must not require a permanently running server.
2. **No account by default.** Identity is device-based and locally managed. Users verify peers with a safety code or explicit pairing action.
3. **Direct where possible.** Chat, files, voice, and video should use direct peer connections whenever the network permits.
4. **LAN first.** The first supported network is a trusted local network or VPN. Internet traversal is not an MVP requirement.
5. **Fail visibly.** The app must explain whether failure is caused by discovery, firewall, ICE, media permissions, or an unavailable peer.
6. **Consent for control.** Screen sharing and remote control always require explicit user action and visible state.
7. **Small and maintainable.** Prefer a small Go core and a simple desktop shell over a large framework with unnecessary features.

## 3. Recommended stack

### Core

- Go, latest stable version available at implementation time
- Standard library for networking, concurrency, crypto primitives, and process management
- Small reviewed libraries for OS key storage and WebRTC signaling where necessary

### Desktop

- Wails v2
- HTML/CSS/JavaScript frontend
- WebView2 runtime on Windows 10/11

Wails is preferred over a large Electron shell for the first implementation. It provides a desktop EXE and system WebView integration while keeping the backend in Go.

### Media

MVP strategy:

- WebRTC `RTCPeerConnection` in the Wails/WebView frontend
- Microphone and camera through `getUserMedia()`
- Screen capture through `getDisplayMedia()`
- ICE restricted to LAN candidates initially
- Signaling transported over the encrypted LAN control channel

Do not build a custom codec stack in the first version.

## 4. Work breakdown

### Track A: Core P2P

- Device identity and local key storage
- UDP broadcast/multicast discovery
- Peer inventory and online/offline state
- Encrypted control channel
- Reconnect and retry behavior
- Network diagnostics

### Track B: Messaging

- One-to-one text chat
- Message delivery acknowledgements
- Local history
- Typing indicators
- Peer block list
- File transfer with progress, cancellation, and SHA-256 verification

### Track C: Media

- Voice call state machine
- Video call state machine
- Microphone/camera device selection
- Mute and camera controls
- LAN ICE candidate handling
- Screen sharing during a call
- Clear call failure diagnostics

### Track D: Desktop experience

- Main window
- Peer list
- Conversation view
- Transfer panel
- Call window
- Settings and diagnostics page
- Windows installer and portable build

### Track E: Future remote control

- `mstsc.exe` launcher for Windows native RDP
- Optional FreeRDP integration
- Consent and audit logging
- Unattended access only as a later, separately secured feature

## 5. MVP exit criteria

The MVP is accepted when all of the following are true on two Windows PCs on the same LAN:

- The app launches without a browser
- No account creation is required
- Peers are discovered automatically
- A text message is delivered end-to-end
- A file is transferred and verified
- A voice call connects and carries audio
- A video call connects and carries camera video
- Screen sharing can be started and stopped
- A firewall or media failure produces an actionable message
- The application can be packaged as a Windows installer/portable EXE

RDP is not part of the MVP exit criteria.

## 6. Major risks

| Risk | Impact | Mitigation |
|---|---|---|
| WebView media permissions differ across OS versions | Calls fail unexpectedly | Test on supported Windows versions; provide permission troubleshooting |
| Multicast is blocked by AP/firewall | Peers are not discovered | Add UDP broadcast fallback, manual IP pairing, and diagnostics |
| Group P2P media scales poorly | High CPU/bandwidth use | Limit MVP to 1:1; evaluate SFU only for larger calls |
| No central server complicates signaling | More complex peer coordination | Use a temporary elected host or encrypted LAN control channel |
| Screen sharing and RDP permissions are easy to misuse | Unauthorized access | Explicit consent, visible state, block list, audit log |
| Reusing GPL/AGPL code creates license obligations | Legal/distribution problem | Prefer original implementation; record every reused component |

## 7. Next action

Before writing production code, perform a small technical spike that proves:

1. Wails desktop app launches on Windows.
2. WebView microphone permission works.
3. WebView camera permission works.
4. WebView screen capture works.
5. Go and frontend exchange signaling messages.
6. Two Windows peers discover each other and connect over LAN WebRTC.

If the spike fails, compare Wails with an Electron prototype before committing to the desktop shell.
