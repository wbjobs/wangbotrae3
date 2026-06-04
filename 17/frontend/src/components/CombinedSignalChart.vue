<template>
  <div class="combined-chart">
    <div class="chart-header">
      <span class="title">叠加波形显示</span>
      <div class="legend">
        <span
          v-for="channel in channels"
          :key="channel"
          class="legend-item"
        >
          <span class="color-dot" :style="{ background: channelColors[channel] }"></span>
          {{ channelConfigs[channel]?.name }}
        </span>
      </div>
    </div>
    <div ref="chartRef" class="chart-body"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  channels: Array,
  channelConfigs: Object,
  signalData: Object,
  anomalies: Array
})

const chartRef = ref(null)
let chart = null

const channelColors = {
  ecg: '#409eff',
  eeg: '#67c23a',
  emg: '#e6a23c',
  ppg: '#f56c6c',
  resp: '#909399',
  temp: '#ff6b6b',
  eda: '#9b59b6',
  spo2: '#2ecc71'
}

const initChart = () => {
  if (!chartRef.value) return
  
  chart = echarts.init(chartRef.value)
  
  const series = props.channels.map(channel => ({
    name: props.channelConfigs[channel]?.name || channel,
    type: 'line',
    data: [],
    smooth: false,
    lineStyle: {
      color: channelColors[channel],
      width: 1.5
    },
    showSymbol: false,
    sampling: 'lttb',
    large: true
  }))
  
  const option = {
    grid: {
      left: 60,
      right: 80,
      top: 40,
      bottom: 30
    },
    legend: {
      show: false
    },
    xAxis: {
      type: 'category',
      axisLabel: {
        formatter: (value) => {
          return new Date(value * 1000).toLocaleTimeString()
        }
      }
    },
    yAxis: props.channels.map((channel, index) => ({
      type: 'value',
      name: props.channelConfigs[channel]?.unit || '',
      position: index % 2 === 0 ? 'left' : 'right',
      offset: Math.floor(index / 2) * 60 * (index % 2 === 0 ? -1 : 1),
      axisLine: {
        lineStyle: {
          color: channelColors[channel]
        }
      }
    })),
    tooltip: {
      trigger: 'axis'
    },
    series
  }
  
  chart.setOption(option)
}

const updateChart = () => {
  if (!chart) return
  
  const updatedSeries = props.channels.map((channel, index) => {
    const data = props.signalData[channel] || []
    return {
      yAxisIndex: index,
      data: data.map(d => [d.time, d.value])
    }
  })
  
  chart.setOption({
    series: updatedSeries
  })
}

watch(() => props.signalData, updateChart, { deep: true })
watch(() => props.channels, () => {
  chart?.dispose()
  initChart()
  updateChart()
})

onMounted(() => {
  initChart()
  updateChart()
  
  window.addEventListener('resize', () => chart?.resize())
})

onUnmounted(() => {
  window.removeEventListener('resize', () => chart?.resize())
  chart?.dispose()
})
</script>

<style scoped>
.combined-chart {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 10px 10px 10px;
}

.title {
  font-weight: 600;
}

.legend {
  display: flex;
  gap: 15px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.chart-body {
  flex: 1;
}
</style>
