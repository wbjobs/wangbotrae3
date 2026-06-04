package scheduler

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"distributed-scheduler/pkg/bloom"
	"distributed-scheduler/pkg/consistenthash"
	"distributed-scheduler/pkg/dag"
	"distributed-scheduler/pkg/gossip"
	"distributed-scheduler/pkg/storage"
)

type Task struct {
	ID             string        `json:"id"`
	Name           string        `json:"name"`
	Payload        string        `json:"payload"`
	Dependencies   []string      `json:"dependencies"`
	DagID          string        `json:"dag_id"`
	MaxRetries     int           `json:"max_retries"`
	RetryCount     int           `json:"retry_count"`
	RetryDelay     time.Duration `json:"retry_delay"`
	DagTimeout     time.Duration `json:"dag_timeout"`
}

type TaskResult struct {
	TaskID     string `json:"task_id"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	Executed   bool   `json:"executed"`
	NodeID     string `json:"node_id"`
	DagID      string `json:"dag_id,omitempty"`
	RetryCount int    `json:"retry_count,omitempty"`
}

type DagState struct {
	ID         string                 `json:"id"`
	Status     string                 `json:"status"`
	CreatedAt  time.Time              `json:"created_at"`
	CompletedAt time.Time             `json:"completed_at,omitempty"`
	TimeoutAt  time.Time              `json:"timeout_at"`
	TaskIDs    []string               `json:"task_ids"`
	TaskStatus map[string]string      `json:"task_status"`
	Graph      *dag.Graph             `json:"-"`
}

type Scheduler struct {
	nodeID         string
	store          *storage.Store
	bloomFilter    *bloom.Filter
	consistentHash *consistenthash.Map
	membership     *gossip.Membership
	mutex          sync.RWMutex
	taskQueue      chan *Task
	workerCount    int
	httpAddr       string
	recoveredTasks map[string]bool
	dags           map[string]*DagState
	dagTaskQueue   chan *Task
}

func NewScheduler(nodeID string, store *storage.Store, membership *gossip.Membership, workerCount int, httpAddr string) (*Scheduler, error) {
	bfSize, bfHashCount := bloom.EstimateParameters(100000, 0.01)
	var bf *bloom.Filter

	bfData, err := store.GetBloomFilter()
	if err == nil && len(bfData) > 0 {
		bf = bloom.Deserialize(bfData)
	} else {
		bf = bloom.New(bfSize, bfHashCount)
	}

	ch := consistenthash.New(100, nil)

	s := &Scheduler{
		nodeID:         nodeID,
		store:          store,
		bloomFilter:    bf,
		consistentHash: ch,
		membership:     membership,
		taskQueue:      make(chan *Task, 1000),
		workerCount:    workerCount,
		httpAddr:       httpAddr,
		recoveredTasks: make(map[string]bool),
		dags:           make(map[string]*DagState),
		dagTaskQueue:   make(chan *Task, 1000),
	}

	s.consistentHash.Add(httpAddr)
	go s.startWorkers()
	go s.dagScheduler()

	membership.SetOnNodeFailure(s.OnNodeFailure)

	return s, nil
}

func (s *Scheduler) OnNodeFailure(node *gossip.Node) {
	log.Printf("Node %s (%s) detected as dead, recovering tasks...", node.ID, node.HTTPAddr)

	s.consistentHash.Remove(node.HTTPAddr)

	s.recoverTasksFromDeadNode(node.ID)
}

func (s *Scheduler) startWorkers() {
	for i := 0; i < s.workerCount; i++ {
		go s.worker(i)
	}
}

func (s *Scheduler) worker(id int) {
	for task := range s.taskQueue {
		s.executeTask(task)
	}
}

func (s *Scheduler) dagScheduler() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		s.checkDagTimeouts()
		s.scheduleReadyDagTasks()
	}
}

func (s *Scheduler) checkDagTimeouts() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	now := time.Now()
	for dagID, dagState := range s.dags {
		if dagState.Status == "running" && now.After(dagState.TimeoutAt) {
			log.Printf("DAG %s timed out, marking as failed", dagID)
			dagState.Status = "timeout"
			dagState.CompletedAt = now

			for taskID := range dagState.TaskStatus {
				if dagState.TaskStatus[taskID] == "pending" || dagState.TaskStatus[taskID] == "processing" {
					dagState.TaskStatus[taskID] = "cancelled"
				}
			}
		}
	}
}

func (s *Scheduler) scheduleReadyDagTasks() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	for dagID, dagState := range s.dags {
		if dagState.Status != "running" {
			continue
		}

		for taskID, status := range dagState.TaskStatus {
			if status != "pending" {
				continue
			}

			if s.canRunTask(dagState, taskID) {
				dagState.TaskStatus[taskID] = "scheduled"

				taskLog, err := s.store.GetTaskLog(taskID)
				if err != nil {
					log.Printf("Error getting task log for %s: %v", taskID, err)
					continue
				}

				task := &Task{
					ID:           taskLog.TaskID,
					Name:         taskLog.TaskName,
					Payload:      taskLog.Payload,
					DagID:        dagID,
					MaxRetries:   3,
					RetryDelay:   1 * time.Second,
				}

				go func(t *Task) {
					s.taskQueue <- t
				}(task)
			}
		}
	}
}

func (s *Scheduler) canRunTask(dagState *DagState, taskID string) bool {
	deps := dagState.Graph.GetDependencies(taskID)
	for _, depID := range deps {
		status, exists := dagState.TaskStatus[depID]
		if !exists || status != "completed" {
			return false
		}
	}
	return true
}

func (s *Scheduler) SubmitDag(dagID string, tasks []*Task, timeout time.Duration) (*TaskResult, error) {
	if dagID == "" {
		dagID = generateDagID()
	}

	if timeout == 0 {
		timeout = 30 * time.Minute
	}

	graph := dag.NewGraph()
	taskMap := make(map[string]*Task)

	for _, task := range tasks {
		if task.ID == "" {
			task.ID = generateTaskID(task.Name)
		}
		task.DagID = dagID
		taskMap[task.ID] = task

		if err := graph.AddNode(task.ID, task.Dependencies); err != nil {
			return nil, fmt.Errorf("failed to add task %s to DAG: %v", task.ID, err)
		}
	}

	if graph.HasCycle() {
		return nil, errors.New("DAG has circular dependency")
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	if _, exists := s.dags[dagID]; exists {
		return nil, errors.New("DAG with this ID already exists")
	}

	taskIDs := make([]string, 0, len(tasks))
	taskStatus := make(map[string]string)

	for _, task := range tasks {
		taskIDs = append(taskIDs, task.ID)
		taskStatus[task.ID] = "pending"

		taskLog := &storage.TaskLog{
			TaskID:    task.ID,
			TaskName:  task.Name,
			Payload:   task.Payload,
			NodeID:    "",
			Status:    "pending",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		s.store.SaveTaskLog(taskLog)
	}

	dagState := &DagState{
		ID:         dagID,
		Status:     "running",
		CreatedAt:  time.Now(),
		TimeoutAt:  time.Now().Add(timeout),
		TaskIDs:    taskIDs,
		TaskStatus: taskStatus,
		Graph:      graph,
	}
	s.dags[dagID] = dagState

	return &TaskResult{
		TaskID:   dagID,
		Status:   "submitted",
		Message:  fmt.Sprintf("DAG submitted with %d tasks", len(tasks)),
		Executed: false,
		NodeID:   s.nodeID,
		DagID:    dagID,
	}, nil
}

func (s *Scheduler) GetDagStatus(dagID string) (*DagState, error) {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	dagState, exists := s.dags[dagID]
	if !exists {
		return nil, errors.New("DAG not found")
	}

	return dagState, nil
}

func (s *Scheduler) GetAllDags() []*DagState {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	dags := make([]*DagState, 0, len(s.dags))
	for _, dagState := range s.dags {
		dags = append(dags, dagState)
	}
	return dags
}

func (s *Scheduler) executeTask(task *Task) {
	taskKey := []byte(task.Name)

	taskLog := &storage.TaskLog{
		TaskID:    task.ID,
		TaskName:  task.Name,
		Payload:   task.Payload,
		NodeID:    s.nodeID,
		Status:    "processing",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.store.SaveTaskLog(taskLog)

	if task.DagID != "" {
		s.mutex.Lock()
		if dagState, exists := s.dags[task.DagID]; exists {
			dagState.TaskStatus[task.ID] = "processing"
		}
		s.mutex.Unlock()
	}

	s.bloomFilter.Add(taskKey)
	s.saveBloomFilter()

	err := s.doExecuteTask(task)

	if err != nil {
		if task.RetryCount < task.MaxRetries {
			task.RetryCount++
			log.Printf("Task %s failed (attempt %d/%d), retrying in %v...", 
				task.ID, task.RetryCount, task.MaxRetries, task.RetryDelay)
			
			time.Sleep(task.RetryDelay)
			
			if task.DagID != "" {
				s.mutex.Lock()
				if dagState, exists := s.dags[task.DagID]; exists {
					dagState.TaskStatus[task.ID] = "pending"
				}
				s.mutex.Unlock()
			}
			
			s.taskQueue <- task
			return
		}

		log.Printf("Task %s failed after %d retries: %v", task.ID, task.MaxRetries, err)
		taskLog.Status = "failed"
		taskLog.UpdatedAt = time.Now()
		s.store.SaveTaskLog(taskLog)

		if task.DagID != "" {
			s.mutex.Lock()
			if dagState, exists := s.dags[task.DagID]; exists {
				dagState.TaskStatus[task.ID] = "failed"
				s.checkDagCompletion(dagState)
			}
			s.mutex.Unlock()
		}

		return
	}

	taskLog.Status = "completed"
	taskLog.UpdatedAt = time.Now()
	s.store.SaveTaskLog(taskLog)

	if task.DagID != "" {
		s.mutex.Lock()
		if dagState, exists := s.dags[task.DagID]; exists {
			dagState.TaskStatus[task.ID] = "completed"
			s.checkDagCompletion(dagState)
		}
		s.mutex.Unlock()
	}

	s.propagateTaskToPeers(task)
}

func (s *Scheduler) doExecuteTask(task *Task) error {
	time.Sleep(100 * time.Millisecond)
	return nil
}

func (s *Scheduler) checkDagCompletion(dagState *DagState) {
	allCompleted := true
	hasFailed := false

	for _, status := range dagState.TaskStatus {
		if status == "pending" || status == "processing" || status == "scheduled" {
			allCompleted = false
			break
		}
		if status == "failed" {
			hasFailed = true
		}
	}

	if allCompleted {
		dagState.CompletedAt = time.Now()
		if hasFailed {
			dagState.Status = "failed"
			log.Printf("DAG %s completed with failures", dagState.ID)
		} else {
			dagState.Status = "completed"
			log.Printf("DAG %s completed successfully", dagState.ID)
		}
	}
}

func (s *Scheduler) saveBloomFilter() {
	data := s.bloomFilter.Serialize()
	s.store.SaveBloomFilter(data)
}

func (s *Scheduler) SubmitTask(task *Task) (*TaskResult, error) {
	if task.DagID != "" {
		return nil, errors.New("use SubmitDag for tasks with dependencies")
	}

	taskKey := []byte(task.Name)

	if s.bloomFilter.Contains(taskKey) {
		return &TaskResult{
			TaskID:   task.ID,
			Status:   "duplicate",
			Message:  "Task already executed",
			Executed: false,
			NodeID:   s.nodeID,
		}, nil
	}

	if task.ID == "" {
		task.ID = generateTaskID(task.Name)
	}

	s.mutex.RLock()
	aliveNodes := s.membership.GetAliveNodes()
	s.mutex.RUnlock()

	for _, node := range aliveNodes {
		s.consistentHash.Add(node)
	}

	deadNodes := s.membership.GetDeadNodes()
	for _, node := range deadNodes {
		s.consistentHash.Remove(node)
	}

	targetNode := s.consistentHash.Get(task.Name)

	if targetNode != "" && targetNode != s.httpAddr {
		return s.forwardTask(task, targetNode)
	}

	select {
	case s.taskQueue <- task:
		return &TaskResult{
			TaskID:   task.ID,
			Status:   "submitted",
			Message:  "Task submitted for execution",
			Executed: false,
			NodeID:   s.nodeID,
		}, nil
	default:
		return nil, errors.New("task queue is full")
	}
}

func (s *Scheduler) recoverTasksFromDeadNode(deadNodeID string) {
	tasks, err := s.store.GetProcessingTasksByNode(deadNodeID)
	if err != nil {
		log.Printf("Error retrieving processing tasks from dead node %s: %v", deadNodeID, err)
		return
	}

	log.Printf("Found %d processing tasks on dead node %s, rescheduling...", len(tasks), deadNodeID)

	for _, taskLog := range tasks {
		s.mutex.Lock()
		if s.recoveredTasks[taskLog.TaskID] {
			s.mutex.Unlock()
			continue
		}
		s.recoveredTasks[taskLog.TaskID] = true
		s.mutex.Unlock()

		taskLog.Status = "recovering"
		taskLog.UpdatedAt = time.Now()
		s.store.SaveTaskLog(taskLog)

		task := &Task{
			ID:        taskLog.TaskID,
			Name:      taskLog.TaskName,
			Payload:   taskLog.Payload,
			MaxRetries: 3,
			RetryDelay: 1 * time.Second,
		}

		s.bloomFilter.Remove([]byte(task.Name))
		s.saveBloomFilter()

		go func(t *Task) {
			time.Sleep(100 * time.Millisecond)
			_, err := s.SubmitTask(t)
			if err != nil {
				log.Printf("Failed to resubmit recovered task %s: %v", t.ID, err)
			} else {
				log.Printf("Successfully resubmitted recovered task %s", t.ID)
			}
		}(task)
	}
}

func (s *Scheduler) forwardTask(task *Task, targetNode string) (*TaskResult, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	data, _ := json.Marshal(task)
	
	resp, err := client.Post(
		fmt.Sprintf("http://%s/api/v1/tasks/forward", targetNode),
		"application/json",
		bytes.NewReader(data),
	)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result TaskResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (s *Scheduler) propagateTaskToPeers(task *Task) {
	nodes := s.membership.GetNodes()
	for _, node := range nodes {
		go func(node string) {
			client := &http.Client{Timeout: 2 * time.Second}
			data, _ := json.Marshal(task)
			client.Post(
				fmt.Sprintf("http://%s/api/v1/tasks/propagate", node),
				"application/json",
				bytes.NewReader(data),
			)
		}(node)
	}
}

func (s *Scheduler) PropagateTask(task *Task) {
	taskKey := []byte(task.Name)
	if s.bloomFilter.Contains(taskKey) {
		return
	}

	s.bloomFilter.Add(taskKey)
	s.saveBloomFilter()
}

func (s *Scheduler) GetTaskStatus(taskID string) (*storage.TaskLog, error) {
	return s.store.GetTaskLog(taskID)
}

func (s *Scheduler) GetAllTasks() ([]*storage.TaskLog, error) {
	return s.store.GetAllTaskLogs()
}

func (s *Scheduler) GetNodeID() string {
	return s.nodeID
}

func generateTaskID(name string) string {
	h := sha256.New()
	h.Write([]byte(name + time.Now().String()))
	return fmt.Sprintf("%x", h.Sum(nil))[:16]
}

func generateDagID() string {
	h := sha256.New()
	h.Write([]byte(time.Now().String()))
	return "dag-" + fmt.Sprintf("%x", h.Sum(nil))[:12]
}

func (s *Scheduler) UpdateNodes() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	aliveNodes := s.membership.GetAliveNodes()
	for _, node := range aliveNodes {
		s.consistentHash.Add(node)
	}

	deadNodes := s.membership.GetDeadNodes()
	for _, node := range deadNodes {
		s.consistentHash.Remove(node)
	}
}

func (s *Scheduler) GetNodeStatuses() map[string]string {
	statuses := s.membership.GetAllNodesWithStatus()
	result := make(map[string]string, len(statuses))
	for addr, status := range statuses {
		result[addr] = string(status)
	}
	return result
}

func (s *Scheduler) MarkNodeAsDead(nodeHTTPAddr string) string {
	node := s.membership.MarkNodeAsDead(nodeHTTPAddr)
	if node != nil {
		return node.ID
	}
	return ""
}
