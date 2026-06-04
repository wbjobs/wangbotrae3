import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IpcMessage, ReplayState, MessageFilter } from '../types';
import { startReplay as apiStartReplay } from '../services/api';
import { formatTimestamp } from '../utils';

interface Props {
  onReplayMessage: (msg: IpcMessage) => void;
  filter: MessageFilter;
}

const TimeTravel: React.FC<Props> = ({ onReplayMessage, filter }) => {
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startReplay = useCallback(async () => {
    const state = await apiStartReplay(filter);
    setReplay(state);
    setPlaying(false);
    if (state.messages.length > 0) {
      onReplayMessage(state.messages[0]);
    }
  }, [filter, onReplayMessage]);

  const stepForward = useCallback(() => {
    if (!replay) return;
    const next = Math.min(replay.current_index + 1, replay.messages.length - 1);
    const updated = { ...replay, current_index: next };
    setReplay(updated);
    onReplayMessage(updated.messages[next]);
  }, [replay, onReplayMessage]);

  const stepBackward = useCallback(() => {
    if (!replay) return;
    const prev = Math.max(replay.current_index - 1, 0);
    const updated = { ...replay, current_index: prev };
    setReplay(updated);
    onReplayMessage(updated.messages[prev]);
  }, [replay, onReplayMessage]);

  const togglePlay = useCallback(() => {
    if (!replay) return;
    if (playing) {
      setPlaying(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    } else {
      setPlaying(true);
    }
  }, [replay, playing]);

  useEffect(() => {
    if (!playing || !replay) return;
    if (replay.current_index >= replay.messages.length - 1) {
      setPlaying(false);
      return;
    }
    const delay = Math.max(50, 1000 / replay.speed);
    timerRef.current = setTimeout(() => {
      stepForward();
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playing, replay, stepForward]);

  const changeSpeed = useCallback((delta: number) => {
    if (!replay) return;
    const speeds = [0.25, 0.5, 1, 2, 4, 8];
    const idx = speeds.indexOf(replay.speed);
    const newIdx = Math.max(0, Math.min(speeds.length - 1, idx + delta));
    setReplay({ ...replay, speed: speeds[newIdx] });
  }, [replay]);

  const seekTo = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!replay) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.floor(ratio * replay.messages.length);
    const clamped = Math.max(0, Math.min(idx, replay.messages.length - 1));
    const updated = { ...replay, current_index: clamped };
    setReplay(updated);
    onReplayMessage(updated.messages[clamped]);
  }, [replay, onReplayMessage]);

  if (!replay) {
    return (
      <div className="time-travel-bar">
        <button className="tt-btn primary" onClick={startReplay}>
          ⏮ Load History
        </button>
        <span style={{ fontSize: 12, color: '#8b949e', marginLeft: 8 }}>
          Time Travel: load message history for replay
        </span>
      </div>
    );
  }

  const progress = replay.messages.length > 0
    ? ((replay.current_index + 1) / replay.messages.length) * 100
    : 0;

  const currentMsg = replay.messages[replay.current_index];

  return (
    <div className="time-travel-bar">
      <button className="tt-btn" onClick={stepBackward}>⏮</button>
      <button className={`tt-btn ${playing ? 'danger' : 'primary'}`} onClick={togglePlay}>
        {playing ? '⏸' : '▶'}
      </button>
      <button className="tt-btn" onClick={stepForward}>⏭</button>

      <div className="tt-progress" onClick={seekTo}>
        <div className="tt-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <span className="tt-time">
        {replay.current_index + 1}/{replay.messages.length}
      </span>

      <button className="tt-btn" onClick={() => changeSpeed(-1)}>−</button>
      <span className="tt-speed">{replay.speed}x</span>
      <button className="tt-btn" onClick={() => changeSpeed(1)}>+</button>

      {currentMsg && (
        <span style={{ fontSize: 11, color: '#8b949e', marginLeft: 8, fontFamily: 'monospace' }}>
          {formatTimestamp(currentMsg.timestamp)}
        </span>
      )}

      <button className="tt-btn" onClick={() => { setReplay(null); setPlaying(false); }} style={{ marginLeft: 'auto' }}>
        ✕ Exit
      </button>
    </div>
  );
};

export default TimeTravel;
