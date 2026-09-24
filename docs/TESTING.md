# inChat Test Strategy

## 1. Test levels

### Unit tests

Test pure logic independently from the desktop UI:

- Protocol envelope parsing
- Message validation
- File-name sanitization
- Hash verification
- State machines for calls and transfers
- Retry and timeout behavior

### Integration tests

Run the Go core and frontend bridge together:

- Discovery announcement parsing
- Control-channel handshake
- Chat message delivery
- File transfer
- Wails API calls
- Frontend event handling

### Network tests

Use a controlled LAN or lab network:

- Two Windows peers
- Three or more peers
- Wi-Fi and Ethernet
- Firewall enabled
- AP with multicast disabled
- VPN network
- Different subnet reachable through VPN

### Media tests

- Microphone permission granted
- Microphone permission denied
- Camera permission granted
- Camera permission denied
- Voice-only call
- Video call
- Screen share start/stop
- Device disconnect during call
- Firewall blocks media ports

### Packaging tests

- Clean Windows 10 installation
- Clean Windows 11 installation
- Portable build
- Upgrade from previous build
- Application restart with existing identity
- Uninstalled application leaves no unexpected user data

## 2. Automated tests

The first implementation should include:

- Go unit tests for all core packages
- Protocol fixtures with malformed and oversized messages
- File transfer tests using generated random files
- Local WebView/frontend tests for state transitions
- A manual LAN test checklist because WebRTC and device permissions cannot be fully tested in a headless unit test

## 3. MVP manual acceptance checklist

- [ ] Install on PC A and PC B
- [ ] Launch without account creation
- [ ] Both peers appear in the peer list
- [ ] Select PC B and send a text message
- [ ] Message arrives on PC B
- [ ] Send a small file
- [ ] File hash verifies
- [ ] Start a voice call
- [ ] Both sides hear audio
- [ ] Start a video call
- [ ] Both sides see video
- [ ] Share the screen
- [ ] Stop screen sharing
- [ ] Close and reopen the application
- [ ] Verify identity remains the same
- [ ] Disable UDP discovery and test manual IP fallback
- [ ] Verify a blocked firewall produces a useful diagnostic

## 4. Security tests

- [ ] Packet capture does not reveal chat plaintext
- [ ] Invalid signatures are rejected
- [ ] Safety code changes are visible
- [ ] File path traversal is blocked
- [ ] Oversized messages do not crash the app
- [ ] Private key is not logged
- [ ] Remote control requires explicit consent
- [ ] Screen-share state is always visible

## 5. Performance targets for MVP

These are initial targets and must be measured:

- Peer discovery visible within 3 seconds on a normal LAN
- Text message delivery within 1 second on a normal LAN
- File transfer should sustain a useful percentage of available LAN bandwidth
- Voice call should have no persistent audio glitching during a 15-minute test
- Video call should support at least 720p on a modern LAN, with lower resolution fallback
- Idle CPU and memory usage should remain reasonable with 20 peers visible
