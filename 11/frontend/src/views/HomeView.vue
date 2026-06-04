<template>
  <div class="home-view">
    <el-row :gutter="24">
      <el-col :span="24">
        <el-card class="welcome-card">
          <div class="welcome-content">
            <el-icon :size="64" class="welcome-icon"><VideoPlay /></el-icon>
            <h1>多端音轨同步校对系统</h1>
            <p class="subtitle">基于音频指纹技术的跨设备音轨同步解决方案</p>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="24" class="action-cards">
      <el-col :xs="24" :md="12">
        <el-card class="role-card host-card">
          <div class="card-content">
            <el-icon :size="48" class="card-icon"><User /></el-icon>
            <h2>我是主播</h2>
            <p>创建房间，上传参考音轨，管理同步会话</p>
            <el-button type="primary" size="large" @click="goToHost">
              进入主播端
            </el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card class="role-card viewer-card">
          <div class="card-content">
            <el-icon :size="48" class="card-icon"><Headset /></el-icon>
            <h2>我是观众</h2>
            <p>加入房间，录制环境音，进行同步校对</p>
            <el-button type="success" size="large" @click="goToViewer">
              进入观众端
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="24" class="feature-section">
      <el-col :span="24">
        <el-card>
          <template #header>
            <h3>核心功能特性</h3>
          </template>
          <el-row :gutter="24">
            <el-col :xs="24" :sm="12" :lg="8">
              <div class="feature-item">
                <el-icon :size="32" color="#409EFF"><MagicStick /></el-icon>
                <h4>音频指纹提取</h4>
                <p>基于Chromaprint算法，精准提取音频特征指纹</p>
              </div>
            </el-col>
            <el-col :xs="24" :sm="12" :lg="8">
              <div class="feature-item">
                <el-icon :size="32" color="#67C23A"><Aim /></el-icon>
                <h4>精准偏移计算</h4>
                <p>滑动窗口匹配算法，毫秒级时间偏移检测</p>
              </div>
            </el-col>
            <el-col :xs="24" :sm="12" :lg="8">
              <div class="feature-item">
                <el-icon :size="32" color="#E6A23C"><Connection /></el-icon>
                <h4>多端同步</h4>
                <p>支持多设备同时接入，实时音频同步校对</p>
              </div>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { VideoPlay, User, Headset, MagicStick, Aim, Connection } from '@element-plus/icons-vue'

const router = useRouter()

const goToHost = () => {
  router.push('/host')
}

const goToViewer = () => {
  router.push('/viewer')
}
</script>

<style scoped>
.home-view {
  max-width: 1200px;
  margin: 0 auto;
}

.welcome-card {
  text-align: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.welcome-card :deep(.el-card__body) {
  padding: 48px 24px;
}

.welcome-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.welcome-icon {
  color: white;
}

.welcome-content h1 {
  font-size: 32px;
  font-weight: 600;
  margin: 0;
}

.subtitle {
  font-size: 16px;
  opacity: 0.9;
  margin: 0;
}

.action-cards {
  margin-top: 24px;
}

.role-card {
  cursor: pointer;
  transition: transform 0.3s, box-shadow 0.3s;
}

.role-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}

.host-card {
  border-top: 4px solid #409EFF;
}

.viewer-card {
  border-top: 4px solid #67C23A;
}

.card-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.card-content h2 {
  font-size: 24px;
  margin: 0;
}

.card-content p {
  color: #909399;
  margin: 0;
}

.feature-section {
  margin-top: 24px;
}

.feature-section h3 {
  margin: 0;
  font-size: 18px;
}

.feature-item {
  text-align: center;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.feature-item h4 {
  margin: 0;
  font-size: 16px;
}

.feature-item p {
  margin: 0;
  color: #909399;
  font-size: 14px;
}
</style>
