<template>
  <div class="flex h-screen flex-col bg-[#0f1219]">
    <nav class="flex h-[52px] items-center justify-between border-b border-[#242b3d] bg-[#1a1f2e] px-5">
      <div class="flex items-center gap-6">
        <router-link to="/" class="flex items-center gap-2 text-base font-bold tracking-tight text-[#00d4aa]">
          <Zap class="h-5 w-5" />
          SubAlign
        </router-link>
        <div class="flex items-center gap-1">
          <router-link
            to="/"
            class="rounded-lg px-3 py-1.5 text-sm transition"
            :class="route.path === '/' ? 'bg-[#00d4aa]/10 text-[#00d4aa]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'"
          >工作台</router-link>
          <router-link
            to="/history"
            class="rounded-lg px-3 py-1.5 text-sm transition"
            :class="route.path === '/history' ? 'bg-[#00d4aa]/10 text-[#00d4aa]' : 'text-[#94a3b8] hover:text-[#e2e8f0]'"
          >历史记录</router-link>
        </div>
      </div>
    </nav>
    <main class="flex-1 overflow-hidden">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Zap } from 'lucide-vue-next'

const route = useRoute()
</script>
