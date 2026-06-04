import { Router, type Request, type Response } from 'express'
import { getDb } from '../db/database.js'
import type { HistoryItem, AlignTaskRecord } from '../types.js'

const router = Router()

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 10
    const offset = (page - 1) * pageSize

    const db = getDb()

    const countRows = db.exec(`SELECT COUNT(*) as total FROM align_tasks`)
    const total = countRows.length > 0 ? (countRows[0].values[0][0] as number) : 0

    const rows = db.exec(
      `SELECT t.id, v.fileName as videoName, s.fileName as subtitleName, t.createdAt, t.correctedCues, t.totalCues, t.score
       FROM align_tasks t
       JOIN videos v ON t.videoId = v.id
       JOIN subtitles s ON t.subtitleId = s.id
       ORDER BY t.createdAt DESC
       LIMIT ? OFFSET ?`,
      [pageSize, offset]
    )

    const items: HistoryItem[] = []
    if (rows.length > 0) {
      const cols = rows[0].columns
      for (const row of rows[0].values) {
        const item: Record<string, any> = {}
        for (let i = 0; i < cols.length; i++) {
          item[cols[i]] = row[i]
        }
        items.push({
          id: item.id as string,
          videoName: item.videoName as string,
          subtitleName: item.subtitleName as string,
          createdAt: item.createdAt as string,
          correctedCues: item.correctedCues as number,
          totalCues: item.totalCues as number,
          score: item.score as number,
        })
      }
    }

    res.json({
      success: true,
      data: {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const db = getDb()

    const taskRows = db.exec(`SELECT * FROM align_tasks WHERE id = ?`, [id])
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

    const videoRows = db.exec(`SELECT fileName FROM videos WHERE id = ?`, [task.videoId])
    const subtitleRows = db.exec(`SELECT fileName, format FROM subtitles WHERE id = ?`, [task.subtitleId])

    const videoName = videoRows.length > 0 ? (videoRows[0].values[0][0] as string) : ''
    const subtitleName = subtitleRows.length > 0 ? (subtitleRows[0].values[0][0] as string) : ''
    const subtitleFormat = subtitleRows.length > 0 ? (subtitleRows[0].values[0][1] as string) : 'srt'

    const cueRows = db.exec(`SELECT * FROM aligned_cues WHERE taskId = ? ORDER BY cueIndex`, [id])
    const cues: any[] = []
    if (cueRows.length > 0) {
      const cueCols = cueRows[0].columns
      for (const row of cueRows[0].values) {
        const cue: Record<string, any> = {}
        for (let i = 0; i < cueCols.length; i++) {
          cue[cueCols[i]] = row[i]
        }
        cues.push(cue)
      }
    }

    res.json({
      success: true,
      data: {
        task: task as AlignTaskRecord,
        videoName,
        subtitleName,
        subtitleFormat,
        cues,
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

router.post('/:id/reload', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const db = getDb()

    const taskRows = db.exec(`SELECT * FROM align_tasks WHERE id = ?`, [id])
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

    const videoRows = db.exec(`SELECT fileName, duration, fileSize FROM videos WHERE id = ?`, [task.videoId])
    const subtitleRows = db.exec(`SELECT fileName, format, totalLines FROM subtitles WHERE id = ?`, [task.subtitleId])

    const videoData = videoRows.length > 0
      ? {
          fileName: videoRows[0].values[0][0],
          duration: videoRows[0].values[0][1],
          fileSize: videoRows[0].values[0][2],
        }
      : null

    const subtitleData = subtitleRows.length > 0
      ? {
          fileName: subtitleRows[0].values[0][0],
          format: subtitleRows[0].values[0][1],
          totalLines: subtitleRows[0].values[0][2],
        }
      : null

    const cueRows = db.exec(`SELECT * FROM aligned_cues WHERE taskId = ? ORDER BY cueIndex`, [id])
    const cues: any[] = []
    if (cueRows.length > 0) {
      const cueCols = cueRows[0].columns
      for (const row of cueRows[0].values) {
        const cue: Record<string, any> = {}
        for (let i = 0; i < cueCols.length; i++) {
          cue[cueCols[i]] = row[i]
        }
        cues.push(cue)
      }
    }

    res.json({
      success: true,
      data: {
        videoId: task.videoId,
        subtitleId: task.subtitleId,
        video: videoData,
        subtitle: subtitleData,
        task: task as AlignTaskRecord,
        cues,
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router
