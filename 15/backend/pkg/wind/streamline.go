package wind

import (
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"

	"voxel-wind-destruction/pkg/models"
)

type StreamlineSystem struct {
	mu sync.RWMutex

	particles  []*models.StreamlineParticle
	windField  *WindField
	maxParticles int
	gridSize   int
	voxelSize  float64
	rng        *rand.Rand
}

func NewStreamlineSystem(windField *WindField, maxParticles, gridSize int, voxelSize float64) *StreamlineSystem {
	ss := &StreamlineSystem{
		particles:    make([]*models.StreamlineParticle, 0, maxParticles),
		windField:    windField,
		maxParticles: maxParticles,
		gridSize:     gridSize,
		voxelSize:    voxelSize,
		rng:          rand.New(rand.NewSource(time.Now().UnixNano())),
	}

	ss.initializeParticles()
	return ss
}

func (ss *StreamlineSystem) initializeParticles() {
	for i := 0; i < ss.maxParticles; i++ {
		ss.spawnParticle(nil)
	}
}

func (ss *StreamlineSystem) spawnParticle(nearPos *models.WindVector) *models.StreamlineParticle {
	var pos models.WindVector
	_ = float64(ss.gridSize) * ss.voxelSize * 0.5

	if nearPos != nil {
		pos = models.WindVector{
			X: nearPos.X + (ss.rng.Float64()-0.5)*2,
			Y: nearPos.Y + (ss.rng.Float64()-0.5)*2,
			Z: nearPos.Z + (ss.rng.Float64()-0.5)*2,
		}
	} else {
		pos = models.WindVector{
			X: (ss.rng.Float64()-0.5)*float64(ss.gridSize)*ss.voxelSize,
			Y: (ss.rng.Float64()-0.5)*float64(ss.gridSize)*ss.voxelSize,
			Z: (ss.rng.Float64()-0.5)*float64(ss.gridSize)*ss.voxelSize,
		}
	}

	maxLife := 3.0 + ss.rng.Float64()*5.0

	p := &models.StreamlineParticle{
		ID:       fmt.Sprintf("particle-%d-%d", time.Now().UnixNano(), ss.rng.Intn(1000000)),
		Position: pos,
		Velocity: models.WindVector{X: 0, Y: 0, Z: 0},
		Life:     maxLife,
		MaxLife:  maxLife,
		Trail:    make([]models.WindVector, 0, 20),
		MaxTrail: 20,
	}

	ss.particles = append(ss.particles, p)
	return p
}

func (ss *StreamlineSystem) Update(dt float64) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	halfSize := float64(ss.gridSize) * ss.voxelSize * 0.5
	activeParticles := make([]*models.StreamlineParticle, 0, ss.maxParticles)

	for _, p := range ss.particles {
		vx, vy, vz := ss.windField.SampleAt(p.Position.X, p.Position.Y, p.Position.Z)

		gridX := int(p.Position.X / ss.voxelSize)
		gridY := int(p.Position.Y / ss.voxelSize)
		gridZ := int(p.Position.Z / ss.voxelSize)

		if ss.windField.IsObstacle(gridX, gridY, gridZ) {
			p.Life -= dt * 3
		}

		p.Velocity = models.WindVector{X: vx, Y: vy, Z: vz}

		p.Trail = append(p.Trail, p.Position)
		if len(p.Trail) > p.MaxTrail {
			p.Trail = p.Trail[1:]
		}

		p.Position.X += vx * dt
		p.Position.Y += vy * dt
		p.Position.Z += vz * dt

		p.Life -= dt

		if p.Life <= 0 ||
			math.Abs(p.Position.X) > halfSize*1.2 ||
			math.Abs(p.Position.Y) > halfSize*1.2 ||
			math.Abs(p.Position.Z) > halfSize*1.2 {
			continue
		}

		activeParticles = append(activeParticles, p)
	}

	ss.particles = activeParticles

	for len(ss.particles) < ss.maxParticles {
		ss.spawnParticle(nil)
	}
}

func (ss *StreamlineSystem) GetParticles() []models.StreamlineParticle {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	result := make([]models.StreamlineParticle, len(ss.particles))
	for i, p := range ss.particles {
		result[i] = *p
	}
	return result
}

func (ss *StreamlineSystem) GetParticlesInRegion(minX, minY, minZ, maxX, maxY, maxZ float64) []models.StreamlineParticle {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	var result []models.StreamlineParticle
	for _, p := range ss.particles {
		if p.Position.X >= minX && p.Position.X <= maxX &&
			p.Position.Y >= minY && p.Position.Y <= maxY &&
			p.Position.Z >= minZ && p.Position.Z <= maxZ {
			result = append(result, *p)
		}
	}
	return result
}

func (ss *StreamlineSystem) SpawnParticlesAtPosition(pos models.WindVector, count int) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	for i := 0; i < count; i++ {
		ss.spawnParticle(&pos)
	}

	if len(ss.particles) > ss.maxParticles {
		excess := len(ss.particles) - ss.maxParticles
		ss.particles = ss.particles[excess:]
	}
}

func (ss *StreamlineSystem) GetStreamlineData(particleID string) (*models.StreamlineParticle, []models.WindVector) {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	for _, p := range ss.particles {
		if p.ID == particleID {
			trail := make([]models.WindVector, len(p.Trail))
			copy(trail, p.Trail)
			pCopy := *p
			return &pCopy, trail
		}
	}
	return nil, nil
}
