from typing import Any, Dict, List, Optional
import io
import json
import logging

import numpy as np
import torch
import torch.nn.functional as F
from ts.torch_handler.base_handler import BaseHandler

from model import FaultDiagnosisCNN

logger = logging.getLogger(__name__)

CLASS_LABELS = ["正常", "轴承故障", "齿轮故障", "不平衡"]


class FaultDiagnosisHandler(BaseHandler):
    """
    工业设备故障诊断TorchServe自定义Handler
    """

    def __init__(self) -> None:
        super().__init__()
        self.model: Optional[FaultDiagnosisCNN] = None
        self.device: Optional[torch.device] = None
        self.initialized: bool = False

    def initialize(self, context: Any) -> None:
        """
        初始化模型和设备
        """
        properties = context.system_properties
        model_dir = properties.get("model_dir")
        self.device = torch.device(
            "cuda:" + str(properties.get("gpu_id"))
            if torch.cuda.is_available() and properties.get("gpu_id") is not None
            else "cpu"
        )

        self.model = FaultDiagnosisCNN()
        model_path = f"{model_dir}/fault_diagnosis_model.pth"
        state_dict = torch.load(model_path, map_location=self.device)
        self.model.load_state_dict(state_dict)
        self.model.to(self.device)
        self.model.eval()

        self.initialized = True
        logger.info(f"模型初始化完成，使用设备: {self.device}")

    def preprocess(self, data: List[Dict[str, Any]]) -> torch.Tensor:
        """
        预处理：numpy数组转tensor，归一化，增加通道维度

        Args:
            data: 请求数据列表，每个元素包含body字段

        Returns:
            预处理后的tensor，形状为(B, 1, 10240)
        """
        processed_data: List[np.ndarray] = []

        for item in data:
            body = item.get("body")
            if body is None:
                body = item.get("data")

            if isinstance(body, (bytes, bytearray)):
                signal = np.load(io.BytesIO(body))
            elif isinstance(body, str):
                signal = np.array(json.loads(body), dtype=np.float32)
            elif isinstance(body, (list, np.ndarray)):
                signal = np.array(body, dtype=np.float32)
            else:
                raise ValueError(f"不支持的数据类型: {type(body)}")

            if signal.ndim == 1:
                signal = signal.reshape(1, -1)

            mean = np.mean(signal)
            std = np.std(signal) + 1e-8
            signal_normalized = (signal - mean) / std

            processed_data.append(signal_normalized)

        batch_data = np.stack(processed_data, axis=0)
        tensor_data = torch.from_numpy(batch_data).float().to(self.device)
        return tensor_data

    def inference(self, data: torch.Tensor, *args: Any, **kwargs: Any) -> torch.Tensor:
        """
        推理：调用模型前向传播

        Args:
            data: 预处理后的tensor

        Returns:
            模型输出logits
        """
        with torch.no_grad():
            logits = self.model(data)
        return logits

    def postprocess(self, data: torch.Tensor) -> List[Dict[str, Any]]:
        """
        后处理：softmax输出概率，返回类别和置信度

        Args:
            data: 模型输出logits

        Returns:
            包含类别和置信度的结果列表
        """
        probabilities = F.softmax(data, dim=1)
        confidences, predictions = torch.max(probabilities, dim=1)

        results: List[Dict[str, Any]] = []
        for i in range(len(predictions)):
            pred_class = predictions[i].item()
            confidence = confidences[i].item()
            probs = probabilities[i].tolist()

            results.append({
                "class_id": pred_class,
                "class_name": CLASS_LABELS[pred_class],
                "confidence": round(confidence, 6),
                "probabilities": {
                    label: round(prob, 6)
                    for label, prob in zip(CLASS_LABELS, probs)
                }
            })

        return results
