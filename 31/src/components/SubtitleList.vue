<template>
  <div class="flex flex-col overflow-hidden rounded-xl bg-[#1a1f2e]">
    <div class="flex items-center justify-between border-b border-[#242b3d] px-4 py-2">
      <span class="text-xs font-medium text-[#94a3b8]">字幕列表</span>
      <span class="text-xs text-[#94a3b8]">{{ cues.length }} 条</span>
    </div>
    <div ref="listEl" class="flex-1 overflow-y-auto overscroll-contain">
      <div
        v-for="(cue, i) in cues"
        :key="cue.index"
        class="flex cursor-pointer items-start gap-2 border-b border-[#242b3d]/50 px-3 py-2 transition-colors"
        :class="i === currentIndex ? 'bg-[#00d4aa]/10' : 'hover:bg-[#242b3d]/40'"
        @click="$emit('select', i)"
      >
        <span class="mt-0.5 min-w-[28px] font-mono text-xs text-[#94a3b8]">{{ cue.index }}</span>
        <div class="flex-1 min-w-0">
          <div
            v-if="editingIndex !== i"
            class="text-sm text-[#e2e8f0] break-words"
            @dblclick.stop="startEdit(i)"
          >{{ cue.text }}</div>
          <input
            v-else
            ref="editInput"
            :value="cue.text"
            class="w-full rounded bg-[#0f1219] px-2 py-0.5 text-sm text-[#e2e8f0] outline-none ring-1 ring-[#00d4aa]"
            @blur="finishEdit(i, ($event.target as HTMLInputElement).value)"
            @keydown.enter="finishEdit(i, ($event.target as HTMLInputElement).value)"
            @keydown.escape="editingIndex = -1"
          />
          <div class="mt-1 flex items-center gap-2 font-mono text-[10px] text-[#94a3b8]">
            <span>{{ fmt(cue.originalStart) }}</span>
            <span>→</span>
            <span>{{ fmt(cue.alignedStart) }}</span>
            <span
              class="rounded px-1.5 py-px font-mono text-[10px] font-semibold"
              :class="offsetClass(cue.offset)"
            >{{ ms(cue.offset) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { AlignedCue } from '@/types'

const props = defineProps<{
  cues: AlignedCue[]
  currentIndex: number
}>()

const emit = defineEmits<{
  select: [cueIndex: number]
  'text-edit': [cueIndex: number, newText: string]
}>()

const listEl = ref<HTMLDivElement | null>(null)
const editingIndex = ref(-1)
const editInput = ref<HTMLInputElement[] | null>(null)

function fmt(msVal: number): string {
  const totalSec = Math.floor(msVal / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const msPart = msVal % 1000
  return `${m}:${s.toString().padStart(2, '0')}.${msPart.toString().padStart(3, '0')}`
}

function ms(offsetMs: number): string {
  const v = Math.abs(Math.round(offsetMs))
  return (offsetMs < 0 ? '-' : '') + v + 'ms'
}

function offsetClass(offsetMs: number): string {
  const a = Math.abs(offsetMs)
  if (a < 200) return 'bg-[#00d4aa]/20 text-[#00d4aa]'
  if (a <= 500) return 'bg-[#f59e0b]/20 text-[#f59e0b]'
  return 'bg-[#ef4444]/20 text-[#ef4444]'
}

function startEdit(i: number) {
  editingIndex.value = i
  nextTick(() => {
    editInput.value?.[0]?.focus()
  })
}

function finishEdit(i: number, val: string) {
  if (editingIndex.value === i) {
    emit('text-edit', i, val)
    editingIndex.value = -1
  }
}

watch(() => props.currentIndex, (idx) => {
  if (idx < 0 || !listEl.value) return
  const rows = listEl.value.children
  if (rows[idx]) {
    rows[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
})
</script>
