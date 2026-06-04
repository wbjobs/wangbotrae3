package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"distributed-scheduler/pkg/api"
	"distributed-scheduler/pkg/gossip"
	"distributed-scheduler/pkg/scheduler"
	"distributed-scheduler/pkg/storage"
)

type Config struct {
	HTTPAddr    string
	GossipAddr  string
	DataDir     string
	WorkerCount int
	Peers       []string
	NodeID      string
}

func main() {
	cfg := parseConfig()

	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	store, err := storage.New(filepath.Join(cfg.DataDir, "leveldb"))
	if err != nil {
		log.Fatalf("Failed to open LevelDB: %v", err)
	}
	defer store.Close()

	nodeID, err := getOrCreateNodeID(store, cfg.NodeID)
	if err != nil {
		log.Fatalf("Failed to get node ID: %v", err)
	}
	log.Printf("Node ID: %s", nodeID)

	membership := gossip.NewMembership(nodeID, cfg.GossipAddr, cfg.HTTPAddr, 2*time.Second)
	if err := membership.Start(); err != nil {
		log.Fatalf("Failed to start gossip: %v", err)
	}
	defer membership.Stop()

	for _, peer := range cfg.Peers {
		membership.AddNode(peer, peer)
		log.Printf("Added peer: %s", peer)
	}

	sched, err := scheduler.NewScheduler(nodeID, store, membership, cfg.WorkerCount, cfg.HTTPAddr)
	if err != nil {
		log.Fatalf("Failed to create scheduler: %v", err)
	}

	handler := api.NewHandler(sched)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	go func() {
		log.Printf("Starting HTTP server on %s", cfg.HTTPAddr)
		if err := http.ListenAndServe(cfg.HTTPAddr, mux); err != nil {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			sched.UpdateNodes()
		}
	}()

	log.Println("Scheduler started successfully")
	log.Printf("Gossip address: %s", cfg.GossipAddr)
	log.Printf("HTTP API: http://%s", cfg.HTTPAddr)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")
}

func parseConfig() *Config {
	cfg := &Config{}

	flag.StringVar(&cfg.HTTPAddr, "http-addr", "localhost:8080", "HTTP API address")
	flag.StringVar(&cfg.GossipAddr, "gossip-addr", "localhost:9090", "Gossip protocol address")
	flag.StringVar(&cfg.DataDir, "data-dir", "./data", "Data directory for LevelDB")
	flag.IntVar(&cfg.WorkerCount, "workers", 10, "Number of worker goroutines")
	flag.StringVar(&cfg.NodeID, "node-id", "", "Node ID (auto-generated if not provided)")
	
	var peers string
	flag.StringVar(&peers, "peers", "", "Comma-separated list of peer gossip addresses")

	flag.Parse()

	if peers != "" {
		// In a real implementation, parse the comma-separated list
		// For simplicity, we'll just add the single peer
		cfg.Peers = []string{peers}
	}

	return cfg
}

func getOrCreateNodeID(store *storage.Store, provided string) (string, error) {
	if provided != "" {
		store.SaveNodeID(provided)
		return provided, nil
	}

	id, err := store.GetNodeID()
	if err == nil {
		return id, nil
	}

	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	id = fmt.Sprintf("node-%s", hex.EncodeToString(b))

	if err := store.SaveNodeID(id); err != nil {
		return "", err
	}

	return id, nil
}
