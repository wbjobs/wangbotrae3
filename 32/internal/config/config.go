package config

import "time"

type Config struct {
	ServerAddr        string
	RedisAddr         string
	RedisPassword     string
	RedisDB           int
	SQLitePath        string
	AnomalyThreshold  int64
	AnomalyWindow     time.Duration
}

func Default() *Config {
	return &Config{
		ServerAddr:       ":8080",
		RedisAddr:        "localhost:6379",
		RedisPassword:    "",
		RedisDB:          0,
		SQLitePath:       "./logs.db",
		AnomalyThreshold: 50,
		AnomalyWindow:    10 * time.Minute,
	}
}
