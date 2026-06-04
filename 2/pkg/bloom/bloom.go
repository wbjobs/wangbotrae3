package bloom

import (
	"encoding/binary"
	"hash/fnv"
	"math"
	"sync"
)

type Filter struct {
	bitset    []bool
	counts    []uint32
	size      uint64
	hashCount uint
	mutex     sync.RWMutex
}

func New(size uint64, hashCount uint) *Filter {
	return &Filter{
		bitset:    make([]bool, size),
		counts:    make([]uint32, size),
		size:      size,
		hashCount: hashCount,
	}
}

func EstimateParameters(n uint64, p float64) (uint64, uint) {
	m := uint64(math.Ceil(-1 * float64(n) * math.Log(p) / math.Pow(math.Log(2), 2)))
	k := uint(math.Ceil(math.Log(2) * float64(m) / float64(n)))
	if m < 1 {
		m = 1
	}
	if k < 1 {
		k = 1
	}
	return m, k
}

func (bf *Filter) hash(data []byte, seed uint) uint64 {
	h := fnv.New64a()
	h.Write(data)
	seedBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(seedBytes, uint32(seed))
	h.Write(seedBytes)
	return h.Sum64() % bf.size
}

func (bf *Filter) Add(data []byte) {
	bf.mutex.Lock()
	defer bf.mutex.Unlock()

	for i := uint(0); i < bf.hashCount; i++ {
		index := bf.hash(data, i)
		bf.counts[index]++
		bf.bitset[index] = true
	}
}

func (bf *Filter) Remove(data []byte) {
	bf.mutex.Lock()
	defer bf.mutex.Unlock()

	for i := uint(0); i < bf.hashCount; i++ {
		index := bf.hash(data, i)
		if bf.counts[index] > 0 {
			bf.counts[index]--
			if bf.counts[index] == 0 {
				bf.bitset[index] = false
			}
		}
	}
}

func (bf *Filter) Contains(data []byte) bool {
	bf.mutex.RLock()
	defer bf.mutex.RUnlock()

	for i := uint(0); i < bf.hashCount; i++ {
		index := bf.hash(data, i)
		if !bf.bitset[index] {
			return false
		}
	}
	return true
}

func (bf *Filter) Serialize() []byte {
	bf.mutex.RLock()
	defer bf.mutex.RUnlock()

	sizeBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(sizeBytes, bf.size)

	hashCountBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(hashCountBytes, uint32(bf.hashCount))

	countsBytes := make([]byte, bf.size*4)
	for i := uint64(0); i < bf.size; i++ {
		binary.BigEndian.PutUint32(countsBytes[i*4:(i+1)*4], bf.counts[i])
	}

	result := make([]byte, 0, 8+4+len(countsBytes))
	result = append(result, sizeBytes...)
	result = append(result, hashCountBytes...)
	result = append(result, countsBytes...)

	return result
}

func Deserialize(data []byte) *Filter {
	if len(data) < 12 {
		return New(1024, 4)
	}

	size := binary.BigEndian.Uint64(data[0:8])
	hashCount := uint(binary.BigEndian.Uint32(data[8:12]))
	countsBytes := data[12:]

	bf := New(size, hashCount)
	for i := uint64(0); i < size; i++ {
		start := i * 4
		end := start + 4
		if end <= uint64(len(countsBytes)) {
			count := binary.BigEndian.Uint32(countsBytes[start:end])
			bf.counts[i] = count
			if count > 0 {
				bf.bitset[i] = true
			}
		}
	}

	return bf
}
