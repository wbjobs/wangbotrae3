package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type LogEntry struct {
	ID          string
	NodeID      string
	Fingerprint string
	Template    string
	Message     string
	Level       string
	Timestamp   time.Time
}

type FingerprintInfo struct {
	Fingerprint string
	Template    string
	FirstSeen   time.Time
	LastSeen    time.Time
	TotalCount  int64
	NodeIDs     []string
}

type AlertRule struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Threshold    int64    `json:"threshold"`
	WindowSeconds int     `json:"window_seconds"`
	NodeWhitelist []string `json:"node_whitelist"`
	Enabled      bool     `json:"enabled"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type WebhookConfig struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Secret    string    `json:"secret,omitempty"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AlertHistory struct {
	ID          string    `json:"id"`
	RuleID      string    `json:"rule_id"`
	RuleName    string    `json:"rule_name"`
	Fingerprint string    `json:"fingerprint"`
	Template    string    `json:"template"`
	NodeID      string    `json:"node_id"`
	Count       int64     `json:"count"`
	Threshold   int64     `json:"threshold"`
	WindowSecs  int       `json:"window_seconds"`
	WebhookResults []WebhookResult `json:"webhook_results"`
	CreatedAt   time.Time `json:"created_at"`
}

type WebhookResult struct {
	WebhookID  string `json:"webhook_id"`
	WebhookURL string `json:"webhook_url"`
	Success    bool   `json:"success"`
	StatusCode int    `json:"status_code,omitempty"`
	Error      string `json:"error,omitempty"`
}

type Store struct {
	db *sql.DB
	mu sync.Mutex
}

func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL")
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := initTables(db); err != nil {
		return nil, err
	}

	return &Store{db: db}, nil
}

func initTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS logs (
		id TEXT PRIMARY KEY,
		node_id TEXT NOT NULL,
		fingerprint TEXT NOT NULL,
		template TEXT NOT NULL,
		message TEXT NOT NULL,
		level TEXT DEFAULT 'INFO',
		timestamp DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS fingerprints (
		fingerprint TEXT PRIMARY KEY,
		template TEXT NOT NULL,
		first_seen DATETIME NOT NULL,
		last_seen DATETIME NOT NULL,
		total_count INTEGER DEFAULT 1
	);

	CREATE TABLE IF NOT EXISTS fingerprint_nodes (
		fingerprint TEXT NOT NULL,
		node_id TEXT NOT NULL,
		last_seen DATETIME NOT NULL,
		PRIMARY KEY (fingerprint, node_id)
	);

	CREATE TABLE IF NOT EXISTS alert_rules (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		threshold INTEGER NOT NULL DEFAULT 50,
		window_seconds INTEGER NOT NULL DEFAULT 600,
		node_whitelist TEXT DEFAULT '[]',
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS webhooks (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		url TEXT NOT NULL,
		secret TEXT DEFAULT '',
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS alert_history (
		id TEXT PRIMARY KEY,
		rule_id TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		fingerprint TEXT NOT NULL,
		template TEXT NOT NULL,
		node_id TEXT NOT NULL,
		count INTEGER NOT NULL,
		threshold INTEGER NOT NULL,
		window_seconds INTEGER NOT NULL,
		webhook_results TEXT DEFAULT '[]',
		created_at DATETIME NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_logs_node_id ON logs(node_id);
	CREATE INDEX IF NOT EXISTS idx_logs_fingerprint ON logs(fingerprint);
	CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
	CREATE INDEX IF NOT EXISTS idx_logs_node_timestamp ON logs(node_id, timestamp);
	CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
	CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id);
	CREATE INDEX IF NOT EXISTS idx_alert_history_fingerprint ON alert_history(fingerprint);
	CREATE INDEX IF NOT EXISTS idx_alert_history_node ON alert_history(node_id);
	CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at);
	`

	_, err := db.Exec(schema)
	return err
}

func (s *Store) InsertLog(entry LogEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()

	_, err = tx.Exec(`
		INSERT INTO logs (id, node_id, fingerprint, template, message, level, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, entry.ID, entry.NodeID, entry.Fingerprint, entry.Template, entry.Message, entry.Level, entry.Timestamp)
	if err != nil {
		return fmt.Errorf("insert log: %w", err)
	}

	_, err = tx.Exec(`
		INSERT INTO fingerprints (fingerprint, template, first_seen, last_seen, total_count)
		VALUES (?, ?, ?, ?, 1)
		ON CONFLICT(fingerprint) DO UPDATE SET
			last_seen = excluded.last_seen,
			total_count = total_count + 1
	`, entry.Fingerprint, entry.Template, entry.Timestamp, entry.Timestamp)
	if err != nil {
		return fmt.Errorf("upsert fingerprint: %w", err)
	}

	_, err = tx.Exec(`
		INSERT INTO fingerprint_nodes (fingerprint, node_id, last_seen)
		VALUES (?, ?, ?)
		ON CONFLICT(fingerprint, node_id) DO UPDATE SET
			last_seen = excluded.last_seen
	`, entry.Fingerprint, entry.NodeID, entry.Timestamp)
	if err != nil {
		return fmt.Errorf("upsert fingerprint_node: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	committed = true
	return nil
}

func (s *Store) InsertLogBatch(entries []LogEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()

	insertLogStmt, err := tx.Prepare(`
		INSERT INTO logs (id, node_id, fingerprint, template, message, level, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare log stmt: %w", err)
	}
	defer insertLogStmt.Close()

	upsertFPStmt, err := tx.Prepare(`
		INSERT INTO fingerprints (fingerprint, template, first_seen, last_seen, total_count)
		VALUES (?, ?, ?, ?, 1)
		ON CONFLICT(fingerprint) DO UPDATE SET
			last_seen = excluded.last_seen,
			total_count = total_count + 1
	`)
	if err != nil {
		return fmt.Errorf("prepare fp stmt: %w", err)
	}
	defer upsertFPStmt.Close()

	upsertNodeStmt, err := tx.Prepare(`
		INSERT INTO fingerprint_nodes (fingerprint, node_id, last_seen)
		VALUES (?, ?, ?)
		ON CONFLICT(fingerprint, node_id) DO UPDATE SET
			last_seen = excluded.last_seen
	`)
	if err != nil {
		return fmt.Errorf("prepare node stmt: %w", err)
	}
	defer upsertNodeStmt.Close()

	for _, entry := range entries {
		_, err = insertLogStmt.Exec(entry.ID, entry.NodeID, entry.Fingerprint, entry.Template, entry.Message, entry.Level, entry.Timestamp)
		if err != nil {
			return fmt.Errorf("insert log %s: %w", entry.ID, err)
		}

		_, err = upsertFPStmt.Exec(entry.Fingerprint, entry.Template, entry.Timestamp, entry.Timestamp)
		if err != nil {
			return fmt.Errorf("upsert fingerprint %s: %w", entry.Fingerprint, err)
		}

		_, err = upsertNodeStmt.Exec(entry.Fingerprint, entry.NodeID, entry.Timestamp)
		if err != nil {
			return fmt.Errorf("upsert node %s/%s: %w", entry.Fingerprint, entry.NodeID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit batch tx: %w", err)
	}

	committed = true
	return nil
}

func (s *Store) GetLogsByNodeID(nodeID string, limit, offset int) ([]LogEntry, error) {
	rows, err := s.db.Query(`
		SELECT id, node_id, fingerprint, template, message, level, timestamp
		FROM logs
		WHERE node_id = ?
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?
	`, nodeID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanLogs(rows)
}

func (s *Store) GetLogsByTimeRange(start, end time.Time, limit, offset int) ([]LogEntry, error) {
	rows, err := s.db.Query(`
		SELECT id, node_id, fingerprint, template, message, level, timestamp
		FROM logs
		WHERE timestamp BETWEEN ? AND ?
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?
	`, start, end, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanLogs(rows)
}

func (s *Store) GetLogsByNodeAndTimeRange(nodeID string, start, end time.Time, limit, offset int) ([]LogEntry, error) {
	rows, err := s.db.Query(`
		SELECT id, node_id, fingerprint, template, message, level, timestamp
		FROM logs
		WHERE node_id = ? AND timestamp BETWEEN ? AND ?
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?
	`, nodeID, start, end, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanLogs(rows)
}

func (s *Store) GetLogsByFingerprint(fingerprint string, limit, offset int) ([]LogEntry, error) {
	rows, err := s.db.Query(`
		SELECT id, node_id, fingerprint, template, message, level, timestamp
		FROM logs
		WHERE fingerprint = ?
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?
	`, fingerprint, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanLogs(rows)
}

func (s *Store) GetFingerprintInfo(fingerprint string) (*FingerprintInfo, error) {
	var info FingerprintInfo
	err := s.db.QueryRow(`
		SELECT fingerprint, template, first_seen, last_seen, total_count
		FROM fingerprints
		WHERE fingerprint = ?
	`, fingerprint).Scan(&info.Fingerprint, &info.Template, &info.FirstSeen, &info.LastSeen, &info.TotalCount)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT node_id FROM fingerprint_nodes WHERE fingerprint = ?
	`, fingerprint)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err == nil {
			info.NodeIDs = append(info.NodeIDs, nodeID)
		}
	}

	return &info, nil
}

func scanLogs(rows *sql.Rows) ([]LogEntry, error) {
	var logs []LogEntry
	for rows.Next() {
		var entry LogEntry
		err := rows.Scan(&entry.ID, &entry.NodeID, &entry.Fingerprint, &entry.Template, &entry.Message, &entry.Level, &entry.Timestamp)
		if err != nil {
			return nil, err
		}
		logs = append(logs, entry)
	}
	return logs, nil
}

func (s *Store) CreateAlertRule(rule AlertRule) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	whitelistJSON, _ := json.Marshal(rule.NodeWhitelist)
	_, err := s.db.Exec(`
		INSERT INTO alert_rules (id, name, threshold, window_seconds, node_whitelist, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, rule.ID, rule.Name, rule.Threshold, rule.WindowSeconds, string(whitelistJSON), rule.Enabled, rule.CreatedAt, rule.UpdatedAt)
	return err
}

func (s *Store) GetAlertRules() ([]AlertRule, error) {
	rows, err := s.db.Query(`
		SELECT id, name, threshold, window_seconds, node_whitelist, enabled, created_at, updated_at
		FROM alert_rules
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []AlertRule
	for rows.Next() {
		var rule AlertRule
		var whitelistJSON string
		var enabled int
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Threshold, &rule.WindowSeconds, &whitelistJSON, &enabled, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, err
		}
		rule.Enabled = enabled == 1
		json.Unmarshal([]byte(whitelistJSON), &rule.NodeWhitelist)
		rules = append(rules, rule)
	}
	return rules, nil
}

func (s *Store) GetAlertRule(id string) (*AlertRule, error) {
	var rule AlertRule
	var whitelistJSON string
	var enabled int
	err := s.db.QueryRow(`
		SELECT id, name, threshold, window_seconds, node_whitelist, enabled, created_at, updated_at
		FROM alert_rules
		WHERE id = ?
	`, id).Scan(&rule.ID, &rule.Name, &rule.Threshold, &rule.WindowSeconds, &whitelistJSON, &enabled, &rule.CreatedAt, &rule.UpdatedAt)
	if err != nil {
		return nil, err
	}
	rule.Enabled = enabled == 1
	json.Unmarshal([]byte(whitelistJSON), &rule.NodeWhitelist)
	return &rule, nil
}

func (s *Store) GetEnabledAlertRules() ([]AlertRule, error) {
	rows, err := s.db.Query(`
		SELECT id, name, threshold, window_seconds, node_whitelist, enabled, created_at, updated_at
		FROM alert_rules
		WHERE enabled = 1
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []AlertRule
	for rows.Next() {
		var rule AlertRule
		var whitelistJSON string
		var enabled int
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Threshold, &rule.WindowSeconds, &whitelistJSON, &enabled, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, err
		}
		rule.Enabled = true
		json.Unmarshal([]byte(whitelistJSON), &rule.NodeWhitelist)
		rules = append(rules, rule)
	}
	return rules, nil
}

func (s *Store) UpdateAlertRule(rule AlertRule) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	whitelistJSON, _ := json.Marshal(rule.NodeWhitelist)
	_, err := s.db.Exec(`
		UPDATE alert_rules
		SET name = ?, threshold = ?, window_seconds = ?, node_whitelist = ?, enabled = ?, updated_at = ?
		WHERE id = ?
	`, rule.Name, rule.Threshold, rule.WindowSeconds, string(whitelistJSON), rule.Enabled, rule.UpdatedAt, rule.ID)
	return err
}

func (s *Store) DeleteAlertRule(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`DELETE FROM alert_rules WHERE id = ?`, id)
	return err
}

func (s *Store) CreateWebhook(wh WebhookConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO webhooks (id, name, url, secret, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, wh.ID, wh.Name, wh.URL, wh.Secret, wh.Enabled, wh.CreatedAt, wh.UpdatedAt)
	return err
}

func (s *Store) GetWebhooks() ([]WebhookConfig, error) {
	rows, err := s.db.Query(`
		SELECT id, name, url, secret, enabled, created_at, updated_at
		FROM webhooks
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var webhooks []WebhookConfig
	for rows.Next() {
		var wh WebhookConfig
		var enabled int
		if err := rows.Scan(&wh.ID, &wh.Name, &wh.URL, &wh.Secret, &enabled, &wh.CreatedAt, &wh.UpdatedAt); err != nil {
			return nil, err
		}
		wh.Enabled = enabled == 1
		webhooks = append(webhooks, wh)
	}
	return webhooks, nil
}

func (s *Store) GetWebhook(id string) (*WebhookConfig, error) {
	var wh WebhookConfig
	var enabled int
	err := s.db.QueryRow(`
		SELECT id, name, url, secret, enabled, created_at, updated_at
		FROM webhooks
		WHERE id = ?
	`, id).Scan(&wh.ID, &wh.Name, &wh.URL, &wh.Secret, &enabled, &wh.CreatedAt, &wh.UpdatedAt)
	if err != nil {
		return nil, err
	}
	wh.Enabled = enabled == 1
	return &wh, nil
}

func (s *Store) GetEnabledWebhooks() ([]WebhookConfig, error) {
	rows, err := s.db.Query(`
		SELECT id, name, url, secret, enabled, created_at, updated_at
		FROM webhooks
		WHERE enabled = 1
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var webhooks []WebhookConfig
	for rows.Next() {
		var wh WebhookConfig
		var enabled int
		if err := rows.Scan(&wh.ID, &wh.Name, &wh.URL, &wh.Secret, &enabled, &wh.CreatedAt, &wh.UpdatedAt); err != nil {
			return nil, err
		}
		wh.Enabled = true
		webhooks = append(webhooks, wh)
	}
	return webhooks, nil
}

func (s *Store) UpdateWebhook(wh WebhookConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		UPDATE webhooks
		SET name = ?, url = ?, secret = ?, enabled = ?, updated_at = ?
		WHERE id = ?
	`, wh.Name, wh.URL, wh.Secret, wh.Enabled, wh.UpdatedAt, wh.ID)
	return err
}

func (s *Store) DeleteWebhook(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`DELETE FROM webhooks WHERE id = ?`, id)
	return err
}

func (s *Store) CreateAlertHistory(history AlertHistory) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	resultsJSON, _ := json.Marshal(history.WebhookResults)
	_, err := s.db.Exec(`
		INSERT INTO alert_history (id, rule_id, rule_name, fingerprint, template, node_id, count, threshold, window_seconds, webhook_results, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, history.ID, history.RuleID, history.RuleName, history.Fingerprint, history.Template, history.NodeID, history.Count, history.Threshold, history.WindowSecs, string(resultsJSON), history.CreatedAt)
	return err
}

func (s *Store) GetAlertHistory(limit, offset int) ([]AlertHistory, error) {
	rows, err := s.db.Query(`
		SELECT id, rule_id, rule_name, fingerprint, template, node_id, count, threshold, window_seconds, webhook_results, created_at
		FROM alert_history
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanAlertHistory(rows)
}

func (s *Store) GetAlertHistoryByRule(ruleID string, limit, offset int) ([]AlertHistory, error) {
	rows, err := s.db.Query(`
		SELECT id, rule_id, rule_name, fingerprint, template, node_id, count, threshold, window_seconds, webhook_results, created_at
		FROM alert_history
		WHERE rule_id = ?
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, ruleID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanAlertHistory(rows)
}

func (s *Store) GetAlertHistoryByNode(nodeID string, limit, offset int) ([]AlertHistory, error) {
	rows, err := s.db.Query(`
		SELECT id, rule_id, rule_name, fingerprint, template, node_id, count, threshold, window_seconds, webhook_results, created_at
		FROM alert_history
		WHERE node_id = ?
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, nodeID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanAlertHistory(rows)
}

func (s *Store) GetAlertHistoryByFingerprint(fingerprint string, limit, offset int) ([]AlertHistory, error) {
	rows, err := s.db.Query(`
		SELECT id, rule_id, rule_name, fingerprint, template, node_id, count, threshold, window_seconds, webhook_results, created_at
		FROM alert_history
		WHERE fingerprint = ?
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, fingerprint, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanAlertHistory(rows)
}

func scanAlertHistory(rows *sql.Rows) ([]AlertHistory, error) {
	var histories []AlertHistory
	for rows.Next() {
		var h AlertHistory
		var resultsJSON string
		if err := rows.Scan(&h.ID, &h.RuleID, &h.RuleName, &h.Fingerprint, &h.Template, &h.NodeID, &h.Count, &h.Threshold, &h.WindowSecs, &resultsJSON, &h.CreatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(resultsJSON), &h.WebhookResults)
		histories = append(histories, h)
	}
	return histories, nil
}

func (s *Store) GetLastAlertTime(ruleID, fingerprint, nodeID string) (time.Time, error) {
	var t time.Time
	err := s.db.QueryRow(`
		SELECT created_at
		FROM alert_history
		WHERE rule_id = ? AND fingerprint = ? AND node_id = ?
		ORDER BY created_at DESC
		LIMIT 1
	`, ruleID, fingerprint, nodeID).Scan(&t)
	if err == sql.ErrNoRows {
		return time.Time{}, nil
	}
	return t, err
}

func (s *Store) Close() error {
	return s.db.Close()
}
