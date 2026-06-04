import numpy as np
import soundfile as sf
from pathlib import Path


def generate_test_wav(output_path: str, duration: float = 5.0, sample_rate: int = 16000):
    t = np.linspace(0, duration, int(sample_rate * duration), dtype=np.float32)
    freq1 = 440
    freq2 = 880
    audio = 0.3 * np.sin(2 * np.pi * freq1 * t) + 0.2 * np.sin(2 * np.pi * freq2 * t)
    noise = np.random.normal(0, 0.05, len(audio)).astype(np.float32)
    audio = audio + noise
    audio = audio / np.max(np.abs(audio)) * 0.9
    sf.write(output_path, audio, sample_rate, subtype="PCM_16")
    print(f"Test WAV file generated: {output_path}")
    print(f"Duration: {duration}s, Sample rate: {sample_rate}Hz, Channels: 1")


if __name__ == "__main__":
    output_path = Path(__file__).parent / "test_audio.wav"
    generate_test_wav(str(output_path))
