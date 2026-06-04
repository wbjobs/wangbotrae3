const { TARGET_SAMPLE_RATE } = require('./audioFingerprint');

class SyncCalculator {
  constructor() {
    this.windowSize = 512;
    this.stepSize = 64;
    this.expectedSampleRate = TARGET_SAMPLE_RATE;
  }

  calculateOffset(referenceFingerprint, recordedFingerprint) {
    console.log('========== 同步计算开始 ==========');
    
    this.validateFingerprints(referenceFingerprint, recordedFingerprint);
    
    const refFps = referenceFingerprint.fingerprints || [];
    const recFps = recordedFingerprint.fingerprints || [];

    if (refFps.length === 0 || recFps.length === 0) {
      console.warn('[SyncCalculator] 警告: 指纹数据为空');
      return { offset: 0, confidence: 0 };
    }

    const refSampleRate = referenceFingerprint.sampleRate;
    const recSampleRate = recordedFingerprint.sampleRate;
    const refFrameDuration = referenceFingerprint.frameDuration;
    const recFrameDuration = recordedFingerprint.frameDuration;

    console.log(`[SyncCalculator] 参考音轨 - 采样率:${refSampleRate}Hz, 帧数:${refFps.length}, 帧时长:${(refFrameDuration * 1000).toFixed(2)}ms`);
    console.log(`[SyncCalculator] 录制音轨 - 采样率:${recSampleRate}Hz, 帧数:${recFps.length}, 帧时长:${(recFrameDuration * 1000).toFixed(2)}ms`);

    const frameDuration = refFrameDuration || 0.032;
    
    const results = [];
    const maxOffset = Math.min(refFps.length - 1, 2000);

    console.log(`[SyncCalculator] 开始滑动窗口匹配...`);

    for (let offset = -Math.min(recFps.length - 1, 1000); offset <= maxOffset; offset++) {
      const similarity = this.computeSimilarity(refFps, recFps, offset);
      results.push({ offset, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    const bestMatch = results[0];

    console.log(`[SyncCalculator] 最佳匹配 - 偏移:${bestMatch.offset}帧, 相似度:${(bestMatch.similarity * 100).toFixed(2)}%`);

    const confidence = this.computeConfidence(results, bestMatch.similarity);

    const timeOffset = bestMatch.offset * frameDuration;

    console.log(`[SyncCalculator] 计算完成 - 时间偏移:${timeOffset.toFixed(4)}秒, 置信度:${(confidence * 100).toFixed(2)}%`);
    console.log('========== 同步计算结束 ==========');

    return {
      offset: timeOffset,
      frameOffset: bestMatch.offset,
      confidence: confidence,
      similarity: bestMatch.similarity
    };
  }

  validateFingerprints(referenceFingerprint, recordedFingerprint) {
    console.log('[SyncCalculator] 指纹验证...');
    
    const refSampleRate = referenceFingerprint.sampleRate;
    const recSampleRate = recordedFingerprint.sampleRate;

    console.log(`[SyncCalculator] 采样率验证 - 参考:${refSampleRate}Hz, 录制:${recSampleRate}Hz`);

    if (refSampleRate !== recSampleRate) {
      console.warn(`[SyncCalculator] ⚠ 采样率不匹配! 参考:${refSampleRate}Hz, 录制:${recSampleRate}Hz`);
    } else {
      console.log('[SyncCalculator] ✓ 采样率一致');
    }

    const refFps = referenceFingerprint.fingerprints || [];
    const recFps = recordedFingerprint.fingerprints || [];

    console.log(`[SyncCalculator] 指纹长度验证 - 参考:${refFps.length}, 录制:${recFps.length}`);

    const refDuration = referenceFingerprint.duration || 0;
    const recDuration = recordedFingerprint.duration || 0;

    console.log(`[SyncCalculator] 音频时长 - 参考:${refDuration.toFixed(3)}秒, 录制:${recDuration.toFixed(3)}秒`);

    const ratio = Math.min(refFps.length, recFps.length) / Math.max(refFps.length, recFps.length);

    if (ratio < 0.1) {
      console.warn(`[SyncCalculator] ⚠ 指纹长度差异过大 (${(ratio * 100).toFixed(1)}%)`);
    }
  }

  computeSimilarity(refFps, recFps, offset) {
    let matches = 0;
    let total = 0;

    const start = Math.max(0, -offset);
    const end = Math.min(refFps.length, recFps.length - offset);

    for (let i = start; i < end; i++) {
      const recIndex = i + offset;
      if (recIndex < 0 || recIndex >= recFps.length) continue;

      const refHash = refFps[i];
      const recHash = recFps[recIndex];
      
      const hamming = this.hammingDistance(refHash, recHash);
      const similarity = 1 - (hamming / 12);
      
      matches += similarity;
      total++;
    }

    return total > 0 ? matches / total : 0;
  }

  hammingDistance(hash1, hash2) {
    let xor = hash1 ^ hash2;
    let distance = 0;
    
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
    
    return distance;
  }

  computeConfidence(results, bestSimilarity) {
    if (results.length < 2) return bestSimilarity;

    const secondBest = results[1].similarity;
    const margin = bestSimilarity - secondBest;
    
    const baseline = this.computeBaseline(results);
    
    const normalized = (bestSimilarity - baseline) / (1 - baseline);
    const marginFactor = Math.min(1, margin / 0.1 + 0.5);
    
    return Math.max(0, Math.min(1, normalized * marginFactor));
  }

  computeBaseline(results) {
    const count = Math.min(results.length, 100);
    let sum = 0;
    
    for (let i = results.length - 1; i >= results.length - count && i >= 0; i--) {
      sum += results[i].similarity;
    }
    
    return sum / count;
  }

  slidingWindowSearch(refFps, recFps) {
    const matches = new Map();
    
    for (let i = 0; i < refFps.length; i++) {
      for (let j = 0; j < recFps.length; j++) {
        if (refFps[i] === recFps[j]) {
          const offset = i - j;
          matches.set(offset, (matches.get(offset) || 0) + 1);
        }
      }
    }
    
    let bestOffset = 0;
    let maxCount = 0;
    
    for (const [offset, count] of matches) {
      if (count > maxCount) {
        maxCount = count;
        bestOffset = offset;
      }
    }
    
    return { offset: bestOffset, count: maxCount };
  }
}

module.exports = new SyncCalculator();
