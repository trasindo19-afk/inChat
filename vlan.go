package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

type VLANScanResult struct {
	ScannedSubnets    []string   `json:"scannedSubnets"`
	ResponsiveSubnets []string   `json:"responsiveSubnets"`
	FoundPeers        []PeerInfo `json:"foundPeers"`
	TotalScanned      int        `json:"totalScanned"`
}

// GetCandidateVLANs returns a list of candidate enterprise VLAN subnets
// based on local network interfaces and known/common corporate VLAN schemes.
func (a *App) GetCandidateVLANs() []string {
	seen := make(map[string]bool)
	var list []string

	add := func(cidr string) {
		cidr = strings.TrimSpace(cidr)
		if cidr != "" && !seen[cidr] {
			seen[cidr] = true
			list = append(list, cidr)
		}
	}

	// 1. Configured known subnets in settings
	a.mu.RLock()
	for _, s := range a.settings.KnownSubnets {
		add(s)
	}
	a.mu.RUnlock()

	// 2. Discover from local network interfaces
	localIPs := localIPv4Addresses()
	for _, ipStr := range localIPs {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		ip4 := ip.To4()
		if ip4 == nil {
			continue
		}

		// Always add the current interface's /24 subnet
		add(fmt.Sprintf("%d.%d.%d.0/24", ip4[0], ip4[1], ip4[2]))

		// Standard Indonesian & corporate enterprise VLAN configurations
		if ip4[0] == 192 && ip4[1] == 168 {
			// Typical office VLAN IDs: 1, 2, 10, 20, 23 (Wi-Fi), 30, 40, 50, 51 (Switch), 100
			commonVLANs := []int{1, 2, 10, 20, 23, 30, 40, 50, 51, 60, 70, 80, 100}
			for _, vlan := range commonVLANs {
				add(fmt.Sprintf("192.168.%d.0/24", vlan))
			}
		} else if ip4[0] == 10 {
			// Class A enterprise subnets (10.x.VLAN.0/24)
			commonVLANs := []int{0, 1, 2, 10, 20, 23, 30, 40, 50, 51, 100}
			for _, vlan := range commonVLANs {
				add(fmt.Sprintf("10.%d.%d.0/24", ip4[1], vlan))
			}
		} else if ip4[0] == 172 && (ip4[1] >= 16 && ip4[1] <= 31) {
			commonVLANs := []int{0, 1, 10, 20, 23, 50, 51, 100}
			for _, vlan := range commonVLANs {
				add(fmt.Sprintf("%d.%d.%d.0/24", ip4[0], ip4[1], vlan))
			}
		}
	}

	return list
}

// GetResponsiveVLANs returns any subnets currently saved as responsive.
func (a *App) GetResponsiveVLANs() []string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	res := make([]string, len(a.settings.KnownSubnets))
	copy(res, a.settings.KnownSubnets)
	return res
}

// SetKnownSubnets updates and persists the list of target VLAN subnets.
func (a *App) SetKnownSubnets(subnets []string) error {
	a.mu.Lock()
	a.settings.KnownSubnets = cleanSubnetsList(subnets)
	err := saveSettings(a.settings)
	a.mu.Unlock()
	return err
}

// ScanAllVLANs probes candidate or user-specified VLAN subnets, establishes
// connections with responding peers, auto-saves responsive VLANs, and returns a summary report.
func (a *App) ScanAllVLANs(userSubnets []string) (VLANScanResult, error) {
	targets := cleanSubnetsList(userSubnets)
	if len(targets) == 0 {
		targets = a.GetCandidateVLANs()
	}
	if len(targets) == 0 {
		return VLANScanResult{}, errors.New("no VLAN subnets to scan")
	}

	// Bound to at most 16 subnets per scan run to prevent flooding
	if len(targets) > 16 {
		targets = targets[:16]
	}

	localIPs := make(map[string]bool)
	for _, ip := range localIPv4Addresses() {
		localIPs[ip] = true
	}

	type ipTarget struct {
		ip     string
		subnet string
	}
	var probeList []ipTarget
	for _, subnet := range targets {
		ips := generateSubnetIPs(subnet)
		for _, ip := range ips {
			if !localIPs[ip] {
				probeList = append(probeList, ipTarget{ip: ip, subnet: subnet})
			}
		}
	}

	result := VLANScanResult{
		ScannedSubnets: targets,
		TotalScanned:   len(probeList),
	}

	if len(probeList) == 0 {
		return result, nil
	}

	type hitResult struct {
		peer   PeerInfo
		subnet string
	}
	hitChan := make(chan hitResult, len(probeList))
	sem := make(chan struct{}, 80) // 80 concurrent workers for rapid multi-VLAN scanning

	var wg sync.WaitGroup
	for _, target := range probeList {
		wg.Add(1)
		go func(t ipTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			endpoint := net.JoinHostPort(t.ip, fmt.Sprintf("%d", controlPort))
			conn, err := net.DialTimeout("tcp4", endpoint, 300*time.Millisecond)
			if err != nil {
				return
			}
			_ = conn.Close()

			peerInfo, err := a.ManualConnect(endpoint)
			if err == nil {
				hitChan <- hitResult{peer: peerInfo, subnet: t.subnet}
			}
		}(target)
	}

	wg.Wait()
	close(hitChan)

	responsiveMap := make(map[string]bool)
	var foundPeers []PeerInfo
	peerSeen := make(map[string]bool)

	for hit := range hitChan {
		responsiveMap[hit.subnet] = true
		if !peerSeen[hit.peer.ID] {
			peerSeen[hit.peer.ID] = true
			foundPeers = append(foundPeers, hit.peer)
		}
	}

	for subnet := range responsiveMap {
		result.ResponsiveSubnets = append(result.ResponsiveSubnets, subnet)
	}
	result.FoundPeers = foundPeers

	// Auto-fill and persist responsive VLANs into settings
	if len(result.ResponsiveSubnets) > 0 {
		a.mu.Lock()
		existingMap := make(map[string]bool)
		for _, s := range a.settings.KnownSubnets {
			existingMap[s] = true
		}
		for _, s := range result.ResponsiveSubnets {
			if !existingMap[s] {
				a.settings.KnownSubnets = append(a.settings.KnownSubnets, s)
				existingMap[s] = true
			}
		}
		_ = saveSettings(a.settings)
		a.mu.Unlock()
	}

	return result, nil
}

func cleanSubnetsList(inputs []string) []string {
	var out []string
	seen := make(map[string]bool)
	for _, item := range inputs {
		for _, part := range strings.Split(item, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if !strings.Contains(part, "/") {
				if strings.Count(part, ".") == 2 {
					part = part + ".0/24"
				} else if strings.Count(part, ".") == 3 {
					// Single IP or base .0
					ip := net.ParseIP(part)
					if ip != nil && ip.To4() != nil {
						ip4 := ip.To4()
						part = fmt.Sprintf("%d.%d.%d.0/24", ip4[0], ip4[1], ip4[2])
					}
				}
			}
			if _, _, err := net.ParseCIDR(part); err == nil && !seen[part] {
				seen[part] = true
				out = append(out, part)
			}
		}
	}
	return out
}

func generateSubnetIPs(target string) []string {
	target = strings.TrimSpace(target)
	if strings.Contains(target, "/") {
		ip, ipnet, err := net.ParseCIDR(target)
		if err != nil {
			return nil
		}
		var ips []string
		for curr := ip.Mask(ipnet.Mask); ipnet.Contains(curr); incIP(curr) {
			curr4 := curr.To4()
			if curr4 != nil && curr4[3] != 0 && curr4[3] != 255 {
				ips = append(ips, curr4.String())
			}
		}
		return ips
	}
	if strings.Count(target, ".") == 3 {
		return []string{target}
	}
	if strings.Count(target, ".") == 2 {
		var ips []string
		for i := 1; i <= 254; i++ {
			ips = append(ips, fmt.Sprintf("%s.%d", target, i))
		}
		return ips
	}
	return nil
}

// sendPeerExchange broadcasts known connected peer addresses to another peer
// for automatic cross-VLAN gossip discovery.
func (a *App) sendPeerExchange(peerID string) {
	a.mu.RLock()
	var list []map[string]string
	for id, p := range a.peers {
		if p.conn != nil && id != peerID && p.info.Address != "" {
			list = append(list, map[string]string{
				"id":      id,
				"name":    p.info.Name,
				"address": p.info.Address,
			})
		}
	}
	a.mu.RUnlock()
	if len(list) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]any{"peers": list})
	_ = a.sendEnvelope(peerID, "peer-exchange", payload)
}
