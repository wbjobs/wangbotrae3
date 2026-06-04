package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"logfingerprint/internal/config"
	"logfingerprint/internal/handler"
	"logfingerprint/internal/service"
	"logfingerprint/pkg/redisclient"
	"logfingerprint/pkg/sqlite"
)

func main() {
	cfg := config.Default()

	redisClient := redisclient.New(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err := redisClient.Ping(); err != nil {
		log.Printf("Warning: Redis connection failed: %v", err)
		log.Println("Continuing without Redis caching...")
	}
	defer redisClient.Close()

	db, err := sqlite.New(cfg.SQLitePath)
	if err != nil {
		log.Fatalf("Failed to open SQLite database: %v", err)
	}
	defer db.Close()

	alertService := service.NewAlertService(redisClient, db)

	logService := service.NewLogService(cfg, redisClient, db, alertService)
	anomalyService := service.NewAnomalyService(cfg, redisClient, db)

	h := handler.New(logService, anomalyService, alertService)

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	h.RegisterRoutes(r)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "ok",
			"service": "log-fingerprint-api",
		})
	})

	log.Printf("Server starting on %s", cfg.ServerAddr)
	log.Printf("Redis: %s", cfg.RedisAddr)
	log.Printf("SQLite: %s", cfg.SQLitePath)
	log.Printf("Anomaly threshold: %d in %v", cfg.AnomalyThreshold, cfg.AnomalyWindow)
	log.Printf("Alert webhook push: enabled")

	if err := r.Run(cfg.ServerAddr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
