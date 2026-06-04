import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { getDb, save } from '../db/database.js'
import { parseSubtitle, detectFormat } from '../services/subtitleParser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads')

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${uuidv4()}${ext}`)
  },
})

const upload = multer({ storage })

const router = Router()

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ])

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (exit code ${code}): ${stderr}`))
        return
      }

      try {
        const info = JSON.parse(stdout)
        const duration = parseFloat(info.format.duration)
        if (isNaN(duration)) {
          reject(new Error('Could not determine video duration'))
          return
        }
        resolve(duration)
      } catch {
        reject(new Error('Failed to parse ffprobe output'))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`))
    })
  })
}

router.post(
  '/video',
  upload.single('video'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file
      if (!file) {
        res.status(400).json({ success: false, error: 'No video file uploaded' })
        return
      }

      const duration = await getVideoDuration(file.path)
      const id = uuidv4()
      const db = getDb()

      db.run(
        `INSERT INTO videos (id, fileName, duration, fileSize, filePath) VALUES (?, ?, ?, ?, ?)`,
        [id, file.originalname, duration, file.size, file.path]
      )
      save()

      res.json({
        success: true,
        data: {
          videoId: id,
          fileName: file.originalname,
          duration,
          fileSize: file.size,
        },
      })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  }
)

router.post(
  '/subtitle',
  upload.single('subtitle'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file
      const videoId = req.body.videoId

      if (!file) {
        res.status(400).json({ success: false, error: 'No subtitle file uploaded' })
        return
      }

      if (!videoId) {
        res.status(400).json({ success: false, error: 'videoId is required' })
        return
      }

      const format = detectFormat(file.originalname)
      const content = fs.readFileSync(file.path, 'utf-8')
      const cues = parseSubtitle(content, format)

      const id = uuidv4()
      const db = getDb()

      db.run(
        `INSERT INTO subtitles (id, videoId, fileName, format, totalLines, filePath) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, videoId, file.originalname, format, cues.length, file.path]
      )
      save()

      res.json({
        success: true,
        data: {
          subtitleId: id,
          fileName: file.originalname,
          format,
          totalLines: cues.length,
          cues,
        },
      })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  }
)

router.get(
  '/video/:id',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params
      const db = getDb()

      const rows = db.exec(`SELECT filePath, fileName FROM videos WHERE id = ?`, [id])
      if (rows.length === 0 || rows[0].values.length === 0) {
        res.status(404).json({ success: false, error: 'Video not found' })
        return
      }

      const filePath = rows[0].values[0][0] as string
      const fileName = rows[0].values[0][1] as string

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ success: false, error: 'Video file not found on disk' })
        return
      }

      const stat = fs.statSync(filePath)
      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Content-Length', stat.size)
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`)

      const range = req.headers.range
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
        const chunkSize = end - start + 1

        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        res.setHeader('Content-Length', chunkSize)
        res.setHeader('Accept-Ranges', 'bytes')
        res.status(206)

        const stream = fs.createReadStream(filePath, { start, end })
        stream.pipe(res)
      } else {
        const stream = fs.createReadStream(filePath)
        stream.pipe(res)
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  }
)

export default router
