package redisclient

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/go-redis/redis/v8"
)

type Client struct {
	rdb *redis.Client
	ctx context.Context
}

func New(addr, password string, db int) *Client {
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           db,
		PoolSize:     50,
		MinIdleConns: 10,
	})

	return &Client{
		rdb: rdb,
		ctx: context.Background(),
	}
}

func (c *Client) Ping() error {
	return c.rdb.Ping(c.ctx).Err()
}

func (c *Client) IncrementFingerprint(nodeID, fingerprint string, window time.Duration) (int64, error) {
	key := fmt.Sprintf("fp:%s:%s", nodeID, fingerprint)

	count, err := c.rdb.Incr(c.ctx, key).Result()
	if err != nil {
		return 0, err
	}

	if count == 1 {
		c.rdb.Expire(c.ctx, key, window)
	} else if count%50 == 0 {
		c.rdb.Expire(c.ctx, key, window)
	}

	return count, nil
}

func (c *Client) GetFingerprintCount(nodeID, fingerprint string) (int64, error) {
	key := fmt.Sprintf("fp:%s:%s", nodeID, fingerprint)
	return c.rdb.Get(c.ctx, key).Int64()
}

func (c *Client) GetAllFingerprintCounts(nodeID string) (map[string]int64, error) {
	pattern := fmt.Sprintf("fp:%s:*", nodeID)
	iter := c.rdb.Scan(c.ctx, 0, pattern, 0).Iterator()

	result := make(map[string]int64)
	for iter.Next(c.ctx) {
		key := iter.Val()
		count, err := c.rdb.Get(c.ctx, key).Int64()
		if err == nil {
			parts := strings.Split(key, ":")
			if len(parts) >= 3 {
				fp := strings.Join(parts[2:], ":")
				result[fp] = count
			}
		}
	}

	return result, iter.Err()
}

func (c *Client) Close() error {
	return c.rdb.Close()
}
