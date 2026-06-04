export const TARGET_SAMPLE_RATE = 16000
export const TARGET_CHANNELS = 1
export const TARGET_BITS_PER_SAMPLE = 16

export class AudioRecorder {
  constructor(options = {}) {
    this.targetSampleRate = options.targetSampleRate || TARGET_SAMPLE_RATE
    this.targetChannels = options.targetChannels || TARGET_CHANNELS
    this.targetBitsPerSample = options.targetBitsPerSample || TARGET_BITS_PER_SAMPLE
    
    this.mediaStream = null
    this.audioContext = null
    this.sourceNode = null
    this.workletNode = null
    this.scriptProcessor = null
    
    this.isRecording = false
    this.recordedSamples = []
    this.sampleCount = 0
    
    this.actualSampleRate = 0
    this.resampleRatio = 1
    
    this.onSampleCallback = null
    this.onEndCallback = null
    
    console.log(`[AudioRecorder] 初始化 - 目标配置: ${this.targetSampleRate}Hz, ${this.targetChannels}声道, ${this.targetBitsPerSample}位`)
  }

  async init() {
    try {
      console.log('[AudioRecorder] 开始初始化...')
      
      const constraints = {
        audio: {
          sampleRate: 44100,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      }
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
      
      const audioContextOptions = {
        sampleRate: 44100,
        latencyHint: 'interactive'
      }
      
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)(audioContextOptions)
      
      this.actualSampleRate = this.audioContext.sampleRate
      this.resampleRatio = this.actualSampleRate / this.targetSampleRate
      
      console.log(`[AudioRecorder] 实际输入采样率: ${this.actualSampleRate}Hz`)
      console.log(`[AudioRecorder] 重采样比率: ${this.resampleRatio.toFixed(4)}`)
      
      if (this.actualSampleRate !== this.targetSampleRate) {
        console.log(`[AudioRecorder] 采样率不匹配，将进行重采样: ${this.actualSampleRate}Hz -> ${this.targetSampleRate}Hz`)
      } else {
        console.log(`[AudioRecorder] 采样率匹配，无需重采样`)
      }
      
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
      
      try {
        await this.initAudioWorklet()
        console.log('[AudioRecorder] AudioWorklet初始化成功')
      } catch (workletError) {
        console.warn('[AudioRecorder] AudioWorklet初始化失败，回退到ScriptProcessor:', workletError)
        this.initScriptProcessor()
      }
      
      return true
    } catch (error) {
      console.error('[AudioRecorder] 初始化失败:', error)
      throw error
    }
  }

  async initAudioWorklet() {
    console.log('[AudioRecorder] 初始化AudioWorklet...')
    
    await this.audioContext.audioWorklet.addModule('/resampler-processor.js')
    
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      'resampler-processor',
      {
        processorOptions: {
          targetSampleRate: this.targetSampleRate
        },
        numberOfInputs: 1,
        numberOfOutputs: 0
      }
    )
    
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'sample') {
        this.handleResampledSample(event.data.value)
      }
    }
    
    this.workletNode.port.onmessageerror = (error) => {
      console.error('[AudioRecorder] Worklet消息错误:', error)
    }
    
    this.sourceNode.connect(this.workletNode)
  }

  initScriptProcessor() {
    console.log('[AudioRecorder] 初始化ScriptProcessor (降级方案)...')
    
    const bufferSize = 4096
    this.scriptProcessor = this.audioContext.createScriptProcessor(
      bufferSize,
      1,
      1
    )
    
    let inputBuffer = []
    let inputIndex = 0
    
    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.isRecording) return
      
      const inputData = event.inputBuffer.getChannelData(0)
      
      for (let i = 0; i < inputData.length; i++) {
        inputBuffer.push(inputData[i])
        
        while (inputIndex < inputBuffer.length - 1) {
          const targetIndex = inputIndex / this.resampleRatio
          const intIndex = Math.floor(targetIndex)
          const fraction = targetIndex - intIndex
          
          if (intIndex + 1 < inputBuffer.length) {
            const sample = inputBuffer[intIndex] * (1 - fraction) + 
                          inputBuffer[intIndex + 1] * fraction
            
            this.handleResampledSample(sample)
            inputIndex++
          } else {
            break
          }
        }
      }
      
      if (inputBuffer.length > this.resampleRatio * 100) {
        const keep = Math.ceil(this.resampleRatio * 2)
        inputBuffer = inputBuffer.slice(-keep)
        inputIndex = Math.max(0, inputIndex - (inputBuffer.length - keep))
      }
    }
    
    this.sourceNode.connect(this.scriptProcessor)
    this.scriptProcessor.connect(this.audioContext.destination)
  }

  handleResampledSample(sample) {
    if (!this.isRecording) return
    
    this.recordedSamples.push(sample)
    this.sampleCount++
    
    if (this.onSampleCallback) {
      this.onSampleCallback(sample)
    }
  }

  start() {
    if (!this.audioContext) {
      throw new Error('录音器未初始化')
    }
    
    if (this.isRecording) {
      console.warn('[AudioRecorder] 已经在录制中')
      return
    }
    
    console.log('[AudioRecorder] 开始录制...')
    
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }
    
    this.recordedSamples = []
    this.sampleCount = 0
    this.isRecording = true
    
    console.log(`[AudioRecorder] 录制已启动，等待音频数据...`)
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.isRecording) {
        console.warn('[AudioRecorder] 当前没有在录制')
        resolve(null)
        return
      }
      
      console.log(`[AudioRecorder] 停止录制...`)
      console.log(`[AudioRecorder] 录制样本数: ${this.sampleCount}`)
      console.log(`[AudioRecorder] 录制时长: ${(this.sampleCount / this.targetSampleRate).toFixed(3)}秒`)
      
      this.isRecording = false
      
      setTimeout(() => {
        const wavBlob = this.encodeToWav()
        console.log(`[AudioRecorder] WAV文件大小: ${wavBlob.size} 字节`)
        console.log(`[AudioRecorder] 预期大小验证: ${this.expectedWavSize()} 字节`)
        
        if (this.onEndCallback) {
          this.onEndCallback(wavBlob)
        }
        
        resolve(wavBlob)
      }, 100)
    })
  }

  encodeToWav() {
    const sampleRate = this.targetSampleRate
    const channels = this.targetChannels
    const bitsPerSample = this.targetBitsPerSample
    const bytesPerSample = bitsPerSample / 8
    const dataSize = this.sampleCount * channels * bytesPerSample
    const bufferSize = 44 + dataSize
    
    const buffer = new ArrayBuffer(bufferSize)
    const view = new DataView(buffer)
    
    this.writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    this.writeString(view, 8, 'WAVE')
    this.writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * channels * bytesPerSample, true)
    view.setUint16(32, channels * bytesPerSample, true)
    view.setUint16(34, bitsPerSample, true)
    this.writeString(view, 36, 'data')
    view.setUint32(40, dataSize, true)
    
    let offset = 44
    
    if (bitsPerSample === 16) {
      for (let i = 0; i < this.sampleCount; i++) {
        const sample = Math.max(-1, Math.min(1, this.recordedSamples[i]))
        const intSample = Math.floor(sample * 32767)
        view.setInt16(offset, intSample, true)
        offset += 2
      }
    } else if (bitsPerSample === 32) {
      for (let i = 0; i < this.sampleCount; i++) {
        const sample = Math.max(-1, Math.min(1, this.recordedSamples[i]))
        view.setFloat32(offset, sample, true)
        offset += 4
      }
    }
    
    console.log(`[AudioRecorder] WAV编码完成 - 采样率:${sampleRate}Hz, 声道:${channels}, 位深:${bitsPerSample}bit`)
    
    return new Blob([buffer], { type: 'audio/wav' })
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  expectedWavSize() {
    const bytesPerSample = this.targetBitsPerSample / 8
    const dataSize = this.sampleCount * this.targetChannels * bytesPerSample
    return 44 + dataSize
  }

  getRecordingDuration() {
    return this.sampleCount / this.targetSampleRate
  }

  getSampleCount() {
    return this.sampleCount
  }

  getSampleRateInfo() {
    return {
      actual: this.actualSampleRate,
      target: this.targetSampleRate,
      ratio: this.resampleRatio,
      recorded: this.sampleCount,
      duration: this.getRecordingDuration()
    }
  }

  logSampleRateInfo() {
    const info = this.getSampleRateInfo()
    console.log('========== 采样率信息 ==========')
    console.log(`输入采样率: ${info.actual} Hz`)
    console.log(`目标采样率: ${info.target} Hz`)
    console.log(`重采样比率: ${info.ratio.toFixed(4)}`)
    console.log(`录制样本数: ${info.recorded}`)
    console.log(`录制时长: ${info.duration.toFixed(3)} 秒`)
    console.log('================================')
    return info
  }

  cleanup() {
    console.log('[AudioRecorder] 清理资源...')
    
    this.isRecording = false
    
    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }
    
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
      this.scriptProcessor = null
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
    }
    
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    
    this.recordedSamples = []
    this.sampleCount = 0
    
    console.log('[AudioRecorder] 资源清理完成')
  }

  createAudioFile(blob, filename = 'recording.wav') {
    return new File([blob], filename, {
      type: 'audio/wav'
    })
  }
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export function validateSampleRate(audioInfo, expectedSampleRate = 16000) {
  const actualSampleRate = audioInfo.sampleRate || audioInfo
  
  console.log(`[采样率校验] 期望:${expectedSampleRate}Hz, 实际:${actualSampleRate}Hz`)
  
  if (actualSampleRate === expectedSampleRate) {
    console.log('[采样率校验] ✓ 通过')
    return { valid: true, message: '采样率匹配' }
  } else {
    console.warn(`[采样率校验] ✗ 不匹配! 差值:${Math.abs(actualSampleRate - expectedSampleRate)}Hz`)
    return { 
      valid: false, 
      message: `采样率不匹配` 
    }
  }
}
