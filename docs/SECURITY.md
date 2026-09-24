# inChat Security Plan

## 1. Security assumptions

The first version targets a trusted LAN or VPN. This does not mean the application should be insecure; it means that Internet traversal, abuse prevention, and large-scale abuse resistance are not MVP goals.

The application must protect content from other LAN users and from passive observers on the network.

## 2. Required security controls

### Device identity

- Generate a cryptographically random device ID.
- Generate a long-term asymmetric key pair on first launch.
- Store the private key using Windows DPAPI or the platform keychain.
- Never send the private key over the network.
- Display a safety code derived from the public key.

### Peer authentication

- Mutually authenticate the control channel.
- Require explicit user confirmation before saving a peer as trusted.
- Warn when a device safety code changes.
- Do not use the peer display name as authentication.

### Transport

- Encrypt control and signaling traffic.
- Encrypt file transfer traffic.
- Use WebRTC DTLS-SRTP for media.
- Reject downgrade to plaintext.
- Enforce maximum frame and message sizes.

### Discovery privacy

- Discovery announcements shall contain only identity metadata, capabilities, address, and timestamps.
- Chat text, file names, file contents, and call media shall not be placed in discovery broadcasts.
- Use a short lifetime for discovery records and prune offline peers.

### File transfer

- Show sender, file name, size, and destination before accepting.
- Reject files above the configured limit.
- Sanitize file names before writing to disk.
- Store received files in an application-controlled directory.
- Verify SHA-256.
- Prevent path traversal.

### Screen sharing and remote control

- Require an explicit click for every session.
- Show a persistent indicator while screen sharing is active.
- Show a persistent indicator while remote control is active.
- Provide a visible disconnect/stop action.
- Do not support silent unattended access in the MVP.

## 3. Threat model

| Threat | Mitigation |
|---|---|
| Another LAN user reads chat | Encrypted control channel |
| Fake peer replaces a trusted device | Safety code and signature verification |
| Malicious peer sends oversized messages | Frame/message size limits |
| Malicious file name escapes download directory | Sanitize and resolve paths before writing |
| User accidentally shares sensitive screen | Explicit consent and visible sharing state |
| Remote control is left active | Persistent indicator and stop action |
| Private key is copied from disk | OS-protected key storage |
| Application is attacked from Internet | LAN-only defaults, no public listener, optional firewall prompt |

## 4. Open security decisions

Before implementation, decide:

- Whether the control channel uses TLS directly or a Noise-style handshake.
- How trust confirmation is presented.
- Whether received files are sandboxed or stored in a normal download directory.
- Whether discovery is disabled by a setting.
- Whether manual IP pairing is allowed when discovery is disabled.
- How safety codes are displayed and rotated.

## 5. Security acceptance tests

- Two peers cannot read each other's chat with a packet capture.
- A modified announcement is rejected.
- A changed device key produces a clear safety-code warning.
- Oversized control messages are rejected safely.
- A file with `../` in its name cannot escape the download directory.
- A corrupted file is rejected by hash verification.
- Screen sharing cannot start without user action.
- The app never exposes the private key through logs or the frontend API.
