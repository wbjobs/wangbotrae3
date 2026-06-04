const syncCalculator = require('./syncCalculator');
const { pool } = require('./workerPool');

class OffsetMatrixCalculator {
  constructor() {
    this.maxTracks = 5;
    this.maxWorkers = 3;
  }

  async computeMatrix(referenceTracks, recordedTrack) {
    console.log(`[OffsetMatrix] 开始计算偏移量矩阵`);
    console.log(`[OffsetMatrix] 参考音轨数: ${referenceTracks.length}, 录制音轨: ${recordedTrack.id}`);
    
    if (referenceTracks.length === 0) {
      throw new Error('没有参考音轨');
    }

    if (referenceTracks.length > this.maxTracks) {
      throw new Error(`参考音轨数量超过上限(${this.maxTracks})`);
    }

    const trackIds = referenceTracks.map(t => t.id);
    const trackLabels = referenceTracks.map(t => t.sourceLabel || t.filename);
    const n = referenceTracks.length;

    const tasks = [];
    for (let i = 0; i < n; i++) {
      tasks.push({
        refTrack: referenceTracks[i],
        recTrack: recordedTrack,
        refIndex: i
      });
    }

    console.log(`[OffsetMatrix] 提交 ${tasks.length} 个计算任务到Worker池`);
    console.log(`[OffsetMatrix] Worker池状态: ${JSON.stringify(pool.getStatus())}`);

    const results = await Promise.all(
      tasks.map(task => 
        pool.submit((data) => {
          const { refTrack, recTrack, refIndex } = data;
          const result = syncCalculator.calculateOffset(
            refTrack.fingerprint,
            recTrack.fingerprint
          );
          return {
            refIndex,
            refTrackId: refTrack.id,
            timeOffset: result.offset,
            frameOffset: result.frameOffset,
            confidence: result.confidence,
            similarity: result.similarity
          };
        }, task)
      )
    );

    const matrix = new Array(n).fill(null).map(() => ({
      timeOffset: 0,
      confidence: 0,
      similarity: 0
    }));

    for (const result of results) {
      matrix[result.refIndex] = {
        refTrackId: result.refTrackId,
        timeOffset: result.timeOffset,
        frameOffset: result.frameOffset,
        confidence: result.confidence,
        similarity: result.similarity
      };
    }

    console.log(`[OffsetMatrix] 偏移量矩阵计算完成`);
    for (let i = 0; i < n; i++) {
      console.log(`  [${trackLabels[i]}] 偏移: ${matrix[i].timeOffset.toFixed(4)}s, 置信度: ${(matrix[i].confidence * 100).toFixed(1)}%`);
    }

    return {
      trackIds,
      trackLabels,
      matrix,
      recordedTrackId: recordedTrack.id,
      recordedLabel: recordedTrack.sourceLabel || recordedTrack.filename,
      computedAt: new Date().toISOString()
    };
  }

  formatMatrixForResponse(matrixResult) {
    const { trackIds, trackLabels, matrix, recordedTrackId, recordedLabel, computedAt } = matrixResult;
    
    return {
      tracks: trackIds.map((id, i) => ({
        id,
        label: trackLabels[i],
        timeOffset: matrix[i].timeOffset,
        confidence: matrix[i].confidence,
        similarity: matrix[i].similarity
      })),
      recordedTrack: {
        id: recordedTrackId,
        label: recordedLabel
      },
      computedAt,
      summary: this.computeSummary(matrix)
    };
  }

  computeSummary(matrix) {
    const offsets = matrix.map(m => m.timeOffset);
    const confidences = matrix.map(m => m.confidence);

    const minOffset = Math.min(...offsets);
    const maxOffset = Math.max(...offsets);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    
    const spread = maxOffset - minOffset;

    return {
      minOffset,
      maxOffset,
      spread,
      avgConfidence,
      bestTrackIndex: confidences.indexOf(Math.max(...confidences)),
      worstTrackIndex: confidences.indexOf(Math.min(...confidences))
    };
  }
}

module.exports = new OffsetMatrixCalculator();
