<template>
  <div class="viewer-room-view">
    <el-page-header @back="goBack" content="返回房间列表" class="page-header" />

    <el-card v-loading="loading" class="room-info-card">
      <template #header>
        <div class="card-header">
          <span>房间信息</span>
          <el-tag type="success">房间号: {{ roomId }}</el-tag>
        </div>
      </template>
      <el-descriptions :column="3" border v-if="room">
        <el-descriptions-item label="房间名称">{{ room.name }}</el-descriptions-item>
        <el-descriptions-item label="主播">{{ room.createdBy }}</el-descriptions-item>
        <el-descriptions-item label="参考音轨">
          <el-tag v-if="refTrackCount > 0" type="success">{{ refTrackCount }} 个</el-tag>
          <el-tag v-else type="warning">未设置</el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="record-card">
      <template #header>
        <span>环境音录制</span>
      </template>
      <div class="recorder-container">
        <div class="recorder-display">
          <div class="timer">
            <el-icon :size="48" :class="isRecording ? 'recording' : ''"><Microphone /></el-icon>
            <span class="time">{{ formatTime(recordingTime) }}</span>
          </div>
          <el-tag v-if="isRecording" type="danger" effect="dark" class="recording-tag">录制中</el-tag>
        </div>
        <div class="recorder-controls">
          <el-button type="primary" size="large" @click="toggleRecording" :disabled="!recorderReady" :class="{ 'recording-btn': isRecording }">
            {{ isRecording ? '停止录制' : '开始录制' }}
          </el-button>
          <el-button size="large" @click="resetRecording" :disabled="isRecording">重新录制</el-button>
        </div>
        <div class="recorder-status">
          <el-tag v-if="recorderReady" type="success">麦克风已就绪</el-tag>
          <el-tag v-else type="info">等待麦克风授权</el-tag>
        </div>
      </div>
    </el-card>

    <el-card v-if="recordedBlob && sampleRateInfo" class="sample-rate-card">
      <template #header>
        <div class="card-header">
          <span>采样率信息</span>
          <el-tag :type="sampleRateInfo.actual === sampleRateInfo.target ? 'success' : 'warning'">
            {{ sampleRateInfo.actual === sampleRateInfo.target ? '已匹配' : '已重采样' }}
          </el-tag>
        </div>
      </template>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="输入采样率">{{ sampleRateInfo.actual }} Hz</el-descriptions-item>
        <el-descriptions-item label="目标采样率">{{ sampleRateInfo.target }} Hz</el-descriptions-item>
        <el-descriptions-item label="重采样比率">{{ sampleRateInfo.ratio.toFixed(4) }}</el-descriptions-item>
        <el-descriptions-item label="录制样本数">{{ sampleRateInfo.recorded.toLocaleString() }}</el-descriptions-item>
        <el-descriptions-item label="录制时长" :span="2">{{ sampleRateInfo.duration.toFixed(3) }} 秒</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card v-if="recordedBlob" class="preview-card">
      <template #header>
        <span>录制预览</span>
      </template>
      <div class="preview-container">
        <audio :src="audioUrl" controls class="audio-player" />
        <el-button type="success" size="large" :loading="syncing" @click="startSync" class="sync-btn">
          开始同步校对 ({{ refTrackCount }} 个参考音轨)
        </el-button>
      </div>
    </el-card>

    <el-card v-if="matrixResult" class="offset-card">
      <template #header>
        <div class="card-header">
          <span>偏移量矩阵</span>
          <el-tag :type="matrixResult.mode === 'multi' ? 'primary' : 'success'">
            {{ matrixResult.mode === 'multi' ? '多音轨并行计算' : '单音轨计算' }}
          </el-tag>
        </div>
      </template>

      <div class="matrix-table" v-if="matrixResult.tracks && matrixResult.tracks.length > 0">
        <el-table :data="matrixResult.tracks" stripe border>
          <el-table-column label="音轨来源" width="140">
            <template #default="{ row }">
              <el-tag type="primary">{{ row.label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="时间偏移" width="140">
            <template #default="{ row }">
              <span :class="row.timeOffset >= 0 ? 'positive' : 'negative'" class="offset-value">
                {{ row.timeOffset >= 0 ? '+' : '' }}{{ row.timeOffset.toFixed(3) }}s
              </span>
            </template>
          </el-table-column>
          <el-table-column label="置信度" width="160">
            <template #default="{ row }">
              <el-progress 
                :percentage="Number((row.confidence * 100).toFixed(1))" 
                :stroke-width="10"
                :color="getConfidenceColor(row.confidence)"
              />
            </template>
          </el-table-column>
          <el-table-column label="相似度" width="100">
            <template #default="{ row }">
              {{ (row.similarity * 100).toFixed(1) }}%
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="showWaveform(row)">
                波形对比
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="matrixResult.summary" class="matrix-summary">
        <el-descriptions :column="4" border size="small">
          <el-descriptions-item label="最大偏移">{{ matrixResult.summary.maxOffset.toFixed(3) }}s</el-descriptions-item>
          <el-descriptions-item label="最小偏移">{{ matrixResult.summary.minOffset.toFixed(3) }}s</el-descriptions-item>
          <el-descriptions-item label="偏移散布">{{ matrixResult.summary.spread.toFixed(3) }}s</el-descriptions-item>
          <el-descriptions-item label="平均置信度">{{ (matrixResult.summary.avgConfidence * 100).toFixed(1) }}%</el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="timeline-chart" ref="timelineRef">
        <canvas ref="canvasRef" :width="canvasWidth" :height="canvasHeight"></canvas>
      </div>
    </el-card>

    <el-card class="history-card">
      <template #header>
        <span>同步历史</span>
      </template>
      <el-table :data="syncSessions" stripe>
        <el-table-column prop="referenceFilename" label="参考音轨" min-width="150" />
        <el-table-column prop="recordedFilename" label="录制文件" min-width="150" />
        <el-table-column prop="timeOffset" label="时间偏移(秒)" width="130">
          <template #default="{ row }">
            <span v-if="row.timeOffset !== null" :class="row.timeOffset >= 0 ? 'positive' : 'negative'">
              {{ row.timeOffset >= 0 ? '+' : '' }}{{ row.timeOffset.toFixed(3) }}
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="confidence" label="置信度" width="130">
          <template #default="{ row }">
            <el-progress v-if="row.confidence !== null" :percentage="(row.confidence * 100).toFixed(0)" :stroke-width="8" />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" width="170">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="syncSessions.length === 0" description="暂无同步记录" />
    </el-card>

    <el-dialog v-model="waveformVisible" :title="`波形对比 - ${selectedTrack?.label || ''}`" width="800px" destroy-on-close>
      <div class="waveform-dialog">
        <div class="waveform-legend">
          <span class="legend-item"><span class="legend-dot" style="background:#409EFF"></span>参考音轨</span>
          <span class="legend-item"><span class="legend-dot" style="background:#67C23A"></span>录制音轨 (偏移校正后)</span>
        </div>
        <canvas ref="waveformCanvasRef" width="760" height="300"></canvas>
        <div class="waveform-info" v-if="selectedTrack">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="音轨来源">{{ selectedTrack.label }}</el-descriptions-item>
            <el-descriptions-item label="时间偏移">{{ selectedTrack.timeOffset?.toFixed(3) }}s</el-descriptions-item>
            <el-descriptions-item label="置信度">{{ ((selectedTrack.confidence || 0) * 100).toFixed(1) }}%</el-descriptions-item>
            <el-descriptions-item label="相似度">{{ ((selectedTrack.similarity || 0) * 100).toFixed(1) }}%</el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Microphone } from '@element-plus/icons-vue'
import { AudioRecorder, formatTime, validateSampleRate, TARGET_SAMPLE_RATE } from '@/utils/audioRecorder'
import { roomApi, audioApi, syncApi } from '@/api'

const router = useRouter()
const route = useRoute()
const roomId = computed(() => route.params.roomId)

const room = ref(null)
const audioTracks = ref([])
const loading = ref(false)
const syncing = ref(false)
const syncSessions = ref([])
const matrixResult = ref(null)

const recorder = ref(null)
const recorderReady = ref(false)
const isRecording = ref(false)
const recordingTime = ref(0)
const recordedBlob = ref(null)
const audioUrl = ref('')
const sampleRateInfo = ref(null)

const waveformVisible = ref(false)
const selectedTrack = ref(null)
const canvasRef = ref(null)
const waveformCanvasRef = ref(null)
const canvasWidth = ref(760)
const canvasHeight = ref(300)

let recordingTimer = null

const refTrackCount = computed(() => audioTracks.value.filter(t => t.trackType === 'reference').length)

const goBack = () => { router.push('/viewer') }

const initRecorder = async () => {
  try {
    recorder.value = new AudioRecorder()
    await recorder.value.init()
    recorderReady.value = true
  } catch (error) {
    ElMessage.error('无法访问麦克风')
    recorderReady.value = false
  }
}

const toggleRecording = async () => {
  if (isRecording.value) { stopRecording() } else { startRecording() }
}

const startRecording = async () => {
  if (!recorderReady.value) return
  try {
    matrixResult.value = null
    recorder.value.start()
    isRecording.value = true
    recordingTime.value = 0
    recordingTimer = setInterval(() => { recordingTime.value++ }, 1000)
  } catch (error) {
    ElMessage.error('开始录制失败')
  }
}

const stopRecording = async () => {
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null }
  try {
    const blob = await recorder.value.stop()
    isRecording.value = false
    if (blob) {
      recordedBlob.value = blob
      audioUrl.value = URL.createObjectURL(blob)
      sampleRateInfo.value = recorder.value.logSampleRateInfo()
      validateSampleRate(sampleRateInfo.value)
      ElMessage.success('录制完成')
    }
  } catch (error) {
    ElMessage.error('停止录制失败')
  }
}

const resetRecording = () => {
  recordedBlob.value = null
  audioUrl.value = ''
  matrixResult.value = null
  recordingTime.value = 0
  sampleRateInfo.value = null
}

const startSync = async () => {
  if (!recordedBlob.value) { ElMessage.warning('请先录制音频'); return }
  if (refTrackCount.value === 0) { ElMessage.warning('房间没有参考音轨'); return }

  syncing.value = true
  try {
    const file = recorder.value.createAudioFile(recordedBlob.value, `recording_${Date.now()}.wav`)
    const formData = new FormData()
    formData.append('audio', file)
    formData.append('roomId', roomId.value)
    formData.append('trackType', 'recorded')

    const audioTrack = await audioApi.upload(formData)
    const result = await syncApi.calculate({ roomId: roomId.value, recordedAudioId: audioTrack.id })

    matrixResult.value = result
    ElMessage.success(result.mode === 'multi' ? '多音轨同步计算完成' : '同步计算完成')
    loadSyncSessions()

    await nextTick()
    drawTimelineChart()
  } catch (error) {
    ElMessage.error('同步计算失败: ' + (error.response?.data?.error || error.message))
  } finally {
    syncing.value = false
  }
}

const showWaveform = async (track) => {
  selectedTrack.value = track
  waveformVisible.value = true
  await nextTick()
  drawWaveformComparison(track)
}

const drawTimelineChart = () => {
  if (!canvasRef.value || !matrixResult.value?.tracks) return

  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  const tracks = matrixResult.value.tracks

  ctx.clearRect(0, 0, width, height)

  const padding = { top: 40, right: 40, bottom: 60, left: 120 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  ctx.fillStyle = '#FAFAFA'
  ctx.fillRect(padding.left, padding.top, chartW, chartH)

  const offsets = tracks.map(t => t.timeOffset)
  const allOffsets = [...offsets, 0]
  const minVal = Math.min(...allOffsets)
  const maxVal = Math.max(...allOffsets)
  const range = maxVal - minVal || 1
  const padRange = range * 0.15
  const scaleMin = minVal - padRange
  const scaleMax = maxVal + padRange

  const toX = (val) => padding.left + ((val - scaleMin) / (scaleMax - scaleMin)) * chartW
  const toY = (i) => padding.top + (i + 0.5) * (chartH / tracks.length)

  ctx.strokeStyle = '#E4E7ED'
  ctx.lineWidth = 1
  for (let i = 0; i <= 5; i++) {
    const val = scaleMin + (scaleMax - scaleMin) * i / 5
    const x = toX(val)
    ctx.beginPath(); ctx.moveTo(x, padding.top); ctx.lineTo(x, height - padding.bottom); ctx.stroke()
    ctx.fillStyle = '#909399'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(val.toFixed(2) + 's', x, height - padding.bottom + 20)
  }

  ctx.strokeStyle = '#DCDFE6'
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  const zeroX = toX(0)
  ctx.beginPath(); ctx.moveTo(zeroX, padding.top); ctx.lineTo(zeroX, height - padding.bottom); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#909399'
  ctx.font = '11px sans-serif'
  ctx.fillText('0', zeroX, height - padding.bottom + 35)

  const colors = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399']
  tracks.forEach((track, i) => {
    const y = toY(i)
    const x = toX(track.timeOffset)
    const color = colors[i % colors.length]

    ctx.fillStyle = '#303133'
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(track.label, padding.left - 10, y + 5)

    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(toX(0), y); ctx.lineTo(x, y); ctx.stroke()

    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill()

    ctx.fillStyle = '#303133'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'left'
    const offsetText = track.timeOffset >= 0 ? `+${track.timeOffset.toFixed(3)}s` : `${track.timeOffset.toFixed(3)}s`
    ctx.fillText(offsetText, x + 12, y + 4)
  })

  ctx.fillStyle = '#303133'
  ctx.font = '14px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('相对时间轴偏移图', width / 2, 24)

  ctx.fillStyle = '#909399'
  ctx.font = '12px sans-serif'
  ctx.fillText('时间偏移量 (秒)', width / 2, height - 8)
}

const drawWaveformComparison = async (track) => {
  if (!waveformCanvasRef.value) return

  const canvas = waveformCanvasRef.value
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height

  ctx.clearRect(0, 0, width, height)

  let refWaveform = null
  let recWaveform = null

  try { refWaveform = await audioApi.getWaveform(track.id) } catch (e) { console.warn('获取参考波形失败') }
  try { recWaveform = await audioApi.getWaveform(matrixResult.value?.recordedTrack?.id) } catch (e) { console.warn('获取录制波形失败') }

  const halfH = height / 2
  const padding = 40
  const drawW = width - padding * 2

  ctx.fillStyle = '#F5F7FA'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = '#DCDFE6'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(padding, halfH); ctx.lineTo(width - padding, halfH); ctx.stroke()

  const drawWaveformLine = (waveform, color, yOffset, h, label) => {
    if (!waveform || !waveform.points || waveform.points.length === 0) {
      ctx.fillStyle = '#C0C4CC'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`${label} - 无数据`, padding, yOffset + 20)
      return
    }

    const points = waveform.points
    const maxVal = Math.max(...points.map(p => p.value)) || 1
    const duration = waveform.duration || 1

    ctx.fillStyle = color
    ctx.globalAlpha = 0.1
    ctx.fillRect(padding, yOffset + 10, drawW, h - 20)
    ctx.globalAlpha = 1

    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < points.length; i++) {
      const x = padding + (points[i].time / duration) * drawW
      const y = yOffset + h / 2 - (points[i].value / maxVal) * (h / 2 - 10)
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.fillStyle = color
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(label, padding, yOffset + 16)
  }

  drawWaveformLine(refWaveform, '#409EFF', 0, halfH, `参考: ${track.label}`)
  drawWaveformLine(recWaveform, '#67C23A', halfH, halfH, `录制 (偏移: ${track.timeOffset?.toFixed(3)}s)`)
}

const getConfidenceColor = (confidence) => {
  if (confidence >= 0.9) return '#67C23A'
  if (confidence >= 0.7) return '#E6A23C'
  return '#F56C6C'
}

const loadRoomInfo = async () => {
  try { room.value = await roomApi.get(roomId.value) } catch (e) { ElMessage.error('加载房间信息失败') }
}

const loadAudioTracks = async () => {
  try { audioTracks.value = await audioApi.listByRoom(roomId.value) } catch (e) { console.error('加载音轨列表失败') }
}

const loadSyncSessions = async () => {
  try { syncSessions.value = await syncApi.listByRoom(roomId.value) } catch (e) { console.error('加载同步历史失败') }
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleString('zh-CN')
}

onMounted(async () => {
  loading.value = true
  await Promise.all([initRecorder(), loadRoomInfo(), loadAudioTracks(), loadSyncSessions()])
  loading.value = false
})

onUnmounted(() => {
  if (recordingTimer) clearInterval(recordingTimer)
  if (isRecording.value && recorder.value) recorder.value.stop()
  if (recorder.value) recorder.value.cleanup()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})
</script>

<style scoped>
.viewer-room-view {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header { margin-bottom: 20px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }

.recorder-container {
  display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px 0;
}
.recorder-display { text-align: center; }
.timer {
  display: flex; align-items: center; gap: 16px; justify-content: center; margin-bottom: 12px;
}
.timer .el-icon { color: #909399; transition: color 0.3s; }
.timer .el-icon.recording { color: #F56C6C; animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.time { font-size: 48px; font-weight: 600; font-family: 'Courier New', monospace; }
.recording-tag { font-size: 14px; }
.recorder-controls { display: flex; gap: 16px; }
.recording-btn { background: #F56C6C; border-color: #F56C6C; }
.recording-btn:hover { background: #F78989 !important; border-color: #F78989 !important; }
.recorder-status { margin-top: 8px; }

.preview-container {
  display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 0;
}
.audio-player { width: 100%; max-width: 500px; }
.sync-btn { min-width: 280px; }

.sample-rate-card .card-header { display: flex; justify-content: space-between; align-items: center; }

.offset-card { overflow: visible; }
.offset-value { font-weight: 600; font-size: 14px; }
.positive { color: #E6A23C; }
.negative { color: #67C23A; }

.matrix-summary { margin-top: 16px; }

.timeline-chart {
  margin-top: 20px;
  display: flex;
  justify-content: center;
  overflow-x: auto;
}
.timeline-chart canvas {
  border: 1px solid #EBEEF5;
  border-radius: 4px;
  background: white;
}

.waveform-dialog { padding: 8px 0; }
.waveform-legend {
  display: flex; gap: 24px; margin-bottom: 12px; justify-content: center;
}
.legend-item {
  display: flex; align-items: center; gap: 6px; font-size: 13px; color: #606266;
}
.legend-dot {
  width: 12px; height: 12px; border-radius: 2px; display: inline-block;
}
.waveform-info { margin-top: 16px; }
.waveform-dialog canvas {
  border: 1px solid #EBEEF5; border-radius: 4px; display: block; margin: 0 auto;
}
</style>
