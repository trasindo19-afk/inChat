# inChat UI Specification

## 1. General style

- Desktop-first, compact, and fast
- Clear online/offline state
- No dashboard-heavy layout
- No account or onboarding requirement beyond a device name
- Important actions should be reachable in one or two clicks
- Use a neutral dark/light theme later, but prioritize clarity

## 2. Main window

### Header

- App name
- Local device name
- Network status
- Diagnostics button
- Settings button

### Sidebar

- Peers
- Active conversations
- Recent transfers
- Blocked peers

### Peer row

- Display name
- Online/offline indicator
- Device fingerprint/safety-code action
- Last-seen time
- Capability indicators for chat, files, voice, video, and screen share

## 3. Conversation view

- Message bubbles
- Local timestamp
- Delivery state
- Typing indicator
- Attach file button
- Voice call button
- Video call button
- Screen-share control during an active call
- Block peer action
- View safety code action

## 4. File transfer view

- File name
- File size
- Sender/receiver
- Progress
- Speed
- Remaining time
- Accept/reject
- Cancel
- Completed/failed status

## 5. Call window

- Remote video area
- Local preview
- Microphone mute
- Camera toggle
- Screen share/stop sharing
- End call
- Connection quality indicator
- Clear permission or firewall error

## 6. Diagnostics view

- Local IP addresses
- Listening ports
- Discovery status
- Number of peers
- Last discovery/error message
- Firewall status
- WebView version
- Media permission status
- ICE/call diagnostics
- Copy diagnostics button

## 7. First-run behavior

On first launch:

1. Show a short device-name prompt.
2. Generate and store a device identity.
3. Start discovery.
4. Show peer list.
5. Display a small explanation that LAN discovery and firewall permissions may be required.

Do not require the user to create a username, password, email address, or cloud account.
