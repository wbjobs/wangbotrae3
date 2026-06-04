<template>
  <div class="flex flex-col gap-3 rounded-xl bg-[#1a1f2e] p-5">
    <span class="text-xs font-medium text-[#94a3b8]">导出字幕</span>

    <div class="flex gap-2">
      <button
        v-for="f in formats"
        :key="f"
        class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition"
        :class="format === f
          ? 'bg-[#00d4aa]/20 text-[#00d4aa] ring-1 ring-[#00d4aa]'
          : 'bg-[#242b3d] text-[#94a3b8] hover:bg-[#242b3d]/80'"
        @click="format = f"
      >{{ f.toUpperCase() }}</button>
    </div>

    <button
      class="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition"
      :class="hasResult
        ? 'bg-[#00d4aa] text-[#0f1219] hover:bg-[#00b894]'
        : 'cursor-not-allowed bg-[#242b3d] text-[#94a3b8]/50'"
      :disabled="!hasResult || exporting"
      @click="handleExport"
    >
      <Download v-if="!exporting" class="h-4 w-4" />
      <svg v-else class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.3" />
        <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
      {{ exporting ? '导出中...' : '下载字幕' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Download } from 'lucide-vue-next'
import { useAlign } from '@/composables/useAlign'

const props = defineProps<{
  taskId: string
  hasResult: boolean
}>()

const { exportSubtitle } = useAlign()
const format = ref<'srt' | 'ass'>('srt')
const exporting = ref(false)
const formats: ('srt' | 'ass')[] = ['srt', 'ass']

async function handleExport() {
  if (!props.hasResult || exporting.value) return
  exporting.value = true
  try {
    const blob = await exportSubtitle(props.taskId, format.value)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aligned.${format.value}`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error(e)
  } finally {
    exporting.value = false
  }
}
</script>
