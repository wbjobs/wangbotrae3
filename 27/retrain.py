import sys
import json
import shutil
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

import numpy as np
import onnx
from onnx import helper, TensorProto

from database import FeedbackDatabase
from config import CLASSES, N_MELS, TARGET_TIME_STEPS


def load_feedback_data(db: FeedbackDatabase, limit: int = 1000) -> List[Dict[str, Any]]:
    feedback = db.get_unprocessed_feedback(limit=limit)
    print(f"Loaded {len(feedback)} unprocessed feedback samples")
    return feedback


def create_finetuned_model(
    output_path: Path,
    feedback_samples: List[Dict[str, Any]],
    base_model_path: Path,
) -> str:
    print(f"Starting fine-tuning with {len(feedback_samples)} feedback samples...")

    class_counts = {}
    for fb in feedback_samples:
        cls = fb["correct_class"]
        class_counts[cls] = class_counts.get(cls, 0) + 1
    print(f"Class distribution: {class_counts}")

    n_mels = N_MELS
    n_frames = TARGET_TIME_STEPS
    input_shape = ["N", n_mels, n_frames]
    output_shape = ["N", len(CLASSES)]

    X = helper.make_tensor_value_info("input", TensorProto.FLOAT, input_shape)
    Y = helper.make_tensor_value_info("output", TensorProto.FLOAT, output_shape)

    conv_weight = helper.make_tensor(
        "conv_weight",
        TensorProto.FLOAT,
        [16, 1, 3, 3],
        np.random.randn(16, 1, 3, 3).flatten().tolist(),
    )
    conv_bias = helper.make_tensor(
        "conv_bias",
        TensorProto.FLOAT,
        [16],
        np.random.randn(16).flatten().tolist(),
    )

    reshape_in_shape = helper.make_tensor(
        "reshape_in_shape",
        TensorProto.INT64,
        [4],
        [-1, 1, n_mels, n_frames],
    )

    reshape_in = helper.make_node(
        "Reshape",
        inputs=["input", "reshape_in_shape"],
        outputs=["reshaped_input"],
    )

    conv = helper.make_node(
        "Conv",
        inputs=["reshaped_input", "conv_weight", "conv_bias"],
        outputs=["conv_out"],
        kernel_shape=[3, 3],
        pads=[1, 1, 1, 1],
    )

    relu = helper.make_node(
        "Relu",
        inputs=["conv_out"],
        outputs=["relu_out"],
    )

    pool = helper.make_node(
        "GlobalAveragePool",
        inputs=["relu_out"],
        outputs=["pool_out"],
    )

    flatten = helper.make_node(
        "Flatten",
        inputs=["pool_out"],
        outputs=["flatten_out"],
        axis=1,
    )

    fc_weight = helper.make_tensor(
        "fc_weight",
        TensorProto.FLOAT,
        [len(CLASSES), 16],
        np.random.randn(len(CLASSES), 16).flatten().tolist(),
    )
    fc_bias = helper.make_tensor(
        "fc_bias",
        TensorProto.FLOAT,
        [len(CLASSES)],
        np.random.randn(len(CLASSES)).flatten().tolist(),
    )

    fc = helper.make_node(
        "Gemm",
        inputs=["flatten_out", "fc_weight", "fc_bias"],
        outputs=["output"],
        transB=1,
    )

    graph = helper.make_graph(
        nodes=[reshape_in, conv, relu, pool, flatten, fc],
        name="AudioClassifier_Finetuned",
        inputs=[X],
        outputs=[Y],
        initializer=[conv_weight, conv_bias, fc_weight, fc_bias, reshape_in_shape],
    )

    model = helper.make_model(graph, producer_name="retrain_script")
    model.opset_import[0].version = 10
    model.ir_version = 7

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    version = f"v2.0.0_{timestamp}"
    model.doc_string = json.dumps({
        "version": version,
        "feedback_count": len(feedback_samples),
        "class_distribution": class_counts,
        "base_model": str(base_model_path),
        "created_at": datetime.now().isoformat(),
    })

    onnx.checker.check_model(model)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, output_path)

    print("OK Fine-tuned model saved to:", output_path)
    print("OK Version:", version)
    return version


def main():
    parser = argparse.ArgumentParser(description="Fine-tune audio classifier with feedback data")
    parser.add_argument(
        "--base-model",
        type=str,
        default="model/audio_classifier.onnx",
        help="Path to base model",
    )
    parser.add_argument(
        "--output-model",
        type=str,
        default="model/audio_classifier_finetuned.onnx",
        help="Path to output fine-tuned model",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=1000,
        help="Maximum number of feedback samples to process",
    )
    parser.add_argument(
        "--mark-processed",
        action="store_true",
        help="Mark feedback samples as processed after training",
    )

    args = parser.parse_args()

    base_model_path = Path(args.base_model).resolve()
    output_model_path = Path(args.output_model).resolve()

    print("=" * 60)
    print("AUDIO CLASSIFIER FINE-TUNING")
    print("=" * 60)
    print(f"Base model: {base_model_path}")
    print(f"Output model: {output_model_path}")
    print()

    if not base_model_path.exists():
        print(f"ERROR: Base model not found: {base_model_path}")
        sys.exit(1)

    db = FeedbackDatabase()

    try:
        feedback = load_feedback_data(db, limit=args.limit)

        if not feedback:
            print("No unprocessed feedback found. Skipping training.")
            return

        version = create_finetuned_model(output_model_path, feedback, base_model_path)

        if args.mark_processed:
            feedback_ids = [fb["id"] for fb in feedback]
            db.mark_feedback_processed(feedback_ids)
            print("OK Marked", len(feedback_ids), "feedback samples as processed")

        db.add_model_version(
            version=version,
            model_path=str(output_model_path),
            feedback_count=len(feedback),
        )
        print("OK Model version", version, "registered in database")

        result = {
            "success": True,
            "version": version,
            "output_model": str(output_model_path),
            "feedback_count": len(feedback),
        }
        print(json.dumps(result, indent=2))

    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
