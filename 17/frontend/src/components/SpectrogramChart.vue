<template>
  <div class="spectrogram-chart">
    <div ref="chartRef" class="chart-body"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  data: Array,
  frequencies: Array
})

const chartRef = ref(null)
let chart = null

const initChart = () => {
  if (!chartRef.value) return
  
  chart = echarts.init(chartRef.value)
  
  const option = {
    grid: {
      left: 60,
      right: 30,
      top: 20,
      bottom: 40
    },
    xAxis: {
      type: 'category',
      name: '时间 (s)',
      nameLocation: 'middle',
      nameGap: 25
    },
    yAxis: {
      type: 'category',
      name: '频率 (Hz)',
      nameLocation: 'middle',
      nameGap: 40
    },
    visualMap: {
      min: 0,
      max: 100,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: {
        color: ['#000033', '#000066', '#000099', '#0033cc', '#0066ff', '#33ccff', '#66ffff', '#99ffcc', '#ccff99', '#ffff66', '#ffcc00', '#ff9900', '#ff6600', '#ff0000']
      }
    },
    tooltip: {
      formatter: (params) => {
        return `时间: ${params.data[0]}<br/>频率: ${params.data[1]} Hz<br/>功率: ${params.data[2].toFixed(2)}`
      }
    },
    series: [{
      name: '频谱',
      type: 'heatmap',
      data: [],
      label: {
        show: false
      }
    }]
  }
  
  chart.setOption(option)
}

const updateChart = () => {
  if (!chart || !props.data.length === 0 || !props.frequencies.length === 0) return
  
  const heatmapData = []
  const maxFreq = 50
  const freqIndices = props.frequencies.filter(f => f <= maxFreq)
  
  props.data.forEach((row, timeIdx) => {
    freqIndices.forEach((freq, freqIdx) => {
      const value = Math.log10(row[freqIdx] + 1) * 20
      heatmapData.push([timeIdx * 0.1, freq.toFixed(1), value])
    })
  })
  
  chart.setOption({
    series: [{
      data: heatmapData
    }]
  })
}

watch(() => props.data, updateChart, { deep: true })

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
.spectrogram-chart {
  height: 300px;
}

.chart-body {
  height: 100%;
  width: 100%;
}
</style>
