<template>
  <div class="host-view">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>主播端 - 房间管理</span>
          <el-button type="primary" @click="showCreateDialog = true">
            <el-icon><Plus /></el-icon>
            创建房间
          </el-button>
        </div>
      </template>

      <el-table :data="rooms" v-loading="loading" stripe>
        <el-table-column prop="name" label="房间名称" min-width="200" />
        <el-table-column prop="createdBy" label="创建者" width="150" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'">
              {{ row.status === 'active' ? '进行中' : '已结束' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="enterRoom(row.id)">
              进入
            </el-button>
            <el-button size="small" type="danger" @click="deleteRoom(row.id)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && rooms.length === 0" description="暂无房间，点击右上角创建" />
    </el-card>

    <el-dialog v-model="showCreateDialog" title="创建房间" width="500px">
      <el-form :model="roomForm" label-width="80px">
        <el-form-item label="房间名称">
          <el-input v-model="roomForm.name" placeholder="请输入房间名称" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="创建者">
          <el-input v-model="roomForm.createdBy" placeholder="请输入您的昵称" maxlength="20" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createRoom" :loading="creating">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { roomApi } from '@/api'

const router = useRouter()
const rooms = ref([])
const loading = ref(false)
const creating = ref(false)
const showCreateDialog = ref(false)
const roomForm = ref({
  name: '',
  createdBy: ''
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

const createRoom = async () => {
  if (!roomForm.value.name.trim()) {
    ElMessage.warning('请输入房间名称')
    return
  }
  if (!roomForm.value.createdBy.trim()) {
    ElMessage.warning('请输入您的昵称')
    return
  }

  creating.value = true
  try {
    const room = await roomApi.create(roomForm.value)
    ElMessage.success('房间创建成功')
    showCreateDialog.value = false
    roomForm.value = { name: '', createdBy: '' }
    enterRoom(room.id)
  } catch (error) {
    ElMessage.error('创建房间失败')
  } finally {
    creating.value = false
  }
}

const enterRoom = (roomId) => {
  router.push(`/host/room/${roomId}`)
}

const deleteRoom = async (roomId) => {
  try {
    await ElMessageBox.confirm('确定要删除这个房间吗？', '提示', {
      type: 'warning'
    })
    await roomApi.delete(roomId)
    ElMessage.success('删除成功')
    loadRooms()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
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
.host-view {
  max-width: 1000px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
