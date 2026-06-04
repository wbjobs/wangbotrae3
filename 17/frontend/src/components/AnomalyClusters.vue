<template>
  <div class="anomaly-clusters">
    <div class="stats-overview">
      <el-statistic title="总聚类数" :value="clusters.length" />
      <el-statistic title="异常模式" :value="patternCount" />
      <el-statistic title="涉及患者" :value="patientCount" />
    </div>
    
    <div class="clusters-list">
      <div
        v-for="cluster in clusters"
        :key="cluster.cluster_id"
        class="cluster-card"
      >
        <div class="cluster-header">
          <el-tag :type="getClusterType(cluster.pattern_type)" size="small">
            {{ cluster.description || cluster.pattern_type }}
          </el-tag>
          <el-badge :value="cluster.count" class="item" type="danger" />
        </div>
        
        <div class="cluster-info">
          <div class="info-row">
            <span class="label">涉及患者:</span>
            <span class="value">{{ cluster.patients?.join(', ') || '-' }}</span>
          </div>
          <div class="info-row">
            <span class="label">涉及通道:</span>
            <span class="value">{{ cluster.channels?.join(', ') || '-' }}</span>
          </div>
          <div class="info-row">
            <span class="label">平均分数:</span>
            <span class="value score">{{ cluster.avg_score?.toFixed(2) || '-' }}</span>
          </div>
        </div>
      </div>
    </div>
    
    <div v-if="Object.keys(statistics).length > 0" class="pattern-stats">
      <h4>模式统计</h4>
      <el-table :data="patternStats" size="small">
        <el-table-column prop="pattern" label="模式类型" width="150">
          <template #default="{ row }">
            <el-tag size="small">{{ row.description || row.pattern }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="count" label="发生次数" width="100" />
        <el-table-column prop="patient_count" label="涉及患者" width="100" />
        <el-table-column prop="patients" label="患者列表">
          <template #default="{ row }">
            {{ row.patients?.join(', ') }}
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  clusters: Array,
  statistics: Object
})

const patternCount = computed(() => {
  return new Set(props.clusters?.map(c => c.pattern_type)).size || 0
})

const patientCount = computed(() => {
  const allPatients = new Set()
  props.clusters?.forEach(c => {
    c.patients?.forEach(p => allPatients.add(p))
  })
  return allPatients.size
})

const patternDescriptions = {
  eeg_burst_suppression: 'EEG爆发抑制',
  ecg_premature_beat: 'ECG早搏模式',
  emg_high_activity: 'EMG高活动',
  resp_abnormal_rate: '呼吸频率异常',
  temp_spike: '体温异常',
  eda_sudden_change: '皮肤电突变',
  spo2_drop: '血氧下降',
  ppg_weak_pulse: '脉搏波减弱',
  unknown: '未知模式'
}

const getClusterType = (type) => {
  const types = {
    ecg_premature_beat: 'danger',
    eeg_burst_suppression: 'warning',
    spo2_drop: 'danger',
    resp_abnormal_rate: 'warning',
    temp_spike: 'info',
    unknown: 'info'
  }
  return types[type] || 'info'
}

const patternStats = computed(() => {
  return Object.entries(props.statistics || {}).map(([pattern, data]) => ({
    pattern,
    description: patternDescriptions[pattern] || pattern,
    ...data
  }))
})
</script>

<style scoped>
.anomaly-clusters {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.stats-overview {
  display: flex;
  gap: 30px;
  padding: 20px;
  background: white;
  border-radius: 8px;
}
.clusters-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 15px;
}
.cluster-card {
  background: white;
  border-radius: 8px;
  padding: 15px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.cluster-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.cluster-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.info-row {
  display: flex;
  font-size: 13px;
}
.info-row .label {
  color: #909399;
  width: 80px;
  flex-shrink: 0;
}
.info-row .value {
  color: #303133;
}
.info-row .score {
  color: #f56c6c;
  font-weight: 600;
}
.pattern-stats {
  background: white;
  border-radius: 8px;
  padding: 15px;
}
.pattern-stats h4 {
  margin: 0 0 15px 0;
}
</style>
