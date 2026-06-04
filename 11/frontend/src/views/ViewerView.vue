<template>
  <div class="viewer-view">
    <el-card>
      <template #header>
        <span>观众端 - 加入房间</span>
      </template>

      <div class="join-form">
        <el-form :model="joinForm" label-width="100px">
          <el-form-item label="房间ID">
            <el-input 
              v-model="joinForm.roomId" 
              placeholder="请输入房间ID"
              maxlength="36"
            >
              <template #append>
                <el-button :icon="Search" @click="searchRoom" :loading="searching">查找</el-button>
              </template>
            </el-input>
          </el-form-item>
        </el-form>
      </div>

      <el-divider>或选择房间</el-divider>

      <el-table :data="rooms" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="name" label="房间名称" min-width="200" />
        <el-table-column prop="createdBy" label="主播" width="150" />
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="joinRoom(row.id)">
              加入
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && rooms.length === 0" description="暂无可用房间" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { roomApi } from '@/api'

const router = useRouter()
const rooms = ref([])
const loading = ref(false)
const searching = ref(false)
const joinForm = reactive({
  roomId: ''
})

const loadRooms = async () => {
  loading.value = true
  try {
    const data = await roomApi.list({ status: 'active' })
    rooms.value = data
  } catch (error) {
    ElMessage.error('加载房间列表失败')
  } finally {
    loading.value = false
  }
}

const searchRoom = async () => {
  if (!joinForm.roomId.trim()) {
    ElMessage.warning('请输入房间ID')
    return
  }

  searching.value = true
  try {
    await roomApi.get(joinForm.roomId)
    joinRoom(joinForm.roomId)
  } catch (error) {
    ElMessage.error('房间不存在')
  } finally {
    searching.value = false
  }
}

const joinRoom = (roomId) => {
  router.push(`/viewer/room/${roomId}`)
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN')
}

onMounted(() => {
  loadRooms()
})
</script>

<style scoped>
.viewer-view {
  max-width: 800px;
  margin: 0 auto;
}

.join-form {
  max-width: 500px;
  margin: 24px auto;
}
</style>
