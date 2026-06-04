import numpy as np
import onnx
from onnx import helper, TensorProto

from config import CLASSES, N_MELS, TARGET_TIME_STEPS


def create_dummy_model(output_path: str) -> None:
    n_mels = N_MELS
    n_frames = TARGET_TIME_STEPS

    input_shape = ["N", n_mels, n_frames]
    output_shape = ["N", len(CLASSES)]

    X = helper.make_tensor_value_info("input", TensorProto.FLOAT, input_shape)
    Y = helper.make_tensor_value_info("output", TensorProto.FLOAT, output_shape)

    conv_weight = helper.make_tensor(
        "conv_weight",
        TensorProto.FLOAT,
        [8, 1, 3, 3],
        np.random.randn(8, 1, 3, 3).flatten().tolist(),
    )
    conv_bias = helper.make_tensor(
        "conv_bias",
        TensorProto.FLOAT,
        [8],
        np.random.randn(8).flatten().tolist(),
    )

    reshape_in_node = helper.make_node(
        "Reshape",
        inputs=["input", "reshape_in_shape"],
        outputs=["reshaped_input"],
    )
    reshape_in_shape = helper.make_tensor(
        "reshape_in_shape",
        TensorProto.INT64,
        [4],
        [-1, 1, n_mels, n_frames],
    )

    conv_node = helper.make_node(
        "Conv",
        inputs=["reshaped_input", "conv_weight", "conv_bias"],
        outputs=["conv_out"],
        kernel_shape=[3, 3],
        pads=[1, 1, 1, 1],
    )

    relu_node = helper.make_node(
        "Relu",
        inputs=["conv_out"],
        outputs=["relu_out"],
    )

    pool_node = helper.make_node(
        "GlobalAveragePool",
        inputs=["relu_out"],
        outputs=["pool_out"],
    )

    flatten_node = helper.make_node(
        "Flatten",
        inputs=["pool_out"],
        outputs=["flatten_out"],
        axis=1,
    )

    fc_weight = helper.make_tensor(
        "fc_weight",
        TensorProto.FLOAT,
        [len(CLASSES), 8],
        np.random.randn(len(CLASSES), 8).flatten().tolist(),
    )
    fc_bias = helper.make_tensor(
        "fc_bias",
        TensorProto.FLOAT,
        [len(CLASSES)],
        np.random.randn(len(CLASSES)).flatten().tolist(),
    )

    fc_node = helper.make_node(
        "Gemm",
        inputs=["flatten_out", "fc_weight", "fc_bias"],
        outputs=["output"],
        transB=1,
    )

    graph_def = helper.make_graph(
        nodes=[reshape_in_node, conv_node, relu_node, pool_node, flatten_node, fc_node],
        name="AudioClassifier",
        inputs=[X],
        outputs=[Y],
        initializer=[conv_weight, conv_bias, fc_weight, fc_bias, reshape_in_shape],
    )

    model_def = helper.make_model(graph_def, producer_name="dummy_audio_model")
    model_def.opset_import[0].version = 10
    model_def.ir_version = 7

    onnx.checker.check_model(model_def)
    onnx.save(model_def, output_path)
    print(f"Dummy model saved to {output_path}")
    print(f"Input shape: {input_shape}")
    print(f"Output shape: {output_shape}")
    print(f"Classes: {CLASSES}")


if __name__ == "__main__":
    from pathlib import Path

    model_path = Path(__file__).parent / "model" / "audio_classifier.onnx"
    create_dummy_model(str(model_path))
