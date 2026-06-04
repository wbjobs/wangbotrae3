package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"logfingerprint/pkg/redisclient"
	"logfingerprint/pkg/sqlite"
)

type AlertService struct {
	redis  *redisclient.Client
	sqlite *sqlite.Store

	cooldown     time.Duration
	cooldownMap  sync.Map

	httpClient *http.Client
}

type WebhookPayload struct {
	AlertID     string              `json:"alert_id"`
	RuleID      string              `json:"rule_id"`
	RuleName    string              `json:"rule_name"`
	Fingerprint string              `json:"fingerprint"`
	Template    string              `json:"template"`
	NodeID      string              `json:"node_id"`
	Count       int64               `json:"count"`
	Threshold   int64               `json:"threshold"`
	WindowSecs  int                 `json:"window_seconds"`
	TriggeredAt int64               `json:"triggered_at"`
	Webhooks    []sqlite.WebhookResult `json:"webhook_results"`
}

type AlertRuleRequest struct {
	Name          string   `json:"name" binding:"required"`
	Threshold     int64    `json:"threshold" binding:"required"`
	WindowSeconds int      `json:"window_seconds" binding:"required"`
	NodeWhitelist []string `json:"node_whitelist"`
	Enabled       *bool    `json:"enabled"`
}

type WebhookRequest struct {
	Name    string `json:"name" binding:"required"`
	URL     string `json:"url" binding:"required"`
	Secret  string `json:"secret"`
	Enabled *bool  `json:"enabled"`
}

func NewAlertService(redis *redisclient.Client, db *sqlite.Store) *AlertService {
	return &AlertService{
		redis:     redis,
		sqlite:    db,
		cooldown:  5 * time.Minute,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *AlertService) EvaluateAndAlert(nodeID, fingerprint, template string, count int64) {
	rules, err := s.sqlite.GetEnabledAlertRules()
	if err != nil {
		log.Printf("AlertService: failed to get alert rules: %v", err)
		return
	}

	for _, rule := range rules {
		if !s.matchRule(rule, nodeID, count) {
			continue
		}

		cooldownKey := fmt.Sprintf("%s:%s:%s", rule.ID, fingerprint, nodeID)
		if last, ok := s.cooldownMap.Load(cooldownKey); ok {
			if time.Since(last.(time.Time)) < s.cooldown {
				continue
			}
		}

		s.cooldownMap.Store(cooldownKey, time.Now())

		webhooks, err := s.sqlite.GetEnabledWebhooks()
		if err != nil {
			log.Printf("AlertService: failed to get webhooks: %v", err)
			webhooks = nil
		}

		var webhookResults []sqlite.WebhookResult
		for _, wh := range webhooks {
			result := s.sendWebhook(wh, rule, fingerprint, template, nodeID, count)
			webhookResults = append(webhookResults, result)
		}

		history := sqlite.AlertHistory{
			ID:            uuid.New().String(),
			RuleID:        rule.ID,
			RuleName:      rule.Name,
			Fingerprint:   fingerprint,
			Template:      template,
			NodeID:        nodeID,
			Count:         count,
			Threshold:     rule.Threshold,
			WindowSecs:    rule.WindowSeconds,
			WebhookResults: webhookResults,
			CreatedAt:     time.Now(),
		}

		if err := s.sqlite.CreateAlertHistory(history); err != nil {
			log.Printf("AlertService: failed to save alert history: %v", err)
		}
	}
}

func (s *AlertService) matchRule(rule sqlite.AlertRule, nodeID string, count int64) bool {
	if count < rule.Threshold {
		return false
	}

	if len(rule.NodeWhitelist) > 0 {
		matched := false
		for _, n := range rule.NodeWhitelist {
			if n == nodeID || n == "*" {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	return true
}

func (s *AlertService) sendWebhook(wh sqlite.WebhookConfig, rule sqlite.AlertRule, fingerprint, template, nodeID string, count int64) sqlite.WebhookResult {
	result := sqlite.WebhookResult{
		WebhookID:  wh.ID,
		WebhookURL: wh.URL,
	}

	payload := WebhookPayload{
		AlertID:     uuid.New().String(),
		RuleID:      rule.ID,
		RuleName:    rule.Name,
		Fingerprint: fingerprint,
		Template:    template,
		NodeID:      nodeID,
		Count:       count,
		Threshold:   rule.Threshold,
		WindowSecs:  rule.WindowSeconds,
		TriggeredAt: time.Now().Unix(),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		result.Success = false
		result.Error = err.Error()
		return result
	}

	req, err := http.NewRequest("POST", wh.URL, bytes.NewReader(body))
	if err != nil {
		result.Success = false
		result.Error = err.Error()
		return result
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Alert-Source", "log-fingerprint-api")
	req.Header.Set("X-Alert-Rule-ID", rule.ID)

	if wh.Secret != "" {
		mac := hmac.New(sha256.New, []byte(wh.Secret))
		mac.Write(body)
		sig := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Webhook-Signature", sig)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		result.Success = false
		result.Error = err.Error()
		return result
	}
	defer resp.Body.Close()

	result.StatusCode = resp.StatusCode
	result.Success = resp.StatusCode >= 200 && resp.StatusCode < 300

	if !result.Success {
		io.Copy(io.Discard, resp.Body)
		result.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}

	return result
}

func (s *AlertService) CreateAlertRule(req AlertRuleRequest) (*sqlite.AlertRule, error) {
	now := time.Now()
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.NodeWhitelist == nil {
		req.NodeWhitelist = []string{}
	}

	rule := sqlite.AlertRule{
		ID:            uuid.New().String(),
		Name:          req.Name,
		Threshold:     req.Threshold,
		WindowSeconds: req.WindowSeconds,
		NodeWhitelist: req.NodeWhitelist,
		Enabled:       enabled,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := s.sqlite.CreateAlertRule(rule); err != nil {
		return nil, err
	}
	return &rule, nil
}

func (s *AlertService) GetAlertRules() ([]sqlite.AlertRule, error) {
	return s.sqlite.GetAlertRules()
}

func (s *AlertService) GetAlertRule(id string) (*sqlite.AlertRule, error) {
	return s.sqlite.GetAlertRule(id)
}

func (s *AlertService) UpdateAlertRule(id string, req AlertRuleRequest) (*sqlite.AlertRule, error) {
	existing, err := s.sqlite.GetAlertRule(id)
	if err != nil {
		return nil, err
	}

	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.Threshold > 0 {
		existing.Threshold = req.Threshold
	}
	if req.WindowSeconds > 0 {
		existing.WindowSeconds = req.WindowSeconds
	}
	if req.NodeWhitelist != nil {
		existing.NodeWhitelist = req.NodeWhitelist
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	existing.UpdatedAt = time.Now()

	if err := s.sqlite.UpdateAlertRule(*existing); err != nil {
		return nil, err
	}
	return existing, nil
}

func (s *AlertService) DeleteAlertRule(id string) error {
	return s.sqlite.DeleteAlertRule(id)
}

func (s *AlertService) CreateWebhook(req WebhookRequest) (*sqlite.WebhookConfig, error) {
	now := time.Now()
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	wh := sqlite.WebhookConfig{
		ID:        uuid.New().String(),
		Name:      req.Name,
		URL:       req.URL,
		Secret:    req.Secret,
		Enabled:   enabled,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := s.sqlite.CreateWebhook(wh); err != nil {
		return nil, err
	}
	return &wh, nil
}

func (s *AlertService) GetWebhooks() ([]sqlite.WebhookConfig, error) {
	return s.sqlite.GetWebhooks()
}

func (s *AlertService) GetWebhook(id string) (*sqlite.WebhookConfig, error) {
	return s.sqlite.GetWebhook(id)
}

func (s *AlertService) UpdateWebhook(id string, req WebhookRequest) (*sqlite.WebhookConfig, error) {
	existing, err := s.sqlite.GetWebhook(id)
	if err != nil {
		return nil, err
	}

	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.URL != "" {
		existing.URL = req.URL
	}
	existing.Secret = req.Secret
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	existing.UpdatedAt = time.Now()

	if err := s.sqlite.UpdateWebhook(*existing); err != nil {
		return nil, err
	}
	return existing, nil
}

func (s *AlertService) DeleteWebhook(id string) error {
	return s.sqlite.DeleteWebhook(id)
}

func (s *AlertService) GetAlertHistory(limit, offset int) ([]sqlite.AlertHistory, error) {
	return s.sqlite.GetAlertHistory(limit, offset)
}

func (s *AlertService) GetAlertHistoryByRule(ruleID string, limit, offset int) ([]sqlite.AlertHistory, error) {
	return s.sqlite.GetAlertHistoryByRule(ruleID, limit, offset)
}

func (s *AlertService) GetAlertHistoryByNode(nodeID string, limit, offset int) ([]sqlite.AlertHistory, error) {
	return s.sqlite.GetAlertHistoryByNode(nodeID, limit, offset)
}

func (s *AlertService) GetAlertHistoryByFingerprint(fingerprint string, limit, offset int) ([]sqlite.AlertHistory, error) {
	return s.sqlite.GetAlertHistoryByFingerprint(fingerprint, limit, offset)
}
