package wind

import (
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"

	"voxel-wind-destruction/pkg/models"
	"voxel-wind-destruction/pkg/redis"
)

type Service struct {
	redisClient    *redis.Client
	params         *models.WindParams
	advancedParams *models.AdvancedWindParams
	currentGust    *models.GustEvent
	autoUpdate     bool
	stopChan       chan struct{}
	gustStopChan   chan struct{}

	windField        *WindField
	streamlineSystem *StreamlineSystem
	obstacleMu       sync.RWMutex
	obstacles        map[string]models.WindObstacle

	simulationTime  float64
	lastUpdateTime  time.Time
	updateTicker    *time.Ticker
	streamlineTicker *time.Ticker
}

const (
	DefaultGridSize  = 64
	DefaultVoxelSize = 0.5
	DefaultMaxParticles = 200
)

func NewService(redisClient *redis.Client) *Service {
	config := models.WindGridConfig{
		GridSize:   DefaultGridSize,
		VoxelSize:  DefaultVoxelSize,
		NoiseScale: 0.1,
		NoiseSpeed: 1.0,
	}

	s := &Service{
		redisClient:    redisClient,
		windField:      NewWindField(config, time.Now().UnixNano()),
		obstacles:      make(map[string]models.WindObstacle),
		simulationTime: 0,
		lastUpdateTime: time.Now(),
		params: &models.WindParams{
			DirectionX: 1.0,
			DirectionY: 0.0,
			DirectionZ: 0.5,
			Speed:      50.0,
			Turbulence: 0.3,
			UpdatedAt:  time.Now().Unix(),
		},
		advancedParams: &models.AdvancedWindParams{
			BaseDirectionX: 1.0,
			BaseDirectionY: 0.0,
			BaseDirectionZ: 0.5,
			BaseSpeed:      50.0,
			NoiseScale:     0.1,
			NoiseSpeed:     1.0,
			Turbulence:     0.3,
			EnableEddies:   true,
			EddyStrength:   0.5,
			UpdatedAt:      time.Now().Unix(),
		},
		stopChan:     make(chan struct{}),
		gustStopChan: make(chan struct{}),
	}

	s.streamlineSystem = NewStreamlineSystem(
		s.windField,
		DefaultMaxParticles,
		DefaultGridSize,
		DefaultVoxelSize,
	)

	existing, err := redisClient.GetWindParams()
	if err == nil && existing != nil {
		s.params = existing
		s.windField.SetBaseParams(
			existing.DirectionX,
			existing.DirectionY,
			existing.DirectionZ,
			existing.Speed,
			existing.Turbulence,
			s.advancedParams.EddyStrength,
		)
	}

	existingAdvanced, err := redisClient.GetAdvancedWindParams()
	if err == nil && existingAdvanced != nil {
		s.advancedParams = existingAdvanced
		s.windField.SetBaseParams(
			existingAdvanced.BaseDirectionX,
			existingAdvanced.BaseDirectionY,
			existingAdvanced.BaseDirectionZ,
			existingAdvanced.BaseSpeed,
			existingAdvanced.Turbulence,
			existingAdvanced.EddyStrength,
		)
	}

	s.StartSimulationLoop()
	return s
}

func (s *Service) GetCurrentParams() *models.WindParams {
	return s.params
}

func (s *Service) UpdateParams(params *models.WindParams) error {
	length := math.Sqrt(params.DirectionX*params.DirectionX +
		params.DirectionY*params.DirectionY +
		params.DirectionZ*params.DirectionZ)

	if length > 0 {
		params.DirectionX /= length
		params.DirectionY /= length
		params.DirectionZ /= length
	}

	s.params = params
	s.windField.SetBaseParams(
		params.DirectionX,
		params.DirectionY,
		params.DirectionZ,
		params.Speed,
		params.Turbulence,
		s.advancedParams.EddyStrength,
	)
	return s.redisClient.SetWindParams(params)
}

func (s *Service) SetSpeed(speed float64) error {
	s.params.Speed = speed
	s.windField.SetBaseParams(
		s.params.DirectionX,
		s.params.DirectionY,
		s.params.DirectionZ,
		speed,
		s.params.Turbulence,
		s.advancedParams.EddyStrength,
	)
	return s.redisClient.SetWindParams(s.params)
}

func (s *Service) SetDirection(x, y, z float64) error {
	length := math.Sqrt(x*x + y*y + z*z)
	if length > 0 {
		s.params.DirectionX = x / length
		s.params.DirectionY = y / length
		s.params.DirectionZ = z / length
	}
	s.windField.SetBaseParams(
		s.params.DirectionX,
		s.params.DirectionY,
		s.params.DirectionZ,
		s.params.Speed,
		s.params.Turbulence,
		s.advancedParams.EddyStrength,
	)
	return s.redisClient.SetWindParams(s.params)
}

func (s *Service) SetTurbulence(turbulence float64) error {
	s.params.Turbulence = math.Max(0, math.Min(1, turbulence))
	s.windField.SetBaseParams(
		s.params.DirectionX,
		s.params.DirectionY,
		s.params.DirectionZ,
		s.params.Speed,
		s.params.Turbulence,
		s.advancedParams.EddyStrength,
	)
	return s.redisClient.SetWindParams(s.params)
}

func (s *Service) StartAutoWind() {
	if s.autoUpdate {
		return
	}
	s.autoUpdate = true

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				s.updateWindDynamically()
			case <-s.stopChan:
				return
			}
		}
	}()
}

func (s *Service) StopAutoWind() {
	s.autoUpdate = false
	close(s.stopChan)
	s.stopChan = make(chan struct{})
}

func (s *Service) updateWindDynamically() {
	angle := rand.Float64() * math.Pi * 2
	tilt := (rand.Float64() - 0.5) * 0.5

	newX := math.Cos(angle) * math.Cos(tilt)
	newY := math.Sin(tilt)
	newZ := math.Sin(angle) * math.Cos(tilt)

	lerpFactor := 0.3
	s.advancedParams.BaseDirectionX = s.advancedParams.BaseDirectionX*(1-lerpFactor) + newX*lerpFactor
	s.advancedParams.BaseDirectionY = s.advancedParams.BaseDirectionY*(1-lerpFactor) + newY*lerpFactor
	s.advancedParams.BaseDirectionZ = s.advancedParams.BaseDirectionZ*(1-lerpFactor) + newZ*lerpFactor

	length := math.Sqrt(s.advancedParams.BaseDirectionX*s.advancedParams.BaseDirectionX +
		s.advancedParams.BaseDirectionY*s.advancedParams.BaseDirectionY +
		s.advancedParams.BaseDirectionZ*s.advancedParams.BaseDirectionZ)
	if length > 0 {
		s.advancedParams.BaseDirectionX /= length
		s.advancedParams.BaseDirectionY /= length
		s.advancedParams.BaseDirectionZ /= length
	}

	speedVariation := (rand.Float64() - 0.5) * 20
	s.advancedParams.BaseSpeed = math.Max(10, math.Min(200, s.advancedParams.BaseSpeed+speedVariation))

	s.advancedParams.Turbulence = 0.2 + rand.Float64()*0.4
	s.advancedParams.NoiseSpeed = 0.5 + rand.Float64()*1.5
	s.advancedParams.EddyStrength = 0.3 + rand.Float64()*0.4

	s.params.DirectionX = s.advancedParams.BaseDirectionX
	s.params.DirectionY = s.advancedParams.BaseDirectionY
	s.params.DirectionZ = s.advancedParams.BaseDirectionZ
	s.params.Speed = s.advancedParams.BaseSpeed
	s.params.Turbulence = s.advancedParams.Turbulence

	s.windField.SetBaseParams(
		s.advancedParams.BaseDirectionX,
		s.advancedParams.BaseDirectionY,
		s.advancedParams.BaseDirectionZ,
		s.advancedParams.BaseSpeed,
		s.advancedParams.Turbulence,
		s.advancedParams.EddyStrength,
	)

	config := s.windField.config
	config.NoiseSpeed = s.advancedParams.NoiseSpeed
	config.NoiseScale = s.advancedParams.NoiseScale
	s.windField.config = config

	s.redisClient.SetWindParams(s.params)
	s.redisClient.SetAdvancedWindParams(s.advancedParams)
}

func (s *Service) GetAdvancedParams() *models.AdvancedWindParams {
	return s.advancedParams
}

func (s *Service) UpdateAdvancedParams(params *models.AdvancedWindParams) error {
	s.advancedParams = params
	s.params.DirectionX = params.BaseDirectionX
	s.params.DirectionY = params.BaseDirectionY
	s.params.DirectionZ = params.BaseDirectionZ
	s.params.Speed = params.BaseSpeed
	s.params.Turbulence = params.Turbulence

	s.windField.SetBaseParams(
		params.BaseDirectionX,
		params.BaseDirectionY,
		params.BaseDirectionZ,
		params.BaseSpeed,
		params.Turbulence,
		params.EddyStrength,
	)

	config := s.windField.config
	config.NoiseScale = params.NoiseScale
	config.NoiseSpeed = params.NoiseSpeed
	s.windField.config = config

	s.redisClient.SetWindParams(s.params)
	return s.redisClient.SetAdvancedWindParams(params)
}

func (s *Service) TriggerGust(strength float64, duration float64, dirX, dirY, dirZ float64) (*models.GustEvent, error) {
	if s.currentGust != nil && s.currentGust.Active {
		return nil, fmt.Errorf("gust event already active")
	}

	length := math.Sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ)
	if length > 0 {
		dirX /= length
		dirY /= length
		dirZ /= length
	}

	gust := &models.GustEvent{
		Strength:   strength,
		Duration:   duration,
		DirectionX: dirX,
		DirectionY: dirY,
		DirectionZ: dirZ,
	}

	if err := s.redisClient.TriggerGustEvent(gust); err != nil {
		return nil, err
	}

	s.currentGust = gust

	go s.manageGustEvent(gust)

	return gust, nil
}

func (s *Service) manageGustEvent(gust *models.GustEvent) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	startTime := time.Now()
	originalSpeed := s.advancedParams.BaseSpeed

	for {
		select {
		case <-ticker.C:
			elapsed := time.Since(startTime).Seconds()
			if elapsed >= gust.Duration {
				s.currentGust = nil
				s.advancedParams.BaseSpeed = originalSpeed
				s.redisClient.SetAdvancedWindParams(s.advancedParams)
				return
			}

			strengthFactor := math.Sin(math.Pi * elapsed / gust.Duration)
			currentStrength := gust.Strength * strengthFactor

			s.advancedParams.BaseSpeed = originalSpeed + currentStrength
			s.advancedParams.NoiseScale = 0.15 + strengthFactor*0.1
			s.advancedParams.Turbulence = 0.5 + strengthFactor*0.3

			s.params.Speed = s.advancedParams.BaseSpeed
			s.params.Turbulence = s.advancedParams.Turbulence

			s.redisClient.SetWindParams(s.params)
			s.redisClient.SetAdvancedWindParams(s.advancedParams)

		case <-s.gustStopChan:
			s.currentGust = nil
			s.advancedParams.BaseSpeed = originalSpeed
			s.redisClient.SetAdvancedWindParams(s.advancedParams)
			return
		}
	}
}

func (s *Service) GetCurrentGust() (*models.GustEvent, error) {
	return s.redisClient.GetCurrentGust()
}

func (s *Service) CancelGust() {
	if s.currentGust != nil {
		close(s.gustStopChan)
		s.gustStopChan = make(chan struct{})
	}
	s.windField.UpdateGustState()
}

func (s *Service) StartSimulationLoop() {
	if s.updateTicker != nil {
		return
	}

	s.updateTicker = time.NewTicker(50 * time.Millisecond)
	s.streamlineTicker = time.NewTicker(33 * time.Millisecond)

	go func() {
		for {
			select {
			case <-s.updateTicker.C:
				dt := time.Since(s.lastUpdateTime).Seconds()
				s.lastUpdateTime = time.Now()
				s.simulationTime += dt

				s.windField.UpdateGustState()
				s.windField.UpdateSparse(s.simulationTime)

			case <-s.streamlineTicker.C:
				dt := 0.033
				s.streamlineSystem.Update(dt)

			case <-s.stopChan:
				s.updateTicker.Stop()
				s.streamlineTicker.Stop()
				s.updateTicker = nil
				s.streamlineTicker = nil
				return
			}
		}
	}()
}

func (s *Service) StopSimulationLoop() {
	if s.updateTicker != nil {
		close(s.stopChan)
		s.stopChan = make(chan struct{})
	}
}

func (s *Service) SetObstacle(x, y, z int, active bool, playerID string) {
	s.obstacleMu.Lock()
	defer s.obstacleMu.Unlock()

	key := fmt.Sprintf("%d:%d:%d", x, y, z)
	if active {
		s.obstacles[key] = models.WindObstacle{
			VoxelX:   x,
			VoxelY:   y,
			VoxelZ:   z,
			Active:   true,
			PlayerID: playerID,
		}
	} else {
		delete(s.obstacles, key)
	}

	s.windField.SetObstacle(x, y, z, active)
}

func (s *Service) SetObstacles(records []models.VoxelDestruction) {
	for _, r := range records {
		s.SetObstacle(r.VoxelX, r.VoxelY, r.VoxelZ, false, r.PlayerID)
	}
}

func (s *Service) IsObstacle(x, y, z int) bool {
	s.obstacleMu.RLock()
	defer s.obstacleMu.RUnlock()

	key := fmt.Sprintf("%d:%d:%d", x, y, z)
	_, exists := s.obstacles[key]
	return exists
}

func (s *Service) GetWindFieldState() models.WindGridState {
	return s.windField.GetState()
}

func (s *Service) GetVoxelWind(x, y, z int) *models.VoxelWind {
	return s.windField.GetVoxelWind(x, y, z)
}

func (s *Service) GetUpdatedVoxels() []models.VoxelWind {
	return s.windField.GetUpdatedVoxels()
}

func (s *Service) GetWindFieldData() models.WindGridData {
	return models.WindGridData{
		State:  s.GetWindFieldState(),
		Voxels: s.GetUpdatedVoxels(),
	}
}

func (s *Service) SampleWindAt(worldX, worldY, worldZ float64) (float64, float64, float64) {
	return s.windField.SampleAt(worldX, worldY, worldZ)
}

func (s *Service) BatchSampleWind(positions []models.WindVector) models.WindFieldBatchResponse {
	samples := s.windField.BatchSample(positions)
	return models.WindFieldBatchResponse{
		Samples: samples,
		State:   s.GetWindFieldState(),
	}
}

func (s *Service) GetStreamlineParticles() []models.StreamlineParticle {
	return s.streamlineSystem.GetParticles()
}

func (s *Service) GetStreamlineParticlesInRegion(minX, minY, minZ, maxX, maxY, maxZ float64) []models.StreamlineParticle {
	return s.streamlineSystem.GetParticlesInRegion(minX, minY, minZ, maxX, maxY, maxZ)
}

func (s *Service) SpawnStreamlineParticles(pos models.WindVector, count int) {
	s.streamlineSystem.SpawnParticlesAtPosition(pos, count)
}

func (s *Service) TriggerGustEvent(strength float64, duration float64, dirX, dirY, dirZ float64) (*models.GustEvent, error) {
	gust, err := s.TriggerGust(strength, duration, dirX, dirY, dirZ)
	if err != nil {
		return nil, err
	}

	s.windField.TriggerGust(strength, duration, dirX, dirY, dirZ)
	return gust, nil
}

func (s *Service) UpdateWindGridConfig(config models.WindGridConfig) {
	s.windField.config = config
	s.advancedParams.NoiseScale = config.NoiseScale
	s.advancedParams.NoiseSpeed = config.NoiseSpeed
	s.redisClient.SetAdvancedWindParams(s.advancedParams)
}

func (s *Service) GetWindGridConfig() models.WindGridConfig {
	return s.windField.config
}

func (s *Service) GetAllObstacles() []models.WindObstacle {
	s.obstacleMu.RLock()
	defer s.obstacleMu.RUnlock()

	result := make([]models.WindObstacle, 0, len(s.obstacles))
	for _, obs := range s.obstacles {
		result = append(result, obs)
	}
	return result
}

func (s *Service) SyncObstaclesFromRedis() error {
	destroyed, err := s.redisClient.GetAllDestroyedVoxels()
	if err != nil {
		return err
	}

	s.obstacleMu.Lock()
	defer s.obstacleMu.Unlock()

	s.obstacles = make(map[string]models.WindObstacle)
	for _, d := range destroyed {
		key := fmt.Sprintf("%d:%d:%d", d.VoxelX, d.VoxelY, d.VoxelZ)
		s.obstacles[key] = models.WindObstacle{
			VoxelX:   d.VoxelX,
			VoxelY:   d.VoxelY,
			VoxelZ:   d.VoxelZ,
			Active:   false,
			PlayerID: d.PlayerID,
		}
		s.windField.SetObstacle(d.VoxelX, d.VoxelY, d.VoxelZ, false)
	}

	return nil
}
