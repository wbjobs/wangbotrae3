package gossip

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

type NodeStatus string

const (
	NodeAlive     NodeStatus = "alive"
	NodeSuspected NodeStatus = "suspected"
	NodeDead      NodeStatus = "dead"
)

type Node struct {
	ID         string     `json:"id"`
	Address    string     `json:"address"`
	LastSeen   time.Time  `json:"last_seen"`
	HTTPAddr   string     `json:"http_addr"`
	Status     NodeStatus `json:"status"`
}

type Membership struct {
	self           *Node
	nodes          map[string]*Node
	mutex          sync.RWMutex
	gossipAddr     string
	httpAddr       string
	interval       time.Duration
	stopChan       chan struct{}
	failureTimeout time.Duration
	onNodeFailure  func(node *Node)
}

type GossipMessage struct {
	Type    string  `json:"type"`
	Nodes   []*Node `json:"nodes"`
	Sender  string  `json:"sender"`
}

func NewMembership(nodeID, gossipAddr, httpAddr string, interval time.Duration) *Membership {
	return &Membership{
		self: &Node{
			ID:       nodeID,
			Address:  gossipAddr,
			LastSeen: time.Now(),
			HTTPAddr: httpAddr,
			Status:   NodeAlive,
		},
		nodes:          make(map[string]*Node),
		gossipAddr:     gossipAddr,
		httpAddr:       httpAddr,
		interval:       interval,
		stopChan:       make(chan struct{}),
		failureTimeout: 10 * time.Second,
	}
}

func (m *Membership) SetOnNodeFailure(callback func(node *Node)) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	m.onNodeFailure = callback
}

func (m *Membership) SetFailureTimeout(timeout time.Duration) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	m.failureTimeout = timeout
}

func (m *Membership) Start() error {
	http.HandleFunc("/gossip", m.handleGossip)

	go m.startGossiping()
	go m.startFailureDetector()

	return nil
}

func (m *Membership) Stop() {
	close(m.stopChan)
}

func (m *Membership) handleGossip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var msg GossipMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	m.mutex.Lock()
	for _, node := range msg.Nodes {
		if node.ID != m.self.ID {
			if existing, ok := m.nodes[node.ID]; ok {
				if node.LastSeen.After(existing.LastSeen) {
					if existing.Status == NodeDead && node.Status == NodeAlive {
						node.Status = NodeAlive
					} else {
						node.Status = existing.Status
					}
					m.nodes[node.ID] = node
				}
			} else {
				m.nodes[node.ID] = node
			}
		}
	}
	m.mutex.Unlock()

	response := GossipMessage{
		Type:   "response",
		Nodes:  m.getNodeList(),
		Sender: m.self.ID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (m *Membership) startFailureDetector() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.detectFailures()
		case <-m.stopChan:
			return
		}
	}
}

func (m *Membership) detectFailures() {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	now := time.Now()
	for nodeID, node := range m.nodes {
		if node.Status == NodeDead {
			continue
		}

		timeSinceLastSeen := now.Sub(node.LastSeen)

		if timeSinceLastSeen > m.failureTimeout {
			if node.Status == NodeAlive {
				node.Status = NodeSuspected
			} else if node.Status == NodeSuspected {
				node.Status = NodeDead
				if m.onNodeFailure != nil {
					go m.onNodeFailure(node)
				}
			}
		} else if timeSinceLastSeen < m.failureTimeout/2 {
			node.Status = NodeAlive
		}

		m.nodes[nodeID] = node
	}
}

func (m *Membership) startGossiping() {
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.gossip()
		case <-m.stopChan:
			return
		}
	}
}

func (m *Membership) gossip() {
	nodes := m.getNodeList()
	if len(nodes) == 0 {
		return
	}

	targetCount := min(3, len(nodes))
	targets := make([]*Node, targetCount)
	copy(targets, nodes)

	for i := range targets {
		j := rand.Intn(len(targets))
		targets[i], targets[j] = targets[j], targets[i]
	}

	msg := GossipMessage{
		Type:   "gossip",
		Nodes:  m.getNodeListWithSelf(),
		Sender: m.self.ID,
	}

	for _, node := range targets[:targetCount] {
		go m.sendGossip(node, msg)
	}
}

func (m *Membership) sendGossip(node *Node, msg GossipMessage) {
	client := &http.Client{Timeout: 2 * time.Second}
	data, _ := json.Marshal(msg)
	resp, err := client.Post(
		fmt.Sprintf("http://%s/gossip", node.Address),
		"application/json",
		bytes.NewReader(data),
	)
	if err != nil {
		m.mutex.Lock()
		if n, ok := m.nodes[node.ID]; ok {
			n.LastSeen = time.Now().Add(-m.failureTimeout)
			m.nodes[node.ID] = n
		}
		m.mutex.Unlock()
		return
	}
	defer resp.Body.Close()

	var response GossipMessage
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return
	}

	m.mutex.Lock()
	for _, n := range response.Nodes {
		if n.ID != m.self.ID {
			if existing, ok := m.nodes[n.ID]; ok {
				if n.LastSeen.After(existing.LastSeen) {
					if existing.Status == NodeDead && n.Status == NodeAlive {
						n.Status = NodeAlive
					} else {
						n.Status = existing.Status
					}
					m.nodes[n.ID] = n
				}
			} else {
				m.nodes[n.ID] = n
			}
		}
	}
	if n, ok := m.nodes[node.ID]; ok {
		n.LastSeen = time.Now()
		n.Status = NodeAlive
		m.nodes[node.ID] = n
	}
	m.mutex.Unlock()
}

func (m *Membership) getNodeList() []*Node {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	nodes := make([]*Node, 0, len(m.nodes))
	for _, node := range m.nodes {
		nodes = append(nodes, node)
	}
	return nodes
}

func (m *Membership) getNodeListWithSelf() []*Node {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	nodes := make([]*Node, 0, len(m.nodes)+1)
	nodes = append(nodes, m.self)
	for _, node := range m.nodes {
		nodes = append(nodes, node)
	}
	return nodes
}

func (m *Membership) GetNodes() []string {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	addrs := make([]string, 0, len(m.nodes))
	for _, node := range m.nodes {
		addrs = append(addrs, node.HTTPAddr)
	}
	return addrs
}

func (m *Membership) GetAliveNodes() []string {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	addrs := make([]string, 0, len(m.nodes))
	for _, node := range m.nodes {
		if node.Status == NodeAlive {
			addrs = append(addrs, node.HTTPAddr)
		}
	}
	return addrs
}

func (m *Membership) GetDeadNodes() []string {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	addrs := make([]string, 0)
	for _, node := range m.nodes {
		if node.Status == NodeDead {
			addrs = append(addrs, node.HTTPAddr)
		}
	}
	return addrs
}

func (m *Membership) GetAllNodesWithStatus() map[string]NodeStatus {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	statusMap := make(map[string]NodeStatus, len(m.nodes)+1)
	statusMap[m.self.HTTPAddr] = m.self.Status
	for _, node := range m.nodes {
		statusMap[node.HTTPAddr] = node.Status
	}
	return statusMap
}

func (m *Membership) MarkNodeAsDead(nodeHTTPAddr string) *Node {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	for nodeID, node := range m.nodes {
		if node.HTTPAddr == nodeHTTPAddr {
			node.Status = NodeDead
			m.nodes[nodeID] = node
			if m.onNodeFailure != nil {
				go m.onNodeFailure(node)
			}
			return node
		}
	}
	return nil
}

func (m *Membership) AddNode(addr, httpAddr string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	nodeID := fmt.Sprintf("node-%s", addr)
	m.nodes[nodeID] = &Node{
		ID:       nodeID,
		Address:  addr,
		LastSeen: time.Now(),
		HTTPAddr: httpAddr,
		Status:   NodeAlive,
	}
}
