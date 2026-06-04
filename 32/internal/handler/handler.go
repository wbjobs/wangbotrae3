package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"logfingerprint/internal/service"
)

type Handler struct {
	logService     *service.LogService
	anomalyService *service.AnomalyService
	alertService   *service.AlertService
}

func New(logService *service.LogService, anomalyService *service.AnomalyService, alertService *service.AlertService) *Handler {
	return &Handler{
		logService:     logService,
		anomalyService: anomalyService,
		alertService:   alertService,
	}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api/v1")
	{
		api.POST("/logs", h.IngestLog)
		api.POST("/logs/batch", h.IngestLogBatch)
		logs := api.Group("/logs")
		{
			logs.GET("/node/:node_id", h.GetLogsByNode)
			logs.GET("/fingerprint/:fingerprint", h.GetLogsByFingerprint)
			logs.GET("/range", h.GetLogsByTimeRange)
		}

		anomalies := api.Group("/anomalies")
		{
			anomalies.GET("/node/:node_id", h.GetAnomaliesByNode)
			anomalies.GET("/node/:node_id/fingerprint/:fingerprint", h.GetAnomalyByFingerprint)
			anomalies.GET("/node/:node_id/range", h.GetAnomaliesByTimeRange)
		}

		stats := api.Group("/stats")
		{
			stats.GET("/node/:node_id/fingerprints", h.GetFingerprintStats)
		}

		alerts := api.Group("/alerts")
		{
			alerts.GET("/rules", h.ListAlertRules)
			alerts.GET("/rules/:id", h.GetAlertRule)
			alerts.POST("/rules", h.CreateAlertRule)
			alerts.PUT("/rules/:id", h.UpdateAlertRule)
			alerts.DELETE("/rules/:id", h.DeleteAlertRule)

			alerts.GET("/webhooks", h.ListWebhooks)
			alerts.GET("/webhooks/:id", h.GetWebhook)
			alerts.POST("/webhooks", h.CreateWebhook)
			alerts.PUT("/webhooks/:id", h.UpdateWebhook)
			alerts.DELETE("/webhooks/:id", h.DeleteWebhook)

			alerts.GET("/history", h.GetAlertHistory)
			alerts.GET("/history/rule/:rule_id", h.GetAlertHistoryByRule)
			alerts.GET("/history/node/:node_id", h.GetAlertHistoryByNode)
			alerts.GET("/history/fingerprint/:fingerprint", h.GetAlertHistoryByFingerprint)
		}
	}
}

func (h *Handler) IngestLog(c *gin.Context) {
	var req service.LogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.logService.ProcessLog(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, resp)
}

func (h *Handler) IngestLogBatch(c *gin.Context) {
	var reqs []service.LogRequest
	if err := c.ShouldBindJSON(&reqs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(reqs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "empty batch"})
		return
	}

	if len(reqs) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "batch size exceeds 500"})
		return
	}

	responses, err := h.logService.ProcessLogBatch(reqs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"data":  responses,
		"count": len(responses),
	})
}

func (h *Handler) GetLogsByNode(c *gin.Context) {
	nodeID := c.Param("node_id")
	limit, offset := getPagination(c)

	logs, err := h.logService.GetLogsByNodeID(nodeID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   logs,
		"total":  len(logs),
		"limit":  limit,
		"offset": offset,
	})
}

func (h *Handler) GetLogsByFingerprint(c *gin.Context) {
	fingerprint := c.Param("fingerprint")
	limit, offset := getPagination(c)

	logs, err := h.logService.GetLogsByFingerprint(fingerprint, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   logs,
		"total":  len(logs),
		"limit":  limit,
		"offset": offset,
	})
}

func (h *Handler) GetLogsByTimeRange(c *gin.Context) {
	nodeID := c.Query("node_id")
	startStr := c.Query("start")
	endStr := c.Query("end")
	limit, offset := getPagination(c)

	start, err := parseTime(startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start time"})
		return
	}

	end, err := parseTime(endStr)
	if err != nil {
		end = time.Now()
	}

	var logs []service.LogResponse
	if nodeID != "" {
		logs, err = h.logService.GetLogsByNodeAndTimeRange(nodeID, start, end, limit, offset)
	} else {
		logs, err = h.logService.GetLogsByTimeRange(start, end, limit, offset)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   logs,
		"total":  len(logs),
		"limit":  limit,
		"offset": offset,
	})
}

func (h *Handler) GetAnomaliesByNode(c *gin.Context) {
	nodeID := c.Param("node_id")

	anomalies, err := h.anomalyService.DetectAnomalies(nodeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  anomalies,
		"total": len(anomalies),
	})
}

func (h *Handler) GetAnomalyByFingerprint(c *gin.Context) {
	nodeID := c.Param("node_id")
	fingerprint := c.Param("fingerprint")

	anomaly, err := h.anomalyService.GetAnomalyByFingerprint(nodeID, fingerprint)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, anomaly)
}

func (h *Handler) GetAnomaliesByTimeRange(c *gin.Context) {
	nodeID := c.Param("node_id")
	startStr := c.Query("start")
	endStr := c.Query("end")

	start, err := parseTime(startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start time"})
		return
	}

	end, err := parseTime(endStr)
	if err != nil {
		end = time.Now()
	}

	anomalies, err := h.anomalyService.GetAnomaliesByTimeRange(nodeID, start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  anomalies,
		"total": len(anomalies),
	})
}

func (h *Handler) GetFingerprintStats(c *gin.Context) {
	nodeID := c.Param("node_id")

	stats, err := h.anomalyService.GetFingerprintStats(nodeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  stats,
		"total": len(stats),
	})
}

func (h *Handler) ListAlertRules(c *gin.Context) {
	rules, err := h.alertService.GetAlertRules()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rules, "total": len(rules)})
}

func (h *Handler) GetAlertRule(c *gin.Context) {
	id := c.Param("id")
	rule, err := h.alertService.GetAlertRule(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) CreateAlertRule(c *gin.Context) {
	var req service.AlertRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule, err := h.alertService.CreateAlertRule(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, rule)
}

func (h *Handler) UpdateAlertRule(c *gin.Context) {
	id := c.Param("id")
	var req service.AlertRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule, err := h.alertService.UpdateAlertRule(id, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, rule)
}

func (h *Handler) DeleteAlertRule(c *gin.Context) {
	id := c.Param("id")
	if err := h.alertService.DeleteAlertRule(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handler) ListWebhooks(c *gin.Context) {
	webhooks, err := h.alertService.GetWebhooks()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": webhooks, "total": len(webhooks)})
}

func (h *Handler) GetWebhook(c *gin.Context) {
	id := c.Param("id")
	wh, err := h.alertService.GetWebhook(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "webhook not found"})
		return
	}
	c.JSON(http.StatusOK, wh)
}

func (h *Handler) CreateWebhook(c *gin.Context) {
	var req service.WebhookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wh, err := h.alertService.CreateWebhook(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, wh)
}

func (h *Handler) UpdateWebhook(c *gin.Context) {
	id := c.Param("id")
	var req service.WebhookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wh, err := h.alertService.UpdateWebhook(id, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, wh)
}

func (h *Handler) DeleteWebhook(c *gin.Context) {
	id := c.Param("id")
	if err := h.alertService.DeleteWebhook(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handler) GetAlertHistory(c *gin.Context) {
	limit, offset := getPagination(c)
	histories, err := h.alertService.GetAlertHistory(limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": histories, "total": len(histories), "limit": limit, "offset": offset})
}

func (h *Handler) GetAlertHistoryByRule(c *gin.Context) {
	ruleID := c.Param("rule_id")
	limit, offset := getPagination(c)
	histories, err := h.alertService.GetAlertHistoryByRule(ruleID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": histories, "total": len(histories), "limit": limit, "offset": offset})
}

func (h *Handler) GetAlertHistoryByNode(c *gin.Context) {
	nodeID := c.Param("node_id")
	limit, offset := getPagination(c)
	histories, err := h.alertService.GetAlertHistoryByNode(nodeID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": histories, "total": len(histories), "limit": limit, "offset": offset})
}

func (h *Handler) GetAlertHistoryByFingerprint(c *gin.Context) {
	fingerprint := c.Param("fingerprint")
	limit, offset := getPagination(c)
	histories, err := h.alertService.GetAlertHistoryByFingerprint(fingerprint, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": histories, "total": len(histories), "limit": limit, "offset": offset})
}

func getPagination(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	return limit, offset
}

func parseTime(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	ts, err := strconv.ParseInt(s, 10, 64)
	if err == nil {
		return time.Unix(ts, 0), nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, err
	}
	return t, nil
}
