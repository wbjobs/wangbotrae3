import { ref, shallowRef, onUnmounted } from 'vue'
import { io, type Socket } from 'socket.io-client'
import type {
  CollabUser,
  RemoteCursor,
  RemoteDrag,
  RemoteSave,
  CollabConflict,
} from '@/types'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || ''

export function useCollaboration() {
  const socket = shallowRef<Socket | null>(null)
  const isConnected = ref(false)
  const currentUser = ref<CollabUser | null>(null)
  const users = ref<CollabUser[]>([])
  const remoteCursors = ref<Map<string, number>>(new Map())
  const remoteDrags = ref<Map<string, { cueIndex: number; start: number; end: number }>>(new Map())
  const lastSaves = ref<Map<number, { userId: string; savedAt: number }>>(new Map())
  const conflicts = ref<CollabConflict[]>([])
  const currentTaskId = ref<string | null>(null)

  let cursorEmitTimer: number | null = null

  function connect(): void {
    if (socket.value?.connected) return

    socket.value = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    })

    socket.value.on('connect', () => {
      isConnected.value = true
      console.log('[Collab] Connected to server')
    })

    socket.value.on('disconnect', () => {
      isConnected.value = false
      console.log('[Collab] Disconnected from server')
    })

    socket.value.on('user-joined', (data: { self?: CollabUser; user?: CollabUser; users: CollabUser[] }) => {
      if (data.self) {
        currentUser.value = data.self
      }
      users.value = data.users
      if (data.user && data.user.id !== socket.value?.id) {
        conflicts.value.push({
          taskId: currentTaskId.value || '',
          cueIndex: -1,
          latestUser: data.user.id,
          overwrittenUser: '',
          savedAt: Date.now(),
        })
        setTimeout(() => {
          conflicts.value = conflicts.value.filter(c => c.cueIndex !== -1)
        }, 3000)
      }
    })

    socket.value.on('user-left', (data: { userId: string; users: CollabUser[] }) => {
      users.value = data.users
      remoteCursors.value.delete(data.userId)
      remoteDrags.value.delete(data.userId)
    })

    socket.value.on('cursor-move', (data: RemoteCursor) => {
      remoteCursors.value.set(data.userId, data.cursorTime)
    })

    socket.value.on('cue-drag', (data: RemoteDrag) => {
      if (data.isPreview) {
        remoteDrags.value.set(data.userId, {
          cueIndex: data.cueIndex,
          start: data.newStart,
          end: data.newEnd,
        })
      } else {
        remoteDrags.value.delete(data.userId)
      }
    })

    socket.value.on('cue-saved', (data: RemoteSave) => {
      lastSaves.value.set(data.cueIndex, {
        userId: data.userId,
        savedAt: data.savedAt,
      })
      remoteDrags.value.delete(data.userId)
      const user = users.value.find(u => u.id === data.userId)
      if (user) {
        conflicts.value.push({
          taskId: currentTaskId.value || '',
          cueIndex: data.cueIndex,
          latestUser: data.userId,
          overwrittenUser: '',
          savedAt: data.savedAt,
        })
        setTimeout(() => {
          conflicts.value = conflicts.value.filter(
            c => !(c.cueIndex === data.cueIndex && c.savedAt === data.savedAt)
          )
        }, 3000)
      }
    })

    socket.value.on('conflict', (data: CollabConflict) => {
      conflicts.value.push(data)
      setTimeout(() => {
        conflicts.value = conflicts.value.filter(
          c => !(c.cueIndex === data.cueIndex && c.savedAt === data.savedAt)
        )
      }, 5000)
    })
  }

  function joinRoom(taskId: string, userName?: string): void {
    if (!socket.value) connect()
    currentTaskId.value = taskId
    socket.value?.emit('join-room', { taskId, userName })
  }

  function leaveRoom(taskId: string): void {
    socket.value?.emit('leave-room', taskId)
    currentTaskId.value = null
    currentUser.value = null
    users.value = []
    remoteCursors.value.clear()
    remoteDrags.value.clear()
    lastSaves.value.clear()
  }

  function sendCursorMove(taskId: string, cursorTime: number): void {
    if (cursorEmitTimer !== null) return
    cursorEmitTimer = window.setTimeout(() => {
      socket.value?.emit('cursor-move', {
        userId: socket.value?.id,
        taskId,
        cursorTime,
      })
      cursorEmitTimer = null
    }, 50)
  }

  function sendCueDrag(taskId: string, cueIndex: number, newStart: number, newEnd: number, isPreview: boolean): void {
    socket.value?.emit('cue-drag', {
      userId: socket.value?.id,
      taskId,
      cueIndex,
      newStart,
      newEnd,
      isPreview,
    })
  }

  function sendCueSave(taskId: string, cueIndex: number, newStart: number, newEnd: number): void {
    const savedAt = Date.now()
    socket.value?.emit('cue-save', {
      userId: socket.value?.id,
      taskId,
      cueIndex,
      newStart,
      newEnd,
      savedAt,
    })
  }

  function disconnect(): void {
    if (currentTaskId.value) {
      leaveRoom(currentTaskId.value)
    }
    socket.value?.disconnect()
    socket.value = null
    isConnected.value = false
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    socket,
    isConnected,
    currentUser,
    users,
    remoteCursors,
    remoteDrags,
    lastSaves,
    conflicts,
    currentTaskId,
    connect,
    disconnect,
    joinRoom,
    leaveRoom,
    sendCursorMove,
    sendCueDrag,
    sendCueSave,
  }
}
