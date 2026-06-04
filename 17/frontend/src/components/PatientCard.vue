<template>
  <div class="patient-card">
    <div class="card-header" :style="{ borderLeftColor: patient?.color }">
      <div class="patient-info">
        <span class="patient-name">{{ patient?.name }}</span>
        <span class="patient-detail">{{ patient?.age }}岁 {{ patient?.gender }}</span>
      </div>
      <div class="anomaly-count">
        <el-tag size="small" type="danger" v-if="anomalyCount > 0">
          {{ anomalyCount }} 异常
        </el-tag>
      </div>
    </div>
    <div class="card-body">
      <div v-for="channel in displayChannels" :key="channel" class="mini-chart">
        <div class="channel-label">{{ channel.toUpperCase() }}</div>
        <div ref="chartRefs" :data-channel="channel" class="mini-chart-body"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  patientId: String,
  patient: Object,
  signalData: Object,
  anomalies: Array
})

const chartRefs = ref([])
const charts = ref({})
const displayChannels = ['ecg', 'eeg', 'ppg']

const anomalyCount = ref(0)

const channelColors = {
  ecg: '#409eff',
  eeg: '#67c23a',
  ppg: '#f56c6c',
  resp: '#909399',
  temp: '#e6a23c',
  eda: '#9b59b6',
  spo2: '#2ecc71',
  emg: '#f39c12'
}

const initCharts = () => {
  nextTick(() => {
    const chartElements = document.querySelectorAll('[data-channel]')
    chartElements.forEach(el => {
      const channel = el.getAttribute('data-channel')
      if (charts.value[channel]) {
        charts.value[channel].dispose()
      }
      charts.value[channel] = echarts.init(el)
      
      const option = {
        grid: { left: 0, right: 0, top: 2, bottom: 2 },
        xAxis: { show: false },
        yAxis: { show: false, scale: true },
        series: [{
          type: 'line',
          data: [],
          smooth: false,
          lineStyle: { color: channelColors[channel], width: 1 },
          showSymbol: false,
          sampling: 'lttb',
          large: true
        }]
      }
      charts.value[channel].setOption(option)
    })
  })
}

const updateCharts = () => {
  for (const channel of displayChannels) {
    if (charts.value[channel] && props.signalData?.[channel]) {
      const data = props.signalData[channel].map(d => [d.time, d.value])
      charts.value[channel].setOption({
        series: [{ data }]
      })
    }
  }
}

watch(() => props.signalData, () => {
  updateCharts()
}, { deep: true, immediate: true })

watch(() => props.anomalies, (val) => {
  anomalyCount.value = val?.length || 0
}, { deep: true, immediate: true })

const handleResize = () => {
  Object.values(charts.value).forEach(chart => chart?.resize())
}

onMounted(() => {
  initCharts()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  Object.values(charts.value).forEach(chart => chart?.dispose())
})
</script>

<style scoped>
.patient-card { display: flex; flex-direction: column; height: 100%; }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 15px;
  background: #fafafa;
  border-bottom: 1px solid #e4e7ed;
  border-left: 4px solid #409eff;
}
.patient-info { display: flex; flex-direction: column; }
.patient-name { font-weight: 600; font-size: 14px; }
.patient-detail { font-size: 12px; color: #909399; }
.card-body { flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 5px; }
.mini-chart { display: flex; align-items: center; gap: 8px; flex: 1; }
.channel-label {
  width: 35px;
  font-size: 11px;
  font-weight: 600;
  color: #606266;
  flex-shrink: 0;
}
.mini-chart-body { flex: 1; height: 100%; min-height: 0; }
</style>
