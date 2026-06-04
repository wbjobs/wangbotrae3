<template>
  <el-container class="app-container">
    <el-header class="app-header">
      <div class="header-content">
        <h1 class="app-title">
          <el-icon :size="28"><VideoPlay /></el-icon>
          多端音轨同步校对系统
        </h1>
        <div class="header-nav">
          <el-button 
            :type="router.path === '/' ? 'primary' : ''" 
            @click="router.push('/')"
          >
            首页
          </el-button>
          <el-button 
            :type="router.path.startsWith('/host') ? 'primary' : ''" 
            @click="router.push('/host')"
          >
            主播端
          </el-button>
          <el-button 
            :type="router.path.startsWith('/viewer') ? 'primary' : ''" 
            @click="router.push('/viewer')"
          >
            观众端
          </el-button>
        </div>
      </div>
    </el-header>
    <el-main class="app-main">
      <router-view />
    </el-main>
    <el-footer class="app-footer">
      <p>多端音轨同步校对系统 &copy; 2024</p>
    </el-footer>
  </el-container>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { VideoPlay } from '@element-plus/icons-vue'

const router = useRouter()
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
}

.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0;
  height: auto;
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-title {
  font-size: 24px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-nav {
  display: flex;
  gap: 12px;
}

.app-main {
  flex: 1;
  background: #f5f7fa;
  padding: 24px;
  overflow: auto;
}

.app-footer {
  background: #303133;
  color: #909399;
  text-align: center;
  padding: 16px;
  font-size: 14px;
}
</style>
