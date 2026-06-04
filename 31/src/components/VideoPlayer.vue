<template>
  <div class="flex flex-col gap-2 rounded-xl bg-[#1a1f2e] p-4">
    <div class="relative overflow-hidden rounded-lg bg-black">
      <video
        ref="videoEl"
        class="w-full"
        :src="videoSrc"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoaded"
        @ended="playing = false"
      />
      <div v-if="!videoSrc" class="flex h-48 items-center justify-center">
        <Film class="h-12 w-12 text-[#94a3b8]/30" />
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button class="flex h-8 w-8 items-center justify-center rounded-lg text-[#e2e8f0] transition hover:bg-[#242b3d]" @click="togglePlay">
        <Play v-if="!playing" class="h-4 w-4" />
        <Pause v-else class="h-4 w-4" />
      </button>

      <span class="min-w-[100px] font-mono text-xs text-[#94a3b8]">
        {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
      </span>

      <input
        type="range"
        class="range-seek h-1 flex-1 cursor-pointer appearance-none rounded bg-[#242b3d] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00d4aa]"
        :min="0"
        :max="duration"
        :value="currentTime"
        step="0.1"
        @input="onSeek"
      />

      <div class="flex items-center gap-2">
        <Volume2 class="h-4 w-4 text-[#94a3b8]" />
        <input
          type="range"
          class="h-1 w-16 cursor-pointer appearance-none rounded bg-[#242b3d] [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00d4aa]"
          min="0"
          max="1"
          step="0.05"
          :value="volume"
          @input="onVolume"
        />
      </div>
    </div>

    <div class="flex h-6 items-end gap-[2px] overflow-hidden rounded bg-[#0f1219] px-1 pt-1">
      <div
        v-for="i in 40"
        :key="i"
        class="flex-1 rounded-t bg-[#00d4aa]/30"
        :style="{ height: Math.random() * 16 + 4 + 'px' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Play, Pause, Volume2, Film } from 'lucide-vue-next'

const props = defineProps<{
  videoSrc: string
  currentTime: number
}>()

const emit = defineEmits<{
  'time-update': [time: number]
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const duration = ref(0)
const volume = ref(0.8)
const internalSeek = ref(false)

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function togglePlay() {
  if (!videoEl.value) return
  if (playing.value) {
    videoEl.value.pause()
    playing.value = false
  } else {
    videoEl.value.play()
    playing.value = true
  }
}

function onTimeUpdate() {
  if (!videoEl.value) return
  internalSeek.value = true
  emit('time-update', videoEl.value.currentTime)
}

function onLoaded() {
  if (!videoEl.value) return
  duration.value = videoEl.value.duration
  videoEl.value.volume = volume.value
}

function onSeek(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (videoEl.value) videoEl.value.currentTime = val
}

function onVolume(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  volume.value = val
  if (videoEl.value) videoEl.value.volume = val
}

watch(() => props.currentTime, (t) => {
  if (internalSeek.value) {
    internalSeek.value = false
    return
  }
  if (videoEl.value && Math.abs(videoEl.value.currentTime - t) > 0.5) {
    videoEl.value.currentTime = t
  }
})
</script>
