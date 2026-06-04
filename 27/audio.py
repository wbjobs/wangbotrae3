import io
from typing import List, Tuple

import numpy as np
import librosa
import soundfile as sf

from config import (
    TARGET_SAMPLE_RATE,
    WINDOW_SIZE_SECONDS,
    HOP_SIZE_SECONDS,
    N_MELS,
    N_FFT,
    HOP_LENGTH,
    F_MIN,
    F_MAX,
    TARGET_TIME_STEPS,
)


def load_audio(audio_bytes: bytes) -> Tuple[np.ndarray, int]:
    with io.BytesIO(audio_bytes) as f:
        audio, sample_rate = sf.read(f, dtype="float32")
    if audio.ndim > 1:
        audio = audio[:, 0]
    return audio, sample_rate


def resample_audio(audio: np.ndarray, original_sr: int) -> np.ndarray:
    if original_sr != TARGET_SAMPLE_RATE:
        audio = librosa.resample(
            audio,
            orig_sr=original_sr,
            target_sr=TARGET_SAMPLE_RATE,
        )
    return audio


def sliding_window(audio: np.ndarray) -> List[Tuple[np.ndarray, float, float]]:
    window_samples = int(WINDOW_SIZE_SECONDS * TARGET_SAMPLE_RATE)
    hop_samples = int(HOP_SIZE_SECONDS * TARGET_SAMPLE_RATE)
    total_samples = len(audio)

    windows = []
    start = 0
    while start + window_samples <= total_samples:
        window = audio[start : start + window_samples]
        start_time = start / TARGET_SAMPLE_RATE
        end_time = (start + window_samples) / TARGET_SAMPLE_RATE
        windows.append((window, start_time, end_time))
        start += hop_samples

    if start < total_samples:
        remaining = total_samples - start
        if remaining > 0:
            window = np.zeros(window_samples, dtype=np.float32)
            window[:remaining] = audio[start:]
            start_time = start / TARGET_SAMPLE_RATE
            end_time = total_samples / TARGET_SAMPLE_RATE
            windows.append((window, start_time, end_time))

    return windows


def pad_or_truncate_spectrogram(
    mel_spec: np.ndarray,
    target_time_steps: int = TARGET_TIME_STEPS,
) -> np.ndarray:
    current_steps = mel_spec.shape[1]

    if current_steps == target_time_steps:
        return mel_spec

    if current_steps > target_time_steps:
        return mel_spec[:, :target_time_steps]

    pad_width = target_time_steps - current_steps
    return np.pad(
        mel_spec,
        ((0, 0), (0, pad_width)),
        mode="constant",
        constant_values=0.0,
    )


def compute_mel_spectrogram(audio: np.ndarray) -> np.ndarray:
    mel_spec = librosa.feature.melspectrogram(
        y=audio,
        sr=TARGET_SAMPLE_RATE,
        n_mels=N_MELS,
        n_fft=N_FFT,
        hop_length=HOP_LENGTH,
        fmin=F_MIN,
        fmax=F_MAX,
        power=2.0,
    )
    mel_spec_db = librosa.power_to_db(mel_spec, ref=np.max)
    mean = np.mean(mel_spec_db)
    std = np.std(mel_spec_db) + 1e-8
    mel_spec_normalized = (mel_spec_db - mean) / std

    mel_spec_fixed = pad_or_truncate_spectrogram(mel_spec_normalized)
    return mel_spec_fixed.astype(np.float32)


def process_audio(audio_bytes: bytes) -> List[Tuple[np.ndarray, float, float]]:
    audio, sample_rate = load_audio(audio_bytes)
    audio = resample_audio(audio, sample_rate)
    windows = sliding_window(audio)
    result = []
    for window, start_time, end_time in windows:
        mel_spec = compute_mel_spectrogram(window)
        result.append((mel_spec, start_time, end_time))
    return result
