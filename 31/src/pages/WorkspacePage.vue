<template>
  <div class="flex h-[calc(100vh-52px)] flex-col gap-4 p-4 lg:flex-row">
    <div class="fixed right-4 top-16 z-50 flex flex-col gap-2">
      <transition-group name="notification" tag="div">
        <div
          v-for="conflict in visibleConflicts"
          :key="conflict.cueIndex + '-' + conflict.savedAt"
          class="w-72 rounded-xl p-4 shadow-xl backdrop-blur-sm"
          :class="conflict.overwrittenUser === currentUser?.id
            ? 'bg-[#ef4444]/90 text-white'
            : 'bg-[#1a1f2e]/95 border border-[#242b3d] text-[#e2e8f0]'"
        >
          <div class="flex items-center gap-2 text-sm font-medium">
            <AlertCircle v-if="conflict.overwrittenUser === currentUser?.id" class="h-4 w-4" />
            <Users v-else class="h-4 w-4 text-[#00d4aa]" />
            {{ getConflictMessage(conflict) }}
          </div>
          <div class="mt-1 text-xs text-[#94a3b8]">
            {{ formatTime(conflict.savedAt) }}
          </div>
        </div>
      </transition-group>
    </div>

    <div class="flex w-full flex-col gap-4 lg:w-72 lg:min-w-72">
      <FileUpload
        :video-info="videoInfo"
        :subtitle-info="subtitleInfo"
        @video-uploaded="onVideoUploaded"
        @subtitle-uploaded="onSubtitleUploaded"
      />
      <div class="flex min-h-0 flex-1 flex-col">
        <SubtitleList
          v-if="alignResult"
          :cues="alignResult.cues"
          :current-index="currentCueIndex"
          @select="onCueSelect"
          @text-edit="onTextEdit"
        />
        <div v-else class="flex flex-1 items-center justify-center rounded-xl bg-[#1a1f2e] p-4 text-center text-sm text-[#94a3b8]">
          开始对齐后显示字幕列表
        </div>
      </div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-4">
      <VideoPlayer
        :video-src="videoSrc"
        :current-time="currentTime"
        @time-update="onTimeUpdate"
      />
      <TimelineEditor
        v-if="alignResult"
        :cues="alignResult.cues"
        :duration="videoInfo?.duration ?? 0"
        :current-time="currentTime"
        :speech-segments="speechSegments"
        :remote-cursors="remoteCursors"
        :remote-drags="remoteDrags"
        :collab-users="collabUsers"
        @cue-drag="onCueDrag"
        @seek="onSeek"
        @cursor-move="onCursorMove"
      />
      <div v-else class="flex h-32 items-center justify-center rounded-xl bg-[#1a1f2e] text-sm text-[#94a3b8]">
        开始对齐后显示时间轴
      </div>
    </div>

    <div class="flex w-full flex-col gap-4 lg:w-64 lg:min-w-64">
      <div v-if="taskId && collabUsers.length > 0" class="rounded-xl bg-[#1a1f2e] p-5">
        <div class="flex items-center gap-2">
          <Users class="h-4 w-4 text-[#00d4aa]" />
          <span class="text-xs font-medium text-[#94a3b8]">在线协作者 ({{ collabUsers.length }})</span>
          <span
            v-if="isConnected"
            class="ml-auto flex h-2 w-2 rounded-full bg-[#00d4aa]"
            title="已连接"
          />
        </div>
        <div class="mt-3 flex flex-col gap-2">
          <div
            v-for="user in collabUsers"
            :key="user.id"
            class="flex items-center gap-2 rounded-lg bg-[#242b3d] px-3 py-2"
          >
            <span
              class="h-3 w-3 rounded-full"
              :style="{ backgroundColor: user.color }"
            />
            <span class="flex-1 truncate text-sm text-[#e2e8f0]">{{ user.name }}</span>
            <span
              v-if="user.id === currentUser?.id"
              class="text-xs text-[#00d4aa]"
            >你</span>
          </div>
        </div>
      </div>

      <div class="rounded-xl bg-[#1a1f2e] p-5">
        <span class="text-xs font-medium text-[#94a3b8]">对齐参数</span>
        <div class="mt-3 flex flex-col gap-3">
          <div>
            <div class="flex items-center justify-between">
              <label class="text-xs text-[#94a3b8]">偏移阈值</label>
              <span class="font-mono text-xs text-[#00d4aa]">{{ threshold }}ms</span>
            </div>
            <input
              type="range"
              class="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-[#242b3d] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00d4aa]"
              min="50"
              max="1000"
              step="50"
              v-model.number="threshold"
            />
          </div>
          <button
            class="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition"
            :class="canAlign
              ? 'bg-[#00d4aa] text-[#0f1219] hover:bg-[#00b894]'
              : 'cursor-not-allowed bg-[#242b3d] text-[#94a3b8]/50'"
            :disabled="!canAlign || isProcessing"
            @click="startAlignment"
          >
            <Zap class="h-4 w-4" />
            {{ isProcessing ? '对齐中...' : '开始对齐' }}
          </button>
        </div>
      </div>

      <AlignStatus :result="alignResult" :is-processing="isProcessing" :progress="progress" />
      <ExportPanel :task-id="taskId" :has-result="!!alignResult" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Zap, Users, AlertCircle } from 'lucide-vue-next'
import FileUpload from '@/components/FileUpload.vue'
import VideoPlayer from '@/components/VideoPlayer.vue'
import TimelineEditor from '@/components/TimelineEditor.vue'
import SubtitleList from '@/components/SubtitleList.vue'
import AlignStatus from '@/components/AlignStatus.vue'
import ExportPanel from '@/components/ExportPanel.vue'
import { useAlign } from '@/composables/useAlign'
import { useCollaboration } from '@/composables/useCollaboration'
import type { VideoInfo, SubtitleInfo, AlignResult, CollabConflict } from '@/types'

const { uploadVideo, uploadSubtitle, startAlign, pollAlignStatus, manualCalibrate } = useAlign()
const {
  isConnected,
  currentUser,
  users: collabUsers,
  remoteCursors,
  remoteDrags,
  conflicts,
  joinRoom,
  leaveRoom,
  sendCursorMove,
  sendCueDrag,
  sendCueSave,
} = useCollaboration()

const videoInfo = ref<VideoInfo | null>(null)
const subtitleInfo = ref<SubtitleInfo | null>(null)
const alignResult = ref<AlignResult | null>(null)
const currentCueIndex = ref(-1)
const currentTime = ref(0)
const isProcessing = ref(false)
const progress = ref(0)
const taskId = ref('')
const threshold = ref(200)

const visibleConflicts = computed(() => conflicts.value.slice(-3))

const videoSrc = computed(() => {
  if (!videoInfo.value) return ''
  return `/api/upload/video/${videoInfo.value.videoId}`
})

const canAlign = computed(() => videoInfo.value && subtitleInfo.value && !isProcessing.value)

const speechSegments = computed(() => {
  if (!alignResult.value) return undefined
  return alignResult.value.cues.map(c => ({ start: c.alignedStart / 1000, end: c.alignedEnd / 1000 }))
})

function getConflictMessage(conflict: CollabConflict): string {
  if (conflict.cueIndex < 0) {
    const user = collabUsers.value.find(u => u.id === conflict.latestUser)
    return `${user?.name || '新用户'} 加入了协同`
  }
  if (conflict.overwrittenUser === currentUser.value?.id) {
    const user = collabUsers.value.find(u => u.id === conflict.latestUser)
    return `你的第 ${conflict.cueIndex + 1} 条字幕被 ${user?.name || '其他用户'} 覆盖`
  }
  const latestUser = collabUsers.value.find(u => u.id === conflict.latestUser)
  const overwrittenUser = collabUsers.value.find(u => u.id === conflict.overwrittenUser)
  if (conflict.overwrittenUser) {
    return `${latestUser?.name || '某用户'} 修改了第 ${conflict.cueIndex + 1} 条字幕 (覆盖了 ${overwrittenUser?.name || '他人'})`
  }
  return `${latestUser?.name || '某用户'} 保存了第 ${conflict.cueIndex + 1} 条字幕`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN')
}

function onVideoUploaded(info: VideoInfo) {
  videoInfo.value = info
}

function onSubtitleUploaded(info: SubtitleInfo) {
  subtitleInfo.value = info
}

async function startAlignment() {
  if (!videoInfo.value || !subtitleInfo.value) return
  isProcessing.value = true
  progress.value = 0
  alignResult.value = null
  try {
    const task = await startAlign(videoInfo.value.videoId, subtitleInfo.value.subtitleId, threshold.value)
    taskId.value = task.taskId
    joinRoom(task.taskId)
    const progressInterval = setInterval(() => {
      progress.value = Math.min(progress.value + Math.random() * 8, 90)
    }, 500)
    const result = await pollAlignStatus(task.taskId)
    clearInterval(progressInterval)
    progress.value = 100
    alignResult.value = result
  } catch (e) {
    console.error(e)
  } finally {
    isProcessing.value = false
  }
}

function onTimeUpdate(t: number) {
  currentTime.value = t
  if (alignResult.value) {
    const cues = alignResult.value.cues
    const ms = t * 1000
    for (let i = 0; i < cues.length; i++) {
      if (ms >= cues[i].alignedStart && ms <= cues[i].alignedEnd) {
        currentCueIndex.value = i
        break
      }
    }
  }
}

function onCueSelect(i: number) {
  currentCueIndex.value = i
  if (alignResult.value) {
    currentTime.value = alignResult.value.cues[i].alignedStart / 1000
  }
}

function onSeek(t: number) {
  currentTime.value = t
}

function onTextEdit(i: number, text: string) {
  if (alignResult.value) {
    alignResult.value.cues[i].text = text
  }
}

function onCursorMove(timeMs: number) {
  if (taskId.value) {
    sendCursorMove(taskId.value, timeMs)
  }
}

async function onCueDrag(cueIndex: number, newStart: number, newEnd: number, isPreview: boolean) {
  if (!taskId.value || !alignResult.value) return

  const cue = alignResult.value.cues[cueIndex]
  cue.alignedStart = newStart
  cue.alignedEnd = newEnd
  cue.corrected = true

  sendCueDrag(taskId.value, cueIndex, newStart, newEnd, isPreview)

  if (!isPreview) {
    try {
      const updated = await manualCalibrate(taskId.value, cueIndex, newStart, newEnd)
      if (alignResult.value) {
        alignResult.value.cues[cueIndex] = updated
      }
      sendCueSave(taskId.value, cueIndex, newStart, newEnd)
    } catch (e: any) {
      console.error(e)
      alert('保存失败: ' + (e.message || '未知错误'))
    }
  }
}

watch(() => remoteDrags.value, (drags) => {
  if (!alignResult.value) return
  for (const [, drag] of drags) {
    const cue = alignResult.value.cues[drag.cueIndex]
    if (cue) {
      cue.alignedStart = drag.start
      cue.alignedEnd = drag.end
      cue.corrected = true
    }
  }
}, { deep: true })

watch(() => taskId.value, (newId, oldId) => {
  if (oldId && oldId !== newId) {
    leaveRoom(oldId)
  }
})
</script>

<style scoped>
.notification-enter-active,
.notification-leave-active {
  transition: all 0.3s ease;
}
.notification-enter-from {
  opacity: 0;
  transform: translateX(100%);
}
.notification-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
