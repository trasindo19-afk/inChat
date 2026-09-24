package main

import (
	"bufio"
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
