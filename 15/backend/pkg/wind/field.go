package wind

import (
	"math"
	"sync"
	"time"

	"voxel-wind-destruction/pkg/models"
)

type WindField struct {
	mu sync.RWMutex

	config   models.WindGridConfig
	state    models.WindGridState
	noise    *PerlinWindField
	obstacle map[int]map[int]map[int]bool
	updateRegions []models.SparseUpdateRegion
	voxelData map[int]map[int]map[int]*models.VoxelWind

	baseDirectionX float64
	baseDirectionY float64
	baseDirectionZ float64
	baseSpeed      float64
	turbulence     float64
	eddyStrength   float64

	gustActive   bool
	gustStrength float64
	gustDirX     float64
	gustDirY     float64
	gustDirZ     float64
	gustEndTime  time.Time
}

func NewWindField(config models.WindGridConfig, seed int64) *WindField {
	wf := &WindField{
		config:        config,
		noise:         NewPerlinWindField(seed),
		obstacle:      make(map[int]map[int]map[int]bool),
		voxelData:     make(map[int]map[int]map[int]*models.VoxelWind),
		updateRegions: make([]models.SparseUpdateRegion, 0),
		baseDirectionX: 1.0,
		baseDirectionZ: 0.5,
		baseSpeed:     50.0,
		turbulence:    0.3,
		eddyStrength:  0.5,
	}

	wf.state = models.WindGridState{
		Config:    config,
		UpdatedAt: time.Now().Unix(),
		Time:      0,
	}

	return wf
}

func (wf *WindField) SetBaseParams(dx, dy, dz, speed, turbulence, eddyStrength float64) {
	wf.mu.Lock()
	defer wf.mu.Unlock()

	length := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if length > 0 {
		wf.baseDirectionX = dx / length
		wf.baseDirectionY = dy / length
		wf.baseDirectionZ = dz / length
	}
	wf.baseSpeed = speed
	wf.turbulence = math.Max(0, math.Min(1, turbulence))
	wf.eddyStrength = eddyStrength
}

func (wf *WindField) SetObstacle(x, y, z int, active bool) {
	wf.mu.Lock()
	defer wf.mu.Unlock()

	if _, ok := wf.obstacle[x]; !ok {
		wf.obstacle[x] = make(map[int]map[int]bool)
	}
	if _, ok := wf.obstacle[x][y]; !ok {
		wf.obstacle[x][y] = make(map[int]bool)
	}
	wf.obstacle[x][y][z] = active

	if !active {
		wf.addUpdateRegion(x, y, z, 5)
	}
}

func (wf *WindField) IsObstacle(x, y, z int) bool {
	wf.mu.RLock()
	defer wf.mu.RUnlock()

	if yz, ok := wf.obstacle[x]; ok {
		if zMap, ok := yz[y]; ok {
			if v, ok := zMap[z]; ok {
				return v
			}
		}
	}
	return false
}

func (wf *WindField) addUpdateRegion(cx, cy, cz, radius int) {
	region := models.SparseUpdateRegion{
		CenterX:    cx,
		CenterY:    cy,
		CenterZ:    cz,
		Radius:     radius,
		UpdateTime: time.Now().Unix(),
	}
	wf.updateRegions = append(wf.updateRegions, region)

	if len(wf.updateRegions) > 50 {
		wf.updateRegions = wf.updateRegions[len(wf.updateRegions)-50:]
	}
}

func (wf *WindField) TriggerGust(strength, duration float64, dx, dy, dz float64) {
	wf.mu.Lock()
	defer wf.mu.Unlock()

	length := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if length > 0 {
		wf.gustDirX = dx / length
		wf.gustDirY = dy / length
		wf.gustDirZ = dz / length
	} else {
		wf.gustDirX = wf.baseDirectionX
		wf.gustDirY = wf.baseDirectionY
		wf.gustDirZ = wf.baseDirectionZ
	}

	wf.gustActive = true
	wf.gustStrength = strength
	wf.gustEndTime = time.Now().Add(time.Duration(duration * float64(time.Second)))
}

func (wf *WindField) UpdateGustState() {
	wf.mu.Lock()
	defer wf.mu.Unlock()

	if wf.gustActive && time.Now().After(wf.gustEndTime) {
		wf.gustActive = false
		wf.gustStrength = 0
	}
}

func (wf *WindField) IsGustActive() bool {
	wf.mu.RLock()
	defer wf.mu.RUnlock()
	return wf.gustActive
}

func (wf *WindField) GetGustStrength() float64 {
	wf.mu.RLock()
	defer wf.mu.RUnlock()

	if !wf.gustActive {
		return 0
	}

	remaining := wf.gustEndTime.Sub(time.Now()).Seconds()
	total := 3.0
	progress := 1.0 - remaining/total
	if progress < 0 {
		progress = 0
	}

	strengthFactor := math.Sin(math.Pi * progress)
	return wf.gustStrength * strengthFactor
}

func (wf *WindField) CalculateVelocity(x, y, z int, simTime float64) (float64, float64, float64) {
	wf.mu.RLock()
	defer wf.mu.RUnlock()

	if wf.IsObstacle(x, y, z) {
		return 0, 0, 0
	}

	dx, dy, dz := wf.noise.SampleDirection(
		float64(x), float64(y), float64(z),
		simTime, wf.config.NoiseScale, wf.config.NoiseSpeed,
	)

	curlX, curlY, curlZ := wf.noise.SampleCurl(
		float64(x), float64(y), float64(z),
		simTime, wf.config.NoiseScale*1.5, wf.config.NoiseSpeed*0.8,
		wf.eddyStrength,
	)

	turbFactor := wf.turbulence
	velocityX := wf.baseDirectionX + dx*turbFactor + curlX
	velocityY := wf.baseDirectionY + dy*turbFactor + curlY
	velocityZ := wf.baseDirectionZ + dz*turbFactor + curlZ

	if wf.gustActive {
		gustStrength := wf.GetGustStrength()
		velocityX += wf.gustDirX * gustStrength / wf.baseSpeed
		velocityY += wf.gustDirY * gustStrength / wf.baseSpeed
		velocityZ += wf.gustDirZ * gustStrength / wf.baseSpeed
	}

	length := math.Sqrt(velocityX*velocityX + velocityY*velocityY + velocityZ*velocityZ)
	if length > 0 {
		velocityX /= length
		velocityY /= length
		velocityZ /= length
	}

	speedMultiplier := wf.baseSpeed
	if wf.gustActive {
		speedMultiplier += wf.GetGustStrength()
	}

	velocityX *= speedMultiplier
	velocityY *= speedMultiplier
	velocityZ *= speedMultiplier

	velocityX, velocityY, velocityZ = wf.applyObstacleAvoidance(
		x, y, z, velocityX, velocityY, velocityZ,
	)

	return velocityX, velocityY, velocityZ
}

func (wf *WindField) applyObstacleAvoidance(x, y, z int, vx, vy, vz float64) (float64, float64, float64) {
	avoidX, avoidY, avoidZ := 0.0, 0.0, 0.0
	avoidCount := 0

	for dx := -2; dx <= 2; dx++ {
		for dy := -2; dy <= 2; dy++ {
			for dz := -2; dz <= 2; dz++ {
				if dx == 0 && dy == 0 && dz == 0 {
					continue
				}

				if wf.IsObstacle(x+dx, y+dy, z+dz) {
					dist := math.Sqrt(float64(dx*dx + dy*dy + dz*dz))
					avoidFactor := 1.0 / (dist * dist)

					avoidX -= float64(dx) * avoidFactor
					avoidY -= float64(dy) * avoidFactor
					avoidZ -= float64(dz) * avoidFactor
					avoidCount++
				}
			}
		}
	}

	if avoidCount > 0 {
		avoidMag := math.Sqrt(avoidX*avoidX + avoidY*avoidY + avoidZ*avoidZ)
		if avoidMag > 0 {
			avoidX /= avoidMag
			avoidY /= avoidMag
			avoidZ /= avoidMag

			blend := math.Min(1.0, float64(avoidCount)/12.0)
			vx = vx*(1-blend) + avoidX*blend*50
			vy = vy*(1-blend) + avoidY*blend*50
			vz = vz*(1-blend) + avoidZ*blend*50
		}
	}

	return vx, vy, vz
}

func (wf *WindField) UpdateSparse(simTime float64) {
	wf.mu.Lock()
	defer wf.mu.Unlock()

	wf.state.Time = simTime
	wf.state.UpdatedAt = time.Now().Unix()
	wf.state.GustActive = wf.gustActive
	wf.state.GustStrength = wf.GetGustStrength()

	updated := make(map[int]bool)

	for _, region := range wf.updateRegions {
		for dx := -region.Radius; dx <= region.Radius; dx++ {
			for dy := -region.Radius; dy <= region.Radius; dy++ {
				for dz := -region.Radius; dz <= region.Radius; dz++ {
					x := region.CenterX + dx
					y := region.CenterY + dy
					z := region.CenterZ + dz

					key := x*1000000 + y*1000 + z
					if updated[key] {
						continue
					}
					updated[key] = true

					if x < 0 || x >= wf.config.GridSize ||
						y < 0 || y >= wf.config.GridSize ||
						z < 0 || z >= wf.config.GridSize {
						continue
					}

					dist := math.Sqrt(float64(dx*dx + dy*dy + dz*dz))
					if dist > float64(region.Radius) {
						continue
					}

					wf.updateVoxel(x, y, z, simTime)
				}
			}
		}
	}

	randUpdates := 100
	for i := 0; i < randUpdates; i++ {
		x := int(math.Mod(float64(int(simTime*100)+i*137), float64(wf.config.GridSize)))
		y := int(math.Mod(float64(int(simTime*73)+i*251), float64(wf.config.GridSize)))
		z := int(math.Mod(float64(int(simTime*41)+i*313), float64(wf.config.GridSize)))

		key := x*1000000 + y*1000 + z
		if updated[key] {
			continue
		}

		wf.updateVoxel(x, y, z, simTime)
	}

	if time.Now().Unix()%10 == 0 {
		wf.updateRegions = wf.updateRegions[:0]
	}
}

func (wf *WindField) updateVoxel(x, y, z int, simTime float64) {
	if _, ok := wf.voxelData[x]; !ok {
		wf.voxelData[x] = make(map[int]map[int]*models.VoxelWind)
	}
	if _, ok := wf.voxelData[x][y]; !ok {
		wf.voxelData[x][y] = make(map[int]*models.VoxelWind)
	}

	vx, vy, vz := wf.CalculateVelocity(x, y, z, simTime)
	pressure := wf.calculatePressure(x, y, z, simTime)

	wf.voxelData[x][y][z] = &models.VoxelWind{
		VoxelX: x,
		VoxelY: y,
		VoxelZ: z,
		Velocity: models.WindVector{
			X: vx,
			Y: vy,
			Z: vz,
		},
		Pressure: pressure,
		Active:   !wf.IsObstacle(x, y, z),
	}
}

func (wf *WindField) calculatePressure(x, y, z int, simTime float64) float64 {
	pressure := 0.0
	count := 0

	for dx := -1; dx <= 1; dx++ {
		for dy := -1; dy <= 1; dy++ {
			for dz := -1; dz <= 1; dz++ {
				if dx == 0 && dy == 0 && dz == 0 {
					continue
				}

				nx, ny, nz := x+dx, y+dy, z+dz
				if nx < 0 || nx >= wf.config.GridSize ||
					ny < 0 || ny >= wf.config.GridSize ||
					nz < 0 || nz >= wf.config.GridSize {
					continue
				}

				if wf.IsObstacle(nx, ny, nz) {
					continue
				}

				vx, vy, vz := wf.noise.SampleDirection(
					float64(nx), float64(ny), float64(nz),
					simTime, wf.config.NoiseScale, wf.config.NoiseSpeed,
				)

				pressure += vx*float64(dx) + vy*float64(dy) + vz*float64(dz)
				count++
			}
		}
	}

	if count > 0 {
		return pressure / float64(count)
	}
	return 0
}

func (wf *WindField) GetVoxelWind(x, y, z int) *models.VoxelWind {
	wf.mu.RLock()
	defer wf.mu.RUnlock()

	if yz, ok := wf.voxelData[x]; ok {
		if zMap, ok := yz[y]; ok {
			if v, ok := zMap[z]; ok {
				return v
			}
		}
	}

	vx, vy, vz := wf.CalculateVelocity(x, y, z, wf.state.Time)
	return &models.VoxelWind{
		VoxelX: x,
		VoxelY: y,
		VoxelZ: z,
		Velocity: models.WindVector{
			X: vx,
			Y: vy,
			Z: vz,
		},
		Pressure: 0,
		Active:   !wf.IsObstacle(x, y, z),
	}
}

func (wf *WindField) GetState() models.WindGridState {
	wf.mu.RLock()
	defer wf.mu.RUnlock()
	return wf.state
}

func (wf *WindField) GetUpdatedVoxels() []models.VoxelWind {
	wf.mu.RLock()
	defer wf.mu.RUnlock()

	var result []models.VoxelWind
	for _, yz := range wf.voxelData {
		for _, zMap := range yz {
			for _, v := range zMap {
				result = append(result, *v)
			}
		}
	}
	return result
}

func (wf *WindField) SampleAt(worldX, worldY, worldZ float64) (float64, float64, float64) {
	vx := int(worldX / wf.config.VoxelSize)
	vy := int(worldY / wf.config.VoxelSize)
	vz := int(worldZ / wf.config.VoxelSize)

	return wf.CalculateVelocity(vx, vy, vz, wf.state.Time)
}

func (wf *WindField) BatchSample(positions []models.WindVector) []models.WindFieldSample {
	results := make([]models.WindFieldSample, len(positions))

	for i, pos := range positions {
		vx, vy, vz := wf.SampleAt(pos.X, pos.Y, pos.Z)
		speed := math.Sqrt(vx*vx + vy*vy + vz*vz)

		gridX := int(pos.X / wf.config.VoxelSize)
		gridY := int(pos.Y / wf.config.VoxelSize)
		gridZ := int(pos.Z / wf.config.VoxelSize)

		results[i] = models.WindFieldSample{
			Position:    pos,
			Velocity:    models.WindVector{X: vx, Y: vy, Z: vz},
			Speed:       speed,
			HasObstacle: wf.IsObstacle(gridX, gridY, gridZ),
		}
	}

	return results
}
