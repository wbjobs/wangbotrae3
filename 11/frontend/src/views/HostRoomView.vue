<template>
  <div class="host-room-view">
    <el-page-header @back="goBack" content="返回房间列表" class="page-header" />

    <el-card v-loading="loading" class="room-info-card">
      <template #header>
        <div class="card-header">
          <span>房间信息</span>
          <el-tag type="success" v-if="room">房间号: {{ room.id }}</el-tag>
        </div>
      </template>
      <el-descriptions :column="2" border v-if="room">
        <el-descriptions-item label="房间名称">{{ room.name }}</el-descriptions-item>
        <el-descriptions-item label="创建者">{{ room.createdBy }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(room.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="room.status === 'active' ? 'success' : 'info'">
            {{ room.status === 'active' ? '进行中' : '已结束' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="upload-card">
      <template #header>
        <div class="card-header">
          <span>上传参考音轨</span>
          <el-tag :type="refTracks.length >= 5 ? 'danger' : 'info'">
            {{ refTracks.length }} / 5
          </el-tag>
        </div>
      </template>

      <el-alert 
        v-if="refTracks.length >= 5" 
        title="参考音轨数量已达上限(5个)" 
        type="warning" 
        :closable="false"
        class="limit-alert"
      />

      <div v-if="refTracks.length < 5">
        <el-form :model="uploadForm" label-width="100px" class="upload-form">
          <el-form-item label="音轨来源">
            <el-select v-model="uploadForm.sourceLabel" placeholder="选择或输入来源标签" filterable allow-create>
              <el-option label="左声道" value="左声道" />
              <el-option label="右声道" value="右声道" />
              <el-option label="环境麦" value="环境麦" />
              <el-option label="主麦克风" value="主麦克风" />
              <el-option label="备用麦克风" value="备用麦克风" />
            </el-select>
          </el-form-item>
          <el-form-item label="音频文件">
            <el-upload
              ref="uploadRef"
              drag
              action="#"
              :auto-upload="false"
              :on-change="handleFileChange"
              :on-remove="handleFileRemove"
              :file-list="fileList"
              accept="audio/*"
              :limit="1"
            >
              <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
              <div class="el-upload__text">将音频文件拖到此处，或<em>点击上传</em></div>
              <template #tip>
                <div class="el-upload__tip">
                  支持 wav、mp3、ogg 等格式，不超过 50MB
                </div>
              </template>
            </el-upload>
          </el-form-item>
          <el-form-item>
            <el-button 
              type="primary" 
              :disabled="fileList.length === 0 || !uploadForm.sourceLabel"
              :loading="uploading"
              @click="uploadAudio"
            >
              上传并提取指纹
            </el-button>
          </el-form-item>
        </el-form>
        <el-progress v-if="uploadProgress > 0" :percentage="uploadProgress" class="progress" />
      </div>
    </el-card>

    <el-card class="audio-list-card">
      <template #header>
        <span>参考音轨列表</span>
      </template>
      <el-table :data="audioTracks" stripe>
        <el-table-column prop="filename" label="文件名" min-width="180" />
        <el-table-column prop="sourceLabel" label="来源" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.sourceLabel" type="primary">{{ row.sourceLabel }}</el-tag>
            <el-tag v-else type="info">未标记</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="duration" label="时长(秒)" width="100">
          <template #default="{ row }">
            {{ row.duration.toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="trackType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.trackType === 'reference' ? 'primary' : 'success'" size="small">
              {{ row.trackType === 'reference' ? '参考' : '录制' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="上传时间" width="170">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" link @click="deleteAudio(row.id)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="audioTracks.length === 0" description="暂无音轨" />
    </el-card>

    <el-card class="sync-history-card">
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { roomApi, audioApi, syncApi } from '@/api'

const router = useRouter()
const route = useRoute()
const roomId = computed(() => route.params.roomId)

const room = ref(null)
const audioTracks = ref([])
const syncSessions = ref([])
const loading = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const fileList = ref([])
const uploadForm = ref({
  sourceLabel: ''
})

const refTracks = computed(() => audioTracks.value.filter(t => t.trackType === 'reference'))

const goBack = () => {
  router.push('/host')
}

const loadRoomInfo = async () => {
  try {
    room.value = await roomApi.get(roomId.value)
  } catch (error) {
    ElMessage.error('加载房间信息失败')
  }
}

const loadAudioTracks = async () => {
  try {
    const data = await audioApi.listByRoom(roomId.value)
    audioTracks.value = data
  } catch (error) {
    ElMessage.error('加载音轨列表失败')
  }
}

const loadSyncSessions = async () => {
  try {
    const data = await syncApi.listByRoom(roomId.value)
    syncSessions.value = data
  } catch (error) {
    ElMessage.error('加载同步历史失败')
  }
}

const handleFileChange = (file) => {
  fileList.value = [file]
}

const handleFileRemove = () => {
  fileList.value = []
}

const uploadAudio = async () => {
  if (fileList.value.length === 0) return
  if (!uploadForm.value.sourceLabel) {
    ElMessage.warning('请选择或输入音轨来源标签')
    return
  }

  uploading.value = true
  uploadProgress.value = 0

  const formData = new FormData()
  formData.append('audio', fileList.value[0].raw)
  formData.append('roomId', roomId.value)
  formData.append('trackType', 'reference')
  formData.append('sourceLabel', uploadForm.value.sourceLabel)

  try {
    await audioApi.upload(formData, (progressEvent) => {
      uploadProgress.value = Math.round(
        (progressEvent.loaded * 100) / progressEvent.total
      )
    })
    ElMessage.success(`音轨「${uploadForm.value.sourceLabel}」上传成功`)
    fileList.value = []
    uploadProgress.value = 0
    uploadForm.value.sourceLabel = ''
    loadAudioTracks()
    loadRoomInfo()
  } catch (error) {
    ElMessage.error('上传失败: ' + (error.response?.data?.error || error.message))
  } finally {
    uploading.value = false
  }
}

const deleteAudio = async (id) => {
  try {
    await audioApi.delete(id)
    ElMessage.success('删除成功')
    loadAudioTracks()
  } catch (error) {
    ElMessage.error('删除失败')
  }
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN')
}

onMounted(async () => {
  loading.value = true
  await Promise.all([
    loadRoomInfo(),
    loadAudioTracks(),
    loadSyncSessions()
  ])
  loading.value = false
})
</script>

<style scoped>
.host-room-view {
  max-width: 1000px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.upload-form {
  max-width: 600px;
}

.limit-alert {
  margin-bottom: 16px;
}

.progress {
  margin-top: 16px;
}

.positive {
  color: #67C23A;
}

.negative {
  color: #F56C6C;
}
</style>
