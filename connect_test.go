package main

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// newTestApp builds an App with a fresh, isolated identity so two instances in
// the same test behave like two different devices on the LAN.
func newTestApp(t *testing.T, name string) *App {
	t.Helper()
	identity, err := createIdentity(name)
	if err != nil {
		t.Fatalf("create identity: %v", err)
	}
	return &App{
		identity:   identity,
		settings:   Settings{DisplayName: name, ReceiveFolder: t.TempDir(), Theme: "dark"},
		peers:      make(map[string]*peer),
		outgoing:   make(map[string]*outgoingTransfer),
		incoming:   make(map[string]*incomingTransfer),
		stop:       make(chan struct{}),
		connecting: make(map[string]bool),
		started:    true,
	}
}

// startTestListener runs the server side of the control channel on loopback.
// It returns the listen address plus a cleanup function.
func startTestListener(t *testing.T, server *App) (string, func()) {
	t.Helper()
	listener, err := tls.Listen("tcp4", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{server.identity.Certificate},
		ClientAuth:   tls.RequireAnyClientCert,
		MinVersion:   tls.VersionTLS13,
	})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server.listener = listener

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			wg.Add(1)
			go func(c net.Conn) {
				defer wg.Done()
				tlsConn, ok := c.(*tls.Conn)
				if !ok {
					_ = c.Close()
					return
				}
				server.handleIncoming(tlsConn)
			}(conn)
		}
	}()

	cleanup := func() {
		_ = listener.Close()
		server.mu.Lock()
		for _, p := range server.peers {
			if p.conn != nil {
				_ = p.conn.Close()
			}
		}
		server.mu.Unlock()
		done := make(chan struct{})
		go func() {
			wg.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
	}
	return listener.Addr().String(), cleanup
}

func connected(app *App, peerID string) bool {
	app.mu.RLock()
	defer app.mu.RUnlock()
	p := app.peers[peerID]
	return p != nil && p.conn != nil
}

// TestPeerConnectionStaysConnected is the regression test for the "stuck on
// connecting" bug: a duplicated newline after the authentication frame used to
// make both readLoops fail immediately, so the channel dropped the instant it
// was established.
func TestPeerConnectionStaysConnected(t *testing.T) {
	server := newTestApp(t, "server-device")
	address, cleanup := startTestListener(t, server)
	defer cleanup()

	client := newTestApp(t, "client-device")
	info := PeerInfo{
		ID:          server.identity.ID,
		Address:     address,
		Fingerprint: server.identity.Fingerprint,
	}
	if err := client.connectPeer(info); err != nil {
		t.Fatalf("connectPeer: %v", err)
	}

	// Give both readLoops time to process any stray bytes left over from the
	// handshake before we assert the channel is still alive.
	time.Sleep(500 * time.Millisecond)

	if !connected(client, server.identity.ID) {
		t.Fatal("client dropped the connection right after the handshake")
	}
	if !connected(server, client.identity.ID) {
		t.Fatal("server dropped the connection right after the handshake")
	}

	// The channel must also carry traffic, not just survive the handshake.
	if err := client.SendMessage(server.identity.ID, "hello over the control channel"); err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if err := server.SendMessage(client.identity.ID, "reply"); err != nil {
		t.Fatalf("server SendMessage: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	if !connected(client, server.identity.ID) || !connected(server, client.identity.ID) {
		t.Fatal("connection dropped while exchanging messages")
	}

	client.mu.Lock()
	if p := client.peers[server.identity.ID]; p == nil || p.info.Status != "online" || p.info.Connected != true {
		client.mu.Unlock()
		t.Fatalf("client peer status not online: %+v", p)
	}
	client.mu.Unlock()
}

// TestManualConnectStaysConnected covers the "+ IP" fallback path.
func TestManualConnectStaysConnected(t *testing.T) {
	server := newTestApp(t, "server-device")
	address, cleanup := startTestListener(t, server)
	defer cleanup()

	client := newTestApp(t, "client-device")
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	info, err := client.ManualConnect(net.JoinHostPort(host, portString(t, address)))
	if err != nil {
		t.Fatalf("ManualConnect: %v", err)
	}
	if info.ID != server.identity.ID {
		t.Fatalf("manual connect returned wrong peer: %s", info.ID)
	}
	time.Sleep(500 * time.Millisecond)
	if !connected(client, info.ID) || !connected(server, client.identity.ID) {
		t.Fatal("manual connection dropped right after the handshake")
	}
}

func portString(t *testing.T, address string) string {
	t.Helper()
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	return port
}

// TestMustMarshalEnvelopeHasNoTrailingNewline pins the framing contract:
// writeLine adds exactly one newline, so the marshalled envelope must not
// already contain one.
func TestMustMarshalEnvelopeHasNoTrailingNewline(t *testing.T) {
	data := mustMarshalEnvelope("auth", "a", "b", []byte(`{"id":"x"}`))
	if bytes.HasSuffix(data, []byte("\n")) {
		t.Fatal("mustMarshalEnvelope must not append a newline; writeLine frames the line")
	}
	if bytes.Count(data, []byte("\n")) != 0 {
		t.Fatalf("unexpected newline inside envelope: %q", data)
	}
}

// TestWriteLineFramesExactlyOneNewline verifies the full framing path produces
// exactly one frame with no stray blank line behind it.
func TestWriteLineFramesExactlyOneNewline(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()

	data := mustMarshalEnvelope("auth", "a", "b", []byte(`{"id":"x"}`))
	go func() {
		_ = writeLine(client, data)
		// Closing the writer unblocks the reader once the single frame is out;
		// any extra byte would show up before EOF.
		_ = client.Close()
	}()

	all, err := io.ReadAll(server)
	if err != nil {
		if !strings.Contains(err.Error(), "closed pipe") {
			t.Fatalf("read stream: %v", err)
		}
	}
	if !bytes.HasSuffix(all, []byte("\n")) {
		t.Fatalf("frame must end with a newline, got %q", all)
	}
	if bytes.HasSuffix(all, []byte("\n\n")) {
		t.Fatal("stray blank line after the frame")
	}
	if bytes.Count(all, []byte("\n")) != 1 {
		t.Fatalf("expected exactly one newline in the frame, got %q", all)
	}
}

// TestReadEnvelopeSkipsBlankFrames keeps legacy peers (which used to emit an
// extra newline) from tearing down the connection.
func TestReadEnvelopeSkipsBlankFrames(t *testing.T) {
	payload := "{\"v\":1,\"type\":\"chat\",\"id\":\"1\",\"from\":\"a\",\"to\":\"b\",\"payload\":\"hi\"}\n"
	reader := bufio.NewReader(strings.NewReader("\n\n   \n" + payload))
	value, err := readEnvelope(reader)
	if err != nil {
		t.Fatalf("readEnvelope: %v", err)
	}
	if value.Type != "chat" {
		t.Fatalf("unexpected envelope type: %s", value.Type)
	}
}
