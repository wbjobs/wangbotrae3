from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


class FaultDiagnosisCNN(nn.Module):
    """
    工业设备故障诊断1D-CNN模型

    输入形状: (B, 1, 10240)
    输出: 4类分类概率（正常、轴承故障、齿轮故障、不平衡）
    """

    def __init__(self, num_classes: int = 4, dropout_rate: float = 0.5) -> None:
        super().__init__()
        self.num_classes = num_classes
        self.dropout_rate = dropout_rate

        self.conv1 = nn.Conv1d(in_channels=1, out_channels=32, kernel_size=5, padding=2)
        self.bn1 = nn.BatchNorm1d(32)
        self.pool1 = nn.MaxPool1d(kernel_size=2)

        self.conv2 = nn.Conv1d(in_channels=32, out_channels=64, kernel_size=5, padding=2)
        self.bn2 = nn.BatchNorm1d(64)
        self.pool2 = nn.MaxPool1d(kernel_size=2)

        self.conv3 = nn.Conv1d(in_channels=64, out_channels=128, kernel_size=5, padding=2)
        self.bn3 = nn.BatchNorm1d(128)
        self.pool3 = nn.MaxPool1d(kernel_size=2)

        self.global_pool = nn.AdaptiveAvgPool1d(1)
        self.dropout = nn.Dropout(dropout_rate)
        self.fc1 = nn.Linear(128, 256)
        self.fc2 = nn.Linear(256, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.conv1(x)
        x = self.bn1(x)
        x = F.relu(x)
        x = self.pool1(x)

        x = self.conv2(x)
        x = self.bn2(x)
        x = F.relu(x)
        x = self.pool2(x)

        x = self.conv3(x)
        x = self.bn3(x)
        x = F.relu(x)
        x = self.pool3(x)

        x = self.global_pool(x)
        x = x.view(x.size(0), -1)
        x = self.dropout(x)
        x = self.fc1(x)
        x = F.relu(x)
        x = self.fc2(x)

        return x

    def get_loss(self, logits: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        return F.cross_entropy(logits, labels)


if __name__ == "__main__":
    model = FaultDiagnosisCNN()
    batch_size = 8
    dummy_input = torch.randn(batch_size, 1, 10240)
    output = model(dummy_input)
    print(f"输入形状: {dummy_input.shape}")
    print(f"输出形状: {output.shape}")
    assert output.shape == (batch_size, 4), f"输出形状错误，期望 (8, 4)，实际 {output.shape}"
    print("模型前向传播测试通过")
