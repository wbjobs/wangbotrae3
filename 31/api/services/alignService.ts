import type { SubtitleCue, AlignedCue, AlignResult } from '../types.js'

interface SpeechSegment {
  start: number
  end: number
}

function findNearestSegment(cueStartMs: number, segments: SpeechSegment[]): SpeechSegment | null {
  let nearest: SpeechSegment | null = null
  let minDist = Infinity

  for (const seg of segments) {
    const segStartMs = seg.start * 1000
    const segEndMs = seg.end * 1000
    const segCenterMs = (segStartMs + segEndMs) / 2

    const dist = Math.abs(cueStartMs - segCenterMs)
    if (dist < minDist) {
      minDist = dist
      nearest = seg
    }
  }

  return nearest
}

export function alignCues(
  cues: SubtitleCue[],
  segments: SpeechSegment[],
  threshold: number = 200
): AlignResult {
  const alignedCues: AlignedCue[] = []

  for (const cue of cues) {
    const nearest = findNearestSegment(cue.startTime, segments)

    let alignedStart = cue.startTime
    let alignedEnd = cue.endTime
    let offset = 0
    let corrected = false

    if (nearest) {
      const segStartMs = Math.round(nearest.start * 1000)
      const segEndMs = Math.round(nearest.end * 1000)
      offset = segStartMs - cue.startTime

      if (Math.abs(offset) > threshold) {
        const duration = cue.endTime - cue.startTime
        alignedStart = segStartMs
        alignedEnd = segStartMs + duration
        corrected = true
      }
    }

    alignedCues.push({
      index: cue.index,
      originalStart: cue.startTime,
      originalEnd: cue.endTime,
      alignedStart,
      alignedEnd,
      offset,
      text: cue.text,
      corrected,
    })
  }

  const correctedCues = alignedCues.filter(c => c.corrected)
  const totalCues = alignedCues.length
  const correctedCount = correctedCues.length

  const totalOffset = alignedCues.reduce((sum, c) => sum + Math.abs(c.offset), 0)
  const averageOffset = totalCues > 0 ? totalOffset / totalCues : 0

  const maxOffset = Math.max(...alignedCues.map(c => Math.abs(c.offset)), 1)
  const score = totalCues > 0
    ? Math.max(0, Math.round((1 - averageOffset / maxOffset) * 100))
    : 0

  return {
    totalCues,
    correctedCues: correctedCount,
    averageOffset: Math.round(averageOffset * 100) / 100,
    score,
    cues: alignedCues,
  }
}
