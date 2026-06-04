package service

import (
	"time"

	"logfingerprint/internal/config"
	"logfingerprint/pkg/redisclient"
	"logfingerprint/pkg/sqlite"
)

type AnomalyService struct {
	config *config.Config
	redis  *redisclient.Client
	sqlite *sqlite.Store
}

type AnomalyLog struct {
	Fingerprint   string   `json:"fingerprint"`
	Template      string   `json:"template"`
	NodeID        string   `json:"node_id"`
	Count         int64    `json:"count"`
	Threshold     int64    `json:"threshold"`
	WindowSeconds int      `json:"window_seconds"`
	FirstSeen     int64    `json:"first_seen"`
	LastSeen      int64    `json:"last_seen"`
	AffectedNodes []string `json:"affected_nodes"`
}

type FingerprintStats struct {
	Fingerprint string `json:"fingerprint"`
	Template    string `json:"template"`
	Count       int64  `json:"count"`
	NodeCount   int    `json:"node_count"`
}

func NewAnomalyService(cfg *config.Config, redis *redisclient.Client, db *sqlite.Store) *AnomalyService {
	return &AnomalyService{
		config: cfg,
		redis:  redis,
		sqlite: db,
	}
}

func (s *AnomalyService) DetectAnomalies(nodeID string) ([]AnomalyLog, error) {
	counts, err := s.redis.GetAllFingerprintCounts(nodeID)
	if err != nil {
		return nil, err
	}

	var anomalies []AnomalyLog
	for fp, count := range counts {
		if count >= s.config.AnomalyThreshold {
			info, err := s.sqlite.GetFingerprintInfo(fp)
			if err != nil {
				continue
			}

			anomalies = append(anomalies, AnomalyLog{
				Fingerprint:   fp,
				Template:      info.Template,
				NodeID:        nodeID,
				Count:         count,
				Threshold:     s.config.AnomalyThreshold,
				WindowSeconds: int(s.config.AnomalyWindow.Seconds()),
				FirstSeen:     info.FirstSeen.Unix(),
				LastSeen:      info.LastSeen.Unix(),
				AffectedNodes: info.NodeIDs,
			})
		}
	}

	return anomalies, nil
}

func (s *AnomalyService) GetAnomalyByFingerprint(nodeID, fingerprint string) (*AnomalyLog, error) {
	count, err := s.redis.GetFingerprintCount(nodeID, fingerprint)
	if err != nil {
		return nil, err
	}

	info, err := s.sqlite.GetFingerprintInfo(fingerprint)
	if err != nil {
		return nil, err
	}

	return &AnomalyLog{
		Fingerprint:   fingerprint,
		Template:      info.Template,
		NodeID:        nodeID,
		Count:         count,
		Threshold:     s.config.AnomalyThreshold,
		WindowSeconds: int(s.config.AnomalyWindow.Seconds()),
		FirstSeen:     info.FirstSeen.Unix(),
		LastSeen:      info.LastSeen.Unix(),
		AffectedNodes: info.NodeIDs,
	}, nil
}

func (s *AnomalyService) GetFingerprintStats(nodeID string) ([]FingerprintStats, error) {
	counts, err := s.redis.GetAllFingerprintCounts(nodeID)
	if err != nil {
		return nil, err
	}

	var stats []FingerprintStats
	for fp, count := range counts {
		info, err := s.sqlite.GetFingerprintInfo(fp)
		if err != nil {
			continue
		}

		stats = append(stats, FingerprintStats{
			Fingerprint: fp,
			Template:    info.Template,
			Count:       count,
			NodeCount:   len(info.NodeIDs),
		})
	}

	return stats, nil
}

func (s *AnomalyService) GetAnomaliesByTimeRange(nodeID string, start, end time.Time) ([]AnomalyLog, error) {
	logs, err := s.sqlite.GetLogsByNodeAndTimeRange(nodeID, start, end, 1000, 0)
	if err != nil {
		return nil, err
	}

	fpCounts := make(map[string]int64)
	fpTemplates := make(map[string]string)

	for _, log := range logs {
		fpCounts[log.Fingerprint]++
		fpTemplates[log.Fingerprint] = log.Template
	}

	var anomalies []AnomalyLog
	for fp, count := range fpCounts {
		if count >= s.config.AnomalyThreshold {
			info, err := s.sqlite.GetFingerprintInfo(fp)
			if err != nil {
				continue
			}

			anomalies = append(anomalies, AnomalyLog{
				Fingerprint:   fp,
				Template:      fpTemplates[fp],
				NodeID:        nodeID,
				Count:         count,
				Threshold:     s.config.AnomalyThreshold,
				WindowSeconds: int(end.Sub(start).Seconds()),
				FirstSeen:     info.FirstSeen.Unix(),
				LastSeen:      info.LastSeen.Unix(),
				AffectedNodes: info.NodeIDs,
			})
		}
	}

	return anomalies, nil
}
