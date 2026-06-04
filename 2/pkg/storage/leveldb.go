package storage

import (
	"encoding/json"
	"time"

	"github.com/syndtr/goleveldb/leveldb"
	"github.com/syndtr/goleveldb/leveldb/util"
)

type TaskLog struct {
	TaskID    string    `json:"task_id"`
	TaskName  string    `json:"task_name"`
	Payload   string    `json:"payload"`
	NodeID    string    `json:"node_id"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Store struct {
	db *leveldb.DB
}

func New(path string) (*Store, error) {
	db, err := leveldb.OpenFile(path, nil)
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) SaveTaskLog(log *TaskLog) error {
	data, err := json.Marshal(log)
	if err != nil {
		return err
	}
	key := []byte("task:" + log.TaskID)
	return s.db.Put(key, data, nil)
}

func (s *Store) GetTaskLog(taskID string) (*TaskLog, error) {
	key := []byte("task:" + taskID)
	data, err := s.db.Get(key, nil)
	if err != nil {
		return nil, err
	}

	var log TaskLog
	if err := json.Unmarshal(data, &log); err != nil {
		return nil, err
	}
	return &log, nil
}

func (s *Store) GetAllTaskLogs() ([]*TaskLog, error) {
	var logs []*TaskLog

	iter := s.db.NewIterator(util.BytesPrefix([]byte("task:")), nil)
	defer iter.Release()

	for iter.Next() {
		var log TaskLog
		if err := json.Unmarshal(iter.Value(), &log); err != nil {
			continue
		}
		logs = append(logs, &log)
	}

	return logs, iter.Error()
}

func (s *Store) GetProcessingTasksByNode(nodeID string) ([]*TaskLog, error) {
	var logs []*TaskLog

	iter := s.db.NewIterator(util.BytesPrefix([]byte("task:")), nil)
	defer iter.Release()

	for iter.Next() {
		var log TaskLog
		if err := json.Unmarshal(iter.Value(), &log); err != nil {
			continue
		}
		if log.NodeID == nodeID && log.Status == "processing" {
			logs = append(logs, &log)
		}
	}

	return logs, iter.Error()
}

func (s *Store) GetTasksByStatus(status string) ([]*TaskLog, error) {
	var logs []*TaskLog

	iter := s.db.NewIterator(util.BytesPrefix([]byte("task:")), nil)
	defer iter.Release()

	for iter.Next() {
		var log TaskLog
		if err := json.Unmarshal(iter.Value(), &log); err != nil {
			continue
		}
		if log.Status == status {
			logs = append(logs, &log)
		}
	}

	return logs, iter.Error()
}

func (s *Store) SaveBloomFilter(data []byte) error {
	return s.db.Put([]byte("bloom:filter"), data, nil)
}

func (s *Store) GetBloomFilter() ([]byte, error) {
	return s.db.Get([]byte("bloom:filter"), nil)
}

func (s *Store) SaveNodeID(nodeID string) error {
	return s.db.Put([]byte("node:id"), []byte(nodeID), nil)
}

func (s *Store) GetNodeID() (string, error) {
	data, err := s.db.Get([]byte("node:id"), nil)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
