import { Router, type Request, type Response } from 'express'
import { getDb } from '../db/database.js'

const router = Router()

function msToSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function msToAssTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = (ms % 60000) / 1000
  return `${String(hours).padStart(1, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
}

function generateSrt(cues: any[]): string {
  return cues
    .map((cue) => {
      const start = msToSrtTime(cue.alignedStart as number)
      const end = msToSrtTime(cue.alignedEnd as number)
      const text = (cue.text as string).replace(/\n/g, '\n')
      return `${cue.cueIndex}\n${start} --> ${end}\n${text}`
    })
    .join('\n\n')
}

function generateAss(cues: any[]): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 384
PlayResY: 288

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,16,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const dialogues = cues
    .map((cue) => {
      const start = msToAssTime(cue.alignedStart as number)
      const end = msToAssTime(cue.alignedEnd as number)
      const text = (cue.text as string).replace(/\n/g, '\\N')
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`
    })
    .join('\n')

  return header + dialogues
}

router.get('/:taskId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params
    const format = (req.query.format as string) || 'srt'

    const db = getDb()

    const taskRows = db.exec(`SELECT subtitleId FROM align_tasks WHERE id = ?`, [taskId])
    if (taskRows.length === 0 || taskRows[0].values.length === 0) {
      res.status(404).json({ success: false, error: 'Task not found' })
      return
    }

    const subtitleId = taskRows[0].values[0][0] as string
    const subtitleRows = db.exec(`SELECT fileName FROM subtitles WHERE id = ?`, [subtitleId])
    const originalName = subtitleRows.length > 0 ? (subtitleRows[0].values[0][0] as string) : 'subtitle'

    const cueRows = db.exec(`SELECT * FROM aligned_cues WHERE taskId = ? ORDER BY cueIndex`, [taskId])
    if (cueRows.length === 0 || cueRows[0].values.length === 0) {
      res.status(404).json({ success: false, error: 'No aligned cues found' })
      return
    }

    const cueCols = cueRows[0].columns
    const cues: any[] = []
    for (const row of cueRows[0].values) {
      const cue: Record<string, any> = {}
      for (let i = 0; i < cueCols.length; i++) {
        cue[cueCols[i]] = row[i]
      }
      cues.push(cue)
    }

    let content: string
    let mimeType: string
    let ext: string

    if (format === 'ass') {
      content = generateAss(cues)
      mimeType = 'text/plain'
      ext = '.ass'
    } else {
      content = generateSrt(cues)
      mimeType = 'text/plain'
      ext = '.srt'
    }

    const baseName = originalName.replace(/\.[^.]+$/, '')
    const fileName = `${baseName}_aligned${ext}`

    res.setHeader('Content-Type', `${mimeType}; charset=utf-8`)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
    res.send(content)
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router
