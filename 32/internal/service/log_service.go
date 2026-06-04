package service

import (
	"log"
	"time"

	"github.com/google/uuid"
	"logfingerprint/internal/config"
	"logfingerprint/pkg/fingerprint"
	"logfingerprint/pkg/redisclient"
	"logfingerprint/pkg/sqlite"
)

type LogService struct {
	config       *config.Config
	redis        *redisclient.Client
	sqlite       *sqlite.Store
	alertService *AlertService
}

type LogRequest struct {
	NodeID    string `json:"node_id" binding:"required"`
	Message   string `json:"message" binding:"required"`
	Level     string `json:"level"`
	Timestamp int64  `json:"timestamp"`
}

type LogResponse struct {
	ID          string `json:"id"`
	NodeID      string `json:"node_id"`
	Fingerprint string `json:"fingerprint"`
	Template    string `json:"template"`
	Message     string `json:"message"`
	Level       string `json:"level"`
	Timestamp   int64  `json:"timestamp"`
	IsAnomaly   bool   `json:"is_anomaly"`
	Count       int64  `json:"count"`
}

func NewLogService(cfg *config.Config, redis *redisclient.Client, db *sqlite.Store, alertSvc *AlertService) *LogService {
	return &LogService{
		config:       cfg,
		redis:        redis,
		sqlite:       db,
		alertService: alertSvc,
	}
}

func (s *LogService) ProcessLog(req LogRequest) (*LogResponse, error) {
	fp := fingerprint.Generate(req.Message)

	ts := time.Now()
	if req.Timestamp > 0 {
		ts = time.Unix(req.Timestamp, 0)
	}

	level := req.Level
	if level == "" {
		level = "INFO"
	}

	logID := uuid.New().String()
	entry := sqlite.LogEntry{
		ID:          logID,
		NodeID:      req.NodeID,
		Fingerprint: fp.Fingerprint,
		Template:    fp.Template,
		Message:     req.Message,
		Level:       level,
		Timestamp:   ts,
	}

	if err := s.sqlite.InsertLog(entry); err != nil {
		return nil, err
	}

	var count int64
	count, err := s.redis.IncrementFingerprint(req.NodeID, fp.Fingerprint, s.config.AnomalyWindow)
	if err != nil {
		log.Printf("Redis increment failed for fp=%s node=%s: %v", fp.Fingerprint, req.NodeID, err)
		count = 0
	}

	isAnomaly := count >= s.config.AnomalyThreshold

	if isAnomaly && s.alertService != nil {
		go s.alertService.EvaluateAndAlert(req.NodeID, fp.Fingerprint, fp.Template, count)
	}

	return &LogResponse{
		ID:          logID,
		NodeID:      req.NodeID,
		Fingerprint: fp.Fingerprint,
		Template:    fp.Template,
		Message:     req.Message,
		Level:       level,
		Timestamp:   ts.Unix(),
		IsAnomaly:   isAnomaly,
		Count:       count,
	}, nil
}

func (s *LogService) ProcessLogBatch(reqs []LogRequest) ([]LogResponse, error) {
	entries := make([]sqlite.LogEntry, len(reqs))
	for i, req := range reqs {
		fp := fingerprint.Generate(req.Message)

		ts := time.Now()
		if req.Timestamp > 0 {
			ts = time.Unix(req.Timestamp, 0)
		}

		level := req.Level
		if level == "" {
			level = "INFO"
		}

		entries[i] = sqlite.LogEntry{
			ID:          uuid.New().String(),
			NodeID:      req.NodeID,
			Fingerprint: fp.Fingerprint,
			Template:    fp.Template,
			Message:     req.Message,
			Level:       level,
			Timestamp:   ts,
		}
	}

	if err := s.sqlite.InsertLogBatch(entries); err != nil {
		return nil, err
	}

	fpCountMap := make(map[string]int64)
	alertTriggered := make(map[string]bool)
	for _, entry := range entries {
		count, err := s.redis.IncrementFingerprint(entry.NodeID, entry.Fingerprint, s.config.AnomalyWindow)
		if err != nil {
			log.Printf("Redis increment failed for fp=%s node=%s: %v", entry.Fingerprint, entry.NodeID, err)
			continue
		}
		key := entry.NodeID + ":" + entry.Fingerprint
		fpCountMap[key] = count

		if count >= s.config.AnomalyThreshold && !alertTriggered[key] && s.alertService != nil {
			alertTriggered[key] = true
			go s.alertService.EvaluateAndAlert(entry.NodeID, entry.Fingerprint, entry.Template, count)
		}
	}

	responses := make([]LogResponse, len(entries))
	for i, entry := range entries {
		key := entry.NodeID + ":" + entry.Fingerprint
		count := fpCountMap[key]
		responses[i] = LogResponse{
			ID:          entry.ID,
			NodeID:      entry.NodeID,
			Fingerprint: entry.Fingerprint,
			Template:    entry.Template,
			Message:     entry.Message,
			Level:       entry.Level,
			Timestamp:   entry.Timestamp.Unix(),
			IsAnomaly:   count >= s.config.AnomalyThreshold,
			Count:       count,
		}
	}

	return responses, nil
}

func (s *LogService) GetLogsByNodeID(nodeID string, limit, offset int) ([]LogResponse, error) {
	entries, err := s.sqlite.GetLogsByNodeID(nodeID, limit, offset)
	if err != nil {
		return nil, err
	}
	return s.convertToResponses(entries), nil
}

func (s *LogService) GetLogsByTimeRange(start, end time.Time, limit, offset int) ([]LogResponse, error) {
	entries, err := s.sqlite.GetLogsByTimeRange(start, end, limit, offset)
	if err != nil {
		return nil, err
	}
	return s.convertToResponses(entries), nil
}

func (s *LogService) GetLogsByNodeAndTimeRange(nodeID string, start, end time.Time, limit, offset int) ([]LogResponse, error) {
	entries, err := s.sqlite.GetLogsByNodeAndTimeRange(nodeID, start, end, limit, offset)
	if err != nil {
		return nil, err
	}
	return s.convertToResponses(entries), nil
}

func (s *LogService) GetLogsByFingerprint(fingerprint string, limit, offset int) ([]LogResponse, error) {
	entries, err := s.sqlite.GetLogsByFingerprint(fingerprint, limit, offset)
	if err != nil {
		return nil, err
	}
	return s.convertToResponses(entries), nil
}

func (s *LogService) convertToResponses(entries []sqlite.LogEntry) []LogResponse {
	responses := make([]LogResponse, len(entries))
	for i, entry := range entries {
		responses[i] = LogResponse{
			ID:          entry.ID,
			NodeID:      entry.NodeID,
			Fingerprint: entry.Fingerprint,
			Template:    entry.Template,
			Message:     entry.Message,
			Level:       entry.Level,
			Timestamp:   entry.Timestamp.Unix(),
		}
	}
	return responses
}
