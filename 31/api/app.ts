/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import uploadRoutes from './routes/upload.js'
import alignRoutes from './routes/align.js'
import historyRoutes from './routes/history.js'
import exportRoutes from './routes/export.js'
import { init as dbInit } from './db/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '500mb' }))
app.use(express.urlencoded({ extended: true, limit: '500mb' }))

app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')))

dbInit().catch((err) => {
  console.error('Failed to initialize database:', err)
})

app.use('/api/auth', authRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/align', alignRoutes)
app.use('/api/history', historyRoutes)
app.use('/api/export', exportRoutes)

app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
