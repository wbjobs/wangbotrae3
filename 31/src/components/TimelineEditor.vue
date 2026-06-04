<template>
  <div class="flex flex-col rounded-xl bg-[#1a1f2e]">
    <div class="flex items-center justify-between px-4 py-2">
      <span class="text-xs font-medium text-[#94a3b8]">时间轴编辑器</span>
      <div class="flex items-center gap-1">
        <button class="ctrl-btn" @click="zoomIn"><ZoomIn class="h-3.5 w-3.5" /></button>
        <button class="ctrl-btn" @click="zoomOut"><ZoomOut class="h-3.5 w-3.5" /></button>
        <button class="ctrl-btn" @click="fitView"><Maximize2 class="h-3.5 w-3.5" /></button>
      </div>
    </div>
    <div
      ref="container"
      class="relative h-32 cursor-crosshair overflow-hidden bg-[#0f1219]"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @wheel.prevent="onWheel"
    >
      <canvas ref="canvas" class="h-full w-full" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-vue-next'
import type { AlignedCue, CollabUser } from '@/types'

const props = defineProps<{
  cues: AlignedCue[]
  duration: number
  currentTime: number
  speechSegments?: { start: number; end: number }[]
  remoteCursors?: Map<string, number>
  remoteDrags?: Map<string, { cueIndex: number; start: number; end: number }>
  collabUsers?: CollabUser[]
}>()

const emit = defineEmits<{
  'cue-drag': [cueIndex: number, newStart: number, newEnd: number, isPreview: boolean]
  seek: [time: number]
  'cursor-move': [time: number]
}>()

const container = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const pixelsPerSecond = ref(50)
const scrollOffset = ref(0)
const draggingCue = ref<number | null>(null)
const dragStartX = ref(0)
const dragStartTime = ref(0)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartOffset = ref(0)
const dragPreviewPos = ref<{ cueIndex: number; start: number; end: number } | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let animFrame = 0
let lastEmitTime = 0
let lastCursorEmitTime = 0
const EMIT_THROTTLE_MS = 100
const CURSOR_EMIT_THROTTLE_MS = 80

const THRESHOLD = 200

function getUserColor(userId: string): string {
  if (!props.collabUsers) return '#f43f5e'
  const user = props.collabUsers.find(u => u.id === userId)
  return user?.color || '#f43f5e'
}

function getUserName(userId: string): string {
  if (!props.collabUsers) return '用户'
  const user = props.collabUsers.find(u => u.id === userId)
  return user?.name || '用户'
}

function cueColor(cue: AlignedCue): string {
  if (cue.corrected && Math.abs(cue.offset) > 0.001) return '#3b82f6'
  if (Math.abs(cue.offset) > THRESHOLD) return '#f59e0b'
  return '#00d4aa'
}

function msToSec(ms: number): number {
  return ms / 1000
}

function timeToX(t: number): number {
  return (t * pixelsPerSecond.value) - scrollOffset.value
}

function xToTime(x: number): number {
  return (x + scrollOffset.value) / pixelsPerSecond.value
}

function draw() {
  const el = canvas.value
  const box = container.value
  if (!el || !box || !ctx) return
  const dpr = window.devicePixelRatio || 1
  const w = box.clientWidth
  const h = box.clientHeight
  el.width = w * dpr
  el.height = h * dpr
  el.style.width = w + 'px'
  el.style.height = h + 'px'
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  ctx.fillStyle = '#0f1219'
  ctx.fillRect(0, 0, w, h)

  if (props.speechSegments) {
    for (const seg of props.speechSegments) {
      const x1 = timeToX(seg.start)
      const x2 = timeToX(seg.end)
      if (x2 < 0 || x1 > w) continue
      ctx.fillStyle = 'rgba(0,212,170,0.06)'
      ctx.fillRect(x1, 0, x2 - x1, h)
    }
  }

  const axisY = h - 24
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, axisY)
  ctx.lineTo(w, axisY)
  ctx.stroke()

  const tickInterval = getTickInterval()
  const startT = Math.floor(xToTime(0) / tickInterval) * tickInterval
  for (let t = startT; t <= xToTime(w); t += tickInterval) {
    const x = timeToX(t)
    if (x < 0 || x > w) continue
    ctx.strokeStyle = '#94a3b8'
    ctx.beginPath()
    ctx.moveTo(x, axisY)
    ctx.lineTo(x, axisY - 6)
    ctx.stroke()
    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px JetBrains Mono, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(formatTick(t), x, axisY + 14)
  }

  const cueTop = 8
  const cueH = axisY - 16
  for (let i = 0; i < props.cues.length; i++) {
    const cue = props.cues[i]
    const x1 = timeToX(msToSec(cue.alignedStart))
    const x2 = timeToX(msToSec(cue.alignedEnd))
    if (x2 < 0 || x1 > w) continue
    ctx.fillStyle = cueColor(cue)
    ctx.globalAlpha = 0.75
    const rw = Math.max(x2 - x1, 2)
    roundRect(ctx, x1, cueTop, rw, cueH, 3)
    ctx.fill()
    ctx.globalAlpha = 1
    if (rw > 24) {
      ctx.fillStyle = '#0f1219'
      ctx.font = '9px JetBrains Mono, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(cue.index), x1 + rw / 2, cueTop + cueH / 2 + 3)
    }
  }

  if (dragPreviewPos.value) {
    const x1 = timeToX(msToSec(dragPreviewPos.value.start))
    const x2 = timeToX(msToSec(dragPreviewPos.value.end))
    if (x2 >= 0 && x1 <= w) {
      ctx.fillStyle = '#3b82f6'
      ctx.globalAlpha = 0.4
      const rw = Math.max(x2 - x1, 2)
      roundRect(ctx, x1, cueTop, rw, cueH, 3)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#60a5fa'
      ctx.lineWidth = 2
      roundRect(ctx, x1, cueTop, rw, cueH, 3)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  if (props.remoteDrags) {
    for (const [userId, drag] of props.remoteDrags) {
      const x1 = timeToX(msToSec(drag.start))
      const x2 = timeToX(msToSec(drag.end))
      if (x2 < 0 || x1 > w) continue
      const color = getUserColor(userId)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.25
      const rw = Math.max(x2 - x1, 2)
      roundRect(ctx, x1, cueTop, rw, cueH, 3)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      roundRect(ctx, x1, cueTop, rw, cueH, 3)
      ctx.stroke()
      ctx.setLineDash([])
      if (rw > 30) {
        ctx.fillStyle = color
        ctx.font = '10px JetBrains Mono, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(getUserName(userId), x1 + rw / 2, cueTop + cueH / 2 + 3)
      }
    }
  }

  const cursorX = timeToX(props.currentTime)
  if (cursorX >= 0 && cursorX <= w) {
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cursorX, 0)
    ctx.lineTo(cursorX, h)
    ctx.stroke()
    ctx.fillStyle = '#ef4444'
    ctx.beginPath()
    ctx.arc(cursorX, 4, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  if (props.remoteCursors) {
    for (const [userId, timeMs] of props.remoteCursors) {
      const x = timeToX(msToSec(timeMs))
      if (x < 0 || x > w) continue
      const color = getUserColor(userId)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x - 6, 10)
      ctx.lineTo(x + 6, 10)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = '9px JetBrains Mono, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(getUserName(userId), x + 8, 9)
    }
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.lineTo(x + w - r, y)
  c.quadraticCurveTo(x + w, y, x + w, y + r)
  c.lineTo(x + w, y + h - r)
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  c.lineTo(x + r, y + h)
  c.quadraticCurveTo(x, y + h, x, y + h - r)
  c.lineTo(x, y + r)
  c.quadraticCurveTo(x, y, x + r, y)
  c.closePath()
}

function getTickInterval(): number {
  const pps = pixelsPerSecond.value
  if (pps >= 100) return 1
  if (pps >= 40) return 5
  if (pps >= 15) return 10
  if (pps >= 5) return 30
  return 60
}

function formatTick(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function hitCue(mx: number): number | null {
  const axisY = canvas.value ? canvas.value.clientHeight - 24 : 100
  const cueTop = 8
  const cueH = axisY - 16
  for (let i = props.cues.length - 1; i >= 0; i--) {
    const cue = props.cues[i]
    const x1 = timeToX(msToSec(cue.alignedStart))
    const x2 = timeToX(msToSec(cue.alignedEnd))
    if (mx >= x1 && mx <= x2 && mx >= 0) return i
  }
  return null
}

function onMouseDown(e: MouseEvent) {
  const rect = container.value?.getBoundingClientRect()
  if (!rect) return
  const mx = e.clientX - rect.left
  const hit = hitCue(mx)
  if (hit !== null) {
    draggingCue.value = hit
    dragStartX.value = mx
    const cue = props.cues[hit]
    dragStartTime.value = msToSec(cue.alignedStart)
  } else if (e.shiftKey) {
    isPanning.value = true
    panStartX.value = e.clientX
    panStartOffset.value = scrollOffset.value
  } else {
    const t = xToTime(mx)
    if (t >= 0 && t <= props.duration) emit('seek', t)
  }
}

function onMouseMove(e: MouseEvent) {
  const rect = container.value?.getBoundingClientRect()
  if (!rect) return
  const mx = e.clientX - rect.left
  const now = performance.now()
  if (draggingCue.value !== null) {
    const dx = mx - dragStartX.value
    const dt = dx / pixelsPerSecond.value
    const cue = props.cues[draggingCue.value]
    const dur = msToSec(cue.alignedEnd - cue.alignedStart)
    let newStart = dragStartTime.value + dt
    newStart = Math.max(0, Math.min(newStart, props.duration - dur))
    const newStartMs = Math.round(newStart * 1000)
    const newEndMs = Math.round((newStart + dur) * 1000)
    dragPreviewPos.value = { cueIndex: draggingCue.value, start: newStartMs, end: newEndMs }
    scheduleDraw()
    if (now - lastEmitTime >= EMIT_THROTTLE_MS) {
      lastEmitTime = now
      emit('cue-drag', draggingCue.value, newStartMs, newEndMs, true)
    }
  } else if (isPanning.value) {
    const dx = e.clientX - panStartX.value
    scrollOffset.value = Math.max(0, panStartOffset.value - dx)
    scheduleDraw()
  } else {
    const t = xToTime(mx)
    if (t >= 0 && t <= props.duration && now - lastCursorEmitTime >= CURSOR_EMIT_THROTTLE_MS) {
      lastCursorEmitTime = now
      emit('cursor-move', Math.round(t * 1000))
    }
  }
}

function onMouseUp() {
  if (draggingCue.value !== null && dragPreviewPos.value) {
    emit('cue-drag', draggingCue.value, dragPreviewPos.value.start, dragPreviewPos.value.end, false)
  }
  draggingCue.value = null
  isPanning.value = false
  dragPreviewPos.value = null
  scheduleDraw()
}

function onWheel(e: WheelEvent) {
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  pixelsPerSecond.value = Math.max(2, Math.min(500, pixelsPerSecond.value * factor))
  draw()
}

function zoomIn() {
  pixelsPerSecond.value = Math.min(500, pixelsPerSecond.value * 1.3)
  draw()
}

function zoomOut() {
  pixelsPerSecond.value = Math.max(2, pixelsPerSecond.value / 1.3)
  draw()
}

function fitView() {
  if (!container.value || !props.duration) return
  pixelsPerSecond.value = container.value.clientWidth / props.duration
  scrollOffset.value = 0
  draw()
}

function scheduleDraw() {
  cancelAnimationFrame(animFrame)
  animFrame = requestAnimationFrame(draw)
}

watch(
  [() => props.cues, () => props.currentTime, () => props.duration, () => props.speechSegments,
   () => props.remoteCursors?.size, () => props.remoteDrags?.size, () => props.collabUsers?.length],
  scheduleDraw,
  { deep: true }
)

onMounted(() => {
  ctx = canvas.value?.getContext('2d') ?? null
  scheduleDraw()
  window.addEventListener('resize', scheduleDraw)
})

onUnmounted(() => {
  window.removeEventListener('resize', scheduleDraw)
  cancelAnimationFrame(animFrame)
})
</script>

<style scoped>
.ctrl-btn {
  @apply flex h-6 w-6 items-center justify-center rounded text-[#94a3b8] transition hover:bg-[#242b3d] hover:text-[#00d4aa];
}
</style>
