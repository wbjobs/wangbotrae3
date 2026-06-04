package models

import "time"

type WindParams struct {
	DirectionX float64 `json:"directionX" binding:"required"`
	DirectionY float64 `json:"directionY" binding:"required"`
	DirectionZ float64 `json:"directionZ" binding:"required"`
	Speed      float64 `json:"speed" binding:"required,min=0"`
	Turbulence float64 `json:"turbulence" binding:"min=0,max=1"`
	UpdatedAt  int64   `json:"updatedAt"`
}

type WindVector struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type VoxelWind struct {
	VoxelX   int        `json:"voxelX"`
	VoxelY   int        `json:"voxelY"`
	VoxelZ   int        `json:"voxelZ"`
	Velocity WindVector `json:"velocity"`
	Pressure float64    `json:"pressure"`
	Active   bool       `json:"active"`
}

type WindGridConfig struct {
	GridSize   int     `json:"gridSize"`
	VoxelSize  float64 `json:"voxelSize"`
	NoiseScale float64 `json:"noiseScale"`
	NoiseSpeed float64 `json:"noiseSpeed"`
}

type WindGridState struct {
	Config     WindGridConfig `json:"config"`
	UpdatedAt  int64          `json:"updatedAt"`
	Time       float64        `json:"time"`
	GustActive bool           `json:"gustActive"`
	GustStrength float64      `json:"gustStrength"`
}

type WindGridData struct {
	State  WindGridState `json:"state"`
	Voxels []VoxelWind   `json:"voxels,omitempty"`
}

type WindObstacle struct {
	VoxelX   int    `json:"voxelX"`
	VoxelY   int    `json:"voxelY"`
	VoxelZ   int    `json:"voxelZ"`
	Active   bool   `json:"active"`
	PlayerID string `json:"playerId,omitempty"`
}

type SparseUpdateRegion struct {
	CenterX    int `json:"centerX"`
	CenterY    int `json:"centerY"`
	CenterZ    int `json:"centerZ"`
	Radius     int `json:"radius"`
	UpdateTime int64 `json:"updateTime"`
}

type StreamlineParticle struct {
	ID        string     `json:"id"`
	Position  WindVector `json:"position"`
	Velocity  WindVector `json:"velocity"`
	Life      float64    `json:"life"`
	MaxLife   float64    `json:"maxLife"`
	Trail     []WindVector `json:"trail"`
	MaxTrail  int        `json:"maxTrail"`
}

type WindFieldSample struct {
	Position    WindVector `json:"position"`
	Velocity    WindVector `json:"velocity"`
	Speed       float64    `json:"speed"`
	HasObstacle bool       `json:"hasObstacle"`
}

type WindFieldBatchRequest struct {
	Positions []WindVector `json:"positions" binding:"required,min=1,max=1000"`
}

type WindFieldBatchResponse struct {
	Samples []WindFieldSample `json:"samples"`
	State   WindGridState     `json:"state"`
}

type VoxelDestruction struct {
	ID        string    `json:"id"`
	VoxelX    int       `json:"voxelX"`
	VoxelY    int       `json:"voxelY"`
	VoxelZ    int       `json:"voxelZ"`
	Force     float64   `json:"force"`
	Strength  float64   `json:"strength"`
	DestroyedAt time.Time `json:"destroyedAt"`
	PlayerID  string    `json:"playerId"`
}

type DestructionBatch struct {
	Records    []VoxelDestruction `json:"records"`
	BatchID    string             `json:"batchId"`
	Timestamp  time.Time          `json:"timestamp"`
}

type GameStats struct {
	TotalVoxels        int     `json:"totalVoxels"`
	DestroyedVoxels    int     `json:"destroyedVoxels"`
	DestructionPercent float64 `json:"destructionPercent"`
	AverageForce       float64 `json:"averageForce"`
	PeakForce          float64 `json:"peakForce"`
	CurrentWindSpeed   float64 `json:"currentWindSpeed"`
}

type PlayerSession struct {
	PlayerID  string    `json:"playerId"`
	Connected time.Time `json:"connected"`
	LastSeen  time.Time `json:"lastSeen"`
}

type GustEvent struct {
	ID         string    `json:"id"`
	Strength   float64   `json:"strength"`
	Duration   float64   `json:"duration"`
	DirectionX float64   `json:"directionX"`
	DirectionY float64   `json:"directionY"`
	DirectionZ float64   `json:"directionZ"`
	StartTime  time.Time `json:"startTime"`
	Active     bool      `json:"active"`
}

type AdvancedWindParams struct {
	BaseDirectionX float64 `json:"baseDirectionX"`
	BaseDirectionY float64 `json:"baseDirectionY"`
	BaseDirectionZ float64 `json:"baseDirectionZ"`
	BaseSpeed      float64 `json:"baseSpeed"`
	NoiseScale     float64 `json:"noiseScale"`
	NoiseSpeed     float64 `json:"noiseSpeed"`
	Turbulence     float64 `json:"turbulence"`
	EnableEddies   bool    `json:"enableEddies"`
	EddyStrength   float64 `json:"eddyStrength"`
	UpdatedAt      int64   `json:"updatedAt"`
}
