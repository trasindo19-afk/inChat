package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"strings"
)

const networkAvatarSize = 128

// networkAvatar returns a small (128x128 JPEG) data URL of the local profile
// photo that is cheap to send to every peer. Returns "" when there is no
// photo or it cannot be decoded (e.g. WebP).
func (a *App) networkAvatar() string {
	a.mu.RLock()
	src := a.settings.AvatarData
	a.mu.RUnlock()
	if src == "" {
		return ""
	}
	comma := strings.Index(src, ",")
	if comma < 0 {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(src[comma+1:])
	if err != nil {
		return ""
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		// Unknown format: only forward it as-is when it is already small.
		if len(raw) <= 128*1024 {
			return src
		}
		return ""
	}
	small := squareThumbnail(img, networkAvatarSize)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, small, &jpeg.Options{Quality: 82}); err != nil {
		return ""
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

// squareThumbnail center-crops img to a square and box-filters it to size x size.
func squareThumbnail(img image.Image, size int) image.Image {
	b := img.Bounds()
	side := b.Dx()
	if b.Dy() < side {
		side = b.Dy()
	}
	x0 := b.Min.X + (b.Dx()-side)/2
	y0 := b.Min.Y + (b.Dy()-side)/2
	out := image.NewRGBA(image.Rect(0, 0, size, size))
	// White background so transparent PNGs look right as JPEG.
	draw.Draw(out, out.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	for y := 0; y < size; y++ {
		sy0 := y0 + y*side/size
		sy1 := y0 + (y+1)*side/size
		if sy1 <= sy0 {
			sy1 = sy0 + 1
		}
		for x := 0; x < size; x++ {
			sx0 := x0 + x*side/size
			sx1 := x0 + (x+1)*side/size
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}
			var r, g, bl, n uint64
			for yy := sy0; yy < sy1; yy++ {
				for xx := sx0; xx < sx1; xx++ {
					cr, cg, cb, ca := img.At(xx, yy).RGBA()
					// Composite over white.
					r += uint64(cr + (0xffff - ca))
					g += uint64(cg + (0xffff - ca))
					bl += uint64(cb + (0xffff - ca))
					n++
				}
			}
			out.SetRGBA(x, y, color.RGBA{uint8(r / n >> 8), uint8(g / n >> 8), uint8(bl / n >> 8), 255})
		}
	}
	return out
}

// sendAvatar pushes the local profile photo to one peer.
func (a *App) sendAvatar(peerID string) {
	data := a.networkAvatar()
	if data == "" {
		return
	}
	payload, _ := json.Marshal(map[string]string{"data": data})
	_ = a.sendEnvelope(peerID, "avatar", payload)
}

// broadcastAvatar pushes the local profile photo to every connected peer.
func (a *App) broadcastAvatar() {
	a.mu.RLock()
	ids := make([]string, 0, len(a.peers))
	for id, p := range a.peers {
		if p.conn != nil {
			ids = append(ids, id)
		}
	}
	a.mu.RUnlock()
	for _, id := range ids {
		a.sendAvatar(id)
	}
}

// RequestAvatar asks a connected peer for their profile photo.
func (a *App) RequestAvatar(peerID string) {
	_ = a.sendEnvelope(peerID, "get-avatar", nil)
}

// SendChannelInvite invites a connected peer to a department room. The
// passphrase travels inside the already-encrypted, authenticated TLS link.
func (a *App) SendChannelInvite(peerID, channel, passphrase string) error {
	channel = strings.TrimSpace(channel)
	if channel == "" || len([]rune(channel)) > 40 {
		return errors.New("invalid room name")
	}
	payload, _ := json.Marshal(map[string]string{
		"channel":    channel,
		"passphrase": passphrase,
		"from_name":  a.identity.Name,
		"creator":    a.identity.ID,
	})
	return a.sendEnvelope(peerID, "channel-invite", payload)
}
