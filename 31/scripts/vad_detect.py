import sys
import os
import json
import subprocess
import struct
import tempfile
import math


def extract_audio(video_path, wav_path):
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le",
        "-ar", "16000", "-ac", "1",
        wav_path, "-y"
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr.decode('utf-8', errors='replace')}")


def read_wav(path):
    with open(path, "rb") as f:
        riff = f.read(4)
        if riff != b"RIFF":
            raise ValueError("Not a valid WAV file")
        f.read(4)
        wave = f.read(4)
        if wave != b"WAVE":
            raise ValueError("Not a valid WAV file")
        fmt_chunk = None
        data_chunk = None
        while True:
            chunk_header = f.read(8)
            if len(chunk_header) < 8:
                break
            chunk_id = chunk_header[:4]
            chunk_size = struct.unpack("<I", chunk_header[4:8])[0]
            if chunk_id == b"fmt ":
                fmt_chunk = f.read(chunk_size)
            elif chunk_id == b"data":
                data_chunk = f.read(chunk_size)
            else:
                f.read(chunk_size)
        if fmt_chunk is None or data_chunk is None:
            raise ValueError("Missing fmt or data chunk")
        audio_format = struct.unpack("<H", fmt_chunk[0:2])[0]
        if audio_format != 1:
            raise ValueError("Not PCM format")
        num_channels = struct.unpack("<H", fmt_chunk[2:4])[0]
        sample_rate = struct.unpack("<I", fmt_chunk[4:8])[0]
        bits_per_sample = struct.unpack("<H", fmt_chunk[14:16])[0]
        return data_chunk, sample_rate, num_channels, bits_per_sample


def frames_from_wav(data, sample_rate, frame_duration_ms):
    n_samples = int(sample_rate * frame_duration_ms / 1000)
    n_bytes = n_samples * 2
    offset = 0
    while offset + n_bytes <= len(data):
        frame_data = data[offset:offset + n_bytes]
        offset += n_bytes
        yield frame_data


def rms(frame_data):
    count = len(frame_data) // 2
    if count == 0:
        return 0.0
    total = 0.0
    for i in range(count):
        sample = struct.unpack("<h", frame_data[i * 2:i * 2 + 2])[0]
        total += sample * sample
    return math.sqrt(total / count)


def merge_segments(segments, gap_threshold=0.3):
    if not segments:
        return []
    merged = [segments[0].copy()]
    for seg in segments[1:]:
        if seg["start"] - merged[-1]["end"] < gap_threshold:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg.copy())
    return merged


def vad_webrtcvad(wav_path, aggressiveness=2, frame_duration_ms=30):
    import webrtcvad
    data, sample_rate, num_channels, bits_per_sample = read_wav(wav_path)
    vad = webrtcvad.Vad(aggressiveness)
    segments = []
    current_start = None
    frame_size = frame_duration_ms / 1000.0
    for i, frame in enumerate(frames_from_wav(data, sample_rate, frame_duration_ms)):
        is_speech = vad.is_speech(frame, sample_rate)
        timestamp = i * frame_size
        if is_speech:
            if current_start is None:
                current_start = timestamp
        else:
            if current_start is not None:
                segments.append({"start": round(current_start, 3), "end": round(timestamp, 3)})
                current_start = None
    if current_start is not None:
        segments.append({"start": round(current_start, 3), "end": round(round(len(data) / 2 / sample_rate, 3), 3)})
    return merge_segments(segments, 0.3)


def vad_energy(wav_path, frame_duration_ms=30):
    data, sample_rate, num_channels, bits_per_sample = read_wav(wav_path)
    frame_size = frame_duration_ms / 1000.0
    energies = []
    frames_list = []
    for i, frame in enumerate(frames_from_wav(data, sample_rate, frame_duration_ms)):
        e = rms(frame)
        energies.append(e)
        frames_list.append(i)
    if not energies:
        return []
    sorted_energies = sorted(energies)
    median_energy = sorted_energies[len(sorted_energies) // 2]
    threshold = max(median_energy * 1.5, 300)
    segments = []
    current_start = None
    for i, e in enumerate(energies):
        timestamp = i * frame_size
        if e > threshold:
            if current_start is None:
                current_start = timestamp
        else:
            if current_start is not None:
                segments.append({"start": round(current_start, 3), "end": round(timestamp, 3)})
                current_start = None
    if current_start is not None:
        segments.append({"start": round(current_start, 3), "end": round(round(len(data) / 2 / sample_rate, 3), 3)})
    return merge_segments(segments, 0.3)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python vad_detect.py <video_path>"}))
        sys.exit(1)
    video_path = sys.argv[1]
    if not os.path.isfile(video_path):
        print(json.dumps({"error": f"File not found: {video_path}"}))
        sys.exit(1)
    tmp_wav = None
    try:
        fd, tmp_wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        extract_audio(video_path, tmp_wav)
        try:
            segments = vad_webrtcvad(tmp_wav)
        except ImportError:
            segments = vad_energy(tmp_wav)
        print(json.dumps({"segments": segments}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.remove(tmp_wav)


if __name__ == "__main__":
    main()
