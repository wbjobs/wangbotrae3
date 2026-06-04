package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
	"voxel-wind-destruction/pkg/models"
)

type Client struct {
	rdb *redis.Client
	ctx context.Context
}

const (
	WindParamsKey         = "wind:params"
	AdvancedWindParamsKey = "wind:advanced"
	GustEventKey          = "wind:gust"
	GustChannel           = "wind:gust:updates"
	DestructionKey        = "destruction:history"
	StatsKey              = "game:stats"
	PlayersKey            = "game:players"
	DestructionChannel    = "destruction:updates"
	WindChannel           = "wind:updates"
	VoxelLockKey          = "voxel:lock"
	VoxelDestroyedKey     = "voxel:destroyed"
	LockTimeout           = 200 * time.Millisecond
	MaxLockRetries        = 5
)

func NewClient(addr, password string, db int) *Client {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	return &Client{
		rdb: rdb,
		ctx: context.Background(),
	}
}

func (c *Client) Ping() error {
	return c.rdb.Ping(c.ctx).Err()
}

func (c *Client) SetWindParams(params *models.WindParams) error {
	params.UpdatedAt = time.Now().Unix()
	data, err := json.Marshal(params)
	if err != nil {
		return err
	}

	if err := c.rdb.Set(c.ctx, WindParamsKey, data, 0).Err(); err != nil {
		return err
	}

	return c.rdb.Publish(c.ctx, WindChannel, data).Err()
}

func (c *Client) GetWindParams() (*models.WindParams, error) {
	data, err := c.rdb.Get(c.ctx, WindParamsKey).Result()
	if err != nil {
		return nil, err
	}

	var params models.WindParams
	if err := json.Unmarshal([]byte(data), &params); err != nil {
		return nil, err
	}

	return &params, nil
}

func (c *Client) RecordDestruction(records []models.VoxelDestruction) error {
	pipe := c.rdb.Pipeline()

	for _, record := range records {
		data, err := json.Marshal(record)
		if err != nil {
			return err
		}

		key := fmt.Sprintf("%s:%s", DestructionKey, record.ID)
		pipe.Set(c.ctx, key, data, 0)
		pipe.LPush(c.ctx, fmt.Sprintf("%s:list", DestructionKey), record.ID)
		pipe.ZAdd(c.ctx, fmt.Sprintf("%s:time", DestructionKey), &redis.Z{
			Score:  float64(record.DestroyedAt.Unix()),
			Member: record.ID,
		})
	}

	_, err := pipe.Exec(c.ctx)
	if err != nil {
		return err
	}

	batchData, err := json.Marshal(records)
	if err != nil {
		return err
	}

	return c.rdb.Publish(c.ctx, DestructionChannel, batchData).Err()
}

func (c *Client) GetDestructionHistory(limit, offset int64) ([]models.VoxelDestruction, error) {
	ids, err := c.rdb.LRange(c.ctx, fmt.Sprintf("%s:list", DestructionKey), offset, offset+limit-1).Result()
	if err != nil {
		return nil, err
	}

	records := make([]models.VoxelDestruction, 0, len(ids))
	for _, id := range ids {
		key := fmt.Sprintf("%s:%s", DestructionKey, id)
		data, err := c.rdb.Get(c.ctx, key).Result()
		if err != nil {
			continue
		}

		var record models.VoxelDestruction
		if err := json.Unmarshal([]byte(data), &record); err != nil {
			continue
		}
		records = append(records, record)
	}

	return records, nil
}

func (c *Client) UpdateStats(stats *models.GameStats) error {
	data, err := json.Marshal(stats)
	if err != nil {
		return err
	}
	return c.rdb.Set(c.ctx, StatsKey, data, 0).Err()
}

func (c *Client) GetStats() (*models.GameStats, error) {
	data, err := c.rdb.Get(c.ctx, StatsKey).Result()
	if err != nil {
		return &models.GameStats{}, nil
	}

	var stats models.GameStats
	if err := json.Unmarshal([]byte(data), &stats); err != nil {
		return nil, err
	}

	return &stats, nil
}

func (c *Client) AddPlayer(playerID string) error {
	session := models.PlayerSession{
		PlayerID:  playerID,
		Connected: time.Now(),
		LastSeen:  time.Now(),
	}
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}
	return c.rdb.HSet(c.ctx, PlayersKey, playerID, data).Err()
}

func (c *Client) RemovePlayer(playerID string) error {
	return c.rdb.HDel(c.ctx, PlayersKey, playerID).Err()
}

func (c *Client) GetActivePlayers() ([]models.PlayerSession, error) {
	players, err := c.rdb.HGetAll(c.ctx, PlayersKey).Result()
	if err != nil {
		return nil, err
	}

	sessions := make([]models.PlayerSession, 0, len(players))
	for _, data := range players {
		var session models.PlayerSession
		if err := json.Unmarshal([]byte(data), &session); err != nil {
			continue
		}
		sessions = append(sessions, session)
	}

	return sessions, nil
}

func (c *Client) SubscribeWind() *redis.PubSub {
	return c.rdb.Subscribe(c.ctx, WindChannel)
}

func (c *Client) SubscribeDestruction() *redis.PubSub {
	return c.rdb.Subscribe(c.ctx, DestructionChannel)
}

func (c *Client) SubscribeGust() *redis.PubSub {
	return c.rdb.Subscribe(c.ctx, GustChannel)
}

func (c *Client) SetAdvancedWindParams(params *models.AdvancedWindParams) error {
	params.UpdatedAt = time.Now().Unix()
	data, err := json.Marshal(params)
	if err != nil {
		return err
	}

	if err := c.rdb.Set(c.ctx, AdvancedWindParamsKey, data, 0).Err(); err != nil {
		return err
	}

	return c.rdb.Publish(c.ctx, WindChannel, data).Err()
}

func (c *Client) GetAdvancedWindParams() (*models.AdvancedWindParams, error) {
	data, err := c.rdb.Get(c.ctx, AdvancedWindParamsKey).Result()
	if err != nil {
		return nil, err
	}

	var params models.AdvancedWindParams
	if err := json.Unmarshal([]byte(data), &params); err != nil {
		return nil, err
	}

	return &params, nil
}

func (c *Client) TriggerGustEvent(gust *models.GustEvent) error {
	gust.ID = fmt.Sprintf("gust-%d", time.Now().UnixNano())
	gust.StartTime = time.Now()
	gust.Active = true

	data, err := json.Marshal(gust)
	if err != nil {
		return err
	}

	if err := c.rdb.Set(c.ctx, GustEventKey, data, time.Duration(gust.Duration)*time.Second).Err(); err != nil {
		return err
	}

	return c.rdb.Publish(c.ctx, GustChannel, data).Err()
}

func (c *Client) GetCurrentGust() (*models.GustEvent, error) {
	data, err := c.rdb.Get(c.ctx, GustEventKey).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var gust models.GustEvent
	if err := json.Unmarshal([]byte(data), &gust); err != nil {
		return nil, err
	}

	return &gust, nil
}

func (c *Client) AcquireVoxelLock(x, y, z int) (bool, string, error) {
	lockKey := fmt.Sprintf("%s:%d:%d:%d", VoxelLockKey, x, y, z)
	lockValue := fmt.Sprintf("%d", time.Now().UnixNano())

	ok, err := c.rdb.SetNX(c.ctx, lockKey, lockValue, LockTimeout).Result()
	if err != nil {
		return false, "", err
	}

	return ok, lockValue, nil
}

func (c *Client) ReleaseVoxelLock(x, y, z int, lockValue string) error {
	lockKey := fmt.Sprintf("%s:%d:%d:%d", VoxelLockKey, x, y, z)

	script := `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("DEL", KEYS[1])
		else
			return 0
		end
	`
	_, err := c.rdb.Eval(c.ctx, script, []string{lockKey}, lockValue).Result()
	return err
}

func (c *Client) IsVoxelDestroyed(x, y, z int) (bool, error) {
	voxelKey := fmt.Sprintf("%s:%d:%d:%d", VoxelDestroyedKey, x, y, z)
	exists, err := c.rdb.Exists(c.ctx, voxelKey).Result()
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}

func (c *Client) MarkVoxelDestroyed(x, y, z int, playerID string) (bool, error) {
	voxelKey := fmt.Sprintf("%s:%d:%d:%d", VoxelDestroyedKey, x, y, z)

	script := `
		if redis.call("EXISTS", KEYS[1]) == 1 then
			return 0
		else
			redis.call("SET", KEYS[1], ARGV[1], "EX", 86400)
			return 1
		end
	`
	result, err := c.rdb.Eval(c.ctx, script, []string{voxelKey}, playerID).Result()
	if err != nil {
		return false, err
	}

	return result.(int64) == 1, nil
}

func (c *Client) RecordDestructionWithLock(records []models.VoxelDestruction) ([]models.VoxelDestruction, []models.VoxelDestruction, error) {
	var successful []models.VoxelDestruction
	var failed []models.VoxelDestruction

	for _, record := range records {
		success := false
		var lockValue string
		var lockAcquired bool
		var err error

		for retry := 0; retry < MaxLockRetries; retry++ {
			lockAcquired, lockValue, err = c.AcquireVoxelLock(record.VoxelX, record.VoxelY, record.VoxelZ)
			if err != nil {
				time.Sleep(10 * time.Millisecond)
				continue
			}

			if lockAcquired {
				break
			}

			time.Sleep(20 * time.Millisecond)
		}

		if !lockAcquired {
			failed = append(failed, record)
			continue
		}

		wasMarked, err := c.MarkVoxelDestroyed(record.VoxelX, record.VoxelY, record.VoxelZ, record.PlayerID)
		if err == nil && wasMarked {
			data, _ := json.Marshal(record)
			key := fmt.Sprintf("%s:%s", DestructionKey, record.ID)
			c.rdb.Set(c.ctx, key, data, 0)
			c.rdb.LPush(c.ctx, fmt.Sprintf("%s:list", DestructionKey), record.ID)
			c.rdb.ZAdd(c.ctx, fmt.Sprintf("%s:time", DestructionKey), &redis.Z{
				Score:  float64(record.DestroyedAt.Unix()),
				Member: record.ID,
			})
			successful = append(successful, record)
			success = true
		} else {
			failed = append(failed, record)
		}

		c.ReleaseVoxelLock(record.VoxelX, record.VoxelY, record.VoxelZ, lockValue)

		if !success {
			continue
		}
	}

	if len(successful) > 0 {
		batchData, err := json.Marshal(successful)
		if err == nil {
			c.rdb.Publish(c.ctx, DestructionChannel, batchData)
		}
	}

	return successful, failed, nil
}

func (c *Client) Close() error {
	return c.rdb.Close()
}

func (c *Client) GetAllDestroyedVoxels() ([]models.VoxelDestruction, error) {
	keys, err := c.rdb.Keys(c.ctx, fmt.Sprintf("%s:*:*:*", VoxelDestroyedKey)).Result()
	if err != nil {
		return nil, err
	}

	var results []models.VoxelDestruction
	for _, key := range keys {
		playerID, err := c.rdb.Get(c.ctx, key).Result()
		if err != nil {
			continue
		}

		parts := key[len(VoxelDestroyedKey)+1:]
		var x, y, z int
		fmt.Sscanf(parts, "%d:%d:%d", &x, &y, &z)

		results = append(results, models.VoxelDestruction{
			VoxelX:   x,
			VoxelY:   y,
			VoxelZ:   z,
			PlayerID: playerID,
		})
	}

	return results, nil
}

func (c *Client) SetWindGridState(state *models.WindGridState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return c.rdb.Set(c.ctx, "wind:grid:state", data, 0).Err()
}

func (c *Client) GetWindGridState() (*models.WindGridState, error) {
	data, err := c.rdb.Get(c.ctx, "wind:grid:state").Result()
	if err != nil {
		return nil, err
	}

	var state models.WindGridState
	if err := json.Unmarshal([]byte(data), &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (c *Client) SetObstacle(x, y, z int, active bool, playerID string) error {
	obstacle := models.WindObstacle{
		VoxelX:   x,
		VoxelY:   y,
		VoxelZ:   z,
		Active:   active,
		PlayerID: playerID,
	}
	data, err := json.Marshal(obstacle)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("wind:obstacle:%d:%d:%d", x, y, z)
	if active {
		return c.rdb.Set(c.ctx, key, data, 0).Err()
	}
	return c.rdb.Del(c.ctx, key).Err()
}

func (c *Client) GetObstacle(x, y, z int) (*models.WindObstacle, error) {
	key := fmt.Sprintf("wind:obstacle:%d:%d:%d", x, y, z)
	data, err := c.rdb.Get(c.ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var obstacle models.WindObstacle
	if err := json.Unmarshal([]byte(data), &obstacle); err != nil {
		return nil, err
	}
	return &obstacle, nil
}

func (c *Client) GetAllObstacles() ([]models.WindObstacle, error) {
	keys, err := c.rdb.Keys(c.ctx, "wind:obstacle:*:*:*").Result()
	if err != nil {
		return nil, err
	}

	var results []models.WindObstacle
	for _, key := range keys {
		data, err := c.rdb.Get(c.ctx, key).Result()
		if err != nil {
			continue
		}

		var obstacle models.WindObstacle
		if err := json.Unmarshal([]byte(data), &obstacle); err != nil {
			continue
		}
		results = append(results, obstacle)
	}

	return results, nil
}

const WindFieldChannel = "wind:field:updates"

func (c *Client) PublishWindFieldUpdate(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return c.rdb.Publish(c.ctx, WindFieldChannel, jsonData).Err()
}

func (c *Client) SubscribeWindField() *redis.PubSub {
	return c.rdb.Subscribe(c.ctx, WindFieldChannel)
}
