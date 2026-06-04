import os
from typing import Tuple

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import numpy as np

from model import FaultDiagnosisCNN


class DummySignalDataset(Dataset):
    """
    模拟信号数据集，用于生成示例权重
    """

    def __init__(self, num_samples: int = 100, signal_length: int = 10240, num_classes: int = 4) -> None:
        self.num_samples = num_samples
        self.signal_length = signal_length
        self.num_classes = num_classes

    def __len__(self) -> int:
        return self.num_samples

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        class_idx = idx % self.num_classes
        signal = np.random.randn(1, self.signal_length).astype(np.float32)

        if class_idx == 0:
            signal = signal * 0.5
        elif class_idx == 1:
            signal = signal * 1.5 + np.sin(np.linspace(0, 100, self.signal_length).astype(np.float32)
        elif class_idx == 2:
            signal = signal * 2.0 + np.cos(np.linspace(0, 50, self.signal_length)).astype(np.float32)
        else:
            signal = signal * 1.0 + np.sin(np.linspace(0, 200, self.signal_length)).astype(np.float32)

        mean = np.mean(signal)
        std = np.std(signal) + 1e-8
        signal = (signal - mean) / std

        return torch.from_numpy(signal), torch.tensor(class_idx, dtype=torch.long)


def generate_dummy_model(output_path: str, num_epochs: int = 5) -> None:
    """
    生成示例权重文件

    Args:
        output_path: 权重文件输出路径
        num_epochs: 训练轮数
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"使用设备: {device}")

    model = FaultDiagnosisCNN().to(device)

    dataset = DummySignalDataset(num_samples=200)
    dataloader = DataLoader(dataset, batch_size=16, shuffle=True)

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    model.train()
    for epoch in range(num_epochs):
        running_loss = 0.0
        correct = 0
        total = 0

        for signals, labels in dataloader:
            signals = signals.to(device)
            labels = labels.to(device)

            optimizer.zero_grad()
            outputs = model(signals)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            running_loss += loss.item()
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()

        epoch_loss = running_loss / len(dataloader)
        epoch_acc = correct / total
        print(f"Epoch [{epoch+1}/{num_epochs}], Loss: {epoch_loss:.4f}, Accuracy: {epoch_acc:.4f}")

    model.eval()
    model.to("cpu")
    torch.save(model.state_dict(), output_path)
    print(f"\n模型权重已保存至: {output_path}")

    file_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"权重文件大小: {file_size:.2f} MB")

    dummy_input = torch.randn(1, 1, 10240)
    output = model(dummy_input)
    print(f"模型推理测试 - 输入形状: {dummy_input.shape}, 输出形状: {output.shape}")


if __name__ == "__main__":
    os.makedirs("weights", exist_ok=True)
    output_path = os.path.join("weights", "fault_diagnosis_model.pth")
    generate_dummy_model(output_path, num_epochs=3)
