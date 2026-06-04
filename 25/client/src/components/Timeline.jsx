import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function Timeline({
  earliest,
  latest,
  currentTime,
  onSeek,
  onPlay,
  onPause,
  onStop,
  isPlaying,
  isViewingHistory,
}) {
  const [localTime, setLocalTime] = useState(currentTime);
  const intervalRef = useRef(null);

  const duration = latest - earliest;

  useEffect(() => {
    setLocalTime(currentTime);
  }, [currentTime]);

  useEffect(() => {
    if (isPlaying) {
      const startTime = localTime;
      const animDuration = 5000;
      const startTs = Date.now();

      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTs;
        const progress = Math.min(elapsed / animDuration, 1);
        const newTime = startTime + (latest - startTime) * progress;

        setLocalTime(newTime);
        onSeek(newTime);

        if (progress >= 1) {
          clearInterval(intervalRef.current);
          onPause();
        }
      }, 50);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying]);

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    const newTime = earliest + (value / 100) * duration;
    setLocalTime(newTime);
  };

  const handleSliderMouseUp = () => {
    onSeek(localTime);
  };

  const progress = duration > 0 ? ((localTime - earliest) / duration) * 100 : 0;

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          className={`timeline-btn ${isViewingHistory ? 'active' : ''}`}
          onClick={isViewingHistory ? onStop : () => onSeek(earliest)}
          title={isViewingHistory ? '返回当前状态' : '查看历史'}
        >
          {isViewingHistory ? '⏹️ 退出历史' : '📅 历史'}
        </button>

        {isViewingHistory && (
          <>
            <button
              className="timeline-btn play-btn"
              onClick={isPlaying ? onPause : onPlay}
              title={isPlaying ? '暂停' : '播放动画'}
              disabled={localTime >= latest}
            >
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            <span className="timeline-label">{formatTime(localTime)}</span>
          </>
        )}
      </div>

      {isViewingHistory && (
        <div className="timeline-slider-container">
          <span className="timeline-marker">{formatTime(earliest)}</span>
          <div className="timeline-slider-wrapper">
            <input
              type="range"
              min="0"
              max="100"
              value={progress}
              onChange={handleSliderChange}
              onMouseUp={handleSliderMouseUp}
              onTouchEnd={handleSliderMouseUp}
              className="timeline-slider"
            />
            <div
              className="timeline-progress"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="timeline-marker">{formatTime(latest)}</span>
        </div>
      )}
    </div>
  );
}
