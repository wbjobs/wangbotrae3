<template>
  <div class="group-heatmap">
    <div ref="chartRef" class="heatmap-chart"></div>
    <div class="heatmap-legend">
      <div class="legend-item">
        <span class="color-box low"></span>
        <span>低频</span>
      </div>
      <div class="legend-item">
        <span class="color-box high"></span>
        <span>高频异常</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  heatmapData: Object
})

const chartRef = ref(null)
let chart = null

const initChart = () => {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
  updateChart()
}

const updateChart = () => {
  if (!chart || !props.heatmapData?.matrix?.length) return
  
  const { times, channels, matrix } = props.heatmapData
  
  const heatmapData = []
  matrix.forEach((row, timeIdx) => {
    row.forEach((value, channelIdx) => {
      if (value > 0) {
        heatmapData.push([timeIdx, channelIdx, value])
      }
    })
  })
  
  const channelNames = {
    ecg: 'ECG', eeg: 'EEG', emg: 'EMG', ppg: 'PPG',
    resp: '呼吸', temp: '体温', eda: '皮肤电', spo2: '血氧'
  }
  
  const option = {
    grid: { left: 80, right: 30, top: 30, bottom: 60 },
    xAxis: {
      type: 'category',
      data: times.map(t => new Date(t * 1000).toLocaleTimeString().slice(-5)),
      axisLabel: { rotate: 45, fontSize: 10 }
    },
    yAxis: {
      type: 'category',
      data: channels.map(c => channelNames[c] || c),
      axisLabel: { fontSize: 12 }
    },
    visualMap: {
      min: 0,
      max: Math.max(...matrix.flat(), 1),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 5,
      inRange: {
        color: ['#f0f9ff', '#e6f7ff', '#91d5ff', '#40a9ff', '#1890ff', '#096dd9', '#0050b3']
      }
    },
    tooltip: {
      formatter: (params) => {
        const data = params.data
        if (!data) return ''
        return `时间: ${times[data[0]] ? new Date(times[data[0]] * 1000).toLocaleTimeString() : ''}<br/>
                通道: ${channelNames[channels[data[1]]] || channels[data[1]]}<br/>
                异常数: ${data[2]}`
      }
    },
    series: [{
      name: '异常热力图',
      type: 'heatmap',
      data: heatmapData,
      label: { show: false },
      emphasis: {
        itemStyle: {
          borderColor: '#333',
          borderWidth: 2
        }
      }
    }]
  }
  
  chart.setOption(option)
}

watch(() => props.heatmapData, () => {
  nextTick(updateChart)
}, { deep: true, immediate: true })

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
.group-heatmap {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  border-radius: 8px;
  padding: 15px;
}
.heatmap-chart { flex: 1; min-height: 400px; }
.heatmap-legend {
  display: flex;
  justify-content: center;
  gap: 30px;
  padding-top: 10px;
}
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.color-box { width: 20px; height: 12px; border-radius: 2px; }
.color-box.low { background: #f0f9ff; border: 1px solid #e4e7ed; }
.color-box.high { background: #0050b3; }
</style>
