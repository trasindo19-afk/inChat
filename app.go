package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	discoveryPort = 45450
	controlPort   = 45451
	maxFrameSize  = 40 * 1024 * 1024
	maxFileSize   = 25 * 1024 * 1024
	protocolVer   = 1
	fileChunkSize = 256 * 1024
	appVersion    = "0.1.0"
)

const (
	connectTimeout      = 5 * time.Second
	peerRetryCooldown   = 3 * time.Second
	authHandshakeWindow = 5 * time.Second
)

type Identity struct {
	ID          string
	Name        string
	Fingerprint string
	Certificate tls.Certificate
	PrivateKey  *ecdsa.PrivateKey
}

type IdentityInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
}

type Settings struct {
	DisplayName     string `json:"displayName"`
	ReceiveFolder   string `json:"receiveFolder"`
	AutoAcceptFiles bool   `json:"autoAcceptFiles"`
	AvatarData      string `json:"avatarData"`
	AvatarMIME      string `json:"avatarMime"`
	UpdateFeedURL   string `json:"updateFeedUrl"`
	Theme           string `json:"theme"`
}

type SettingsInfo struct {
	DisplayName     string `json:"displayName"`
	ReceiveFolder   string `json:"receiveFolder"`
	AutoAcceptFiles bool   `json:"autoAcceptFiles"`
	AvatarData      string `json:"avatarData"`
	UpdateFeedURL   string `json:"updateFeedUrl"`
	Theme           string `json:"theme"`
}

type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	DownloadURL    string `json:"downloadUrl"`
	ReleaseURL     string `json:"releaseUrl"`
	Available      bool   `json:"available"`
	Message        string `json:"message"`
}

type PeerInfo struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Address      string    `json:"address"`
	Fingerprint  string    `json:"fingerprint"`
	Connected    bool      `json:"connected"`
	Status       string    `json:"status"`
	LastError    string    `json:"lastError,omitempty"`
	LastSeen     time.Time `json:"lastSeen"`
	Capabilities []string  `json:"capabilities"`
}

type peer struct {
	info        PeerInfo
	conn        *tls.Conn
	initiator   string
	lastError   string
	lastAttempt time.Time
	mu          sync.Mutex
}

type discoveryHello struct {
	Version      int      `json:"version"`
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Addresses    []string `json:"addresses"`
	Port         int      `json:"port"`
	Fingerprint  string   `json:"fingerprint"`
	Capabilities []string `json:"capabilities"`
}

type envelope struct {
	Version int             `json:"v"`
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	From    string          `json:"from"`
	To      string          `json:"to"`
	Payload json.RawMessage `json:"payload"`
}

type filePayload struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	MIME string `json:"mime"`
	Data string `json:"data"`
}

type FileTransferInfo struct {
	TransferID  string `json:"transfer_id"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	TotalChunks int    `json:"total_chunks"`
}

type fileOfferPayload struct {
	TransferID string `json:"transfer_id"`
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
}

type fileAcceptedPayload struct {
	TransferID string `json:"transfer_id"`
	Accepted   bool   `json:"accepted"`
}

type fileChunkPayload struct {
	TransferID string `json:"transfer_id"`
	Index      int    `json:"index"`
	Total      int    `json:"total"`
	Data       string `json:"data"`
}

type fileCompletePayload struct {
	TransferID string `json:"transfer_id"`
	SHA256     string `json:"sha256"`
}

type fileCancelPayload struct {
	TransferID string `json:"transfer_id"`
	Reason     string `json:"reason"`
}

type outgoingTransfer struct {
	PeerID      string
	Path        string
	Name        string
	Size        int64
	SHA256      string
	TotalChunks int
	CreatedAt   time.Time
}

type incomingTransfer struct {
	PeerID      string
	Path        string
	Name        string
	Size        int64
	SHA256      string
	TotalChunks int
	Received    int64
	File        *os.File
	CreatedAt   time.Time
	mu          sync.Mutex
}

type signalPayload struct {
	Kind string `json:"kind"`
	Data string `json:"data"`
}

type App struct {
	ctx context.Context

	mu       sync.RWMutex
	identity Identity
	settings Settings
	peers    map[string]*peer
	outgoing map[string]*outgoingTransfer
	incoming map[string]*incomingTransfer
	started  bool
	quitting bool
	tray     trayNotifier

	listener     net.Listener
	stop         chan struct{}
	wg           sync.WaitGroup
	connecting   map[string]bool
	recentErrors []string
}

func newApp() *App {
	settings := loadSettings()
	identity, err := loadOrCreateIdentity(settings.DisplayName)
	if err != nil {
		// A temporary identity keeps the UI usable; startup reports the error.
		identity, _ = createIdentity(settings.DisplayName)
	}

	return &App{
		identity:   identity,
		settings:   settings,
		peers:      make(map[string]*peer),
		outgoing:   make(map[string]*outgoingTransfer),
		incoming:   make(map[string]*incomingTransfer),
		stop:       make(chan struct{}),
		connecting: make(map[string]bool),
	}
}

func defaultDeviceName() string {
	name, err := os.Hostname()
	if err != nil || strings.TrimSpace(name) == "" {
		return "inChat device"
	}
	return name
}

func createIdentity(name string) (Identity, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return Identity{}, err
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return Identity{}, err
	}

	rawID := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, rawID); err != nil {
		return Identity{}, err
	}

	id := base64.RawURLEncoding.EncodeToString(rawID)
	template := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "inChat-" + id},
		NotBefore:    time.Now().Add(-5 * time.Minute),
		NotAfter:     time.Now().AddDate(5, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     []string{"localhost"},
	}

	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return Identity{}, err
	}

	fingerprint := sha256.Sum256(der)
	cert := tls.Certificate{
		Certificate: [][]byte{der},
		PrivateKey:  key,
	}

	return Identity{
		ID:          id,
		Name:        name,
		Fingerprint: hex.EncodeToString(fingerprint[:]),
		Certificate: cert,
		PrivateKey:  key,
	}, nil
}

func identityPath() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return filepath.Join(os.TempDir(), "inChat", "identity.json")
		}
		base = filepath.Join(home, "AppData", "Roaming")
	}
	return filepath.Join(base, "inChat", "identity.json")
}

func settingsPath() string {
	return filepath.Join(filepath.Dir(identityPath()), "settings.json")
}

func defaultReceiveFolder() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "inChat", "Received")
	}
	return filepath.Join(home, "Downloads", "inChat")
}

func loadSettings() Settings {
	settings := Settings{
		DisplayName:     defaultDeviceName(),
		ReceiveFolder:   defaultReceiveFolder(),
		AutoAcceptFiles: false,
		Theme:           "dark",
	}
	data, err := os.ReadFile(settingsPath())
	if err == nil && json.Unmarshal(data, &settings) != nil {
		settings = Settings{DisplayName: defaultDeviceName(), ReceiveFolder: defaultReceiveFolder()}
	}
	if strings.TrimSpace(settings.DisplayName) == "" {
		settings.DisplayName = defaultDeviceName()
	}
	if strings.TrimSpace(settings.ReceiveFolder) == "" {
		settings.ReceiveFolder = defaultReceiveFolder()
	}
	if settings.Theme != "dark" && settings.Theme != "light" && settings.Theme != "system" {
		settings.Theme = "dark"
	}
	_ = os.MkdirAll(settings.ReceiveFolder, 0700)
	return settings
}

func saveSettings(settings Settings) error {
	path := settingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func (a *App) GetSettings() SettingsInfo {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return SettingsInfo{
		DisplayName:     a.settings.DisplayName,
		ReceiveFolder:   a.settings.ReceiveFolder,
		AutoAcceptFiles: a.settings.AutoAcceptFiles,
		AvatarData:      a.settings.AvatarData,
		UpdateFeedURL:   a.settings.UpdateFeedURL,
		Theme:           a.settings.Theme,
	}
}

func (a *App) SetDisplayName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 64 {
		return errors.New("display name must be between 1 and 64 characters")
	}
	a.mu.Lock()
	a.identity.Name = name
	a.settings.DisplayName = name
	identityErr := saveIdentity(a.identity)
	settingsErr := saveSettings(a.settings)
	a.mu.Unlock()
	if identityErr != nil {
		return identityErr
	}
	return settingsErr
}

func (a *App) SetDeviceName(name string) error {
	return a.SetDisplayName(name)
}

func (a *App) SetUpdateFeedURL(feedURL string) error {
	feedURL = strings.TrimSpace(feedURL)
	if feedURL != "" && !strings.HasPrefix(strings.ToLower(feedURL), "https://") {
		return errors.New("update feed URL must use HTTPS")
	}
	a.mu.Lock()
	a.settings.UpdateFeedURL = feedURL
	err := saveSettings(a.settings)
	a.mu.Unlock()
	return err
}

func (a *App) CheckForUpdates() (UpdateInfo, error) {
	a.mu.RLock()
	feedURL := a.settings.UpdateFeedURL
	a.mu.RUnlock()
	info := UpdateInfo{CurrentVersion: appVersion, LatestVersion: appVersion}
	if feedURL == "" {
		info.Message = "Update feed is not configured"
		return info, nil
	}
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Get(feedURL)
	if err != nil {
		return info, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return info, fmt.Errorf("update server returned HTTP %d", response.StatusCode)
	}
	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
		Assets  []struct {
			BrowserDownloadURL string `json:"browser_download_url"`
			Name               string `json:"name"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2*1024*1024)).Decode(&release); err != nil {
		return info, err
	}
	info.LatestVersion = strings.TrimPrefix(release.TagName, "v")
	info.ReleaseURL = release.HTMLURL
	for _, asset := range release.Assets {
		if strings.HasSuffix(strings.ToLower(asset.Name), ".exe") || strings.HasSuffix(strings.ToLower(asset.Name), ".zip") {
			info.DownloadURL = asset.BrowserDownloadURL
			break
		}
	}
	info.Available = info.LatestVersion != "" && info.LatestVersion != appVersion && info.DownloadURL != ""
	if !info.Available {
		info.Message = "inChat is up to date"
	}
	return info, nil
}

func (a *App) DownloadUpdate(downloadURL string) (string, error) {
	if !strings.HasPrefix(strings.ToLower(downloadURL), "https://") {
		return "", errors.New("update download must use HTTPS")
	}
	client := &http.Client{Timeout: 10 * time.Minute}
	response, err := client.Get(downloadURL)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("update download returned HTTP %d", response.StatusCode)
	}
	dir := filepath.Join(os.TempDir(), "inChat", "updates")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(dir, "inChat-update-*.exe")
	if err != nil {
		return "", err
	}
	defer file.Close()
	_, copyErr := io.CopyN(file, response.Body, 250*1024*1024)
	if copyErr != nil && copyErr != io.EOF {
		_ = os.Remove(file.Name())
		return "", copyErr
	}
	return file.Name(), nil
}

func (a *App) ApplyUpdate(path string) error {
	if !strings.HasSuffix(strings.ToLower(path), ".exe") {
		return errors.New("update file must be an EXE installer")
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	if err := exec.Command(path).Start(); err != nil {
		return err
	}
	a.requestQuit()
	return nil
}

func (a *App) SetAutoAcceptFiles(enabled bool) error {
	a.mu.Lock()
	a.settings.AutoAcceptFiles = enabled
	err := saveSettings(a.settings)
	a.mu.Unlock()
	return err
}

func (a *App) SetTheme(theme string) error {
	if theme != "dark" && theme != "light" && theme != "system" {
		return errors.New("theme must be dark, light, or system")
	}
	a.mu.Lock()
	a.settings.Theme = theme
	err := saveSettings(a.settings)
	a.mu.Unlock()
	return err
}

func (a *App) SetReceiveFolder(folder string) error {
	folder = strings.TrimSpace(folder)
	if folder == "" {
		return errors.New("receive folder cannot be empty")
	}
	if err := os.MkdirAll(folder, 0700); err != nil {
		return err
	}
	a.mu.Lock()
	a.settings.ReceiveFolder = folder
	err := saveSettings(a.settings)
	a.mu.Unlock()
	return err
}

func (a *App) ChooseReceiveFolder() (string, error) {
	if a.ctx == nil {
		return "", errors.New("application is not ready")
	}
	folder, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{Title: "Choose inChat received files folder"})
	if err != nil || folder == "" {
		return folder, err
	}
	return folder, a.SetReceiveFolder(folder)
}

func (a *App) ChooseAvatar() (SettingsInfo, error) {
	if a.ctx == nil {
		return SettingsInfo{}, errors.New("application is not ready")
	}
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Choose profile photo",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Images", Pattern: "*.png;*.jpg;*.jpeg;*.webp;*.gif"},
		},
	})
	if err != nil || path == "" {
		return a.GetSettings(), err
	}
	info, err := os.Stat(path)
	if err != nil {
		return a.GetSettings(), err
	}
	if info.Size() > 5*1024*1024 {
		return a.GetSettings(), errors.New("profile photo must be smaller than 5 MB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return a.GetSettings(), err
	}
	mimeType := mime.TypeByExtension(filepath.Ext(path))
	if mimeType == "" {
		return a.GetSettings(), errors.New("unsupported image format")
	}
	a.mu.Lock()
	a.settings.AvatarMIME = mimeType
	a.settings.AvatarData = "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
	err = saveSettings(a.settings)
	a.mu.Unlock()
	return a.GetSettings(), err
}

func loadOrCreateIdentity(name string) (Identity, error) {
	path := identityPath()
	data, err := os.ReadFile(path)
	if err == nil {
		var stored struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Certificate string `json:"certificate"`
			PrivateKey  string `json:"private_key"`
			Fingerprint string `json:"fingerprint"`
		}
		if json.Unmarshal(data, &stored) == nil && stored.Certificate != "" && stored.PrivateKey != "" {
			certBlock, _ := pem.Decode([]byte(stored.Certificate))
			keyBlock, _ := pem.Decode([]byte(stored.PrivateKey))
			if certBlock != nil && keyBlock != nil {
				key, parseErr := x509.ParseECPrivateKey(keyBlock.Bytes)
				if parseErr == nil {
					cert := tls.Certificate{Certificate: [][]byte{certBlock.Bytes}, PrivateKey: key}
					return Identity{ID: stored.ID, Name: name, Fingerprint: stored.Fingerprint, Certificate: cert, PrivateKey: key}, nil
				}
			}
		}
	}

	identity, err := createIdentity(name)
	if err != nil {
		return Identity{}, err
	}
	if err := saveIdentity(identity); err != nil {
		return identity, err
	}
	return identity, nil
}

func saveIdentity(identity Identity) error {
	path := identityPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	keyDER, err := x509.MarshalECPrivateKey(identity.PrivateKey)
	if err != nil {
		return err
	}

	stored := struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Certificate string `json:"certificate"`
		PrivateKey  string `json:"private_key"`
		Fingerprint string `json:"fingerprint"`
	}{
		ID:          identity.ID,
		Name:        identity.Name,
		Certificate: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: identity.Certificate.Certificate[0]})),
		PrivateKey:  string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})),
		Fingerprint: identity.Fingerprint,
	}
	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.mu.Lock()
	a.started = true
	identityErr := saveIdentity(a.identity)
	a.mu.Unlock()

	if identityErr != nil {
		a.emitError("identity", identityErr)
	}

	listener, err := tls.Listen("tcp4", fmt.Sprintf(":%d", controlPort), &tls.Config{
		Certificates: []tls.Certificate{a.identity.Certificate},
		ClientAuth:   tls.RequireAnyClientCert,
		MinVersion:   tls.VersionTLS13,
	})
	if err != nil {
		a.emitError("listener", err)
		return
	}
	a.listener = listener

	a.wg.Add(2)
	go a.acceptLoop(listener)
	go a.discoveryLoop()
	a.startTray()

	a.emit("status", map[string]any{
		"message": "inChat is running",
		"port":    controlPort,
	})
}

func (a *App) shutdown(context.Context) {
	a.mu.Lock()
	if !a.started {
		a.mu.Unlock()
		return
	}
	a.started = false
	close(a.stop)
	listener := a.listener
	a.listener = nil
	for id, p := range a.peers {
		if p.conn != nil {
			_ = p.conn.Close()
		}
		delete(a.peers, id)
	}
	a.mu.Unlock()

	if listener != nil {
		_ = listener.Close()
	}
	a.wg.Wait()
}

func (a *App) GetIdentity() IdentityInfo {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return IdentityInfo{ID: a.identity.ID, Name: a.identity.Name, Fingerprint: a.identity.Fingerprint}
}

func (a *App) GetPeers() []PeerInfo {
	a.mu.RLock()
	defer a.mu.RUnlock()

	result := make([]PeerInfo, 0, len(a.peers))
	for _, p := range a.peers {
		result = append(result, a.peerSnapshotLocked(p))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}

func (a *App) peerSnapshotLocked(p *peer) PeerInfo {
	info := p.info
	info.Connected = p.conn != nil
	info.LastError = p.lastError
	info.Status = peerStatus(p.conn, a.connecting[p.info.ID], p.lastError)
	return info
}

func peerStatus(conn *tls.Conn, connecting bool, lastError string) string {
	switch {
	case conn != nil:
		return "online"
	case connecting:
		return "connecting"
	case lastError != "":
		return "failed"
	default:
		return "discovered"
	}
}

func preferredInitiator(localID, peerID string) string {
	if localID < peerID {
		return localID
	}
	return peerID
}

func shouldReplaceConnection(localID, peerID, existingInitiator, newInitiator string, hasConnection bool) bool {
	if !hasConnection {
		return true
	}
	preferred := preferredInitiator(localID, peerID)
	if existingInitiator == preferred {
		return false
	}
	return newInitiator == preferred
}

// recordPeerResult stores the outcome of a connection attempt and pushes the
// updated peer snapshot to the UI. It deliberately does not raise a toast:
// discovery retries in the background and the peer row already shows the
// failure reason. Errors are still kept for diagnostics.
func (a *App) recordPeerResult(peerID string, err error) {
	a.mu.Lock()
	p := a.peers[peerID]
	var snapshot PeerInfo
	if p != nil {
		p.lastAttempt = time.Now()
		if err != nil {
			p.lastError = err.Error()
		} else {
			p.lastError = ""
		}
		snapshot = a.peerSnapshotLocked(p)
	}
	a.mu.Unlock()
	if p != nil {
		a.emitPeer(snapshot)
	}
	if err != nil {
		// Keep a copy for the diagnostics view without spamming the UI.
		a.mu.Lock()
		a.recentErrors = append(a.recentErrors, fmt.Sprintf("%s: %s", time.Now().Format("15:04:05"), err.Error()))
		if len(a.recentErrors) > 12 {
			a.recentErrors = a.recentErrors[len(a.recentErrors)-12:]
		}
		a.mu.Unlock()
	}
}

// ConnectPeer attempts to establish (or re-establish) the control channel and
// returns the real transport error so the UI can explain what failed.
func (a *App) ConnectPeer(peerID string) error {
	a.mu.RLock()
	p, ok := a.peers[peerID]
	var info PeerInfo
	if ok {
		info = a.peerSnapshotLocked(p)
	}
	a.mu.RUnlock()
	if !ok {
		return fmt.Errorf("peer not found: %s", peerID)
	}
	return a.connectPeer(info)
}

func (a *App) ManualConnect(address string) (PeerInfo, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return PeerInfo{}, errors.New("peer address is required")
	}
	if !strings.Contains(address, ":") {
		address = net.JoinHostPort(address, fmt.Sprintf("%d", controlPort))
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil || !isAllowedLANAddress(host) {
		return PeerInfo{}, errors.New("enter a valid LAN IP address")
	}
	conn, err := a.dialTLS(address, &tls.Config{
		InsecureSkipVerify: true, // the peer fingerprint is shown to the user for verification
		Certificates:       []tls.Certificate{a.identity.Certificate},
		MinVersion:         tls.VersionTLS13,
	})
	if err != nil {
		return PeerInfo{}, err
	}
	authPayload, _ := json.Marshal(map[string]string{"id": a.identity.ID, "name": a.identity.Name, "fingerprint": a.identity.Fingerprint})
	if err := conn.SetDeadline(time.Now().Add(authHandshakeWindow)); err != nil {
		_ = conn.Close()
		return PeerInfo{}, err
	}
	if err := writeLine(conn, mustMarshalEnvelope("auth", a.identity.ID, "manual-peer", authPayload)); err != nil {
		_ = conn.Close()
		return PeerInfo{}, err
	}
	reader := bufio.NewReaderSize(conn, 64*1024)
	response, err := readEnvelope(reader)
	if err != nil || response.Type != "auth-ok" {
		_ = conn.Close()
		if err != nil {
			return PeerInfo{}, err
		}
		return PeerInfo{}, errors.New("manual peer authentication failed")
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		_ = conn.Close()
		return PeerInfo{}, err
	}
	var authData struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Fingerprint string `json:"fingerprint"`
	}
	if json.Unmarshal(response.Payload, &authData) != nil || authData.ID == "" || authData.Fingerprint == "" {
		_ = conn.Close()
		return PeerInfo{}, errors.New("manual peer returned invalid identity")
	}
	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		_ = conn.Close()
		return PeerInfo{}, errors.New("manual peer certificate is missing")
	}
	fingerprint := sha256.Sum256(state.PeerCertificates[0].Raw)
	if !strings.EqualFold(hex.EncodeToString(fingerprint[:]), authData.Fingerprint) {
		_ = conn.Close()
		return PeerInfo{}, errors.New("manual peer certificate fingerprint mismatch")
	}
	info := PeerInfo{ID: authData.ID, Name: authData.Name, Address: address, Fingerprint: authData.Fingerprint, Connected: true, Status: "online", LastSeen: time.Now(), Capabilities: []string{"chat", "files", "voice", "video", "screen"}}
	// We placed this call, so we are the initiator for connection election.
	if !a.installConnection(info, conn, a.identity.ID) {
		_ = conn.Close()
		a.mu.RLock()
		existing := a.peers[info.ID]
		snapshot := PeerInfo{}
		if existing != nil {
			snapshot = a.peerSnapshotLocked(existing)
		}
		a.mu.RUnlock()
		if snapshot.ID != "" {
			a.emitPeer(snapshot)
			return snapshot, nil
		}
		return PeerInfo{}, errors.New("an existing peer connection is preferred")
	}
	a.recordPeerResult(info.ID, nil)
	if !a.startTracked(func() { a.readLoop(info.ID, conn, reader) }) {
		_ = conn.Close()
		return PeerInfo{}, errors.New("application is shutting down")
	}
	return info, nil
}

func (a *App) SendMessage(peerID, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("message cannot be empty")
	}
	if len([]byte(text)) > 64*1024 {
		return errors.New("message is too large")
	}
	payload, _ := json.Marshal(text)
	return a.sendEnvelope(peerID, "chat", payload)
}

func (a *App) SendSignal(peerID, kind, data string) error {
	if kind == "" || data == "" {
		return errors.New("signal kind and data are required")
	}
	payload, _ := json.Marshal(signalPayload{Kind: kind, Data: data})
	return a.sendEnvelope(peerID, "signal", payload)
}

func (a *App) BroadcastMessage(text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("message cannot be empty")
	}
	if len([]byte(text)) > 64*1024 {
		return errors.New("message is too large")
	}
	a.mu.RLock()
	activePeers := make([]string, 0, len(a.peers))
	for id, p := range a.peers {
		if p.conn != nil {
			activePeers = append(activePeers, id)
		}
	}
	a.mu.RUnlock()
	if len(activePeers) == 0 {
		return errors.New("no peers currently online in LAN room")
	}
	payload, _ := json.Marshal(map[string]string{
		"text": text,
		"name": a.identity.Name,
	})
	var lastErr error
	for _, peerID := range activePeers {
		if err := a.sendEnvelope(peerID, "group-chat", payload); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

func (a *App) BroadcastChannelMessage(channel, text string) error {
	channel = strings.TrimSpace(channel)
	text = strings.TrimSpace(text)
	if channel == "" || text == "" {
		return errors.New("channel and message cannot be empty")
	}
	if len([]byte(text)) > 64*1024 {
		return errors.New("message is too large")
	}
	a.mu.RLock()
	activePeers := make([]string, 0, len(a.peers))
	for id, p := range a.peers {
		if p.conn != nil {
			activePeers = append(activePeers, id)
		}
	}
	a.mu.RUnlock()
	if len(activePeers) == 0 {
		return errors.New("no peers currently online in LAN room")
	}
	payload, _ := json.Marshal(map[string]string{
		"channel": channel,
		"text":    text,
		"name":    a.identity.Name,
	})
	var lastErr error
	for _, peerID := range activePeers {
		if err := a.sendEnvelope(peerID, "channel-chat", payload); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

func incIP(ip net.IP) {
	for j := len(ip) - 1; j >= 0; j-- {
		ip[j]++
		if ip[j] > 0 {
			break
		}
	}
}

func (a *App) ScanSubnet(target string) ([]PeerInfo, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return nil, errors.New("subnet or IP range is required")
	}

	var ips []string
	if strings.Contains(target, "/") {
		ip, ipnet, err := net.ParseCIDR(target)
		if err != nil {
			return nil, fmt.Errorf("invalid CIDR: %w", err)
		}
		for curr := ip.Mask(ipnet.Mask); ipnet.Contains(curr); incIP(curr) {
			curr4 := curr.To4()
			if curr4 != nil && curr4[3] != 0 && curr4[3] != 255 {
				ips = append(ips, curr4.String())
			}
		}
	} else if strings.Count(target, ".") == 3 {
		ips = append(ips, target)
	} else if strings.Count(target, ".") == 2 {
		for i := 1; i <= 254; i++ {
			ips = append(ips, fmt.Sprintf("%s.%d", target, i))
		}
	} else {
		return nil, errors.New("format must be CIDR (e.g. 192.168.1.0/24) or prefix (e.g. 192.168.1)")
	}

	if len(ips) == 0 {
		return nil, errors.New("no IP addresses to scan")
	}
	if len(ips) > 512 {
		return nil, errors.New("subnet scan limited to maximum 512 IP addresses")
	}

	type scanResult struct {
		peer PeerInfo
		ok   bool
	}
	resultsChan := make(chan scanResult, len(ips))
	sem := make(chan struct{}, 40)

	var wg sync.WaitGroup
	for _, ip := range ips {
		wg.Add(1)
		go func(addr string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			endpoint := net.JoinHostPort(addr, fmt.Sprintf("%d", controlPort))
			conn, err := net.DialTimeout("tcp4", endpoint, 350*time.Millisecond)
			if err != nil {
				return
			}
			_ = conn.Close()

			peerInfo, err := a.ManualConnect(endpoint)
			if err == nil {
				resultsChan <- scanResult{peer: peerInfo, ok: true}
			}
		}(ip)
	}

	wg.Wait()
	close(resultsChan)

	var found []PeerInfo
	for r := range resultsChan {
		if r.ok {
			found = append(found, r.peer)
		}
	}
	return found, nil
}

func (a *App) ExportChatHTML(defaultFilename, htmlContent string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("application is not ready")
	}
	if defaultFilename == "" {
		defaultFilename = fmt.Sprintf("inChat-Audit-%s.html", time.Now().Format("20060102-150405"))
	}
	savePath, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "Export Chat Archive",
		DefaultFilename: defaultFilename,
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "HTML Archive (*.html)", Pattern: "*.html"},
		},
	})
	if err != nil || savePath == "" {
		return "", err
	}
	if err := os.WriteFile(savePath, []byte(htmlContent), 0600); err != nil {
		return "", err
	}
	return savePath, nil
}

func (a *App) SendFileDirect(peerID, name, mimeType, dataBase64 string) error {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." {
		return errors.New("file name cannot be empty")
	}
	decoded, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return errors.New("invalid base64 file data")
	}
	if len(decoded) == 0 {
		return errors.New("cannot send empty file")
	}
	if int64(len(decoded)) > 15*1024*1024 {
		return errors.New("direct file exceeds maximum size (15MB); use chunked transfer for larger files")
	}
	payload, err := json.Marshal(filePayload{
		Name: name,
		Size: int64(len(decoded)),
		MIME: mimeType,
		Data: dataBase64,
	})
	if err != nil {
		return err
	}
	return a.sendEnvelope(peerID, "file", payload)
}

func historyFilePath() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		appData = filepath.Join(home, "AppData", "Roaming")
	}
	dir := filepath.Join(appData, "inChat")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return filepath.Join(dir, "chat_history.json"), nil
}

func (a *App) SaveChatHistory(data string) error {
	path, err := historyFilePath()
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(data), 0600)
}

func (a *App) LoadChatHistory() string {
	path, err := historyFilePath()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

func (a *App) GetAutoStart() bool {
	exePath, err := os.Executable()
	if err != nil {
		return false
	}
	out, err := runPowerShell("(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue).inChat")
	if err != nil || len(bytes.TrimSpace(out)) == 0 {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), strings.ToLower(filepath.Base(exePath)))
}

func (a *App) SetAutoStart(enabled bool) error {
	if enabled {
		exePath, err := os.Executable()
		if err != nil {
			return err
		}
		cmd := fmt.Sprintf("Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'inChat' -Value '\"%s\"'", exePath)
		_, err = runPowerShell(cmd)
		return err
	}
	_, err := runPowerShell("Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'inChat' -ErrorAction SilentlyContinue")
	return err
}

func (a *App) PingPeer(peerID string, ts int64) error {
	payload, _ := json.Marshal(map[string]any{"ts": ts})
	return a.sendEnvelope(peerID, "ping", payload)
}

func (a *App) SendReaction(peerID, messageID, emoji string) error {
	payload, _ := json.Marshal(map[string]string{
		"message_id": messageID,
		"emoji":      emoji,
	})
	return a.sendEnvelope(peerID, "reaction", payload)
}

func (a *App) SendPin(peerID, text string) error {
	payload, _ := json.Marshal(map[string]string{
		"text": text,
	})
	return a.sendEnvelope(peerID, "pin", payload)
}




func (a *App) BeginFileTransfer(peerID, path string) (FileTransferInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return FileTransferInfo{}, err
	}
	if info.IsDir() {
		return FileTransferInfo{}, errors.New("directories are not supported in the MVP")
	}
	if info.Size() <= 0 {
		return FileTransferInfo{}, errors.New("cannot send empty (0-byte) file")
	}
	if info.Size() > maxFileSize {
		return FileTransferInfo{}, fmt.Errorf("file is too large; maximum is %d MB", maxFileSize/(1024*1024))
	}
	hash, err := hashFile(path)
	if err != nil {
		return FileTransferInfo{}, err
	}
	transferID := newID()
	transfer := &outgoingTransfer{PeerID: peerID, Path: path, Name: filepath.Base(path), Size: info.Size(), SHA256: hash, TotalChunks: int((info.Size() + fileChunkSize - 1) / fileChunkSize), CreatedAt: time.Now()}
	payload, _ := json.Marshal(fileOfferPayload{TransferID: transferID, Name: transfer.Name, Size: transfer.Size, SHA256: transfer.SHA256})
	a.mu.Lock()
	a.outgoing[transferID] = transfer
	a.mu.Unlock()
	if err := a.sendEnvelope(peerID, "file-offer", payload); err != nil {
		a.mu.Lock()
		delete(a.outgoing, transferID)
		a.mu.Unlock()
		return FileTransferInfo{}, err
	}
	return FileTransferInfo{TransferID: transferID, Name: transfer.Name, Size: transfer.Size, TotalChunks: transfer.TotalChunks}, nil
}

func hashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (a *App) CancelFileTransfer(transferID string) error {
	a.mu.Lock()
	outgoing := a.outgoing[transferID]
	incoming := a.incoming[transferID]
	a.mu.Unlock()
	if outgoing != nil {
		payload, _ := json.Marshal(fileCancelPayload{TransferID: transferID, Reason: "cancelled by sender"})
		_ = a.sendEnvelope(outgoing.PeerID, "file-cancel", payload)
		a.mu.Lock()
		delete(a.outgoing, transferID)
		a.mu.Unlock()
		return nil
	}
	if incoming != nil {
		incoming.mu.Lock()
		if incoming.File != nil {
			_ = incoming.File.Close()
			incoming.File = nil
		}
		path := incoming.Path
		incoming.mu.Unlock()
		_ = os.Remove(path)
		payload, _ := json.Marshal(fileCancelPayload{TransferID: transferID, Reason: "cancelled by receiver"})
		_ = a.sendEnvelope(incoming.PeerID, "file-cancel", payload)
		a.mu.Lock()
		delete(a.incoming, transferID)
		a.mu.Unlock()
		return nil
	}
	return errors.New("transfer not found")
}

func (a *App) AcceptFileTransfer(transferID string, accept bool) error {
	a.mu.RLock()
	transfer, ok := a.incoming[transferID]
	a.mu.RUnlock()
	if !ok {
		return errors.New("incoming transfer not found")
	}
	if accept {
		transfer.mu.Lock()
		if transfer.File == nil {
			file, err := os.OpenFile(transfer.Path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
			if err != nil {
				transfer.mu.Unlock()
				return err
			}
			transfer.File = file
		}
		transfer.mu.Unlock()
	}
	payload, _ := json.Marshal(fileAcceptedPayload{TransferID: transferID, Accepted: accept})
	if err := a.sendEnvelope(transfer.PeerID, "file-accepted", payload); err != nil {
		return err
	}
	if !accept {
		a.cancelIncomingTransfer(transferID, "rejected by receiver")
	}
	return nil
}

func (a *App) sendFileChunks(transferID string, transfer *outgoingTransfer) error {
	file, err := os.Open(transfer.Path)
	if err != nil {
		return err
	}
	defer file.Close()
	var sent int64
	for index := 0; index < transfer.TotalChunks; index++ {
		a.mu.RLock()
		_, active := a.outgoing[transferID]
		a.mu.RUnlock()
		if !active {
			return nil
		}
		buffer := make([]byte, fileChunkSize)
		n, readErr := io.ReadFull(file, buffer)
		if readErr != nil && readErr != io.ErrUnexpectedEOF && readErr != io.EOF {
			return readErr
		}
		if n == 0 {
			break
		}
		payload, _ := json.Marshal(fileChunkPayload{TransferID: transferID, Index: index, Total: transfer.TotalChunks, Data: base64.StdEncoding.EncodeToString(buffer[:n])})
		if err := a.sendEnvelope(transfer.PeerID, "file-chunk", payload); err != nil {
			return err
		}
		sent += int64(n)
		a.emit("file-progress", map[string]any{"transfer_id": transferID, "peer_id": transfer.PeerID, "sent": sent, "total": transfer.Size, "direction": "sent"})
	}
	payload, _ := json.Marshal(fileCompletePayload{TransferID: transferID, SHA256: transfer.SHA256})
	if err := a.sendEnvelope(transfer.PeerID, "file-complete", payload); err != nil {
		return err
	}
	a.mu.Lock()
	delete(a.outgoing, transferID)
	a.mu.Unlock()
	a.emit("file-complete", map[string]any{"transfer_id": transferID, "peer_id": transfer.PeerID, "name": transfer.Name, "size": transfer.Size, "saved_path": ""})
	return nil
}

func (a *App) LaunchRDP(peerID string) error {
	a.mu.RLock()
	p, ok := a.peers[peerID]
	info := PeerInfo{}
	if ok {
		info = p.info
	}
	a.mu.RUnlock()
	if !ok {
		return fmt.Errorf("peer not found: %s", peerID)
	}
	host, _, err := net.SplitHostPort(info.Address)
	if err != nil {
		host = info.Address
	}
	if !isAllowedLANAddress(host) {
		return errors.New("RDP target is not a valid LAN address")
	}

	dir := filepath.Join(os.TempDir(), "inChat", "rdp")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	file := filepath.Join(dir, "peer-"+peerID+".rdp")
	content := fmt.Sprintf("full address:s:%s\r\nprompt for credentials:i:1\r\nadministrative session:i:0\r\nscreen mode id:i:2\r\ndesktopwidth:i:1280\r\ndesktopheight:i:800\r\n", host)
	if err := os.WriteFile(file, []byte(content), 0600); err != nil {
		return err
	}
	return exec.Command("mstsc.exe", file).Start()
}

func (a *App) PickAndSendFile(peerID string) (FileTransferInfo, error) {
	if a.ctx == nil {
		return FileTransferInfo{}, errors.New("application is not ready")
	}
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title:   "Select a file to send",
		Filters: []wailsruntime.FileFilter{{DisplayName: "All files", Pattern: "*.*"}},
	})
	if err != nil || path == "" {
		return FileTransferInfo{}, err
	}
	return a.BeginFileTransfer(peerID, path)
}

func (a *App) GetDiagnostics() map[string]any {
	a.mu.RLock()
	peerStates := make(map[string]string, len(a.peers))
	peerErrors := make(map[string]string, len(a.peers))
	for id, p := range a.peers {
		peerStates[id] = peerStatus(p.conn, a.connecting[id], p.lastError)
		if p.lastError != "" {
			peerErrors[id] = p.lastError
		}
	}
	recent := append([]string(nil), a.recentErrors...)
	listening := a.listener != nil
	started := a.started
	deviceID := a.identity.ID
	a.mu.RUnlock()

	return map[string]any{
		"protocol":       protocolVer,
		"device_id":      deviceID,
		"listen":         fmt.Sprintf("0.0.0.0:%d", controlPort),
		"listening":      listening,
		"discovery":      fmt.Sprintf("255.255.255.255:%d", discoveryPort),
		"peers":          len(peerStates),
		"peer_states":    peerStates,
		"peer_errors":    peerErrors,
		"recent_errors":  recent,
		"local_ips":      localIPv4Addresses(),
		"started":        started,
		"control_port":   controlPort,
		"discovery_port": discoveryPort,
		"webview":        "Wails WebView2",
	}
}

func (a *App) sendEnvelope(peerID, messageType string, payload json.RawMessage) error {
	a.mu.RLock()
	p, ok := a.peers[peerID]
	conn := (*tls.Conn)(nil)
	var info PeerInfo
	if ok {
		conn = p.conn
		info = p.info
	}
	a.mu.RUnlock()
	if !ok {
		return fmt.Errorf("peer not found: %s", peerID)
	}
	if conn == nil {
		if err := a.connectPeer(info); err != nil {
			return err
		}
		for i := 0; i < 20; i++ {
			a.mu.RLock()
			p, ok = a.peers[peerID]
			if ok {
				conn = p.conn
			}
			a.mu.RUnlock()
			if conn != nil {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	if conn == nil {
		a.mu.RLock()
		lastError := ""
		if p, ok := a.peers[peerID]; ok {
			lastError = p.lastError
		}
		a.mu.RUnlock()
		if lastError != "" {
			return fmt.Errorf("peer is not connected (%s): %s", lastError, peerID)
		}
		return fmt.Errorf("peer is not connected: %s", peerID)
	}

	envelope := envelope{
		Version: protocolVer,
		Type:    messageType,
		ID:      newID(),
		From:    a.identity.ID,
		To:      peerID,
		Payload: payload,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	a.mu.RLock()
	p, ok = a.peers[peerID]
	a.mu.RUnlock()
	if !ok || p == nil {
		return errors.New("peer connection disappeared")
	}
	p.mu.Lock()
	_, err = conn.Write(append(data, '\n'))
	p.mu.Unlock()
	return err
}

func (a *App) dialTLS(address string, config *tls.Config) (*tls.Conn, error) {
	dialer := &net.Dialer{Timeout: connectTimeout}
	rawConn, err := dialer.Dial("tcp4", address)
	if err != nil {
		return nil, err
	}
	conn := tls.Client(rawConn, config)
	if err := conn.SetDeadline(time.Now().Add(connectTimeout)); err != nil {
		_ = conn.Close()
		return nil, err
	}
	if err := conn.Handshake(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

func (a *App) installConnection(info PeerInfo, conn *tls.Conn, initiator string) bool {
	localID := a.identity.ID
	a.mu.Lock()
	existing := a.peers[info.ID]
	hasConnection := existing != nil && existing.conn != nil
	existingInitiator := ""
	if existing != nil {
		existingInitiator = existing.initiator
	}
	if !shouldReplaceConnection(localID, info.ID, existingInitiator, initiator, hasConnection) {
		a.mu.Unlock()
		return false
	}
	if hasConnection {
		_ = existing.conn.Close()
	}
	info.Connected = true
	info.Status = "online"
	info.LastError = ""
	info.LastSeen = time.Now()
	a.peers[info.ID] = &peer{info: info, conn: conn, initiator: initiator, lastAttempt: time.Now()}
	a.mu.Unlock()
	return true
}

func (a *App) connectPeer(info PeerInfo) error {
	a.mu.Lock()
	if _, connecting := a.connecting[info.ID]; connecting {
		a.mu.Unlock()
		return nil
	}
	if p, ok := a.peers[info.ID]; ok && p.conn != nil {
		a.mu.Unlock()
		return nil
	}
	if p, ok := a.peers[info.ID]; ok && p.lastError != "" && time.Since(p.lastAttempt) < peerRetryCooldown {
		a.mu.Unlock()
		return nil
	}
	if p, ok := a.peers[info.ID]; ok {
		p.lastAttempt = time.Now()
	}
	a.connecting[info.ID] = true
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.connecting, info.ID)
		a.mu.Unlock()
	}()

	if info.Address == "" {
		return errors.New("peer has no reachable address")
	}
	verify := func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return errors.New("peer certificate is missing")
		}
		fingerprint := sha256.Sum256(rawCerts[0])
		if !strings.EqualFold(hex.EncodeToString(fingerprint[:]), info.Fingerprint) {
			return errors.New("peer certificate fingerprint does not match discovery record")
		}
		return nil
	}
	conn, err := a.dialTLS(info.Address, &tls.Config{
		InsecureSkipVerify:    true, // certificate is verified against the discovery fingerprint above
		VerifyPeerCertificate: verify,
		Certificates:          []tls.Certificate{a.identity.Certificate},
		MinVersion:            tls.VersionTLS13,
	})
	if err != nil {
		a.recordPeerResult(info.ID, err)
		return err
	}

	authPayload, _ := json.Marshal(map[string]string{
		"id":          a.identity.ID,
		"name":        a.identity.Name,
		"fingerprint": a.identity.Fingerprint,
	})
	if err := conn.SetDeadline(time.Now().Add(authHandshakeWindow)); err != nil {
		_ = conn.Close()
		a.recordPeerResult(info.ID, err)
		return err
	}
	authEnvelope := mustMarshalEnvelope("auth", a.identity.ID, info.ID, authPayload)
	if err := writeLine(conn, authEnvelope); err != nil {
		_ = conn.Close()
		a.recordPeerResult(info.ID, err)
		return err
	}

	reader := bufio.NewReaderSize(conn, 64*1024)
	response, err := readEnvelope(reader)
	if err != nil || response.Type != "auth-ok" || response.From != info.ID {
		_ = conn.Close()
		if err == nil {
			err = errors.New("peer authentication failed")
		}
		a.recordPeerResult(info.ID, err)
		return err
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		_ = conn.Close()
		a.recordPeerResult(info.ID, err)
		return err
	}

	if !a.installConnection(info, conn, a.identity.ID) {
		_ = conn.Close()
		a.recordPeerResult(info.ID, nil)
		return nil
	}
	// recordPeerResult already emits the authoritative "online" snapshot; do
	// not emit the pre-install copy afterwards or the UI would flip back.
	a.recordPeerResult(info.ID, nil)

	if !a.startTracked(func() { a.readLoop(info.ID, conn, reader) }) {
		_ = conn.Close()
		return errors.New("application is shutting down")
	}
	return nil
}

func (a *App) acceptLoop(listener net.Listener) {
	defer a.wg.Done()
	for {
		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-a.stop:
				return
			default:
			}
			continue
		}
		if !a.startTracked(func() { a.handleIncoming(conn.(*tls.Conn)) }) {
			_ = conn.Close()
		}
	}
}

func (a *App) handleIncoming(conn *tls.Conn) {
	defer conn.Close()
	// Bound the authentication exchange so a stalled or firewalled peer cannot
	// hold the handler open forever.
	if err := conn.SetDeadline(time.Now().Add(authHandshakeWindow)); err != nil {
		return
	}
	reader := bufio.NewReaderSize(conn, 64*1024)
	auth, err := readEnvelope(reader)
	if err != nil || auth.Type != "auth" {
		return
	}

	var authData struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Fingerprint string `json:"fingerprint"`
	}
	if json.Unmarshal(auth.Payload, &authData) != nil || authData.ID == "" || authData.Fingerprint == "" {
		return
	}

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return
	}
	fingerprint := sha256.Sum256(state.PeerCertificates[0].Raw)
	if !strings.EqualFold(hex.EncodeToString(fingerprint[:]), authData.Fingerprint) {
		return
	}

	okPayload, _ := json.Marshal(map[string]string{"id": a.identity.ID, "name": a.identity.Name, "fingerprint": a.identity.Fingerprint})
	_ = writeLine(conn, mustMarshalEnvelope("auth-ok", a.identity.ID, authData.ID, okPayload))
	// Clear the authentication deadline: the long-lived readLoop must not
	// inherit it or it would drop the connection as soon as the window expires.
	_ = conn.SetDeadline(time.Time{})

	// Store the peer's control address (host + control port) rather than the
	// ephemeral source port, so reconnects after a drop still work.
	address := conn.RemoteAddr().String()
	if host, _, splitErr := net.SplitHostPort(address); splitErr == nil {
		address = net.JoinHostPort(host, fmt.Sprintf("%d", controlPort))
	}
	info := PeerInfo{
		ID:           authData.ID,
		Name:         authData.Name,
		Address:      address,
		Fingerprint:  authData.Fingerprint,
		Connected:    true,
		LastSeen:     time.Now(),
		Capabilities: []string{"chat", "files", "voice", "video", "screen"},
	}
	// The remote device initiated this connection, so it is the initiator used
	// for deterministic connection election on both sides.
	if !a.installConnection(info, conn, authData.ID) {
		return
	}
	a.recordPeerResult(info.ID, nil)

	a.readLoop(info.ID, conn, reader)
}

func (a *App) readLoop(peerID string, conn *tls.Conn, reader *bufio.Reader) {
	defer func() {
		_ = conn.Close()
		a.mu.Lock()
		if current, ok := a.peers[peerID]; ok && current.conn == conn {
			current.info.Connected = false
			current.conn = nil
			current.info.LastSeen = time.Now()
			// A clean remote close is not an error; let discovery reconnect on
			// the next tick without surfacing a scary failure reason.
			current.lastError = ""
			snapshot := a.peerSnapshotLocked(current)
			a.mu.Unlock()
			a.emitPeer(snapshot)
			return
		}
		a.mu.Unlock()
	}()

	for {
		envelope, err := readEnvelope(reader)
		if err != nil {
			return
		}
		a.handleEnvelope(peerID, envelope)
	}
}

func (a *App) saveReceivedFile(name string, data []byte) (string, error) {
	a.mu.RLock()
	folder := a.settings.ReceiveFolder
	a.mu.RUnlock()
	if err := os.MkdirAll(folder, 0700); err != nil {
		return "", err
	}
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "", errors.New("invalid file name")
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 0; i < 1000; i++ {
		candidate := filepath.Join(folder, name)
		if i > 0 {
			candidate = filepath.Join(folder, fmt.Sprintf("%s (%d)%s", base, i, ext))
		}
		file, err := os.OpenFile(candidate, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if os.IsExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, writeErr := file.Write(data)
		closeErr := file.Close()
		if writeErr != nil {
			_ = os.Remove(candidate)
			return "", writeErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		return candidate, nil
	}
	return "", errors.New("could not allocate a unique file name")
}

func (a *App) createIncomingTransfer(peerID string, offer fileOfferPayload) (*incomingTransfer, error) {
	a.mu.RLock()
	folder := a.settings.ReceiveFolder
	a.mu.RUnlock()
	if err := os.MkdirAll(folder, 0700); err != nil {
		return nil, err
	}
	partPath := filepath.Join(folder, ".inchat-"+offer.TransferID+".part")
	file, err := os.OpenFile(partPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	transfer := &incomingTransfer{PeerID: peerID, Path: partPath, Name: filepath.Base(offer.Name), Size: offer.Size, SHA256: offer.SHA256, TotalChunks: int((offer.Size + fileChunkSize - 1) / fileChunkSize), CreatedAt: time.Now(), File: file}
	a.mu.Lock()
	a.incoming[offer.TransferID] = transfer
	a.mu.Unlock()
	return transfer, nil
}

func (a *App) handleFileOffer(peerID string, payload json.RawMessage) {
	var offer fileOfferPayload
	if json.Unmarshal(payload, &offer) != nil || offer.TransferID == "" || offer.Name == "" || offer.Size <= 0 || offer.Size > maxFileSize {
		return
	}
	a.mu.RLock()
	autoAccept := a.settings.AutoAcceptFiles
	a.mu.RUnlock()
	if _, err := a.createIncomingTransfer(peerID, offer); err != nil {
		a.emitError("file", err)
		return
	}
	a.notify("Incoming file", fmt.Sprintf("%s wants to send %s", peerID, offer.Name))
	if autoAccept {
		_ = a.AcceptFileTransfer(offer.TransferID, true)
		return
	}
	a.emit("file-offer", map[string]any{"transfer_id": offer.TransferID, "peer_id": peerID, "name": offer.Name, "size": offer.Size, "sha256": offer.SHA256})
}

func (a *App) finalizeIncomingTransfer(transferID string) {
	a.mu.Lock()
	transfer, ok := a.incoming[transferID]
	if !ok {
		a.mu.Unlock()
		return
	}
	delete(a.incoming, transferID)
	a.mu.Unlock()
	transfer.mu.Lock()
	if transfer.File != nil {
		_ = transfer.File.Close()
		transfer.File = nil
	}
	transfer.mu.Unlock()
	data, err := os.ReadFile(transfer.Path)
	if err != nil {
		_ = os.Remove(transfer.Path)
		a.emitError("file", err)
		return
	}
	hash := sha256.Sum256(data)
	if int64(len(data)) != transfer.Size || !strings.EqualFold(hex.EncodeToString(hash[:]), transfer.SHA256) {
		_ = os.Remove(transfer.Path)
		a.emitError("file", errors.New("received file failed integrity verification"))
		return
	}
	savedPath, err := a.saveReceivedFile(transfer.Name, data)
	_ = os.Remove(transfer.Path)
	if err != nil {
		a.emitError("file", err)
		return
	}
	a.emit("file-complete", map[string]any{"transfer_id": transferID, "peer_id": transfer.PeerID, "name": transfer.Name, "size": transfer.Size, "saved_path": savedPath})
}

func (a *App) cancelIncomingTransfer(transferID, reason string) {
	a.mu.Lock()
	transfer, ok := a.incoming[transferID]
	if ok {
		delete(a.incoming, transferID)
	}
	a.mu.Unlock()
	if !ok {
		return
	}
	transfer.mu.Lock()
	if transfer.File != nil {
		_ = transfer.File.Close()
		transfer.File = nil
	}
	transfer.mu.Unlock()
	_ = os.Remove(transfer.Path)
	a.emit("file-cancelled", map[string]any{"transfer_id": transferID, "peer_id": transfer.PeerID, "reason": reason})
}

func (a *App) handleEnvelope(peerID string, message envelope) {
	a.mu.Lock()
	if p, ok := a.peers[peerID]; ok {
		p.info.LastSeen = time.Now()
	}
	a.mu.Unlock()

	switch message.Type {
	case "chat":
		if len(message.Payload) > 64*1024 {
			return
		}
		var text string
		if json.Unmarshal(message.Payload, &text) == nil {
			a.mu.RLock()
			name := "peer"
			if p, ok := a.peers[peerID]; ok {
				name = p.info.Name
			}
			a.mu.RUnlock()
			a.notify("New inChat message", fmt.Sprintf("%s: %s", name, text))
			a.emit("message", map[string]any{"peer_id": peerID, "text": text, "id": message.ID})
			ackPayload, _ := json.Marshal(map[string]string{"id": message.ID})
			_ = a.sendEnvelope(peerID, "chat-ack", ackPayload)
		}
	case "chat-ack":
		var ack struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(message.Payload, &ack) == nil && ack.ID != "" {
			a.emit("chat-ack", map[string]any{"peer_id": peerID, "id": ack.ID})
		}
	case "ping":
		_ = a.sendEnvelope(peerID, "pong", message.Payload)
	case "pong":
		var pingData map[string]any
		if json.Unmarshal(message.Payload, &pingData) == nil {
			a.emit("pong", map[string]any{"peer_id": peerID, "data": pingData})
		}
	case "reaction":
		var reaction struct {
			MessageID string `json:"message_id"`
			Emoji     string `json:"emoji"`
		}
		if json.Unmarshal(message.Payload, &reaction) == nil && reaction.MessageID != "" && reaction.Emoji != "" {
			a.emit("reaction", map[string]any{
				"peer_id":    peerID,
				"message_id": reaction.MessageID,
				"emoji":      reaction.Emoji,
			})
		}
	case "pin":
		var pinData struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(message.Payload, &pinData) == nil {
			a.emit("pin", map[string]any{
				"peer_id": peerID,
				"text":    pinData.Text,
			})
		}
	case "channel-chat":
		if len(message.Payload) > 64*1024 {
			return
		}
		var chPayload struct {
			Channel string `json:"channel"`
			Text    string `json:"text"`
			Name    string `json:"name"`
		}
		if json.Unmarshal(message.Payload, &chPayload) == nil && chPayload.Channel != "" {
			senderName := chPayload.Name
			if senderName == "" {
				a.mu.RLock()
				if p, ok := a.peers[peerID]; ok {
					senderName = p.info.Name
				}
				a.mu.RUnlock()
			}
			a.notify(chPayload.Channel, fmt.Sprintf("%s: %s", senderName, chPayload.Text))
			a.emit("channel-message", map[string]any{
				"id":      message.ID,
				"peer_id": peerID,
				"channel": chPayload.Channel,
				"name":    senderName,
				"text":    chPayload.Text,
			})
		}
	case "group-chat":
		if len(message.Payload) > 64*1024 {
			return
		}
		var payload struct {
			Text string `json:"text"`
			Name string `json:"name"`
		}
		if json.Unmarshal(message.Payload, &payload) == nil {
			senderName := payload.Name
			if senderName == "" {
				a.mu.RLock()
				if p, ok := a.peers[peerID]; ok {
					senderName = p.info.Name
				}
				a.mu.RUnlock()
			}
			a.notify("LAN Group Room", fmt.Sprintf("%s: %s", senderName, payload.Text))
			a.emit("group-message", map[string]any{
				"peer_id": peerID,
				"name":    senderName,
				"text":    payload.Text,
				"id":      message.ID,
			})
		}
	case "signal":
		if len(message.Payload) > 2*1024*1024 {
			return
		}
		var signal signalPayload
		if json.Unmarshal(message.Payload, &signal) == nil {
			a.emit("signal", map[string]any{"peer_id": peerID, "kind": signal.Kind, "data": signal.Data})
		}
	case "file-offer":
		a.handleFileOffer(peerID, message.Payload)
	case "file-accepted":
		var accepted fileAcceptedPayload
		if json.Unmarshal(message.Payload, &accepted) != nil {
			return
		}
		a.mu.Lock()
		transfer := a.outgoing[accepted.TransferID]
		if !accepted.Accepted {
			delete(a.outgoing, accepted.TransferID)
		}
		a.mu.Unlock()
		if !accepted.Accepted {
			a.emit("file-cancelled", map[string]any{"transfer_id": accepted.TransferID, "peer_id": peerID, "reason": "rejected by receiver"})
		}
		if accepted.Accepted && transfer != nil {
			if !a.startTracked(func() {
				if err := a.sendFileChunks(accepted.TransferID, transfer); err != nil {
					a.emitError("file", err)
				}
			}) {
				return
			}
		}
	case "file-chunk":
		var chunk fileChunkPayload
		if json.Unmarshal(message.Payload, &chunk) != nil {
			return
		}
		a.mu.RLock()
		transfer := a.incoming[chunk.TransferID]
		a.mu.RUnlock()
		if transfer == nil {
			return
		}
		decoded, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil || len(decoded) == 0 || len(decoded) > fileChunkSize {
			return
		}
		transfer.mu.Lock()
		if transfer.File == nil || int64(len(decoded))+transfer.Received > transfer.Size {
			transfer.mu.Unlock()
			return
		}
		_, err = transfer.File.Write(decoded)
		transfer.Received += int64(len(decoded))
		received := transfer.Received
		transfer.mu.Unlock()
		if err == nil {
			a.emit("file-progress", map[string]any{"transfer_id": chunk.TransferID, "peer_id": peerID, "sent": received, "total": transfer.Size, "direction": "received"})
		}
	case "file-complete":
		var complete fileCompletePayload
		if json.Unmarshal(message.Payload, &complete) == nil {
			a.finalizeIncomingTransfer(complete.TransferID)
		}
	case "file-cancel":
		var cancel fileCancelPayload
		if json.Unmarshal(message.Payload, &cancel) == nil {
			a.cancelIncomingTransfer(cancel.TransferID, cancel.Reason)
			a.mu.Lock()
			delete(a.outgoing, cancel.TransferID)
			a.mu.Unlock()
		}
	case "file":
		var file filePayload
		if json.Unmarshal(message.Payload, &file) != nil || file.Name == "" || file.Size < 0 || file.Size > maxFileSize {
			return
		}
		decoded, err := base64.StdEncoding.DecodeString(file.Data)
		if err != nil || int64(len(decoded)) != file.Size {
			return
		}
		a.mu.RLock()
		autoAccept := a.settings.AutoAcceptFiles
		a.mu.RUnlock()
		if autoAccept {
			savedPath, saveErr := a.saveReceivedFile(file.Name, decoded)
			if saveErr != nil {
				a.emitError("file", saveErr)
				return
			}
			a.emit("file", map[string]any{"peer_id": peerID, "name": filepath.Base(file.Name), "size": file.Size, "saved_path": savedPath, "mime": file.MIME, "data": file.Data})
			return
		}
		a.emit("file", map[string]any{"peer_id": peerID, "name": filepath.Base(file.Name), "size": file.Size, "mime": file.MIME, "data": file.Data})
	}
}

func (a *App) currentDiscoveryHello() discoveryHello {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return discoveryHello{
		Version:      protocolVer,
		ID:           a.identity.ID,
		Name:         a.identity.Name,
		Addresses:    localIPv4Addresses(),
		Port:         controlPort,
		Fingerprint:  a.identity.Fingerprint,
		Capabilities: []string{"chat", "files", "voice", "video", "screen"},
	}
}

func (a *App) discoveryLoop() {
	defer a.wg.Done()
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{Port: discoveryPort})
	if err != nil {
		a.emitError("discovery", err)
		return
	}
	defer conn.Close()

	if !a.startTracked(func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-a.stop:
				return
			case <-ticker.C:
				payload, _ := json.Marshal(a.currentDiscoveryHello())
				msg := append(payload, '\n')
				_, _ = conn.WriteTo(msg, &net.UDPAddr{IP: net.IPv4bcast, Port: discoveryPort})
				for _, bcast := range localBroadcastAddresses() {
					if !bcast.Equal(net.IPv4bcast) {
						_, _ = conn.WriteTo(msg, &net.UDPAddr{IP: bcast, Port: discoveryPort})
					}
				}
			}
		}
	}) {
		return
	}

	buffer := make([]byte, 8192)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		n, sender, err := conn.ReadFromUDP(buffer)
		if err != nil {
			select {
			case <-a.stop:
				return
			default:
				continue
			}
		}
		var received discoveryHello
		if json.Unmarshal(buffer[:n], &received) != nil || received.ID == a.identity.ID {
			continue
		}
		if received.Version != protocolVer || received.ID == "" || received.Fingerprint == "" || received.Port != controlPort {
			continue
		}
		address := sender.IP.String()
		if !isAllowedLANAddress(address) {
			address = firstReachableAddress(received.Addresses)
		}
		if address == "" || !isAllowedLANAddress(address) {
			continue
		}
		info := PeerInfo{
			ID:           received.ID,
			Name:         received.Name,
			Address:      net.JoinHostPort(address, fmt.Sprintf("%d", received.Port)),
			Fingerprint:  received.Fingerprint,
			LastSeen:     time.Now(),
			Capabilities: received.Capabilities,
		}
		// Update the existing peer record in place so connection state,
		// initiator, retry cooldown and last error survive each discovery tick.
		a.mu.Lock()
		existing, exists := a.peers[info.ID]
		if !exists {
			existing = &peer{}
			a.peers[info.ID] = existing
		}
		wasConnected := existing.conn != nil
		info.Connected = wasConnected
		info.Status = peerStatus(existing.conn, a.connecting[info.ID], existing.lastError)
		info.LastError = existing.lastError
		existing.info = info
		snapshot := a.peerSnapshotLocked(existing)
		a.mu.Unlock()

		a.emitPeer(snapshot)
		if !snapshot.Connected {
			if !a.startTracked(func() {
				_ = a.connectPeer(snapshot)
			}) {
				return
			}
		}
	}
}

// CheckFirewall reports whether Windows Firewall currently allows inbound LAN
// traffic for inChat (discovery UDP45450 / control TCP45451) and lists the
// active network profile so the user can compare it against the rules.
func (a *App) CheckFirewall() map[string]any {
	result := map[string]any{
		"available": false,
		"allowed":   false,
		"port":      controlPort,
		"udp_port":  discoveryPort,
		"exe":       "",
		"message":   "",
	}
	exe, err := os.Executable()
	if err == nil {
		result["exe"] = exe
	}
	script := firewallStatusScript(exe)
	output, err := runPowerShell(script)
	if err != nil {
		result["message"] = fmt.Sprintf("could not query Windows Firewall: %s", firstLine(output, err))
		return result
	}
	var parsed struct {
		Allowed  bool     `json:"allowed"`
		Profiles []string `json:"profiles"`
		Rules    []struct {
			Name    string `json:"name"`
			Enabled bool   `json:"enabled"`
		} `json:"rules"`
	}
	if json.Unmarshal(output, &parsed) != nil {
		result["message"] = fmt.Sprintf("unexpected firewall query output: %s", firstLine(output, nil))
		return result
	}
	result["available"] = true
	result["allowed"] = parsed.Allowed
	result["profiles"] = parsed.Profiles
	result["rules"] = parsed.Rules
	if parsed.Allowed {
		result["message"] = "Windows Firewall is allowing inChat."
	} else {
		result["message"] = fmt.Sprintf("Windows Firewall is missing an inbound allow rule for UDP %d and TCP %d. Peers will be discovered but cannot connect.", discoveryPort, controlPort)
	}
	return result
}

// AllowFirewall adds the two inbound allow rules. Windows requires elevation,
// so this triggers the standard UAC prompt; cancelling it is reported back to
// the UI instead of failing silently.
func (a *App) AllowFirewall() (map[string]any, error) {
	script := firewallAllowScript()
	if err := runPowerShellElevated(script); err != nil {
		return a.CheckFirewall(), fmt.Errorf("Windows Firewall access was not granted: %w", err)
	}
	return a.CheckFirewall(), nil
}

// OpenFirewallSettings opens the built-in Windows Firewall control panel so
// the user can review or change rules manually.
func (a *App) OpenFirewallSettings() error {
	return exec.Command("control.exe", "firewall.cpl").Start()
}

const firewallScriptHeader = `
$ErrorActionPreference = 'SilentlyContinue'
$names = @('inChat Discovery','inChat Control')
$rules = @()
foreach ($n in $names) {
  foreach ($r in @(Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue)) {
    $rules += [pscustomobject]@{ name = [string]$r.DisplayName; enabled = [bool]$r.Enabled }
  }
}
`

func firewallStatusScript(exe string) string {
	exeLiteral := strings.ReplaceAll(exe, "'", "''")
	return firewallScriptHeader + fmt.Sprintf(`
$exe = '%s'
foreach ($r in @(Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | ForEach-Object { $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue })) {
  if ($r.Direction.ToString() -eq 'Inbound' -and $r.Action.ToString() -eq 'Allow' -and [bool]$r.Enabled) {
    $rules += [pscustomobject]@{ name = [string]$r.DisplayName; enabled = [bool]$r.Enabled }
  }
}
$profiles = @()
foreach ($p in @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)) { $profiles += [string]$p.NetworkCategory }
$needed = @('inChat Discovery','inChat Control')
$allowed = $true
foreach ($n in $needed) {
  $found = $false
  foreach ($r in $rules) { if ($r.name -eq $n -and $r.enabled) { $found = $true } }
  if (-not $found) { $allowed = $false }
}
[pscustomobject]@{ allowed = [bool]$allowed; profiles = $profiles; rules = $rules } | ConvertTo-Json -Depth 6 -Compress
`, exeLiteral)
}

func firewallAllowScript() string {
	return firewallScriptHeader + `
$created = @()
foreach ($pair in @(
  @{ n = 'inChat Discovery'; p = 'UDP'; port = 45450 },
  @{ n = 'inChat Control';   p = 'TCP'; port = 45451 }
)) {
  Get-NetFirewallRule -DisplayName $pair.n -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  $rule = New-NetFirewallRule -DisplayName $pair.n -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol $pair.p -LocalPort $pair.port
  $created += [string]$rule.DisplayName
}
Write-Output ('OK ' + ($created -join ', '))
`
}

// encodePowerShellCommand encodes a PowerShell script or command to base64 UTF-16LE,
// which is strictly required by powershell.exe -EncodedCommand.
func encodePowerShellCommand(command string) string {
	u16 := utf16.Encode([]rune(command))
	buf := make([]byte, len(u16)*2)
	for i, r := range u16 {
		buf[i*2] = byte(r)
		buf[i*2+1] = byte(r >> 8)
	}
	return base64.StdEncoding.EncodeToString(buf)
}

// runPowerShell executes a script with the signed-in user's privileges and
// returns combined output.
func runPowerShell(script string) ([]byte, error) {
	encoded := encodePowerShellCommand(script)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded)
	return cmd.CombinedOutput()
}

// runPowerShellElevated runs the script through UAC elevation. The temp script
// is written with restrictive permissions and removed afterwards.
func runPowerShellElevated(script string) error {
	file, err := os.CreateTemp(os.TempDir(), "inchat-firewall-*.ps1")
	if err != nil {
		return err
	}
	path := file.Name()
	defer os.Remove(path)
	if _, err := file.WriteString(script); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}

	// Re-launch the script elevated: Start-Process -Verb RunAs is what shows
	// the standard Windows UAC consent prompt.
	command := fmt.Sprintf("Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','%s' -Verb RunAs -Wait -PassThru | ForEach-Object { $_.ExitCode }", strings.ReplaceAll(path, "'", "''"))
	encoded := encodePowerShellCommand(command)
	output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", firstLine(output, err))
	}
	if code := strings.TrimSpace(string(output)); code != "" && code != "0" {
		return fmt.Errorf("firewall helper exited with code %s", code)
	}
	return nil
}

func firstLine(output []byte, fallback error) error {
	line := strings.TrimSpace(string(output))
	if line == "" {
		if fallback != nil {
			return fallback
		}
		return errors.New("no output")
	}
	if index := strings.IndexByte(line, '\n'); index > 0 {
		line = strings.TrimSpace(line[:index])
	}
	return errors.New(line)
}

func (a *App) emitPeer(info PeerInfo) {
	a.emit("peer", info)
}

func (a *App) emitError(component string, err error) {
	a.emit("error", map[string]string{"component": component, "message": err.Error()})
}

func (a *App) emit(event string, data any) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, event, data)
}

func (a *App) startTracked(fn func()) bool {
	a.mu.Lock()
	if !a.started {
		a.mu.Unlock()
		return false
	}
	a.wg.Add(1)
	a.mu.Unlock()
	go func() {
		defer a.wg.Done()
		fn()
	}()
	return true
}

// mustMarshalEnvelope returns a single JSON envelope WITHOUT a trailing
// newline. writeLine is responsible for framing the newline exactly once.
// Appending it here as well previously produced a stray blank line after every
// authentication frame, which made the peer's readLoop fail instantly and drop
// the connection right after the handshake ("connecting" forever).
func mustMarshalEnvelope(messageType, from, to string, payload []byte) []byte {
	value, _ := json.Marshal(envelope{Version: protocolVer, Type: messageType, ID: newID(), From: from, To: to, Payload: payload})
	return value
}

func writeLine(conn net.Conn, data []byte) error {
	_, err := conn.Write(append(data, '\n'))
	return err
}

func readEnvelope(reader *bufio.Reader) (envelope, error) {
	for {
		var data []byte
		for {
			fragment, err := reader.ReadSlice('\n')
			if len(data)+len(fragment) > maxFrameSize {
				return envelope{}, errors.New("control frame is too large")
			}
			data = append(data, fragment...)
			if err == bufio.ErrBufferFull {
				continue
			}
			if err != nil {
				return envelope{}, err
			}
			break
		}

		// Tolerate blank/whitespace-only frames instead of tearing down the
		// connection: a legacy peer may still emit an extra newline.
		if len(bytes.TrimSpace(data)) == 0 {
			continue
		}

		var value envelope
		if err := json.Unmarshal(data, &value); err != nil {
			return envelope{}, err
		}
		if value.Version != protocolVer {
			return envelope{}, errors.New("unsupported protocol version")
		}
		if value.From == "" || value.To == "" || value.Type == "" {
			return envelope{}, errors.New("control envelope is incomplete")
		}
		return value, nil
	}
}
func newID() string {
	data := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, data); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return base64.RawURLEncoding.EncodeToString(data)
}

func localIPv4Addresses() []string {
	result := make([]string, 0)
	interfaces, err := net.Interfaces()
	if err != nil {
		return result
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			ipNet, ok := address.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip != nil {
				result = append(result, ip.String())
			}
		}
	}
	return result
}

func firstReachableAddress(addresses []string) string {
	for _, address := range addresses {
		if ip := net.ParseIP(address); ip != nil && isAllowedLANAddress(address) {
			return address
		}
	}
	return ""
}

func localBroadcastAddresses() []net.IP {
	var list []net.IP
	seen := make(map[string]bool)

	interfaces, err := net.Interfaces()
	if err != nil {
		return list
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil {
				continue
			}
			mask := ipNet.Mask
			if len(mask) == 4 {
				bcast := make(net.IP, 4)
				for i := 0; i < 4; i++ {
					bcast[i] = ip[i] | ^mask[i]
				}
				key := bcast.String()
				if !seen[key] {
					seen[key] = true
					list = append(list, bcast)
				}
			}
		}
	}
	return list
}

func isAllowedLANAddress(address string) bool {
	ip := net.ParseIP(address)
	if ip == nil {
		return false
	}
	if ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLoopback() {
		return true
	}
	// Support RFC 6598 Carrier-Grade NAT (100.64.0.0/10), commonly used in
	// corporate intranet, enterprise VPNs, Tailscale, ZeroTier, and SD-WAN networks.
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && (ip4[1]&0xC0) == 64 {
			return true
		}
	}
	return false
}
