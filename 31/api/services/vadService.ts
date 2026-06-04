import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface SpeechSegment {
  start: number
  end: number
}

interface VadResult {
  segments: SpeechSegment[]
}

export function runVad(videoPath: string): Promise<VadResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, '../../scripts/vad_detect.py')
    const proc = spawn('python', [scriptPath, videoPath])

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
        reject(new Error(`VAD detection failed (exit code ${code}): ${stderr}`))
        return
      }

      try {
        const result = JSON.parse(stdout) as VadResult
        resolve(result)
      } catch {
        reject(new Error(`Failed to parse VAD output: ${stdout}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn VAD process: ${err.message}`))
    })
  })
}
