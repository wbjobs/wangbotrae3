<template>
  <div class="patient-compare">
    <div ref="chartRef" class="compare-chart"></div>
    <div class="legend">
      <div v-for="(pid, idx) in patientIds" :key="pid" class="legend-item">
        <span class="color-dot" :style="{ background: patientColors[idx % patientColors.length] }"></span>
        <span>{{ patients[pid]?.name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  patientIds: Array,
  patients: Object,
  channel: String,
  signalData: Object,
  showDiff: Boolean
})

const chartRef = ref(null)
let chart = null

const patientColors = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c']

const alignedData = computed(() => {
  const result = {}
  const allTimes = new Set()
  
  for (const pid of props.patientIds) {
    const data = props.signalData?.[pid]?.[props.channel] || []
    data.forEach(d => allTimes.add(d.time))
  }
  
  const sortedTimes = Array.from(allTimes).sort()
  
  for (const pid of props.patientIds) {
    const data = props.signalData?.[pid]?.[props.channel] || []
    const dataMap = new Map(data.map(d => [d.time, d.value]))
    
    result[pid] = sortedTimes.map(t => [t, dataMap.get(t) || null])
  }
  
  return result
})

const diffData = computed(() => {
  if (props.patientIds.length < 2) return []
  
  const pid1 = props.patientIds[0]
  const pid2 = props.patientIds[1]
  const data1 = alignedData.value[pid1] || []
  const data2 = alignedData.value[pid2] || []
  
  return data1.map((d1, i) => {
    const d2 = data2[i]
    if (d1[1] !== null && d2?.[1] !== null) {
      return [d1[0], d1[1] - d2[1]]
    }
    return [d1[0], null]
  })
})

const initChart = () => {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
  updateChart()
}

const updateChart = () => {
  if (!chart) return
  
  const series = props.patientIds.map((pid, idx) => ({
    name: props.patients[pid]?.name || pid,
    type: 'line',
    data: alignedData.value[pid] || [],
    smooth: false,
    lineStyle: { color: patientColors[idx % patientColors.length], width: 2 },
    showSymbol: false,
    sampling: 'lttb',
    large: true
  }))
  
  if (props.showDiff && props.patientIds.length >= 2) {
    series.push({
      name: '差异',
      type: 'line',
      data: diffData.value,
      smooth: false,
      lineStyle: { color: '#ff4d4f', width: 1, type: 'dashed' },
      showSymbol: false,
      sampling: 'lttb',
      areaStyle: {
        color: (params) => {
          return params.data[1] > 0 ? 'rgba(255,77,79,0.1)' : 'rgba(77,171,247,0.1)'
        }
      }
    })
  }
  
  const option = {
    grid: { left: 60, right: 80, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      axisLabel: {
        formatter: (value) => new Date(value * 1000).toLocaleTimeString()
      }
    },
    yAxis: {
      type: 'value',
      scale: true
    },
    tooltip: { trigger: 'axis' },
    legend: { show: false },
    series
  }
  
  chart.setOption(option)
}

watch(() => [props.signalData, props.channel, props.showDiff, props.patientIds], () => {
  nextTick(updateChart)
}, { deep: true })

const handleResize = () => chart?.resize()

onMounted(() => {
  nextTick(() => {
    initChart()
    window.addEventListener('resize', handleResize)
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
})
</script>

<style scoped>
.patient-compare { display: flex; flex-direction: column; height: 100%; flex: 1; }
.compare-chart { flex: 1; min-height: 0; }
.legend {
  display: flex;
  justify-content: center;
  gap: 30px;
  padding: 10px;
  background: white;
  border-top: 1px solid #e4e7ed;
}
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.color-dot { width: 12px; height: 12px; border-radius: 50%; }
</style>
