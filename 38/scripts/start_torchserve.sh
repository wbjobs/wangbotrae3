#!/bin/bash

set -e

MODEL_SERVICE_DIR="../model_service"
CONFIG_FILE="${MODEL_SERVICE_DIR}/config.properties"
MODEL_STORE_DIR="../model_store"
LOG_DIR="../logs"
MODEL_NAME="fault_diagnosis"

echo "=========================================="
echo "启动 TorchServe 服务 - 工业设备故障诊断"
echo "=========================================="

if [ ! -f "${MODEL_STORE_DIR}/${MODEL_NAME}.mar" ]; then
    echo "错误: 模型归档文件不存在: ${MODEL_STORE_DIR}/${MODEL_NAME}.mar"
    echo "请先运行 archive_model.sh 打包模型"
    exit 1
fi

mkdir -p "${LOG_DIR}"
mkdir -p "${MODEL_STORE_DIR}"

echo "停止已有的 TorchServe 服务..."
torchserve --stop || true

echo ""
echo "启动 TorchServe 服务..."
echo "配置文件: ${CONFIG_FILE}"
echo "模型存储: ${MODEL_STORE_DIR}"
echo "日志目录: ${LOG_DIR}"
echo ""

nohup torchserve \
    --start \
    --ts-config "${CONFIG_FILE}" \
    --model-store "${MODEL_STORE_DIR}" \
    --workflow-store "${MODEL_STORE_DIR}" \
    --foreground \
    > "${LOG_DIR}/torchserve.log" 2>&1 &

TORCHSERVE_PID=$!
echo "TorchServe PID: ${TORCHSERVE_PID}"
echo "${TORCHSERVE_PID}" > "${LOG_DIR}/torchserve.pid"

echo ""
echo "等待服务启动..."
sleep 10

echo ""
echo "检查服务状态..."
curl -s http://localhost:8081/models || {
    echo "错误: 服务启动失败，请检查日志: ${LOG_DIR}/torchserve.log"
    exit 1
}

echo ""
echo "=========================================="
echo "TorchServe 服务启动成功!"
echo "=========================================="
echo ""
echo "服务地址:"
echo "  推理API:  http://localhost:8080"
echo "  管理API:  http://localhost:8081"
echo "  指标API:  http://localhost:8082"
echo "  gRPC推理:  localhost:7070"
echo "  gRPC管理:  localhost:7071"
echo ""
echo "模型API:"
echo "  推理:     POST http://localhost:8080/predictions/${MODEL_NAME}"
echo "  描述:     GET  http://localhost:8081/models/${MODEL_NAME}"
echo ""
echo "测试命令:"
echo '  curl -X POST http://localhost:8080/predictions/'"${MODEL_NAME}"' \'
echo '    -H "Content-Type: application/json" \'
echo '    -d @test_data.json'
echo ""
echo "日志文件: ${LOG_DIR}/torchserve.log"
echo "停止服务: torchserve --stop"
echo "=========================================="
