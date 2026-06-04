<template>
  <div class="signal-chart">
    <div class="chart-header">
      <span class="channel-name">{{ config.name }} ({{ channel.toUpperCase() }})</span>
      <span class="channel-unit">{{ config.unit }}</span>
    </div>
    <div ref="chartRef" class="chart-body"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  channel: String,
  config: Object,
  data: Array,
  anomalies: Array
})

const emit = defineEmits(['anomaly-click'])

const chartRef = ref(null)
let chart = null
let resizeObserver = null

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
  
  const color = channelColors[props.channel] || '#409eff'
  
  const option = {
    grid: {
      left: 50,
      right: 20,
      top: 10,
      bottom: 20
    },
    xAxis: {
      type: 'category',
      show: false
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        fontSize: 10
      }
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        if (!params || !params.length) return ''
        const p = params[0]
        return `时间: ${new Date(p.data[0] * 1000).toLocaleTimeString()}<br/>值: ${p.data[1].toFixed(4)}`
      }
    },
    series: [
      {
        type: 'line',
        data: [],
        smooth: false,
        lineStyle: {
          color,
          width: 1.5
        },
        showSymbol: false,
        sampling: 'lttb',
        large: true
      },
      {
        type: 'scatter',
        data: [],
        symbolSize: 8,
        itemStyle: {
          color: '#ff4d4f'
        },
        emphasis: {
          scale: true
        }
      }
    ]
  }
  
  chart.setOption(option)
  
  chart.on('click', (params) => {
    if (params.seriesType === 'scatter') {
      emit('anomaly-click', params.data)
    }
  })
}

const updateChart = () => {
  if (!chart || !props.data.length) return
  
  const signalData = props.data.map(d => [d.time, d.value])
  const anomalyMarkers = []
  
  if (props.anomalies) {
    props.anomalies.forEach(anomaly => {
      const point = props.data.find(d => Math.abs(d.time - anomaly.timestamp) < 0.1)
      if (point) {
        anomalyMarkers.push({
          value: [point.time, point.value],
          itemStyle: { color: '#ff4d4f' },
          ...anomaly
        })
      }
    })
  }
  
  chart.setOption({
    series: [
      { data: signalData },
      { data: anomalyMarkers }
    ]
  })
}

const handleResize = () => {
  chart?.resize()
}

watch(() => props.data, updateChart, { deep: true })
watch(() => props.anomalies, updateChart, { deep: true })

onMounted(() => {
  initChart()
  updateChart()
  
  resizeObserver = new ResizeObserver(handleResize)
  if (chartRef.value) {
    resizeObserver.observe(chartRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
})
</script>

<style scoped>
.signal-chart {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  padding: 0 50px 5px 10px;
}

.channel-name {
  font-weight: 600;
  font-size: 14px;
}

.channel-unit {
  color: #909399;
  font-size: 12px;
}

.chart-body {
  flex: 1;
  min-height: 0;
}
</style>
