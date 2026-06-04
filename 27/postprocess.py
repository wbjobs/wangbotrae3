from typing import List, Dict, Any

from config import CONFIDENCE_THRESHOLD, MERGE_GAP_SECONDS, CLASSES


class Detection:
    __slots__ = ("class_name", "start_time", "end_time", "confidence")

    def __init__(
        self,
        class_name: str,
        start_time: float,
        end_time: float,
        confidence: float,
    ):
        self.class_name = class_name
        self.start_time = start_time
        self.end_time = end_time
        self.confidence = confidence

    def to_dict(self) -> Dict[str, Any]:
        return {
            "class": self.class_name,
            "start_time": round(self.start_time, 3),
            "end_time": round(self.end_time, 3),
            "confidence": round(float(self.confidence), 4),
        }


def filter_detections(
    predictions: List[tuple],
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
) -> List[Detection]:
    detections = []
    for pred_class, start_time, end_time, probs in predictions:
        try:
            class_idx = CLASSES.index(pred_class)
        except ValueError:
            continue
        confidence = probs[class_idx]
        if confidence >= confidence_threshold:
            detections.append(
                Detection(
                    class_name=pred_class,
                    start_time=start_time,
                    end_time=end_time,
                    confidence=confidence,
                )
            )
    return detections


def merge_adjacent_events(
    detections: List[Detection],
    merge_gap_seconds: float = MERGE_GAP_SECONDS,
) -> List[Detection]:
    if not detections:
        return []

    sorted_detections = sorted(detections, key=lambda d: (d.class_name, d.start_time))

    merged: List[Detection] = []
    current_group: List[Detection] = []

    for det in sorted_detections:
        if not current_group:
            current_group = [det]
            continue

        last = current_group[-1]
        if (
            det.class_name == last.class_name
            and det.start_time - last.end_time <= merge_gap_seconds
        ):
            current_group.append(det)
        else:
            merged.append(_merge_group(current_group))
            current_group = [det]

    if current_group:
        merged.append(_merge_group(current_group))

    merged.sort(key=lambda d: d.start_time)
    return merged


def _merge_group(group: List[Detection]) -> Detection:
    if len(group) == 1:
        return Detection(
            class_name=group[0].class_name,
            start_time=group[0].start_time,
            end_time=group[0].end_time,
            confidence=group[0].confidence,
        )

    class_name = group[0].class_name
    start_time = min(d.start_time for d in group)
    end_time = max(d.end_time for d in group)
    max_confidence = max(d.confidence for d in group)
    avg_confidence = sum(d.confidence for d in group) / len(group)
    confidence = max(max_confidence, avg_confidence)

    return Detection(
        class_name=class_name,
        start_time=start_time,
        end_time=end_time,
        confidence=confidence,
    )


def process_predictions(
    window_predictions: List[tuple],
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
    merge_gap_seconds: float = MERGE_GAP_SECONDS,
) -> List[Dict[str, Any]]:
    detections = filter_detections(window_predictions, confidence_threshold)
    merged = merge_adjacent_events(detections, merge_gap_seconds)
    return [d.to_dict() for d in merged]
