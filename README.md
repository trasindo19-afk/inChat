# inChat

A lightweight, self-hosted, peer-to-peer LAN messenger and collaboration desktop application.

> **Status:** MVP build succeeded. The first desktop slice includes a Wails shell, LAN discovery, encrypted control channel, chat, chunked file transfer, one-to-one and small group WebRTC calls, screen sharing, a Windows RDP launcher, local history, customizable settings, tray support, native notifications, configurable GitHub release updates, and an NSIS installer.

## Vision

inChat is a desktop application for people on the same trusted LAN or VPN. It should provide:

- Automatic peer discovery without a central server
- No account or cloud login
- Encrypted direct chat between peers
- File transfer
- One-to-one voice calls
- One-to-one video calls
- Screen sharing
- Optional remote control/RDP integration in a later phase

The application must not require a Rocket.Chat-style permanent server for normal LAN usage.

## Recommended technical direction

- **Language:** Go for the P2P engine, networking, identity, cryptography, file transfer, and service lifecycle
- **Desktop shell:** Wails v2 with a small HTML/CSS/JavaScript frontend
- **Media:** WebRTC in the desktop WebView for the MVP; evaluate a native Go media backend later
- **Remote control:** integrate with Windows `mstsc.exe` first; evaluate FreeRDP/RustDesk later
- **Initial platform:** Windows 10/11 x64
- **Later platforms:** Linux and macOS

Go is a good fit for the core because it produces small, portable binaries and has strong networking and concurrency support. The tradeoff is that desktop media integration is not as simple as pure Go GUI toolkits. Wails keeps the binary and deployment model relatively light while allowing WebRTC to provide microphone, camera, and screen capture in the first version.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Master project plan and milestones |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements and MVP scope |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Technical architecture and component boundaries |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | LAN discovery, transport, and message protocol |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model and security requirements |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Delivery phases and exit criteria |
| [`docs/TESTING.md`](docs/TESTING.md) | Test strategy and acceptance checklist |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architecture decision records |
| [`docs/OPEN_ISSUES.md`](docs/OPEN_ISSUES.md) | Decisions and risks to resolve before coding |
| [`docs/UI_SPEC.md`](docs/UI_SPEC.md) | Desktop UI and user-flow specification |

## MVP definition

The first usable MVP will be:

1. Install and start the Windows application.
2. Launch the app on two or more PCs in the same LAN.
3. Peers appear automatically.
4. Select a peer and send an encrypted text message.
5. Transfer a file.
6. Make a one-to-one voice call.
7. Make a one-to-one video call.
8. Share the screen during a call.

RDP and unattended remote control are intentionally excluded from the first MVP and will be evaluated after the P2P communication core is stable.

## Status checklist

- [x] Project planning documents created
- [ ] Technical spike for Wails + WebRTC
- [ ] Go module and project skeleton
- [ ] P2P discovery proof of concept
- [ ] Encrypted control channel
- [ ] Text chat
- [ ] File transfer
- [ ] Voice call
- [ ] Video call
- [ ] Screen sharing
- [ ] RDP integration

## License note

The project will not copy code from GPL or AGPL projects without reviewing the license obligations. Any dependency or code reused from another repository must be recorded in `docs/DECISIONS.md` and in the dependency inventory before implementation.
