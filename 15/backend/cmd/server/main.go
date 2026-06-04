package main

import (
	"log"
	"os"
	"strconv"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"voxel-wind-destruction/pkg/api"
	"voxel-wind-destruction/pkg/redis"
	"voxel-wind-destruction/pkg/wind"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("Warning: .env file not found: %v", err)
	}

	redisAddr := getEnv("REDIS_ADDR", "localhost:6379")
	redisPassword := getEnv("REDIS_PASSWORD", "")
	redisDB := getEnvInt("REDIS_DB", 0)
	serverPort := getEnv("SERVER_PORT", "8080")

	redisClient := redis.NewClient(redisAddr, redisPassword, redisDB)
	if err := redisClient.Ping(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer redisClient.Close()

	log.Println("Connected to Redis successfully")

	windService := wind.NewService(redisClient)
	handler := api.NewHandler(redisClient, windService)

	if getEnvBool("AUTO_WIND", true) {
		windService.StartAutoWind()
		log.Println("Auto wind simulation started")
	}

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	apiV1 := r.Group("/api/v1")
	{
		wind := apiV1.Group("/wind")
		{
			wind.GET("", handler.GetWindParams)
			wind.PUT("", handler.UpdateWindParams)
			wind.PUT("/speed/:speed", handler.SetWindSpeed)
			wind.PUT("/direction/:x/:y/:z", handler.SetWindDirection)
			wind.PUT("/turbulence/:turbulence", handler.SetTurbulence)
			wind.POST("/auto/start", handler.StartAutoWind)
			wind.POST("/auto/stop", handler.StopAutoWind)

			wind.GET("/field/state", handler.GetWindFieldState)
			wind.GET("/field/voxel/:x/:y/:z", handler.GetVoxelWind)
			wind.GET("/field/voxels", handler.GetAllUpdatedVoxels)
			wind.GET("/field/sample/:x/:y/:z", handler.SampleWindAt)
			wind.POST("/field/batch-sample", handler.BatchSampleWind)
			wind.GET("/field/config", handler.GetWindGridConfig)
			wind.PUT("/field/config", handler.UpdateWindGridConfig)

			wind.GET("/streamline/particles", handler.GetStreamlineParticles)
			wind.GET("/streamline/particles/:minX/:minY/:minZ/:maxX/:maxY/:maxZ", handler.GetStreamlineParticlesInRegion)
			wind.POST("/streamline/spawn", handler.SpawnStreamlineParticles)

			wind.GET("/obstacles", handler.GetObstacles)
			wind.POST("/obstacles", handler.SetObstacle)

			wind.POST("/gust", handler.TriggerGust)
			wind.POST("/gust/3s", handler.TriggerGust3s)
			wind.GET("/gust/current", handler.GetCurrentGust)
			wind.POST("/gust/cancel", handler.CancelGust)
		}

		destruction := apiV1.Group("/destruction")
		{
			destruction.POST("", handler.RecordDestruction)
			destruction.GET("/history", handler.GetDestructionHistory)
		}

		stats := apiV1.Group("/stats")
		{
			stats.GET("", handler.GetStats)
			stats.PUT("/total/:total", handler.SetTotalVoxels)
		}

		apiV1.GET("/ws", handler.WebSocket)
	}

	log.Printf("Server starting on port %s", serverPort)
	if err := r.Run(":" + serverPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}
