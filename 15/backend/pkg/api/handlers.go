package api

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"voxel-wind-destruction/pkg/models"
	"voxel-wind-destruction/pkg/redis"
	"voxel-wind-destruction/pkg/wind"
)

type Handler struct {
	redisClient *redis.Client
	windService *wind.Service
	upgrader    websocket.Upgrader
	clients     map[string]*websocket.Conn
	clientsMu   sync.RWMutex
}

func NewHandler(redisClient *redis.Client, windService *wind.Service) *Handler {
	h := &Handler{
		redisClient: redisClient,
		windService: windService,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		clients: make(map[string]*websocket.Conn),
	}

	go h.broadcastWindUpdates()
	go h.broadcastDestructionUpdates()
	go h.broadcastGustUpdates()
	go h.broadcastWindFieldUpdates()
	go h.periodicWindFieldBroadcast()

	return h
}

func (h *Handler) GetWindParams(c *gin.Context) {
	params := h.windService.GetCurrentParams()
	c.JSON(http.StatusOK, params)
}

func (h *Handler) UpdateWindParams(c *gin.Context) {
	var params models.WindParams
	if err := c.ShouldBindJSON(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.windService.UpdateParams(&params); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, params)
}

func (h *Handler) SetWindSpeed(c *gin.Context) {
	speedStr := c.Param("speed")
	speed, err := strconv.ParseFloat(speedStr, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid speed value"})
		return
	}

	if err := h.windService.SetSpeed(speed); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"speed": speed})
}

func (h *Handler) SetWindDirection(c *gin.Context) {
	x, _ := strconv.ParseFloat(c.Param("x"), 64)
	y, _ := strconv.ParseFloat(c.Param("y"), 64)
	z, _ := strconv.ParseFloat(c.Param("z"), 64)

	if err := h.windService.SetDirection(x, y, z); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"directionX": x, "directionY": y, "directionZ": z})
}

func (h *Handler) SetTurbulence(c *gin.Context) {
	turbulenceStr := c.Param("turbulence")
	turbulence, err := strconv.ParseFloat(turbulenceStr, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid turbulence value"})
		return
	}

	if err := h.windService.SetTurbulence(turbulence); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"turbulence": turbulence})
}

func (h *Handler) GetAdvancedWindParams(c *gin.Context) {
	params := h.windService.GetAdvancedParams()
	c.JSON(http.StatusOK, params)
}

func (h *Handler) UpdateAdvancedWindParams(c *gin.Context) {
	var params models.AdvancedWindParams
	if err := c.ShouldBindJSON(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.windService.UpdateAdvancedParams(&params); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, params)
}

func (h *Handler) TriggerGust(c *gin.Context) {
	var req struct {
		Strength   float64 `json:"strength" binding:"required,min=0"`
		Duration   float64 `json:"duration" binding:"required,min=1,max=30"`
		DirectionX float64 `json:"directionX"`
		DirectionY float64 `json:"directionY"`
		DirectionZ float64 `json:"directionZ"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.DirectionX == 0 && req.DirectionY == 0 && req.DirectionZ == 0 {
		params := h.windService.GetCurrentParams()
		req.DirectionX = params.DirectionX
		req.DirectionY = params.DirectionY
		req.DirectionZ = params.DirectionZ
	}

	gust, err := h.windService.TriggerGustEvent(req.Strength, req.Duration, req.DirectionX, req.DirectionY, req.DirectionZ)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gust)
}

func (h *Handler) GetCurrentGust(c *gin.Context) {
	gust, err := h.windService.GetCurrentGust()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if gust == nil {
		c.JSON(http.StatusOK, gin.H{"active": false})
		return
	}

	c.JSON(http.StatusOK, gust)
}

func (h *Handler) CancelGust(c *gin.Context) {
	h.windService.CancelGust()
	c.JSON(http.StatusOK, gin.H{"status": "gust cancelled"})
}

func (h *Handler) RecordDestruction(c *gin.Context) {
	var batch models.DestructionBatch
	if err := c.ShouldBindJSON(&batch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	successful, failed, err := h.redisClient.RecordDestructionWithLock(batch.Records)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(successful) > 0 {
		h.updateStats(successful)
		h.windService.SetObstacles(successful)
	}

	c.JSON(http.StatusCreated, gin.H{
		"batchId":    batch.BatchID,
		"recorded":   len(successful),
		"successful": successful,
		"failed":     failed,
		"hasConflicts": len(failed) > 0,
	})
}

func (h *Handler) GetDestructionHistory(c *gin.Context) {
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "100"), 10, 64)
	offset, _ := strconv.ParseInt(c.DefaultQuery("offset", "0"), 10, 64)

	records, err := h.redisClient.GetDestructionHistory(limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, records)
}

func (h *Handler) GetStats(c *gin.Context) {
	stats, err := h.redisClient.GetStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	params := h.windService.GetCurrentParams()
	stats.CurrentWindSpeed = params.Speed

	c.JSON(http.StatusOK, stats)
}

func (h *Handler) WebSocket(c *gin.Context) {
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	playerID := c.Query("playerId")
	if playerID == "" {
		playerID = strconv.FormatInt(time.Now().UnixNano(), 36)
	}

	h.clientsMu.Lock()
	h.clients[playerID] = conn
	h.clientsMu.Unlock()

	h.redisClient.AddPlayer(playerID)

	defer func() {
		conn.Close()
		h.clientsMu.Lock()
		delete(h.clients, playerID)
		h.clientsMu.Unlock()
		h.redisClient.RemovePlayer(playerID)
	}()

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (h *Handler) broadcastWindUpdates() {
	pubsub := h.redisClient.SubscribeWind()
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		h.broadcastToAll("wind", []byte(msg.Payload))
	}
}

func (h *Handler) broadcastDestructionUpdates() {
	pubsub := h.redisClient.SubscribeDestruction()
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		h.broadcastToAll("destruction", []byte(msg.Payload))
	}
}

func (h *Handler) broadcastGustUpdates() {
	pubsub := h.redisClient.SubscribeGust()
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		h.broadcastToAll("gust", []byte(msg.Payload))
	}
}

func (h *Handler) broadcastToAll(msgType string, data []byte) {
	message := map[string]interface{}{
		"type": msgType,
		"data": json.RawMessage(data),
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		return
	}

	h.clientsMu.RLock()
	defer h.clientsMu.RUnlock()

	for _, conn := range h.clients {
		go func(c *websocket.Conn) {
			c.WriteMessage(websocket.TextMessage, messageBytes)
		}(conn)
	}
}

func (h *Handler) updateStats(records []models.VoxelDestruction) {
	stats, _ := h.redisClient.GetStats()

	totalForce := 0.0
	destroyedNow := 0

	for _, r := range records {
		destroyedNow++
		totalForce += r.Force
		if r.Force > stats.PeakForce {
			stats.PeakForce = r.Force
		}
	}

	stats.DestroyedVoxels += destroyedNow
	if stats.TotalVoxels > 0 {
		stats.DestructionPercent = float64(stats.DestroyedVoxels) / float64(stats.TotalVoxels) * 100
	}

	if stats.DestroyedVoxels > 0 {
		stats.AverageForce = (stats.AverageForce*float64(stats.DestroyedVoxels-destroyedNow) + totalForce) / float64(stats.DestroyedVoxels)
	}

	stats.AverageForce = math.Round(stats.AverageForce*100) / 100
	stats.DestructionPercent = math.Round(stats.DestructionPercent*100) / 100

	h.redisClient.UpdateStats(stats)
}

func (h *Handler) SetTotalVoxels(c *gin.Context) {
	totalStr := c.Param("total")
	total, err := strconv.Atoi(totalStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid total value"})
		return
	}

	stats, _ := h.redisClient.GetStats()
	stats.TotalVoxels = total
	if stats.TotalVoxels > 0 {
		stats.DestructionPercent = float64(stats.DestroyedVoxels) / float64(stats.TotalVoxels) * 100
	}

	h.redisClient.UpdateStats(stats)
	c.JSON(http.StatusOK, gin.H{"totalVoxels": total})
}

func (h *Handler) StartAutoWind(c *gin.Context) {
	h.windService.StartAutoWind()
	c.JSON(http.StatusOK, gin.H{"status": "auto wind started"})
}

func (h *Handler) StopAutoWind(c *gin.Context) {
	h.windService.StopAutoWind()
	c.JSON(http.StatusOK, gin.H{"status": "auto wind stopped"})
}

func (h *Handler) GetWindFieldState(c *gin.Context) {
	state := h.windService.GetWindFieldState()
	c.JSON(http.StatusOK, state)
}

func (h *Handler) GetVoxelWind(c *gin.Context) {
	x, _ := strconv.Atoi(c.Param("x"))
	y, _ := strconv.Atoi(c.Param("y"))
	z, _ := strconv.Atoi(c.Param("z"))

	voxelWind := h.windService.GetVoxelWind(x, y, z)
	c.JSON(http.StatusOK, voxelWind)
}

func (h *Handler) GetAllUpdatedVoxels(c *gin.Context) {
	voxels := h.windService.GetUpdatedVoxels()
	c.JSON(http.StatusOK, models.WindGridData{
		State:  h.windService.GetWindFieldState(),
		Voxels: voxels,
	})
}

func (h *Handler) SampleWindAt(c *gin.Context) {
	x, _ := strconv.ParseFloat(c.Param("x"), 64)
	y, _ := strconv.ParseFloat(c.Param("y"), 64)
	z, _ := strconv.ParseFloat(c.Param("z"), 64)

	vx, vy, vz := h.windService.SampleWindAt(x, y, z)
	c.JSON(http.StatusOK, models.WindFieldSample{
		Position: models.WindVector{X: x, Y: y, Z: z},
		Velocity: models.WindVector{X: vx, Y: vy, Z: vz},
		Speed:    math.Sqrt(vx*vx + vy*vy + vz*vz),
	})
}

func (h *Handler) BatchSampleWind(c *gin.Context) {
	var req models.WindFieldBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response := h.windService.BatchSampleWind(req.Positions)
	c.JSON(http.StatusOK, response)
}

func (h *Handler) GetStreamlineParticles(c *gin.Context) {
	particles := h.windService.GetStreamlineParticles()
	c.JSON(http.StatusOK, gin.H{
		"state":     h.windService.GetWindFieldState(),
		"particles": particles,
	})
}

func (h *Handler) GetStreamlineParticlesInRegion(c *gin.Context) {
	minX, _ := strconv.ParseFloat(c.Param("minX"), 64)
	minY, _ := strconv.ParseFloat(c.Param("minY"), 64)
	minZ, _ := strconv.ParseFloat(c.Param("minZ"), 64)
	maxX, _ := strconv.ParseFloat(c.Param("maxX"), 64)
	maxY, _ := strconv.ParseFloat(c.Param("maxY"), 64)
	maxZ, _ := strconv.ParseFloat(c.Param("maxZ"), 64)

	particles := h.windService.GetStreamlineParticlesInRegion(minX, minY, minZ, maxX, maxY, maxZ)
	c.JSON(http.StatusOK, gin.H{
		"state":     h.windService.GetWindFieldState(),
		"particles": particles,
	})
}

func (h *Handler) SpawnStreamlineParticles(c *gin.Context) {
	var req struct {
		Position models.WindVector `json:"position" binding:"required"`
		Count    int               `json:"count" binding:"required,min=1,max=500"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.windService.SpawnStreamlineParticles(req.Position, req.Count)
	c.JSON(http.StatusOK, gin.H{"status": "particles spawned"})
}

func (h *Handler) GetObstacles(c *gin.Context) {
	obstacles := h.windService.GetAllObstacles()
	c.JSON(http.StatusOK, gin.H{
		"obstacles": obstacles,
		"count":     len(obstacles),
	})
}

func (h *Handler) SetObstacle(c *gin.Context) {
	var req struct {
		VoxelX   int    `json:"voxelX" binding:"required"`
		VoxelY   int    `json:"voxelY" binding:"required"`
		VoxelZ   int    `json:"voxelZ" binding:"required"`
		Active   bool   `json:"active"`
		PlayerID string `json:"playerId"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.windService.SetObstacle(req.VoxelX, req.VoxelY, req.VoxelZ, req.Active, req.PlayerID)
	c.JSON(http.StatusOK, gin.H{"status": "obstacle updated"})
}

func (h *Handler) GetWindGridConfig(c *gin.Context) {
	config := h.windService.GetWindGridConfig()
	c.JSON(http.StatusOK, config)
}

func (h *Handler) UpdateWindGridConfig(c *gin.Context) {
	var config models.WindGridConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.windService.UpdateWindGridConfig(config)
	c.JSON(http.StatusOK, config)
}

func (h *Handler) TriggerGust3s(c *gin.Context) {
	var req struct {
		Strength   float64 `json:"strength" binding:"required,min=0"`
		DirectionX float64 `json:"directionX"`
		DirectionY float64 `json:"directionY"`
		DirectionZ float64 `json:"directionZ"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.DirectionX == 0 && req.DirectionY == 0 && req.DirectionZ == 0 {
		params := h.windService.GetCurrentParams()
		req.DirectionX = params.DirectionX
		req.DirectionY = params.DirectionY
		req.DirectionZ = params.DirectionZ
	}

	gust, err := h.windService.TriggerGustEvent(req.Strength, 3.0, req.DirectionX, req.DirectionY, req.DirectionZ)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gust)
}

func (h *Handler) broadcastWindFieldUpdates() {
	pubsub := h.redisClient.SubscribeWindField()
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		h.broadcastToAll("windfield", []byte(msg.Payload))
	}
}

func (h *Handler) periodicWindFieldBroadcast() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			state := h.windService.GetWindFieldState()
			data := map[string]interface{}{
				"type":  "windfield",
				"state": state,
			}

			messageBytes, err := json.Marshal(data)
			if err == nil {
				h.broadcastToAll("windfield_state", messageBytes)
			}

		case <-h.stopChan():
			return
		}
	}
}

var stopChanInstance = make(chan struct{})

func (h *Handler) stopChan() chan struct{} {
	return stopChanInstance
}
