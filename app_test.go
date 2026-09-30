package main

import (
	"bufio"
	"encoding/base64"
	"strings"
	"testing"
)

func TestReadEnvelopeRejectsUnsupportedVersion(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader("{\"v\":99,\"type\":\"chat\",\"from\":\"a\",\"to\":\"b\",\"payload\":null}\n"))
	if _, err := readEnvelope(reader); err == nil {
		t.Fatal("expected unsupported version error")
	}
}

func TestReadEnvelopeAcceptsValidEnvelope(t *testing.T) {
	line := `{"v":1,"type":"chat","id":"1","from":"a","to":"b","payload":"hello"}` + "\n"
	reader := bufio.NewReader(strings.NewReader(line))
	value, err := readEnvelope(reader)
	if err != nil {
		t.Fatalf("read valid envelope: %v", err)
	}
	if value.Type != "chat" || value.From != "a" || value.To != "b" {
		t.Fatalf("unexpected envelope: %+v", value)
	}
}

func TestReadEnvelopeRejectsOversizedFrame(t *testing.T) {
	line := strings.Repeat("x", maxFrameSize+1) + "\n"
	reader := bufio.NewReader(strings.NewReader(line))
	if _, err := readEnvelope(reader); err == nil {
		t.Fatal("expected oversized frame error")
	}
}

func TestIsAllowedLANAddress(t *testing.T) {
	allowed := []string{"192.168.1.20", "10.1.2.3", "172.16.4.5", "127.0.0.1"}
	for _, address := range allowed {
		if !isAllowedLANAddress(address) {
			t.Errorf("expected %s to be allowed", address)
		}
	}
	blocked := []string{"8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "not-an-ip"}
	for _, address := range blocked {
		if isAllowedLANAddress(address) {
			t.Errorf("expected %s to be blocked", address)
		}
	}
}

func TestEncodePowerShellCommand(t *testing.T) {
	cmd := "Write-Output 'OK'"
	encoded := encodePowerShellCommand(cmd)
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	if len(raw) != len(cmd)*2 {
		t.Fatalf("expected UTF-16LE byte count %d, got %d", len(cmd)*2, len(raw))
	}
	// Verify little-endian ASCII: every odd byte is 0 for standard ASCII chars
	for i := 0; i < len(cmd); i++ {
		if raw[i*2] != cmd[i] || raw[i*2+1] != 0 {
			t.Fatalf("character %d mismatch: got (%d, %d), expected (%d, 0)", i, raw[i*2], raw[i*2+1], cmd[i])
		}
	}
}

func TestIdentityPersistenceRoundTrip(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)

	orig, err := createIdentity("test-host")
	if err != nil {
		t.Fatalf("create identity: %v", err)
	}
	if err := saveIdentity(orig); err != nil {
		t.Fatalf("save identity: %v", err)
	}

	loaded, err := loadOrCreateIdentity("test-host")
	if err != nil {
		t.Fatalf("load identity: %v", err)
	}
	if loaded.ID != orig.ID {
		t.Fatalf("expected ID %s, got %s", orig.ID, loaded.ID)
	}
	if loaded.Fingerprint != orig.Fingerprint {
		t.Fatalf("expected fingerprint %s, got %s", orig.Fingerprint, loaded.Fingerprint)
	}
	if len(loaded.Certificate.Certificate) == 0 {
		t.Fatal("loaded certificate is missing")
	}
	if loaded.PrivateKey == nil {
		t.Fatal("loaded private key is missing")
	}
}

func TestEnterpriseLANAddresses(t *testing.T) {
	cgnatAllowed := []string{"100.64.0.1", "100.100.50.2", "100.127.255.254"}
	for _, addr := range cgnatAllowed {
		if !isAllowedLANAddress(addr) {
			t.Errorf("expected enterprise/CGNAT address %s to be allowed", addr)
		}
	}
	publicBlocked := []string{"100.63.255.255", "100.128.0.1", "52.96.10.1"}
	for _, addr := range publicBlocked {
		if isAllowedLANAddress(addr) {
			t.Errorf("expected public address %s to be blocked", addr)
		}
	}
}

func TestLocalBroadcastAddressesDoesNotPanic(t *testing.T) {
	addrs := localBroadcastAddresses()
	// Should not panic and each returned address should have valid 4-byte IPv4 representation
	for _, bcast := range addrs {
		if ip4 := bcast.To4(); ip4 == nil {
			t.Errorf("expected valid IPv4 broadcast address, got: %v", bcast)
		}
	}
}

func TestChatHistoryRoundTrip(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("APPDATA", tempDir)

	app := &App{}
	sampleHistory := `{"peer-1":[{"kind":"text","text":"hello peer","mine":true}]}`
	if err := app.SaveChatHistory(sampleHistory); err != nil {
		t.Fatalf("save chat history: %v", err)
	}

	loaded := app.LoadChatHistory()
	if loaded != sampleHistory {
		t.Fatalf("expected chat history %q, got %q", sampleHistory, loaded)
	}
}


