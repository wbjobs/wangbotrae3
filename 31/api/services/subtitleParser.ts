import type { SubtitleCue } from '../types.js'

function parseSrtTime(timeStr: string): number {
  const cleaned = timeStr.trim().replace(',', '.')
  const parts = cleaned.split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseFloat(parts[2])
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
}

export function parseSrt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\n+/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    const timeMatch = lines[1].match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/
    )
    if (!timeMatch) continue

    const startTime = parseSrtTime(timeMatch[1])
    const endTime = parseSrtTime(timeMatch[2])
    const text = lines.slice(2).join('\n').trim()
    const index = parseInt(lines[0].trim(), 10) || cues.length + 1

    cues.push({ index, startTime, endTime, text })
  }

  return cues
}

function parseAssTime(timeStr: string): number {
  const parts = timeStr.trim().split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseFloat(parts[2])
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
}

export function parseAss(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')

  let formatFields: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.toLowerCase().startsWith('format:')) {
      formatFields = trimmed
        .substring(7)
        .split(',')
        .map(f => f.trim().toLowerCase())
      continue
    }

    if (trimmed.toLowerCase().startsWith('dialogue:')) {
      const parts = trimmed.substring(9).split(',')
      const textStartIndex = formatFields.indexOf('text')
      const startIdx = formatFields.indexOf('start')
      const endIdx = formatFields.indexOf('end')

      if (startIdx === -1 || endIdx === -1) continue

      const startTime = parseAssTime(parts[startIdx])
      const endTime = parseAssTime(parts[endIdx])
      const text = textStartIndex !== -1 && textStartIndex < parts.length
        ? parts.slice(textStartIndex).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim()
        : ''

      cues.push({
        index: cues.length + 1,
        startTime,
        endTime,
        text,
      })
    }
  }

  return cues
}

export function parseSubtitle(content: string, format: 'srt' | 'ass'): SubtitleCue[] {
  if (format === 'ass') return parseAss(content)
  return parseSrt(content)
}

export function detectFormat(fileName: string): 'srt' | 'ass' {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'ass') return 'ass'
  return 'srt'
}
