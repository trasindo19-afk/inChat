# inChat Roadmap

## Phase 0 — Planning and technical spike

### Deliverables

- Project structure created
- Architecture and protocol drafts reviewed
- Wails application starts on Windows
- WebView media permissions tested
- Go/frontend binding test passes
- Two-device WebRTC proof of concept passes

### Exit criteria

A decision is recorded for the desktop shell and media approach before broad feature work begins.

## Phase 1 — P2P foundation

### Deliverables

- Device identity and local key storage
- UDP discovery
- Manual IP fallback
- Peer list and online status
- Mutual authenticated control channel
- Basic logging and diagnostics

### Exit criteria

Two Windows peers discover each other and maintain a stable encrypted control connection.

## Phase 2 — Messaging MVP

### Deliverables

- One-to-one text chat
- Message acknowledgements
- Local history
- Typing indicator
- File transfer
- Progress, cancellation, and SHA-256 verification
- Block/unblock peer

### Exit criteria

Two peers can exchange text and files reliably on a normal LAN without a server.

## Phase 3 — Voice and video

### Deliverables

- One-to-one voice call
- One-to-one video call
- Incoming call screen
- Microphone and camera selection
- Mute and camera controls
- ICE diagnostics
- Reconnect behavior

### Exit criteria

Two Windows peers can establish a direct LAN voice and video call.

## Phase 4 — Screen sharing

### Deliverables

- Screen/window selection
- Start/stop sharing
- Remote rendering
- Sharing indicator
- Permission and failure diagnostics

### Exit criteria

A user can share a selected screen during an active call and stop sharing reliably.

## Phase 5 — Packaging and hardening

### Deliverables

- Windows installer
- Portable EXE build
- Firewall diagnostic/helper
- Auto-update decision
- Crash reporting decision
- Dependency and license inventory
- User documentation

### Exit criteria

A non-developer can install and run the application on two Windows PCs.

## Phase 6 — Remote control/RDP exploration

### Option A: Windows RDP launcher

- Generate a temporary `.rdp` file
- Launch `mstsc.exe`
- Support target IP/hostname
- Do not store passwords in the application

### Option B: FreeRDP integration

- Embed or manage an RDP session
- Add clipboard and display controls
- Add consent and audit events
- Investigate license and binary distribution

### Exit criteria

Remote control is launched only after explicit user action and is clearly separated from the P2P chat workflow.

## Later ideas

- Group chat
- Small group calls
- VPN discovery support
- Cross-subnet discovery through a VPN
- Optional TURN/STUN configuration
- Native Go media backend
- Unattended access with strong authorization
