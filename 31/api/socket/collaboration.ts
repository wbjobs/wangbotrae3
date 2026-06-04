import type { Server as HTTPServer } from 'http'
import { Server as IOServer, type Socket } from 'socket.io'
import type {
  CollabUser,
  CollabCursorEvent,
  CollabCueDragEvent,
  CollabCueSaveEvent,
  CollabConflictEvent,
} from '../types.js'
import { getDb, save } from '../db/database.js'

const USER_COLORS = [
  '#f43f5e', '#8b5cf6', '#3b82f6', '#f59e0b',
  '#10b981', '#ec4899', '#f97316', '#06b6d4',
]

interface RoomState {
  users: Map<string, CollabUser>
  cueLastSavedBy: Map<number, { userId: string; savedAt: number }>
}

export class CollaborationServer {
  private io: IOServer
  private rooms: Map<string, RoomState> = new Map()
  private userNameCounter: Map<string, number> = new Map()

  constructor(httpServer: HTTPServer) {
    this.io = new IOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      path: '/socket.io',
    })
    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`[Collab] Client connected: ${socket.id}`)

      socket.on('join-room', (data: { taskId: string; userName?: string }) => {
        this.handleJoinRoom(socket, data.taskId, data.userName)
      })

      socket.on('cursor-move', (data: CollabCursorEvent) => {
        this.handleCursorMove(socket, data)
      })

      socket.on('cue-drag', (data: CollabCueDragEvent) => {
        this.handleCueDrag(socket, data)
      })

      socket.on('cue-save', (data: CollabCueSaveEvent) => {
        this.handleCueSave(socket, data)
      })

      socket.on('leave-room', (taskId: string) => {
        this.handleLeaveRoom(socket, taskId)
      })

      socket.on('disconnect', () => {
        this.handleDisconnect(socket)
      })
    })
  }

  private getRoom(taskId: string): RoomState {
    if (!this.rooms.has(taskId)) {
      this.rooms.set(taskId, {
        users: new Map(),
        cueLastSavedBy: new Map(),
      })
    }
    return this.rooms.get(taskId)!
  }

  private generateUserName(taskId: string): string {
    const count = this.userNameCounter.get(taskId) || 0
    this.userNameCounter.set(taskId, count + 1)
    return `用户${count + 1}`
  }

  private getUserColor(taskId: string, userId: string): string {
    const room = this.getRoom(taskId)
    const usedColors = Array.from(room.users.values()).map(u => u.color)
    const available = USER_COLORS.filter(c => !usedColors.includes(c))
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)]
    }
    return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
  }

  private handleJoinRoom(socket: Socket, taskId: string, userName?: string): void {
    const room = this.getRoom(taskId)
    const name = userName || this.generateUserName(taskId)
    const color = this.getUserColor(taskId, socket.id)

    const user: CollabUser = {
      id: socket.id,
      name,
      color,
      taskId,
      cursorTime: 0,
      draggingCue: null,
    }

    room.users.set(socket.id, user)
    socket.join(taskId)

    socket.emit('user-joined', {
      self: user,
      users: Array.from(room.users.values()),
    })

    socket.to(taskId).emit('user-joined', {
      user,
      users: Array.from(room.users.values()),
    })

    console.log(`[Collab] ${name} joined room ${taskId}`)
  }

  private handleLeaveRoom(socket: Socket, taskId: string): void {
    const room = this.rooms.get(taskId)
    if (!room) return

    room.users.delete(socket.id)
    socket.leave(taskId)

    this.io.to(taskId).emit('user-left', {
      userId: socket.id,
      users: Array.from(room.users.values()),
    })

    if (room.users.size === 0) {
      this.rooms.delete(taskId)
      this.userNameCounter.delete(taskId)
    }

    console.log(`[Collab] User ${socket.id} left room ${taskId}`)
  }

  private handleDisconnect(socket: Socket): void {
    for (const [taskId, room] of this.rooms.entries()) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id)

        this.io.to(taskId).emit('user-left', {
          userId: socket.id,
          users: Array.from(room.users.values()),
        })

        if (room.users.size === 0) {
          this.rooms.delete(taskId)
          this.userNameCounter.delete(taskId)
        }
      }
    }
    console.log(`[Collab] Client disconnected: ${socket.id}`)
  }

  private handleCursorMove(socket: Socket, data: CollabCursorEvent): void {
    const room = this.rooms.get(data.taskId)
    if (!room) return

    const user = room.users.get(socket.id)
    if (!user) return

    user.cursorTime = data.cursorTime

    socket.to(data.taskId).emit('cursor-move', {
      userId: socket.id,
      cursorTime: data.cursorTime,
    })
  }

  private handleCueDrag(socket: Socket, data: CollabCueDragEvent): void {
    const room = this.rooms.get(data.taskId)
    if (!room) return

    const user = room.users.get(socket.id)
    if (!user) return

    user.draggingCue = data.isPreview ? data.cueIndex : null

    socket.to(data.taskId).emit('cue-drag', {
      userId: socket.id,
      cueIndex: data.cueIndex,
      newStart: data.newStart,
      newEnd: data.newEnd,
      isPreview: data.isPreview,
    })
  }

  private async handleCueSave(socket: Socket, data: CollabCueSaveEvent): Promise<void> {
    const room = this.rooms.get(data.taskId)
    if (!room) return

    const user = room.users.get(socket.id)
    if (!user) return

    const lastSave = room.cueLastSavedBy.get(data.cueIndex)
    let conflictEvent: CollabConflictEvent | null = null

    if (lastSave && lastSave.userId !== socket.id && data.savedAt < lastSave.savedAt) {
      conflictEvent = {
        taskId: data.taskId,
        cueIndex: data.cueIndex,
        latestUser: lastSave.userId,
        overwrittenUser: socket.id,
        savedAt: data.savedAt,
      }
      socket.emit('conflict', conflictEvent)
      return
    }

    if (lastSave && lastSave.userId !== socket.id) {
      conflictEvent = {
        taskId: data.taskId,
        cueIndex: data.cueIndex,
        latestUser: socket.id,
        overwrittenUser: lastSave.userId,
        savedAt: data.savedAt,
      }
      this.io.to(data.taskId).emit('conflict', conflictEvent)
    }

    room.cueLastSavedBy.set(data.cueIndex, {
      userId: socket.id,
      savedAt: data.savedAt,
    })

    const db = getDb()

    const current = db.exec(
      `SELECT originalStart, originalEnd FROM aligned_cues WHERE taskId = ? AND cueIndex = ?`,
      [data.taskId, data.cueIndex]
    )

    if (current.length > 0 && current[0].values.length > 0) {
      const originalStart = current[0].values[0][0] as number
      const newOffset = data.newStart - originalStart

      db.run(
        `UPDATE aligned_cues SET alignedStart = ?, alignedEnd = ?, offset = ?, corrected = 1 WHERE taskId = ? AND cueIndex = ?`,
        [data.newStart, data.newEnd, newOffset, data.taskId, data.cueIndex]
      )
      save()

      const allCues = db.exec(`SELECT offset, corrected FROM aligned_cues WHERE taskId = ?`, [data.taskId])
      if (allCues.length > 0 && allCues[0].values.length > 0) {
        const totalCues = allCues[0].values.length
        const correctedCount = allCues[0].values.filter(r => r[1] === 1).length
        const totalOffset = allCues[0].values.reduce((sum, r) => sum + Math.abs(r[0] as number), 0)
        const averageOffset = Math.round((totalOffset / totalCues) * 100) / 100
        const maxOffset = Math.max(...allCues[0].values.map(r => Math.abs(r[0] as number)), 1)
        const score = Math.max(0, Math.round((1 - averageOffset / maxOffset) * 100))

        db.run(
          `UPDATE align_tasks SET correctedCues = ?, averageOffset = ?, score = ? WHERE id = ?`,
          [correctedCount, averageOffset, score, data.taskId]
        )
        save()
      }
    }

    this.io.to(data.taskId).emit('cue-saved', {
      userId: socket.id,
      userName: user.name,
      cueIndex: data.cueIndex,
      newStart: data.newStart,
      newEnd: data.newEnd,
      savedAt: data.savedAt,
    })
  }

  public getIO(): IOServer {
    return this.io
  }
}

let collabServer: CollaborationServer | null = null

export function initCollaborationServer(httpServer: HTTPServer): CollaborationServer {
  collabServer = new CollaborationServer(httpServer)
  return collabServer
}

export function getCollaborationServer(): CollaborationServer | null {
  return collabServer
}
