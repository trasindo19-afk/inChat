# inChat Open Issues and Decisions Needed

These questions should be resolved before the production implementation.

## Product

- Should the first release be Windows-only or cross-platform from day one?
- Is group chat required in the MVP?
- Is screen sharing required in the first demo or can it follow voice/video?
- Should users be able to save a peer as trusted?

## Networking

- Which discovery method is default: UDP multicast, UDP broadcast, or both?
- What ports should be reserved?
- How will manual IP pairing work if discovery is disabled?
- How should subnet/VPN discovery be represented?

## Identity and security

- Use TLS 1.3 with locally generated certificates, or a Noise-style handshake?
- How should the safety code be displayed?
- How should a changed device identity be handled?
- Should received files be quarantined before opening?

## Media

- Does Wails/WebView2 support reliable screen capture on the target Windows versions?
- Should the first release use one media `RTCPeerConnection` for audio/video/screen?
- What codecs and resolution should be the defaults?
- Is a temporary TURN server acceptable for non-LAN networks later?

## Remote control

- Should RDP open a separate `mstsc.exe` window?
- Is a FreeRDP integration worth the binary and license complexity?
- Should unattended remote control ever be supported?
- How will the user distinguish a screen share from a remote-control session?

## Packaging

- Portable EXE first, or installer first?
- Should the application auto-update?
- How should firewall changes be requested?
- What logs and diagnostics should be exportable?

## Exit criteria for the technical spike

The spike is complete when:

- Two Windows instances discover each other.
- A direct encrypted control connection is established.
- WebRTC audio works.
- WebRTC video works.
- `getDisplayMedia()` works.
- A failed firewall test produces a readable diagnostic.
