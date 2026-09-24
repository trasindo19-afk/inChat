# inChat Product Requirements

## 1. Problem

Users on a trusted LAN need a simple way to chat, send files, and talk to each other without cloud accounts, internet access, or a central server.

A separate remote-control tool should be available later without changing the basic communication workflow.

## 2. Users

### Primary user

A technical or office user on a private LAN who wants an easy desktop application with no account administration.

### Secondary user

An administrator or developer who wants to diagnose network problems, pair trusted devices, and optionally use remote desktop features.

## 3. MVP goals

- Discover peers automatically on a LAN.
- Communicate directly with a selected peer.
- Send encrypted text and files.
- Support one-to-one voice and video calls.
- Share the screen during a call.
- Run as a desktop application, not a browser-only app.
- Work without a permanent server.
- Work without a user account.

## 4. MVP functional requirements

### FR-001: Device startup

The application shall start as a desktop window and initialize a device identity without asking the user to create an account.

### FR-002: Peer discovery

The application shall discover compatible peers using LAN discovery mechanisms. It shall also allow manual peer connection by IP/address as a fallback.

### FR-003: Presence

The application shall show discovered peers and indicate online, connecting, and offline states.

### FR-004: Direct chat

The user shall be able to select a peer and exchange text messages over a direct encrypted connection.

### FR-005: File transfer

The user shall be able to send and receive files with:

- Progress indication
- Cancellation
- Resumable transfer target for the next iteration
- File-size validation
- SHA-256 integrity verification

### FR-006: Voice call

The user shall be able to start and answer a one-to-one voice call from a peer conversation.

### FR-007: Video call

The user shall be able to start and answer a one-to-one video call and select an available camera/microphone.

### FR-008: Screen sharing

A user in an active call shall be able to start and stop sharing a screen or window. The remote user shall see a clear sharing state.

### FR-009: Network diagnostics

The application shall identify common failure states, including:

- No peer discovered
- UDP discovery blocked
- TCP control connection refused
- Firewall permission required
- Microphone/camera permission denied
- WebRTC ICE negotiation failed

### FR-010: Local privacy

Messages and files shall not be sent to a third-party server. Local history shall be stored only on the user's device unless the user explicitly implements backup/export.

## 5. Out of scope for MVP

- Accounts and cloud synchronization
- Internet/NAT traversal
- Mobile applications
- Group video calls
- SFU/media server
- Native RDP protocol implementation
- Unattended remote control
- Federation with Rocket.Chat, Matrix, or another messenger
- File backup to cloud storage
- Cross-subnet discovery without VPN

## 6. Non-functional requirements

- The app shall run on Windows 10/11 x64.
- The app shall not require a browser for normal use.
- The app shall avoid a central server requirement.
- The application shall use encrypted peer connections.
- The UI shall remain usable with 5–20 peers on a small LAN.
- The app shall provide visible error states instead of silently failing.
- The first release shall be testable on a network with client isolation disabled.
