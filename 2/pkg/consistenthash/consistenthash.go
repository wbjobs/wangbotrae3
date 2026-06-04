package consistenthash

import (
	"hash/crc32"
	"sort"
	"strconv"
	"sync"
)

type Hash func(data []byte) uint32

type Map struct {
	hash     Hash
	replicas int
	keys     []int
	hashMap  map[int]string
	mutex    sync.RWMutex
}

func New(replicas int, fn Hash) *Map {
	m := &Map{
		replicas: replicas,
		hash:     fn,
		hashMap:  make(map[int]string),
	}
	if m.hash == nil {
		m.hash = crc32.ChecksumIEEE
	}
	return m
}

func (m *Map) Add(nodes ...string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	for _, node := range nodes {
		for i := 0; i < m.replicas; i++ {
			hash := int(m.hash([]byte(strconv.Itoa(i) + node)))
			m.keys = append(m.keys, hash)
			m.hashMap[hash] = node
		}
	}
	sort.Ints(m.keys)
}

func (m *Map) Remove(node string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	keysToRemove := make(map[int]bool)
	for i := 0; i < m.replicas; i++ {
		hash := int(m.hash([]byte(strconv.Itoa(i) + node)))
		keysToRemove[hash] = true
	}

	newKeys := make([]int, 0, len(m.keys))
	for _, key := range m.keys {
		if !keysToRemove[key] {
			newKeys = append(newKeys, key)
		}
	}
	m.keys = newKeys

	for key := range keysToRemove {
		delete(m.hashMap, key)
	}
}

func (m *Map) Get(key string) string {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	if len(m.keys) == 0 {
		return ""
	}

	hash := int(m.hash([]byte(key)))

	idx := sort.Search(len(m.keys), func(i int) bool {
		return m.keys[i] >= hash
	})

	if idx == len(m.keys) {
		idx = 0
	}

	return m.hashMap[m.keys[idx]]
}

func (m *Map) Nodes() []string {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	nodeSet := make(map[string]bool)
	for _, node := range m.hashMap {
		nodeSet[node] = true
	}

	nodes := make([]string, 0, len(nodeSet))
	for node := range nodeSet {
		nodes = append(nodes, node)
	}
	return nodes
}
