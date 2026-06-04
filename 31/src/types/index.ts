export interface SubtitleCue {
  index: number
  startTime: number
  endTime: number
  text: string
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

export interface VideoInfo {
  videoId: string
  fileName: string
  duration: number
  fileSize: number
}

export interface SubtitleInfo {
  subtitleId: string
  format: 'srt' | 'ass'
  totalLines: number
  cues: SubtitleCue[]
}

export interface AlignTaskInfo {
  taskId: string
  status: 'processing' | 'completed' | 'failed'
  progress: number
  result?: AlignResult
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

export interface RemoteCursor {
  userId: string
  cursorTime: number
}

export interface RemoteDrag {
  userId: string
  cueIndex: number
  newStart: number
  newEnd: number
  isPreview: boolean
}

export interface RemoteSave {
  userId: string
  userName: string
  cueIndex: number
  newStart: number
  newEnd: number
  savedAt: number
}

export interface CollabConflict {
  taskId: string
  cueIndex: number
  latestUser: string
  overwrittenUser: string
  savedAt: number
}
