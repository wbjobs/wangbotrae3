<template>
  <div class="mx-auto max-w-5xl p-6">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-[#e2e8f0]">历史记录</h1>
      <button
        class="flex items-center gap-1.5 rounded-lg bg-[#242b3d] px-3 py-1.5 text-xs text-[#94a3b8] transition hover:bg-[#242b3d]/80 hover:text-[#e2e8f0]"
        @click="loadHistory"
      >
        <RefreshCw class="h-3.5 w-3.5" />
        刷新
      </button>
    </div>

    <div class="overflow-hidden rounded-xl border border-[#242b3d]">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-[#1a1f2e] text-left text-xs text-[#94a3b8]">
            <th class="px-4 py-3 font-medium">视频名称</th>
            <th class="px-4 py-3 font-medium">字幕名称</th>
            <th class="px-4 py-3 font-medium">日期</th>
            <th class="px-4 py-3 font-medium">校正/总数</th>
            <th class="px-4 py-3 font-medium">评分</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            class="border-t border-[#242b3d] transition hover:bg-[#242b3d]/30"
          >
            <td class="px-4 py-3 text-[#e2e8f0]">{{ item.videoName }}</td>
            <td class="px-4 py-3 text-[#e2e8f0]">{{ item.subtitleName }}</td>
            <td class="px-4 py-3 font-mono text-xs text-[#94a3b8]">{{ formatDate(item.createdAt) }}</td>
            <td class="px-4 py-3 font-mono text-xs">
              <span class="text-[#f59e0b]">{{ item.correctedCues }}</span>
              <span class="text-[#94a3b8]"> / {{ item.totalCues }}</span>
            </td>
            <td class="px-4 py-3 font-mono text-xs" :class="scoreClass(item.score)">{{ item.score }}</td>
            <td class="px-4 py-3">
              <button
                class="rounded px-2 py-1 text-xs text-[#00d4aa] transition hover:bg-[#00d4aa]/10"
                @click="viewDetail(item.id)"
              >详情</button>
            </td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="6" class="px-4 py-12 text-center text-[#94a3b8]">暂无历史记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > limit" class="mt-4 flex items-center justify-center gap-2">
      <button
        class="rounded-lg bg-[#242b3d] px-3 py-1.5 text-xs text-[#94a3b8] transition hover:text-[#e2e8f0]"
        :disabled="page <= 1"
        @click="page--"
      >上一页</button>
      <span class="text-xs text-[#94a3b8]">{{ page }} / {{ totalPages }}</span>
      <button
        class="rounded-lg bg-[#242b3d] px-3 py-1.5 text-xs text-[#94a3b8] transition hover:text-[#e2e8f0]"
        :disabled="page >= totalPages"
        @click="page++"
      >下一页</button>
    </div>

    <div
      v-if="showDetail"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="showDetail = false"
    >
      <div class="w-full max-w-lg rounded-xl bg-[#1a1f2e] p-6 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-[#e2e8f0]">对齐详情</h2>
          <button class="text-[#94a3b8] hover:text-[#e2e8f0]" @click="showDetail = false">
            <X class="h-4 w-4" />
          </button>
        </div>
        <div v-if="detailLoading" class="py-8 text-center text-sm text-[#94a3b8]">加载中...</div>
        <div v-else-if="detail" class="flex flex-col gap-2">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg bg-[#242b3d] p-3 text-center">
              <p class="text-xs text-[#94a3b8]">总条数</p>
              <p class="mt-1 font-mono text-lg text-[#e2e8f0]">{{ detail.totalCues }}</p>
            </div>
            <div class="rounded-lg bg-[#242b3d] p-3 text-center">
              <p class="text-xs text-[#94a3b8]">校正条数</p>
              <p class="mt-1 font-mono text-lg text-[#f59e0b]">{{ detail.correctedCues }}</p>
            </div>
          </div>
          <button
            class="mt-3 flex items-center justify-center gap-2 rounded-lg bg-[#00d4aa] px-4 py-2 text-sm font-medium text-[#0f1219] transition hover:bg-[#00b894]"
            @click="reloadToWorkspace"
          >载入工作台</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, X } from 'lucide-vue-next'
import { useAlign } from '@/composables/useAlign'
import type { HistoryItem } from '@/types'

const { fetchHistory, fetchHistoryDetail } = useAlign()
const router = useRouter()

const items = ref<HistoryItem[]>([])
const total = ref(0)
const page = ref(1)
const limit = 10
const showDetail = ref(false)
const detail = ref<any>(null)
const detailLoading = ref(false)
const detailId = ref('')

const totalPages = computed(() => Math.ceil(total.value / limit))

function formatDate(d: string): string {
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function scoreClass(s: number): string {
  if (s > 80) return 'text-[#00d4aa]'
  if (s >= 50) return 'text-[#f59e0b]'
  return 'text-[#ef4444]'
}

async function loadHistory() {
  try {
    const res = await fetchHistory(page.value, limit)
    items.value = res.items
    total.value = res.total
  } catch (e) {
    console.error(e)
  }
}

async function viewDetail(id: string) {
  detailId.value = id
  showDetail.value = true
  detailLoading.value = true
  try {
    detail.value = await fetchHistoryDetail(id)
  } catch (e) {
    console.error(e)
  } finally {
    detailLoading.value = false
  }
}

function reloadToWorkspace() {
  router.push('/')
}

watch(page, loadHistory, { immediate: true })
</script>
