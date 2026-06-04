import type { VideoInfo, SubtitleInfo, AlignTaskInfo, AlignResult, AlignedCue, HistoryItem } from '@/types'

function unwrap<T>(res: Response): Promise<T> {
  return res.json().then((json) => {
    if (!res.ok) throw new Error(json.error || 'Request failed')
    return json.data as T
  })
}

export function useAlign() {
  async function uploadVideo(file: File): Promise<VideoInfo> {
    const formData = new FormData()
    formData.append('video', file)
    const res = await fetch('/api/upload/video', { method: 'POST', body: formData })
    return unwrap<VideoInfo>(res)
  }

  async function uploadSubtitle(file: File, videoId: string): Promise<SubtitleInfo> {
    const formData = new FormData()
    formData.append('subtitle', file)
    formData.append('videoId', videoId)
    const res = await fetch('/api/upload/subtitle', { method: 'POST', body: formData })
    return unwrap<SubtitleInfo>(res)
  }

  async function startAlign(videoId: string, subtitleId: string, threshold?: number): Promise<AlignTaskInfo> {
    const body: Record<string, unknown> = { videoId, subtitleId, threshold }
    const res = await fetch('/api/align', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return unwrap<AlignTaskInfo>(res)
  }

  async function pollAlignStatus(taskId: string): Promise<AlignResult> {
    while (true) {
      const res = await fetch(`/api/align/${taskId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Request failed')
      const data = json.data
      if (data.task.status === 'completed') {
        return {
          totalCues: data.task.totalCues,
          correctedCues: data.task.correctedCues,
          averageOffset: data.task.averageOffset,
          score: data.task.score,
          cues: data.cues,
        }
      }
      if (data.task.status === 'failed') throw new Error('对齐任务失败')
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  async function manualCalibrate(taskId: string, cueIndex: number, alignedStart: number, alignedEnd: number): Promise<AlignedCue> {
    const res = await fetch(`/api/align/${taskId}/cues/${cueIndex}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alignedStart, alignedEnd }),
    })
    return unwrap<AlignedCue>(res)
  }

  async function exportSubtitle(taskId: string, format: 'srt' | 'ass'): Promise<Blob> {
    const res = await fetch(`/api/export/${taskId}?format=${format}`)
    if (!res.ok) throw new Error('Export failed')
    return res.blob()
  }

  async function fetchHistory(page: number, limit: number): Promise<{ total: number; items: HistoryItem[] }> {
    const res = await fetch(`/api/history?page=${page}&pageSize=${limit}`)
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Request failed')
    return { total: json.data.total, items: json.data.items }
  }

  async function fetchHistoryDetail(id: string): Promise<any> {
    const res = await fetch(`/api/history/${id}`)
    return unwrap<any>(res)
  }

  return {
    uploadVideo,
    uploadSubtitle,
    startAlign,
    pollAlignStatus,
    manualCalibrate,
    exportSubtitle,
    fetchHistory,
    fetchHistoryDetail,
  }
}
