<template>
  <div class="app-container">
    <el-container>
      <el-header>
        <div class="header-content">
          <h1>多患者生理信号实时监测系统</h1>
          <div class="header-controls">
            <div class="baseline-status" v-if="baselineStatus.is_learning">
              <el-tag type="warning" size="small">
                基线学习中: {{ (baselineStatus.learning_progress * 100).toFixed(1) }}%
              </el-tag>
            </div>
            <el-switch
              v-model="isStreaming"
              @change="toggleStreaming"
              active-text="实时流"
              inactive-text="已暂停"
            />
            <el-button @click="showResetDialog = true" type="danger" size="small">
              重置基线
            </el-button>
            <el-button @click="showReportDialog = true" type="success" size="small">
              导出报告
            </el-button>
          </div>
        </div>
      </el-header>
      
      <el-container>
        <el-aside width="220px">
          <div class="sidebar">
            <h3>视图模式</h3>
            <el-radio-group v-model="viewMode" size="small">
              <el-radio-button value="dashboard">多患者看板</el-radio-button>
              <el-radio-button value="compare">患者对比</el-radio-button>
              <el-radio-button value="heatmap">群体热力图</el-radio-button>
              <el-radio-button value="clusters">异常聚类</el-radio-button>
            </el-radio-group>
            
            <h3 style="margin-top: 20px;">患者选择</h3>
            <el-checkbox-group v-model="selectedPatients">
              <el-checkbox
                v-for="(patient, key) in patients"
                :key="key"
                :label="key"
              >
                <span :style="{ color: patient.color }">●</span>
                {{ patient.name }}
              </el-checkbox>
            </el-checkbox-group>
            
            <h3 style="margin-top: 20px;">通道选择</h3>
            <el-select v-model="selectedChannel" style="width: 100%;" size="small">
              <el-option
                v-for="(config, key) in channels"
                :key="key"
                :label="config.name"
                :value="key"
              />
            </el-select>
          </div>
        </el-aside>
        
        <el-main>
          <div v-if="viewMode === 'dashboard'" class="dashboard-view">
            <div class="patient-grid">
              <div
                v-for="patientId in selectedPatients"
                :key="patientId"
                class="patient-card"
              >
                <PatientCard
                  :patient-id="patientId"
                  :patient="patients[patientId]"
                  :signal-data="patientSignalData[patientId] || {}"
                  :anomalies="patientAnomalies[patientId] || []"
                />
              </div>
            </div>
          </div>
          
          <div v-else-if="viewMode === 'compare'" class="compare-view">
            <div class="compare-header">
              <h3>患者波形对比 - {{ channels[selectedChannel]?.name }}</h3>
              <el-button @click="toggleDiffHighlight" size="small">
                {{ showDiff ? '隐藏' : '显示' }}差异区域
              </el-button>
            </div>
            <PatientCompare
              :patient-ids="selectedPatients"
              :patients="patients"
              :channel="selectedChannel"
              :signal-data="patientSignalData"
              :show-diff="showDiff"
            />
          </div>
          
          <div v-else-if="viewMode === 'heatmap'" class="heatmap-view">
            <h3>群体异常热力图 - 高频异常时段</h3>
            <GroupHeatmap :heatmap-data="heatmapData" />
          </div>
          
          <div v-else-if="viewMode === 'clusters'" class="clusters-view">
            <h3>异常模式聚类分析</h3>
            <AnomalyClusters :clusters="clusters" :statistics="clusterStatistics" />
          </div>
        </el-main>
        
        <el-aside width="280px">
          <div class="anomaly-panel">
            <h3>全局异常事件</h3>
            <el-table
              :data="globalAnomalyList"
              max-height="350"
              size="small"
              @row-click="handleAnomalyRowClick"
              highlight-current-row
            >
              <el-table-column prop="timestamp" label="时间" width="70">
                <template #default="{ row }">
                  {{ formatTime(row.timestamp) }}
                </template>
              </el-table-column>
              <el-table-column prop="patient_name" label="患者" width="60" />
              <el-table-column prop="channel" label="通道" width="50" />
              <el-table-column prop="score" label="分数" width="50">
                <template #default="{ row }">
                  {{ row.score?.toFixed(1) }}
                </template>
              </el-table-column>
              <el-table-column prop="status" label="状态" width="60">
                <template #default="{ row }">
                  <el-tag :type="getStatusType(row.status)" size="small">
                    {{ getStatusText(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
            
            <div v-if="selectedAnomaly" class="anomaly-detail">
              <h4>异常详情</h4>
              <p>患者: {{ selectedAnomaly.patient_name }}</p>
              <p>通道: {{ selectedAnomaly.channel }}</p>
              <p>时间: {{ formatTime(selectedAnomaly.timestamp) }}</p>
              <p>异常分数: {{ selectedAnomaly.score?.toFixed(2) }}</p>
              <p>模式: {{ selectedAnomaly.pattern_description || selectedAnomaly.pattern_type }}</p>
              
              <div class="label-actions">
                <el-button type="success" size="small" @click="labelAnomaly('confirmed')">
                  确认
                </el-button>
                <el-button type="warning" size="small" @click="labelAnomaly('false_positive')">
                  假阳性
                </el-button>
                <el-button type="danger" size="small" @click="labelAnomaly('missed')">
                  漏报
                </el-button>
              </div>
            </div>
          </div>
        </el-aside>
      </el-container>
    </el-container>
    
    <el-dialog v-model="showResetDialog" title="重置基线" width="400px">
      <el-form>
        <el-form-item label="选择患者">
          <el-select v-model="resetPatientId" placeholder="所有患者">
            <el-option label="所有患者" value="" />
            <el-option
              v-for="(patient, key) in patients"
              :key="key"
              :label="patient.name"
              :value="key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="选择通道">
          <el-select v-model="resetChannel" placeholder="所有通道">
            <el-option label="所有通道" value="" />
            <el-option
              v-for="(config, key) in channels"
              :key="key"
              :label="config.name"
              :value="key"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showResetDialog = false">取消</el-button>
        <el-button type="danger" @click="confirmResetBaseline">确认重置</el-button>
      </template>
    </el-dialog>
    
    <el-dialog v-model="showReportDialog" title="导出对比报告" width="500px">
      <el-form>
        <el-form-item label="选择患者">
          <el-checkbox-group v-model="reportPatientIds">
            <el-checkbox
              v-for="(patient, key) in patients"
              :key="key"
              :label="key"
            >
              {{ patient.name }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="对比通道">
          <el-select v-model="reportChannel" style="width: 100%;">
            <el-option
              v-for="(config, key) in channels"
              :key="key"
              :label="config.name"
              :value="key"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showReportDialog = false">取消</el-button>
        <el-button type="primary" @click="generateReport">生成报告</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import PatientCard from './components/PatientCard.vue'
import PatientCompare from './components/PatientCompare.vue'
import GroupHeatmap from './components/GroupHeatmap.vue'
import AnomalyClusters from './components/AnomalyClusters.vue'

const patients = ref({})
const channels = ref({})
const viewMode = ref('dashboard')
const selectedPatients = ref(['patient_1', 'patient_2'])
const selectedChannel = ref('ecg')
const isStreaming = ref(false)
const patientSignalData = ref({})
const patientAnomalies = ref({})
const globalAnomalyList = ref([])
const selectedAnomaly = ref(null)
const baselineStatus = ref({ is_learning: true, learning_progress: 0 })
const showResetDialog = ref(false)
const showReportDialog = ref(false)
const resetPatientId = ref('')
const resetChannel = ref('')
const reportPatientIds = ref([])
const reportChannel = ref('ecg')
const showDiff = ref(false)
const heatmapData = ref({ times: [], channels: [], matrix: [] })
const clusters = ref([])
const clusterStatistics = ref({})

let ws = null
let baselineInterval = null
let heatmapInterval = null
let clustersInterval = null
const MAX_POINTS = 500

const formatTime = (ts) => {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleTimeString()
}

const getStatusType = (status) => {
  return { detected: 'info', confirmed: 'success', false_positive: 'warning', missed: 'danger' }[status] || 'info'
}

const getStatusText = (status) => {
  return { detected: '已检测', confirmed: '已确认', false_positive: '假阳性', missed: '漏报' }[status] || status
}

const loadPatients = async () => {
  try {
    const res = await axios.get('/api/patients')
    patients.value = res.data
  } catch (e) { console.error('加载患者失败:', e) }
}

const loadChannels = async () => {
  try {
    const res = await axios.get('/api/channels')
    channels.value = res.data
  } catch (e) { console.error('加载通道失败:', e) }
}

const loadHeatmap = async () => {
  try {
    const res = await axios.get('/api/heatmap')
    heatmapData.value = res.data
  } catch (e) { console.error('加载热力图失败:', e) }
}

const loadClusters = async () => {
  try {
    const res = await axios.get('/api/clusters')
    clusters.value = res.data.clusters
    clusterStatistics.value = res.data.statistics
  } catch (e) { console.error('加载聚类失败:', e) }
}

const loadBaselineStatus = async () => {
  try {
    const res = await axios.get('/api/baseline/status')
    const allStatuses = []
    for (const pid of Object.keys(res.data)) {
      for (const ch of Object.keys(res.data[pid])) {
        allStatuses.push(res.data[pid][ch])
      }
    }
    if (allStatuses.length > 0) {
      baselineStatus.value = {
        is_learning: allStatuses.some(s => s.is_learning),
        learning_progress: allStatuses.reduce((sum, s) => sum + s.learning_progress, 0) / allStatuses.length
      }
    }
  } catch (e) { console.error('加载基线状态失败:', e) }
}

const connectWebSocket = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${window.location.host}/ws/stream`)
  
  ws.onopen = () => { isStreaming.value = true }
  ws.onmessage = (event) => handleStreamData(JSON.parse(event.data))
  ws.onerror = () => { isStreaming.value = false }
  ws.onclose = () => { isStreaming.value = false }
}

const handleStreamData = (data) => {
  for (const [patientId, patientData] of Object.entries(data.patients || {})) {
    if (!patientSignalData.value[patientId]) patientSignalData.value[patientId] = {}
    
    for (const [channel, channelData] of Object.entries(patientData.channels || {})) {
      if (!patientSignalData.value[patientId][channel]) {
        patientSignalData.value[patientId][channel] = []
      }
      
      const newPoints = channelData.timestamps.map((t, i) => ({
        time: t, value: channelData.values[i]
      }))
      patientSignalData.value[patientId][channel] = [
        ...patientSignalData.value[patientId][channel],
        ...newPoints
      ].slice(-MAX_POINTS)
    }
    
    if (patientData.anomalies?.length > 0) {
      if (!patientAnomalies.value[patientId]) {
        patientAnomalies.value[patientId] = []
      }
      patientAnomalies.value[patientId].push(...patientData.anomalies)
    }
  }
  
  if (data.all_anomalies?.length > 0) {
    for (const anomaly of data.all_anomalies) {
      globalAnomalyList.value.unshift(anomaly)
    }
    globalAnomalyList.value = globalAnomalyList.value.slice(0, 200)
  }
}

const toggleStreaming = (value) => {
  if (value && !ws) connectWebSocket()
  else if (!value && ws) { ws.close(); ws = null }
}

const handleAnomalyRowClick = (row) => { selectedAnomaly.value = row }

const labelAnomaly = async (status) => {
  if (!selectedAnomaly.value) return
  try {
    await axios.post('/api/anomalies/label', {
      patient_id: selectedAnomaly.value.patient_id,
      channel: selectedAnomaly.value.channel,
      anomaly_id: selectedAnomaly.value.id || 0,
      status,
      notes: ''
    })
    selectedAnomaly.value.status = status
  } catch (e) { console.error('标注失败:', e) }
}

const confirmResetBaseline = async () => {
  try {
    await axios.post('/api/baseline/reset', {
      patient_id: resetPatientId.value || undefined,
      channel: resetChannel.value || undefined
    })
    showResetDialog.value = false
    await loadBaselineStatus()
  } catch (e) { console.error('重置基线失败:', e) }
}

const generateReport = async () => {
  try {
    const res = await axios.post('/api/report/generate', {
      patient_ids: reportPatientIds.value,
      channel: reportChannel.value,
      format: 'html'
    }, { responseType: 'blob' })
    
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = 'comparison_report.html'
    a.click()
    window.URL.revokeObjectURL(url)
    showReportDialog.value = false
  } catch (e) { console.error('生成报告失败:', e) }
}

const toggleDiffHighlight = () => { showDiff.value = !showDiff.value }

onMounted(async () => {
  await loadPatients()
  await loadChannels()
  await loadBaselineStatus()
  await loadHeatmap()
  await loadClusters()
  connectWebSocket()
  
  baselineInterval = setInterval(loadBaselineStatus, 2000)
  heatmapInterval = setInterval(loadHeatmap, 5000)
  clustersInterval = setInterval(loadClusters, 10000)
})

onUnmounted(() => {
  if (ws) ws.close()
  if (baselineInterval) clearInterval(baselineInterval)
  if (heatmapInterval) clearInterval(heatmapInterval)
  if (clustersInterval) clearInterval(clustersInterval)
})
</script>

<style scoped>
.app-container { height: 100vh; display: flex; flex-direction: column; }
.header-content { display: flex; justify-content: space-between; align-items: center; height: 100%; }
.header-content h1 { margin: 0; color: #409eff; font-size: 20px; }
.header-controls { display: flex; gap: 10px; align-items: center; }
.baseline-status { margin-right: 10px; }
.sidebar { padding: 15px; height: 100%; background: #f5f7fa; overflow-y: auto; }
.sidebar h3 { margin: 0 0 10px 0; font-size: 14px; }
.dashboard-view { height: 100%; overflow-y: auto; padding: 10px; }
.patient-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
.patient-card { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.compare-view { padding: 15px; height: 100%; display: flex; flex-direction: column; }
.compare-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.compare-header h3 { margin: 0; }
.heatmap-view, .clusters-view { padding: 15px; height: 100%; overflow-y: auto; }
.heatmap-view h3, .clusters-view h3 { margin-top: 0; }
.anomaly-panel { padding: 15px; height: 100%; background: #f5f7fa; overflow-y: auto; }
.anomaly-panel h3 { margin-top: 0; }
.anomaly-detail { margin-top: 15px; padding: 15px; background: white; border-radius: 8px; }
.anomaly-detail h4 { margin-top: 0; }
.anomaly-detail p { margin: 5px 0; font-size: 13px; }
.label-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.el-header { background: white; border-bottom: 1px solid #e4e7ed; }
.el-aside { border-right: 1px solid #e4e7ed; }
.el-main { padding: 0; background: #f0f2f5; }
</style>
