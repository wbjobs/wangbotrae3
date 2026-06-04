package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"distributed-scheduler/pkg/scheduler"
)

type Handler struct {
	scheduler *scheduler.Scheduler
}

func NewHandler(s *scheduler.Scheduler) *Handler {
	return &Handler{scheduler: s}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/tasks", h.handleTasks)
	mux.HandleFunc("/api/v1/tasks/", h.handleTask)
	mux.HandleFunc("/api/v1/tasks/forward", h.handleForwardTask)
	mux.HandleFunc("/api/v1/tasks/propagate", h.handlePropagateTask)
	mux.HandleFunc("/api/v1/dags", h.handleDags)
	mux.HandleFunc("/api/v1/dags/", h.handleDag)
	mux.HandleFunc("/api/v1/nodes", h.handleNodes)
	mux.HandleFunc("/api/v1/nodes/status", h.handleNodesStatus)
	mux.HandleFunc("/api/v1/nodes/fail", h.handleNodeFail)
	mux.HandleFunc("/api/v1/health", h.handleHealth)
}

func (h *Handler) handleTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.submitTask(w, r)
	case http.MethodGet:
		h.listTasks(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) submitTask(w http.ResponseWriter, r *http.Request) {
	var task scheduler.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result, err := h.scheduler.SubmitTask(&task)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) listTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := h.scheduler.GetAllTasks()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

func (h *Handler) handleTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	taskID := r.URL.Path[len("/api/v1/tasks/"):]
	if taskID == "" {
		http.Error(w, "Task ID required", http.StatusBadRequest)
		return
	}

	task, err := h.scheduler.GetTaskStatus(taskID)
	if err != nil {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(task)
}

func (h *Handler) handleForwardTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var task scheduler.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result, err := h.scheduler.SubmitTask(&task)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) handlePropagateTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var task scheduler.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.scheduler.PropagateTask(&task)

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	type NodeInfo struct {
		NodeID   string   `json:"node_id"`
		HTTPAddr string   `json:"http_addr"`
	}

	info := NodeInfo{
		NodeID:   h.scheduler.GetNodeID(),
		HTTPAddr: r.Host,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "healthy",
		"node_id": h.scheduler.GetNodeID(),
	})
}

func (h *Handler) handleNodesStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	statuses := h.scheduler.GetNodeStatuses()

	type NodeStatusResponse struct {
		NodeID  string            `json:"node_id"`
		Nodes   map[string]string `json:"nodes"`
	}

	response := NodeStatusResponse{
		NodeID: h.scheduler.GetNodeID(),
		Nodes:  statuses,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *Handler) handleNodeFail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request struct {
		NodeHTTPAddr string `json:"node_http_addr"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if request.NodeHTTPAddr == "" {
		http.Error(w, "node_http_addr is required", http.StatusBadRequest)
		return
	}

	nodeID := h.scheduler.MarkNodeAsDead(request.NodeHTTPAddr)
	if nodeID == "" {
		http.Error(w, "Node not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"message": "Node marked as dead, task recovery initiated",
		"node_id": nodeID,
	})
}

func (h *Handler) handleDags(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.submitDag(w, r)
	case http.MethodGet:
		h.listDags(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) submitDag(w http.ResponseWriter, r *http.Request) {
	var request struct {
		DagID   string           `json:"dag_id"`
		Tasks   []*scheduler.Task `json:"tasks"`
		Timeout string           `json:"timeout"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if len(request.Tasks) == 0 {
		http.Error(w, "At least one task is required", http.StatusBadRequest)
		return
	}

	var timeout time.Duration
	if request.Timeout != "" {
		var err error
		timeout, err = time.ParseDuration(request.Timeout)
		if err != nil {
			http.Error(w, "Invalid timeout format: "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	result, err := h.scheduler.SubmitDag(request.DagID, request.Tasks, timeout)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) listDags(w http.ResponseWriter, r *http.Request) {
	dags := h.scheduler.GetAllDags()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dags)
}

func (h *Handler) handleDag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	dagID := strings.TrimPrefix(r.URL.Path, "/api/v1/dags/")
	if dagID == "" {
		http.Error(w, "DAG ID required", http.StatusBadRequest)
		return
	}

	dagState, err := h.scheduler.GetDagStatus(dagID)
	if err != nil {
		http.Error(w, "DAG not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dagState)
}
