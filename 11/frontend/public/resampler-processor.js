class ResamplerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return []
  }

  constructor(options) {
    super(options)
    
    this.targetSampleRate = options.processorOptions.targetSampleRate || 16000
    this.inputSampleRate = sampleRate
    this.ratio = this.inputSampleRate / this.targetSampleRate
    
    this.buffer = []
    this.lastInputSample = 0
    this.position = 0
    
    console.log(`[Resampler] 初始化: 输入采样率=${this.inputSampleRate}Hz, 目标采样率=${this.targetSampleRate}Hz, 重采样比=${this.ratio.toFixed(4)}`)
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    
    if (input.length === 0 || input[0].length === 0) {
      return true
    }
    
    const inputChannel = input[0]
    
    for (let i = 0; i < inputChannel.length; i++) {
      const targetPosition = this.position / this.ratio
      const targetIndex = Math.floor(targetPosition)
      const fraction = targetPosition - targetIndex
      
      if (targetIndex < this.buffer.length) {
        const nextSample = targetIndex + 1 < this.buffer.length 
          ? this.buffer[targetIndex + 1] 
          : inputChannel[i]
        
        const interpolated = this.buffer[targetIndex] * (1 - fraction) + nextSample * fraction
        
        this.port.postMessage({
          type: 'sample',
          value: interpolated
        })
      }
      
      this.buffer.push(inputChannel[i])
      this.position++
      
      if (this.position > this.ratio * 1000) {
        const keepSamples = Math.ceil(this.ratio * 2)
        this.buffer = this.buffer.slice(-keepSamples)
        this.position = keepSamples
      }
    }
    
    return true
  }
}

registerProcessor('resampler-processor', ResamplerProcessor)
