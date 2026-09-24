# inChat Architecture

## 1. Architectural style

inChat uses a peer-centric architecture. There is no always-on application server. The desktop process acts as both a UI and a peer node.

The application has two cooperating layers:

1. **Go core** — discovery, identity, encrypted control transport, file transfer, peer state, diagnostics, and future RDP launcher.
2. **WebView frontend** — peer list, chat UI, call controls, WebRTC media, and screen capture.

The frontend communicates with the Go core through Wails bindings and an application event bridge.

## 2. Component map

```text
┌──────────────────────────────────────────────┐
│                 Wails Desktop                │
│                                              │
│  ┌────────────────────┐  ┌─────────────────┐  │
│  │ WebView Frontend   │  │ Go Application  │  │
│  │                    │  │                 │  │
│  │ Peer list          │◄─┤ Peer manager    │  │
│  │ Chat UI            │  │ Identity        │  │
│  │ Voice/video UI     │  │ Discovery       │  │
│  │ WebRTC media       │  │ Control channel │  │
│  │ getDisplayMedia    │  │ File transfer   │  │
│  └────────────────────┘  │ Diagnostics     │  │
│                          └─────────────────┘  │
└──────────────────────────────────────────────┘
             │             │
             │ LAN         │ LAN
             ▼             ▼
        Peer A         Peer B
```

## 3. Go packages

```text
cmd/inchat/                  application entrypoint
internal/app/                application lifecycle and event wiring
internal/config/              local configuration
internal/identity/            device IDs, key pairs, safety codes
internal/discovery/           UDP broadcast/multicast and peer records
internal/transport/           encrypted control connection
internal/protocol/            message and event schemas
internal/filetransfer/        streaming, hashing, cancellation
internal/presence/            online state and peer lifecycle
internal/calls/               WebRTC signaling coordinator
internal/rdp/                 mstsc/FreeRDP launch abstraction
internal/storage/             local SQLite/history abstraction
internal/logging/             structured logging
internal/firewall/            Windows firewall diagnostics/helper
```

The exact package layout can change during the technical spike. The boundaries should remain independent.

## 4. Data flow

### Discovery

```text
Device A                         Device B
  │ UDP announce                    │
  │────────────────────────────────►│
  │ UDP response/announce           │
  │◄────────────────────────────────│
  │ verify identity                 │
  │ open control channel            │
```

The discovery message must not contain plaintext chat content or file data.

### Chat

```text
Frontend A → Wails API → Go core → encrypted control channel → Go core B → Wails API → Frontend B
```

### Voice/video

```text
Frontend A                   Frontend B
  │ SDP offer/answer             │
  │──── control channel ────────►│
  │ ICE candidates               │
  │◄────────────────────────────►│
  │ WebRTC media directly        │
  │◄════════════════════════════►│
```

For LAN-only operation, the app should not require STUN or TURN. ICE should still be implemented so LAN candidates can be gathered and connectivity failures can be diagnosed.

### File transfer

File data should not be copied through the chat UI. The control channel negotiates a transfer, then the file stream uses a separate bounded connection or channel with backpressure.

## 5. Identity and trust

Each installation creates:

- Random device ID
- Long-term public/private key pair
- Human-readable safety code derived from the public key

A first-time peer connection displays a safety code. The user can compare it with the other device to detect interception or an incorrect peer.

A trusted-peer list may be stored locally after explicit confirmation. There is no global account identity.

## 6. Media architecture

The MVP uses WebView WebRTC:

- Microphone and camera permissions are requested explicitly
- One `RTCPeerConnection` is used for a one-to-one call
- Audio and video tracks are negotiated in the same peer connection
- Screen capture replaces or adds video tracks according to the chosen UI behavior
- Call state is coordinated by the Go core, but media remains between the two WebViews

A later native Go media backend may improve device control and performance, but it is not required for the MVP.

## 7. RDP architecture

Do not implement RDP in the P2P core in the first release.

Phase 1 integration:

- Detect Windows target
- Launch `mstsc.exe` with a generated `.rdp` file
- Pass the target IP/hostname
- Let Windows handle authentication and the RDP session
- Show the connection status in the inChat window

Later integration:

- Use FreeRDP for an embedded or managed session
- Add explicit user consent
- Add session audit events
- Evaluate unattended access separately

## 8. Failure model

The application must distinguish:

- Discovery failure
- Control transport failure
- Identity mismatch
- Firewall failure
- Media permission failure
- ICE failure
- File transfer failure
- RDP launch failure

Every error should include a short user message and a technical detail available in the diagnostics page.
