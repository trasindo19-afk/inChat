# inChat Architecture Decisions

## ADR-001: Go for the P2P core

**Status:** Proposed

**Decision:** Use Go for discovery, identity, transport, file transfer, diagnostics, and future RDP launcher logic.

**Reason:** Go provides small static binaries, strong networking primitives, simple concurrency, and good cross-platform support.

**Trade-off:** Native microphone/camera capture and embedded desktop GUI are more involved than in Electron. The MVP uses Wails/WebRTC to reduce that risk.

## ADR-002: Wails for the desktop shell

**Status:** Proposed

**Decision:** Use Wails v2 with a small web frontend.

**Reason:** It produces a desktop application, uses the system WebView, keeps the backend in Go, and is lighter than a full Electron runtime.

**Trade-off:** Windows requires WebView2, and media permission behavior must be tested on supported Windows versions.

## ADR-003: WebRTC in the WebView for MVP media

**Status:** Proposed

**Decision:** Use browser WebRTC APIs for the first voice/video/screen-sharing implementation.

**Reason:** WebRTC already handles ICE, DTLS-SRTP, media codecs, microphone/camera capture, and screen capture.

**Trade-off:** Less control over native device enumeration and performance. A native Go media backend remains a later option.

## ADR-004: No permanent signaling server

**Status:** Proposed

**Decision:** Exchange WebRTC signaling through the existing encrypted peer control channel or a temporary peer coordinator.

**Reason:** Keeps normal operation serverless and appropriate for a trusted LAN.

**Trade-off:** Peer discovery and group-call coordination are more complex. The MVP is limited to one-to-one calls.

## ADR-005: Do not implement RDP from scratch

**Status:** Proposed

**Decision:** Use Windows `mstsc.exe` for the first RDP integration. Investigate FreeRDP later.

**Reason:** RDP is a complex protocol and Windows already provides a mature client.

**Trade-off:** The first RDP feature may open a separate window rather than embedding the session in inChat.

## ADR-006: License-safe reuse

**Status:** Accepted

**Decision:** Prefer original code and permissive dependencies. Do not copy GPL/AGPL source into the project without a license review.

**Reason:** Reusing code from BLIP, Squiggle, RustDesk, or other repositories can impose distribution obligations.

**Action:** Every reused component must be added to a dependency/license inventory before implementation.
