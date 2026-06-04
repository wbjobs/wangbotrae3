<template>
  <div class="flex flex-col gap-4">
    <div
      class="upload-zone relative rounded-xl border-2 border-dashed p-6 text-center transition-all duration-300 cursor-pointer"
      :class="[
        videoDragOver ? 'border-[#00d4aa] bg-[#00d4aa]/5' : 'border-[#94a3b8]/30 hover:border-[#00d4aa]/60',
        videoInfo ? 'border-[#00d4aa]/40 bg-[#00d4aa]/5' : '',
      ]"
      @dragover.prevent="videoDragOver = true"
      @dragleave="videoDragOver = false"
      @drop.prevent="handleVideoDrop"
      @click="videoInput?.click()"
    >
      <input ref="videoInput" type="file" accept=".mp4,.mkv,.avi" class="hidden" @change="handleVideoChange" />
      <template v-if="videoInfo">
        <div class="flex items-center justify-center gap-3">
          <Film class="h-8 w-8 text-[#00d4aa]" />
          <div class="text-left">
            <p class="text-sm font-medium text-[#e2e8f0]">{{ videoInfo.fileName }}</p>
            <p class="text-xs text-[#94a3b8]">{{ formatSize(videoInfo.fileSize) }} · {{ formatDuration(videoInfo.duration) }}</p>
          </div>
        </div>
      </template>
      <template v-else>
        <Upload class="mx-auto h-10 w-10 text-[#94a3b8] transition-transform duration-300" :class="videoDragOver ? 'scale-110 text-[#00d4aa]' : ''" />
        <p class="mt-3 text-sm text-[#e2e8f0]">拖放或点击上传视频</p>
        <p class="mt-1 text-xs text-[#94a3b8]">支持 MP4 / MKV / AVI</p>
      </template>
    </div>

    <div
      class="upload-zone relative rounded-xl border-2 border-dashed p-6 text-center transition-all duration-300 cursor-pointer"
      :class="[
        subtitleDragOver ? 'border-[#00d4aa] bg-[#00d4aa]/5' : 'border-[#94a3b8]/30 hover:border-[#00d4aa]/60',
        subtitleInfo ? 'border-[#00d4aa]/40 bg-[#00d4aa]/5' : '',
      ]"
      @dragover.prevent="subtitleDragOver = true"
      @dragleave="subtitleDragOver = false"
      @drop.prevent="handleSubtitleDrop"
      @click="subtitleInput?.click()"
    >
      <input ref="subtitleInput" type="file" accept=".srt,.ass" class="hidden" @change="handleSubtitleChange" />
      <template v-if="subtitleInfo">
        <div class="flex items-center justify-center gap-3">
          <FileText class="h-8 w-8 text-[#00d4aa]" />
          <div class="text-left">
            <p class="text-sm font-medium text-[#e2e8f0]">字幕文件已上传</p>
            <p class="text-xs text-[#94a3b8]">{{ subtitleInfo.format.toUpperCase() }} · {{ subtitleInfo.totalLines }} 条</p>
          </div>
        </div>
      </template>
      <template v-else>
        <Upload class="mx-auto h-10 w-10 text-[#94a3b8] transition-transform duration-300" :class="subtitleDragOver ? 'scale-110 text-[#00d4aa]' : ''" />
        <p class="mt-3 text-sm text-[#e2e8f0]">拖放或点击上传字幕</p>
        <p class="mt-1 text-xs text-[#94a3b8]">支持 SRT / ASS</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Upload, Film, FileText } from 'lucide-vue-next'
import type { VideoInfo, SubtitleInfo } from '@/types'
import { useAlign } from '@/composables/useAlign'

const props = defineProps<{
  videoInfo: VideoInfo | null
  subtitleInfo: SubtitleInfo | null
}>()

const emit = defineEmits<{
  'video-uploaded': [info: VideoInfo]
  'subtitle-uploaded': [info: SubtitleInfo]
}>()

const { uploadVideo, uploadSubtitle } = useAlign()
const videoInput = ref<HTMLInputElement | null>(null)
const subtitleInput = ref<HTMLInputElement | null>(null)
const videoDragOver = ref(false)
const subtitleDragOver = ref(false)

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function handleVideoFile(file: File) {
  try {
    const info = await uploadVideo(file)
    emit('video-uploaded', info)
  } catch (e) {
    console.error(e)
  }
}

async function handleSubtitleFile(file: File) {
  if (!props.videoInfo) return
  try {
    const info = await uploadSubtitle(file, props.videoInfo.videoId)
    emit('subtitle-uploaded', info)
  } catch (e) {
    console.error(e)
  }
}

function handleVideoDrop(e: DragEvent) {
  videoDragOver.value = false
  const file = e.dataTransfer?.files[0]
  if (file) handleVideoFile(file)
}

function handleVideoChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleVideoFile(file)
}

function handleSubtitleDrop(e: DragEvent) {
  subtitleDragOver.value = false
  const file = e.dataTransfer?.files[0]
  if (file) handleSubtitleFile(file)
}

function handleSubtitleChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleSubtitleFile(file)
}
</script>
