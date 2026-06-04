import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import { getDb, save } from '../db/database.js'
import { runVad } from '../services/vadService.js'
import { parseSubtitle } from '../services/subtitleParser.js'
import { alignCues } from '../services/alignService.js'
import type { AlignTaskRecord, AlignedCue } from '../types.js'

const router = Router()

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoId, subtitleId, threshold } = req.body

    if (!videoId || !subtitleId) {
      res.status(400).json({ success: false, error: 'videoId and subtitleId are required' })
      return
    }

    const db = getDb()

    const videoRows = db.exec(`SELECT * FROM videos WHERE id = ?`, [videoId])
    if (videoRows.length === 0 || videoRows[0].values.length === 0) {
      res.status(404).json({ success: false, error: 'Video not found' })
      return
    }

    const subtitleRows = db.exec(`SELECT * FROM subtitles WHERE id = ?`, [subtitleId])
    if (subtitleRows.length === 0 || subtitleRows[0].values.length === 0) {
      res.status(404).json({ success: false, error: 'Subtitle not found' })
      return
    }

    const taskId = uuidv4()
    const effectiveThreshold = threshold || 200

    db.run(
      `INSERT INTO align_tasks (id, videoId, subtitleId, threshold) VALUES (?, ?, ?, ?)`,
      [taskId, videoId, subtitleId, effectiveThreshold]
    )
    save()

    res.json({
      success: true,
      data: { taskId },
    })

    processAlignment(taskId, videoId, subtitleId, effectiveThreshold).catch((err) => {
      console.error(`Alignment task ${taskId} failed:`, err)
      try {
        const d = getDb()
        d.run(`UPDATE align_tasks SET status = 'failed' WHERE id = ?`, [taskId])
        save()
      } catch {}
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

async function processAlignment(
  taskId: string,
  videoId: string,
  subtitleId: string,
  threshold: number
): Promise<void> {
  const db = getDb()

  const videoRows = db.exec(`SELECT filePath FROM videos WHERE id = ?`, [videoId])
  const videoPath = videoRows[0].values[0][0] as string

  const subtitleRows = db.exec(`SELECT filePath, format FROM subtitles WHERE id = ?`, [subtitleId])
  const subRow = subtitleRows[0].values[0]
  const subFilePath = subRow[0] as string
  const subFormat = subRow[1] as 'srt' | 'ass'

  const vadResult = await runVad(videoPath)
  const segments = vadResult.segments

  const content = fs.readFileSync(subFilePath, 'utf-8')
  const cues = parseSubtitle(content, subFormat)

  const result = alignCues(cues, segments, threshold)

  for (const cue of result.cues) {
    db.run(
      `INSERT INTO aligned_cues (taskId, cueIndex, originalStart, originalEnd, alignedStart, alignedEnd, offset, text, corrected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        cue.index,
        cue.originalStart,
        cue.originalEnd,
        cue.alignedStart,
        cue.alignedEnd,
        cue.offset,
        cue.text,
        cue.corrected ? 1 : 0,
      ]
    )
  }

  db.run(
    `UPDATE align_tasks SET status = 'completed', progress = 100, totalCues = ?, correctedCues = ?, averageOffset = ?, score = ?, completedAt = datetime('now') WHERE id = ?`,
    [result.totalCues, result.correctedCues, result.averageOffset, result.score, taskId]
  )
  save()
}

router.get('/:taskId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params
    const db = getDb()

    const taskRows = db.exec(`SELECT * FROM align_tasks WHERE id = ?`, [taskId])
    if (taskRows.length === 0 || taskRows[0].values.length === 0) {
      res.status(404).json({ success: false, error: 'Task not found' })
      return
    }

    const cols = taskRows[0].columns
    const vals = taskRows[0].values[0]
    const task: Record<string, any> = {}
    for (let i = 0; i < cols.length; i++) {
      task[cols[i]] = vals[i]
    }

    const cueRows = db.exec(`SELECT * FROM aligned_cues WHERE taskId = ? ORDER BY cueIndex`, [taskId])
    const cues: AlignedCue[] = []
    if (cueRows.length > 0) {
      const cueCols = cueRows[0].columns
      for (const row of cueRows[0].values) {
        const cue: Record<string, any> = {}
        for (let i = 0; i < cueCols.length; i++) {
          cue[cueCols[i]] = row[i]
        }
        cues.push({
          index: cue.cueIndex as number,
          originalStart: cue.originalStart as number,
          originalEnd: cue.originalEnd as number,
          alignedStart: cue.alignedStart as number,
          alignedEnd: cue.alignedEnd as number,
          offset: cue.offset as number,
          text: cue.text as string,
          corrected: (cue.corrected as number) === 1,
        })
      }
    }

    res.json({
      success: true,
      data: {
        task: task as AlignTaskRecord,
        cues,
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

router.put('/:taskId/cues/:cueIndex', async (req: Request, res: Response): Promise<void> => {
  try {
    const { taskId, cueIndex } = req.params
    const { alignedStart, alignedEnd } = req.body

    if (alignedStart === undefined || alignedEnd === undefined) {
      res.status(400).json({ success: false, error: 'alignedStart and alignedEnd are required' })
      return
    }

    if (typeof alignedStart !== 'number' || typeof alignedEnd !== 'number') {
      res.status(400).json({ success: false, error: 'alignedStart and alignedEnd must be numbers' })
      return
    }

    if (!Number.isInteger(alignedStart)) {
      res.status(400).json({ success: false, error: 'alignedStart must be an integer (milliseconds)' })
      return
    }

    if (!Number.isInteger(alignedEnd)) {
      res.status(400).json({ success: false, error: 'alignedEnd must be an integer (milliseconds)' })
      return
    }

    if (alignedStart < 0 || alignedEnd <= alignedStart) {
      res.status(400).json({ success: false, error: 'Invalid time range: start must be >= 0 and end must be > start' })
      return
    }

    const db = getDb()
    const cueIdx = parseInt(cueIndex, 10)

    if (isNaN(cueIdx) || cueIdx < 0) {
      res.status(400).json({ success: false, error: 'Invalid cueIndex' })
      return
    }

    const current = db.exec(
      `SELECT originalStart, originalEnd FROM aligned_cues WHERE taskId = ? AND cueIndex = ?`,
      [taskId, cueIdx]
    )

    if (current.length === 0 || current[0].values.length === 0) {
      res.status(404).json({ success: false, error: 'Cue not found' })
      return
    }

    const originalStart = current[0].values[0][0] as number
    const originalEnd = current[0].values[0][1] as number

    const newOffset = alignedStart - originalStart

    db.run(
      `UPDATE aligned_cues SET alignedStart = ?, alignedEnd = ?, offset = ?, corrected = 1 WHERE taskId = ? AND cueIndex = ?`,
      [alignedStart, alignedEnd, newOffset, taskId, cueIdx]
    )
    save()

    const allCues = db.exec(`SELECT offset, corrected, originalStart, originalEnd, alignedStart, alignedEnd, text, cueIndex FROM aligned_cues WHERE taskId = ?`, [taskId])
    let updatedCue: AlignedCue | null = null
    if (allCues.length > 0 && allCues[0].values.length > 0) {
      const totalCues = allCues[0].values.length
      const correctedCount = allCues[0].values.filter(r => r[1] === 1).length
      const totalOffset = allCues[0].values.reduce((sum, r) => sum + Math.abs(r[0] as number), 0)
      const averageOffset = Math.round((totalOffset / totalCues) * 100) / 100
      const maxOffset = Math.max(...allCues[0].values.map(r => Math.abs(r[0] as number)), 1)
      const score = Math.max(0, Math.round((1 - averageOffset / maxOffset) * 100))

      db.run(
        `UPDATE align_tasks SET correctedCues = ?, averageOffset = ?, score = ? WHERE id = ?`,
        [correctedCount, averageOffset, score, taskId]
      )
      save()

      for (const row of allCues[0].values) {
        if (row[7] === cueIdx) {
          updatedCue = {
            index: row[7] as number,
            originalStart: row[2] as number,
            originalEnd: row[3] as number,
            alignedStart: row[4] as number,
            alignedEnd: row[5] as number,
            offset: row[0] as number,
            text: row[6] as string,
            corrected: row[1] === 1
          }
          break
        }
      }
    }

    if (!updatedCue) {
      res.status(500).json({ success: false, error: '无法解析修改后的时间轴' })
      return
    }

    res.json({ success: true, data: updatedCue })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router
