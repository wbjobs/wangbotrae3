import logging
import cv2
import numpy as np
from pathlib import Path
from typing import Optional, Callable, Dict, Any, List
import tempfile
import subprocess
import json
import shutil

from config import ScaleFactor, PrecisionType, TEMP_DIR
from inference_engine import InferenceEngineFactory
from precision_selector import DynamicPrecisionSelector
from bitrate_allocator import DynamicBitrateAllocator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

CHUNK_SIZE = 100
OVERLAP_SIZE = 5


class VideoProcessor:
    def __init__(
        self,
        model_type: str = "espcn",
        scale: ScaleFactor = 2,
        precision: Optional[PrecisionType] = None,
        bitrate_budget: Optional[float] = None
    ):
        self.model_type = model_type
        self.scale = scale
        self.precision = precision
        self.bitrate_budget = bitrate_budget
        self.precision_selector = DynamicPrecisionSelector()
        self.bitrate_allocator = DynamicBitrateAllocator(
            bitrate_budget_mbps=bitrate_budget if bitrate_budget else 5.0
        )
        self.engine = None
    
    def _initialize_engine(self, sample_frames=None):
        if sample_frames is not None:
            for frame in sample_frames[:5]:
                self.precision_selector.add_frame_sample(frame)
        
        selected_precision, use_tensorrt = self.precision_selector.select_precision(self.precision)
        
        logger.info(f"Selected precision: {selected_precision}, TensorRT: {use_tensorrt}")
        
        self.engine = InferenceEngineFactory.get_engine(
            self.model_type,
            self.scale,
            selected_precision,
            use_tensorrt
        )
        
        return selected_precision, use_tensorrt
    
    def get_video_info(self, video_path: str) -> Dict[str, Any]:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        duration = frame_count / fps if fps > 0 else 0
        
        cap.release()
        
        return {
            "fps": fps,
            "frame_count": frame_count,
            "width": width,
            "height": height,
            "duration": duration,
            "has_audio": self._has_audio(video_path)
        }
    
    def _has_audio(self, video_path: str) -> bool:
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                return any(s.get("codec_type") == "audio" for s in data.get("streams", []))
        except Exception:
            pass
        return False
    
    def _extract_audio(self, video_path: str, output_audio_path: str) -> bool:
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", video_path, "-vn", "-acodec", "copy", output_audio_path],
                capture_output=True,
                timeout=30
            )
            return Path(output_audio_path).exists()
        except Exception as e:
            logger.warning(f"Audio extraction failed: {e}")
            return False
    
    def _merge_audio_video(self, video_path: str, audio_path: str, output_path: str) -> bool:
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", video_path, "-i", audio_path, "-c:v", "copy", "-c:a", "aac", output_path],
                capture_output=True,
                timeout=60
            )
            return Path(output_path).exists()
        except Exception as e:
            logger.warning(f"Audio merge failed: {e}")
            return False
    
    def process_video(
        self,
        input_path: str,
        output_path: str,
        progress_callback: Optional[Callable[[float, str], None]] = None
    ) -> Dict[str, Any]:
        input_path = str(input_path)
        output_path = str(output_path)
        
        if progress_callback:
            progress_callback(0.0, "Analyzing video...")
        
        video_info = self.get_video_info(input_path)
        logger.info(f"Video info: {video_info}")
        
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {input_path}")
        
        sample_frames = []
        for i in range(min(10, video_info["frame_count"])):
            ret, frame = cap.read()
            if ret:
                sample_frames.append(frame)
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        
        if progress_callback:
            progress_callback(0.05, "Initializing model...")
        
        selected_precision, use_tensorrt = self._initialize_engine(sample_frames)
        
        output_width = video_info["width"] * self.scale
        output_height = video_info["height"] * self.scale
        fps = video_info["fps"]
        
        temp_dir = TEMP_DIR / f"proc_{Path(input_path).stem}"
        temp_dir.mkdir(exist_ok=True, parents=True)
        temp_audio_path = str(temp_dir / "audio.aac")
        
        has_audio = video_info["has_audio"]
        audio_extracted = False
        if has_audio:
            if progress_callback:
                progress_callback(0.08, "Extracting audio...")
            audio_extracted = self._extract_audio(input_path, temp_audio_path)
        
        if progress_callback:
            progress_callback(0.1, "Processing frames and analyzing complexity...")
        
        total_frames = video_info["frame_count"]
        chunks = self._split_into_chunks(total_frames)
        logger.info(f"Split video into {len(chunks)} chunks, total frames: {total_frames}")
        
        chunk_frame_counts = []
        all_valid_frames = []
        frames_processed = 0
        
        for chunk_idx, chunk_info in enumerate(chunks):
            is_first_chunk = chunk_idx == 0
            is_last_chunk = chunk_idx == len(chunks) - 1
            
            valid_start = chunk_info["valid_start"]
            valid_end = chunk_info["valid_end"]
            valid_frame_count = valid_end - valid_start
            
            logger.info(f"Processing chunk {chunk_idx + 1}/{len(chunks)}: frames {valid_start}-{valid_end} "
                       f"(overlap: {chunk_info['overlap_before']}/{chunk_info['overlap_after']})")
            
            chunk_frames = self._read_frames(cap, chunk_info["chunk_start"], chunk_info["chunk_end"])
            
            if not chunk_frames:
                logger.warning(f"Chunk {chunk_idx} has no frames, skipping")
                chunk_frame_counts.append(0)
                continue
            
            if self.bitrate_budget is not None:
                self.bitrate_allocator.analyze_chunk(chunk_frames)
            
            processed_frames = self._process_chunk(
                chunk_frames,
                output_width,
                output_height
            )
            
            valid_frames = self._extract_valid_frames(
                processed_frames,
                chunk_info,
                is_first_chunk,
                is_last_chunk
            )
            
            expected_valid_frames = valid_end - valid_start
            actual_valid_frames = len(valid_frames)
            
            if actual_valid_frames < expected_valid_frames:
                logger.warning(f"Chunk {chunk_idx}: expected {expected_valid_frames} valid frames, "
                              f"got {actual_valid_frames}. Adjusting to match available frames.")
                valid_frame_count = actual_valid_frames
            
            chunk_frame_counts.append(valid_frame_count)
            all_valid_frames.extend(valid_frames)
            frames_processed += actual_valid_frames
            
            if progress_callback and frames_processed % 10 == 0:
                progress = 0.1 + 0.6 * (frames_processed / total_frames)
                progress_callback(
                    progress,
                    f"Processing frame {frames_processed}/{total_frames} "
                    f"(chunk {chunk_idx + 1}/{len(chunks)})"
                )
        
        cap.release()
        
        logger.info(f"Processed {frames_processed} frames out of {total_frames} total")
        
        if frames_processed < total_frames:
            logger.warning(f"Only processed {frames_processed}/{total_frames} frames. "
                          f"Last {total_frames - frames_processed} frames may be corrupted.")
        
        if progress_callback:
            progress_callback(0.72, "Allocating bitrates and encoding...")
        
        bitrate_allocations = []
        if self.bitrate_budget is not None:
            bitrate_allocations = self.bitrate_allocator.allocate_bitrates(chunk_frame_counts)
        
        segment_paths = self._encode_segments(
            all_valid_frames,
            chunk_frame_counts,
            bitrate_allocations,
            output_width,
            output_height,
            fps,
            temp_dir,
            progress_callback
        )
        
        if progress_callback:
            progress_callback(0.9, "Concatenating segments...")
        
        temp_video_path = str(temp_dir / "raw_video.mp4")
        
        if len(segment_paths) == 1:
            shutil.copy2(segment_paths[0], temp_video_path)
        elif len(segment_paths) > 1:
            self._concatenate_segments(segment_paths, temp_video_path)
        else:
            raise RuntimeError("No segments were encoded")
        
        final_output = temp_video_path
        if has_audio and audio_extracted:
            merged_path = str(temp_dir / "merged_video.mp4")
            if self._merge_audio_video(temp_video_path, temp_audio_path, merged_path):
                final_output = merged_path
        
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        if Path(final_output).exists():
            shutil.copy2(final_output, output_path)
        
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
        
        if progress_callback:
            progress_callback(1.0, "Complete!")
        
        actual_duration = frames_processed / fps if fps > 0 else 0
        
        bitrate_summary = self.bitrate_allocator.get_summary() if self.bitrate_budget else {}
        
        return {
            "output_path": output_path,
            "scale": self.scale,
            "precision": selected_precision,
            "use_tensorrt": use_tensorrt,
            "output_width": output_width,
            "output_height": output_height,
            "fps": fps,
            "frame_count": frames_processed,
            "original_frame_count": total_frames,
            "duration": actual_duration,
            "original_duration": video_info["duration"],
            "audio_preserved": has_audio and audio_extracted,
            "chunks_processed": len(chunks),
            "overlap_size": OVERLAP_SIZE,
            "chunk_size": CHUNK_SIZE,
            "bitrate_budget_mbps": self.bitrate_budget,
            "bitrate_allocation": bitrate_allocations,
            "bitrate_summary": bitrate_summary,
            "encoding_mode": "dynamic_vbr" if self.bitrate_budget else "default"
        }
    
    def _split_into_chunks(self, total_frames: int) -> List[Dict[str, int]]:
        chunks = []
        start = 0
        
        while start < total_frames:
            chunk_start = max(0, start - OVERLAP_SIZE)
            chunk_end = min(total_frames, start + CHUNK_SIZE + OVERLAP_SIZE)
            
            valid_start = start
            valid_end = min(total_frames, start + CHUNK_SIZE)
            
            if valid_end >= total_frames:
                chunk_end = total_frames
            
            chunks.append({
                "chunk_start": chunk_start,
                "chunk_end": chunk_end,
                "valid_start": valid_start,
                "valid_end": valid_end,
                "overlap_before": valid_start - chunk_start,
                "overlap_after": chunk_end - valid_end
            })
            
            start = valid_end
            if start >= total_frames:
                break
        
        return chunks
    
    def _create_blend_weights(self, length: int, fade_in: bool = True, fade_out: bool = True) -> np.ndarray:
        weights = np.ones(length, dtype=np.float32)
        
        if fade_in and length > 1:
            fade_len = min(OVERLAP_SIZE, length)
            weights[:fade_len] = np.linspace(0, 1, fade_len, dtype=np.float32)
        
        if fade_out and length > 1:
            fade_len = min(OVERLAP_SIZE, length)
            weights[-fade_len:] = np.linspace(1, 0, fade_len, dtype=np.float32)
        
        return weights
    
    def _blend_frames(
        self,
        frame1: np.ndarray,
        frame2: np.ndarray,
        alpha: float
    ) -> np.ndarray:
        alpha = np.clip(alpha, 0, 1)
        return cv2.addWeighted(frame1, 1 - alpha, frame2, alpha, 0)
    
    def _read_frames(self, cap: cv2.VideoCapture, start: int, end: int) -> List[np.ndarray]:
        frames = []
        cap.set(cv2.CAP_PROP_POS_FRAMES, start)
        
        for i in range(start, end):
            ret, frame = cap.read()
            if not ret:
                logger.warning(f"Failed to read frame {i}, stopping chunk early")
                break
            frames.append(frame)
        
        return frames
    
    def _process_chunk(
        self,
        frames: List[np.ndarray],
        output_width: int,
        output_height: int
    ) -> List[np.ndarray]:
        processed = []
        for frame in frames:
            sr_frame = self.engine.infer(frame)
            if sr_frame.shape[:2] != (output_height, output_width):
                sr_frame = cv2.resize(sr_frame, (output_width, output_height))
            processed.append(sr_frame)
        return processed
    
    def _extract_valid_frames(
        self,
        processed_frames: List[np.ndarray],
        chunk_info: Dict[str, int],
        is_first_chunk: bool,
        is_last_chunk: bool
    ) -> List[np.ndarray]:
        overlap_before = chunk_info["overlap_before"]
        overlap_after = chunk_info["overlap_after"]
        total_processed = len(processed_frames)
        
        valid_start = overlap_before
        valid_end = total_processed - overlap_after
        
        if valid_end <= valid_start:
            return processed_frames
        
        valid_frames = []
        total_valid = valid_end - valid_start
        
        weights = self._create_blend_weights(
            total_valid,
            fade_in=not is_first_chunk,
            fade_out=not is_last_chunk
        )
        
        for i in range(total_valid):
            frame_idx = valid_start + i
            frame = processed_frames[frame_idx].astype(np.float32)
            weight = weights[i]
            
            if not is_first_chunk and i < OVERLAP_SIZE and overlap_before > 0:
                if frame_idx - 1 >= 0 and len(valid_frames) > 0:
                    prev_frame = valid_frames[-1].astype(np.float32)
                    alpha = weights[i]
                    frame = self._blend_frames(prev_frame, frame, alpha)
            
            valid_frames.append(np.clip(frame, 0, 255).astype(np.uint8))
        
        return valid_frames
    
    def cleanup(self):
        if self.engine:
            self.engine.cleanup()
        self.precision_selector.reset()
        self.bitrate_allocator.reset()
    
    def _encode_segments(
        self,
        all_frames: List[np.ndarray],
        chunk_frame_counts: List[int],
        bitrate_allocations: List[Dict[str, Any]],
        width: int,
        height: int,
        fps: float,
        temp_dir: Path,
        progress_callback: Optional[Callable[[float, str], None]] = None
    ) -> List[str]:
        segment_paths = []
        frame_offset = 0
        
        for seg_idx, frame_count in enumerate(chunk_frame_counts):
            if frame_count <= 0:
                continue
            
            segment_frames = all_frames[frame_offset:frame_offset + frame_count]
            frame_offset += frame_count
            
            if not segment_frames:
                continue
            
            segment_path = str(temp_dir / f"segment_{seg_idx:04d}.mp4")
            
            if bitrate_allocations and seg_idx < len(bitrate_allocations):
                alloc = bitrate_allocations[seg_idx]
                bitrate_mbps = alloc["bitrate_mbps"]
                crf = alloc["crf"]
                self._encode_segment_ffmpeg(
                    segment_frames, segment_path,
                    width, height, fps,
                    bitrate_mbps=bitrate_mbps, crf=crf
                )
            else:
                self._encode_segment_ffmpeg(
                    segment_frames, segment_path,
                    width, height, fps
                )
            
            if Path(segment_path).exists():
                segment_paths.append(segment_path)
            
            if progress_callback:
                seg_progress = 0.72 + 0.18 * ((seg_idx + 1) / len(chunk_frame_counts))
                progress_callback(seg_progress, f"Encoded segment {seg_idx + 1}/{len(chunk_frame_counts)}")
        
        return segment_paths
    
    def _encode_segment_ffmpeg(
        self,
        frames: List[np.ndarray],
        output_path: str,
        width: int,
        height: int,
        fps: float,
        bitrate_mbps: Optional[float] = None,
        crf: Optional[int] = None
    ):
        raw_path = output_path.replace('.mp4', '_raw.yuv')
        
        fourcc = cv2.VideoWriter_fourcc(*'I420')
        temp_raw_writer_path = output_path.replace('.mp4', '_temp.avi')
        out = cv2.VideoWriter(
            temp_raw_writer_path,
            cv2.VideoWriter_fourcc(*'mp4v'),
            fps,
            (width, height)
        )
        
        for frame in frames:
            out.write(frame)
        out.release()
        
        cmd = ["ffmpeg", "-y", "-i", temp_raw_writer_path]
        
        cmd.extend(["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p"])
        
        if bitrate_mbps is not None and crf is not None:
            cmd.extend([
                "-b:v", f"{bitrate_mbps}M",
                "-maxrate", f"{bitrate_mbps * 1.5}M",
                "-bufsize", f"{bitrate_mbps * 2}M",
                "-crf", str(crf)
            ])
        elif bitrate_mbps is not None:
            cmd.extend([
                "-b:v", f"{bitrate_mbps}M",
                "-maxrate", f"{bitrate_mbps * 1.5}M",
                "-bufsize", f"{bitrate_mbps * 2}M"
            ])
        else:
            cmd.extend(["-crf", "23"])
        
        cmd.extend(["-movflags", "+faststart", output_path])
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )
            if result.returncode != 0:
                logger.warning(f"FFmpeg encoding warning: {result.stderr[-200:] if result.stderr else 'none'}")
        except FileNotFoundError:
            logger.warning("FFmpeg not found, falling back to OpenCV writer")
            shutil.copy2(temp_raw_writer_path, output_path)
        except subprocess.TimeoutExpired:
            logger.warning("FFmpeg encoding timeout, falling back to OpenCV writer")
            shutil.copy2(temp_raw_writer_path, output_path)
        
        try:
            if Path(temp_raw_writer_path).exists():
                Path(temp_raw_writer_path).unlink()
        except Exception:
            pass
    
    def _concatenate_segments(self, segment_paths: List[str], output_path: str):
        concat_list_path = output_path.replace('.mp4', '_concat.txt')
        
        with open(concat_list_path, 'w', encoding='utf-8') as f:
            for seg_path in segment_paths:
                escaped = seg_path.replace('\\', '/')
                f.write(f"file '{escaped}'\n")
        
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list_path,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode != 0:
                logger.warning(f"FFmpeg concat warning: {result.stderr[-200:] if result.stderr else 'none'}")
                self._concatenate_segments_reencode(segment_paths, output_path)
        except FileNotFoundError:
            self._concatenate_segments_reencode(segment_paths, output_path)
        except subprocess.TimeoutExpired:
            self._concatenate_segments_reencode(segment_paths, output_path)
        finally:
            try:
                if Path(concat_list_path).exists():
                    Path(concat_list_path).unlink()
            except Exception:
                pass
    
    def _concatenate_segments_reencode(self, segment_paths: List[str], output_path: str):
        concat_list_path = output_path.replace('.mp4', '_concat.txt')
        
        with open(concat_list_path, 'w', encoding='utf-8') as f:
            for seg_path in segment_paths:
                escaped = seg_path.replace('\\', '/')
                f.write(f"file '{escaped}'\n")
        
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list_path,
            "-c:v", "libx264",
            "-crf", "20",
            "-preset", "medium",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path
        ]
        
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except Exception as e:
            logger.error(f"Re-encode concatenation failed: {e}")
            if segment_paths:
                shutil.copy2(segment_paths[0], output_path)
        finally:
            try:
                if Path(concat_list_path).exists():
                    Path(concat_list_path).unlink()
            except Exception:
                pass
