# inChat Protocol Draft

This document is a design draft. It must be versioned before implementation and tested with interoperability fixtures.

## 1. Protocol principles

- LAN-first
- No central account system
- Encrypted control and file channels
- Direct peer-to-peer media where possible
- Explicit capability negotiation
- Human-readable peer identity verification
- Forward-compatible message envelopes

## 2. Default ports

These are provisional and may be changed after a networking spike.

| Port | Protocol | Purpose |
|---:|---|---|
| 45450 | UDP | Discovery announcements and responses |
| 45451 | TCP | Encrypted control/signaling channel |
| 45452 | TCP | File transfer channel, when not negotiated dynamically |
| Dynamic | UDP/TCP | WebRTC LAN media and ICE candidates |

Ports must be configurable for testing and networks with existing services.

## 3. Discovery

### Announcement

A peer periodically broadcasts a compact signed announcement:

```json
{
  "protocol": 1,
  "deviceId": "base64-id",
  "name": "Laptop Admin",
  "address": "192.168.1.25",
  "port": 45451,
  "publicKey": "base64-ed25519-key",
  "capabilities": ["chat", "files", "voice", "video", "screen"],
  "nonce": "base64-nonce",
  "timestamp": 0,
  "signature": "base64-signature"
}
```

Requirements:

- Sign every announcement with the device private key
- Reject stale timestamps
- Do not trust the displayed name for identity
- Do not place chat/file content in announcements
- Use multicast first and UDP broadcast fallback

## 4. Control channel

The control channel carries:

- Authentication handshake
- Safety-code verification
- Presence state
- Text messages
- File-transfer negotiation
- WebRTC SDP and ICE messages
- Call state
- Screen-share state
- Error and diagnostic events

The transport is mutually authenticated and encrypted. The first implementation should use TLS 1.3 with a locally generated certificate and a separate application-level device identity/signature if needed to keep certificate and peer identity responsibilities clear.

## 5. Message envelope

All control messages should use a versioned envelope:

```json
{
  "v": 1,
  "id": "message-id",
  "type": "chat.message",
  "from": "device-id",
  "to": "device-id",
  "sentAt": 0,
  "replyTo": "optional-message-id",
  "payload": {}
}
```

Required rules:

- Unknown message types are ignored safely
- Maximum message size is enforced
- Invalid JSON is rejected without crashing the peer
- Message IDs are generated locally and must not be trusted as authorization
- Time is displayed using local clock; ordering uses sequence numbers, not timestamp alone

## 6. Chat message

```json
{
  "v": 1,
  "id": "msg-uuid",
  "type": "chat.message",
  "from": "device-id",
  "to": "device-id",
  "sentAt": 0,
  "seq": 42,
  "payload": {
    "text": "Hello"
  }
}
```

Acknowledgements should be separate:

```json
{
  "type": "chat.ack",
  "payload": {
    "messageId": "msg-uuid",
    "status": "received"
  }
}
```

The MVP should not promise exactly-once delivery across network failures. It should provide delivery state and allow manual retry if necessary.

## 7. File transfer

The control channel negotiates:

```json
{
  "type": "file.offer",
  "payload": {
    "transferId": "transfer-uuid",
    "fileName": "report.pdf",
    "size": 123456,
    "sha256": "hex-digest",
    "chunkSize": 262144
  }
}
```

The receiving side explicitly accepts or rejects. Transfer data is streamed in bounded chunks and is never loaded entirely into memory.

The receiver verifies SHA-256 before marking the file complete.

## 8. WebRTC signaling

The Go core relays only signaling messages between consenting peers. Media must flow directly between peers.

Initial support:

- One-to-one voice
- One-to-one video
- Screen share
- ICE LAN candidates
- Renegotiation for camera/microphone changes

STUN/TURN is not an MVP requirement. The protocol must leave room for an optional future configuration.

## 9. Compatibility

Every capability is negotiated before use. A peer may support chat and files but not video or screen sharing.

The application should display:

- `Supported`
- `Unavailable`
- `Permission required`
- `Connection failed`

rather than failing with a generic error.
