export interface VideoRecord {
  id: string
  fileName: string
  duration: number
  fileSize: number
  filePath: string
  createdAt: string
}

export interface SubtitleRecord {
  id: string
  videoId: string
  fileName: string
  format: 'srt' | 'ass'
  totalLines: number
  filePath: string
  createdAt: string
}

export interface SubtitleCue {
  index: number
  startTime: number
  endTime: number
  text: string
}

export interface AlignTaskRecord {
  id: string
  videoId: string
  subtitleId: string
  status: 'processing' | 'completed' | 'failed'
  threshold: number
  progress: number
  totalCues: number
  correctedCues: number
  averageOffset: number
  score: number
  createdAt: string
  completedAt: string | null
}

export interface AlignedCue {
  index: number
  originalStart: number
  originalEnd: number
  alignedStart: number
  alignedEnd: number
  offset: number
  text: string
  corrected: boolean
}

export interface AlignResult {
  totalCues: number
  correctedCues: number
  averageOffset: number
  score: number
  cues: AlignedCue[]
}

export interface HistoryItem {
  id: string
  videoName: string
  subtitleName: string
  createdAt: string
  correctedCues: number
  totalCues: number
  score: number
}

export interface CollabUser {
  id: string
  name: string
  color: string
  taskId: string
  cursorTime: number
  draggingCue: number | null
}

export interface CollabCursorEvent {
  userId: string
  taskId: string
  cursorTime: number
}

export interface CollabCueDragEvent {
  userId: string
  taskId: string
  cueIndex: number
  newStart: number
  newEnd: number
  isPreview: boolean
}

export interface CollabCueSaveEvent {
  userId: string
  taskId: string
  cueIndex: number
  newStart: number
  newEnd: number
  savedAt: number
}

export interface CollabConflictEvent {
  taskId: string
  cueIndex: number
  latestUser: string
  overwrittenUser: string
  savedAt: number
}
