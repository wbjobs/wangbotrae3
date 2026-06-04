<template>
  <div class="flex flex-col items-center gap-4 rounded-xl bg-[#1a1f2e] p-6">
    <template v-if="isProcessing">
      <div class="relative h-24 w-24">
        <svg class="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" stroke="#242b3d" stroke-width="6" fill="none" />
          <circle
            cx="50" cy="50" r="42"
            stroke="#00d4aa"
            stroke-width="6"
            fill="none"
            stroke-linecap="round"
            :stroke-dasharray="264"
            :stroke-dashoffset="264 - (264 * progress / 100)"
            class="transition-all duration-500"
          />
        </svg>
        <span class="absolute inset-0 flex items-center justify-center font-mono text-lg text-[#00d4aa]">
          {{ Math.round(progress) }}%
        </span>
      </div>
      <p class="text-sm text-[#94a3b8]">正在对齐字幕...</p>
    </template>

    <template v-else-if="result">
      <div class="grid grid-cols-2 gap-3 w-full">
        <div class="rounded-lg bg-[#242b3d] p-3 text-center">
          <p class="text-xs text-[#94a3b8]">总字幕条数</p>
          <p class="mt-1 font-mono text-xl text-[#e2e8f0]">{{ result.totalCues }}</p>
        </div>
        <div class="rounded-lg bg-[#242b3d] p-3 text-center">
          <p class="text-xs text-[#94a3b8]">校正条数</p>
          <p class="mt-1 font-mono text-xl text-[#f59e0b]">{{ result.correctedCues }}</p>
        </div>
        <div class="rounded-lg bg-[#242b3d] p-3 text-center">
          <p class="text-xs text-[#94a3b8]">平均偏移</p>
          <p class="mt-1 font-mono text-xl text-[#e2e8f0]">{{ result.averageOffset.toFixed(0) }}ms</p>
        </div>
        <div class="rounded-lg bg-[#242b3d] p-3 text-center">
          <p class="text-xs text-[#94a3b8]">质量评分</p>
          <p class="mt-1 font-mono text-xl" :class="scoreColor">{{ result.score }}</p>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-col items-center gap-2 py-4 text-center">
        <BarChart3 class="h-10 w-10 text-[#94a3b8]/30" />
        <p class="text-sm text-[#94a3b8]">上传文件并开始对齐后<br/>此处将显示结果</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BarChart3 } from 'lucide-vue-next'
import type { AlignResult } from '@/types'

const props = defineProps<{
  result: AlignResult | null
  isProcessing: boolean
  progress: number
}>()

const scoreColor = computed(() => {
  if (!props.result) return 'text-[#e2e8f0]'
  if (props.result.score > 80) return 'text-[#00d4aa]'
  if (props.result.score >= 50) return 'text-[#f59e0b]'
  return 'text-[#ef4444]'
})
</script>
