#!/bin/bash

set -e

MODEL_NAME="fault_diagnosis"
MODEL_VERSION="1.0"
MODEL_SERVICE_DIR="../model_service"
MODEL_WEIGHTS="${MODEL_SERVICE_DIR}/weights/fault_diagnosis_model.pth"
MODEL_HANDLER="${MODEL_SERVICE_DIR}/handler.py"
MODEL_FILE="${MODEL_SERVICE_DIR}/model.py"
MODEL_STORE_DIR="../model_store"
REQUIREMENTS_FILE="${MODEL_SERVICE_DIR}/requirements.txt"

echo "=========================================="
echo "模型打包脚本 - 工业设备故障诊断"
echo "=========================================="

if [ ! -f "${MODEL_WEIGHTS}" ]; then
    echo "错误: 模型权重文件不存在: ${MODEL_WEIGHTS}"
    echo "请先运行 generate_dummy_model.py 生成权重文件"
    exit 1
fi

mkdir -p "${MODEL_STORE_DIR}"

if [ -f "${MODEL_STORE_DIR}/${MODEL_NAME}.mar" ]; then
    echo "删除旧的模型归档文件..."
    rm -f "${MODEL_STORE_DIR}/${MODEL_NAME}.mar"
fi

cat > "${REQUIREMENTS_FILE}" << EOF
numpy>=1.21.0
torch>=1.9.0
torchserve>=0.6.0
torch-model-archiver>=0.6.0
EOF

echo "开始打包模型..."
torch-model-archiver \
    --model-name "${MODEL_NAME}" \
    --version "${MODEL_VERSION}" \
    --serialized-file "${MODEL_WEIGHTS}" \
    --handler "${MODEL_HANDLER}" \
    --extra-files "${MODEL_FILE}" \
    --requirements-file "${REQUIREMENTS_FILE}" \
    --export-path "${MODEL_STORE_DIR}" \
    --force

echo ""
echo "模型打包完成!"
echo "模型文件: ${MODEL_STORE_DIR}/${MODEL_NAME}.mar"
echo ""
echo "模型信息:"
echo "  名称: ${MODEL_NAME}"
echo "  版本: ${MODEL_VERSION}"
echo "  输入形状: (B, 1, 10240)"
echo "  输出类别: 4类（正常、轴承故障、齿轮故障、不平衡）"
