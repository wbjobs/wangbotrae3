#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
快速演示脚本 - 创建测试设备和异常注入
使用方法: python test_demo.py
"""

import asyncio
import httpx
import time
from datetime import datetime, timezone, timedelta

BASE_URL = "http://localhost:8000"


async def create_demo_devices():
    """创建演示设备"""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        print("=" * 60)
        print("创建演示设备...")
        print("=" * 60)
        
        devices = [
            {
                "device_id": "sensor-factory-001",
                "metrics": ["temperature", "humidity", "voltage"],
                "interval": 1.0,
                "temperature_base": 25.0,
                "temperature_variance": 2.0,
                "humidity_base": 50.0,
                "humidity_variance": 5.0,
                "voltage_base": 3.7,
                "voltage_variance": 0.1,
                "current_base": 0.5,
                "current_variance": 0.05,
                "pressure_base": 1013.25,
                "pressure_variance": 5.0
            },
            {
                "device_id": "sensor-outdoor-001",
                "metrics": ["temperature", "humidity", "pressure"],
                "interval": 2.0,
                "temperature_base": 22.0,
                "temperature_variance": 3.0,
                "humidity_base": 60.0,
                "humidity_variance": 8.0,
                "voltage_base": 5.0,
                "voltage_variance": 0.2,
                "current_base": 0.3,
                "current_variance": 0.02,
                "pressure_base": 1010.0,
                "pressure_variance": 10.0
            },
            {
                "device_id": "sensor-machine-001",
                "metrics": ["temperature", "voltage", "current"],
                "interval": 0.5,
                "temperature_base": 45.0,
                "temperature_variance": 5.0,
                "humidity_base": 40.0,
                "humidity_variance": 3.0,
                "voltage_base": 24.0,
                "voltage_variance": 0.5,
                "current_base": 2.5,
                "current_variance": 0.3,
                "pressure_base": 1013.25,
                "pressure_variance": 5.0
            }
        ]
        
        for device in devices:
            try:
                response = await client.post("/devices", json=device)
                if response.status_code == 200:
                    print(f"✅ 创建设备成功: {device['device_id']}")
                elif response.status_code == 400:
                    print(f"ℹ️  设备已存在: {device['device_id']}")
                else:
                    print(f"❌ 创建设备失败: {device['device_id']} - {response.text}")
            except Exception as e:
                print(f"❌ 连接错误: {e}")
        
        print()


async def start_devices():
    """启动所有设备"""
    print("=" * 60)
    print("启动设备模拟...")
    print("=" * 60)
    
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        try:
            response = await client.post("/devices/start-all")
            if response.status_code == 200:
                print("✅ 所有设备已启动")
            else:
                print(f"❌ 启动失败: {response.text}")
        except Exception as e:
            print(f"❌ 连接错误: {e}")
    
    print()


async def inject_anomalies():
    """注入异常"""
    print("=" * 60)
    print("注入异常配置...")
    print("=" * 60)
    
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        anomalies = [
            {
                "device_id": "sensor-factory-001",
                "config": {
                    "anomaly_type": "value_spike",
                    "parameters": {
                        "spike_factor": 3.0,
                        "spike_probability": 0.05,
                        "affected_metrics": ["temperature", "voltage"]
                    },
                    "probability": 1.0
                }
            },
            {
                "device_id": "sensor-factory-001",
                "config": {
                    "anomaly_type": "delay",
                    "parameters": {
                        "min_delay": 0.5,
                        "max_delay": 2.0
                    },
                    "probability": 0.2
                }
            },
            {
                "device_id": "sensor-outdoor-001",
                "config": {
                    "anomaly_type": "packet_loss",
                    "parameters": {
                        "loss_rate": 0.1
                    },
                    "probability": 1.0
                }
            },
            {
                "device_id": "sensor-machine-001",
                "config": {
                    "anomaly_type": "temperature_drift",
                    "parameters": {
                        "drift_rate": 0.1,
                        "affected_metrics": ["temperature"]
                    },
                    "probability": 1.0
                }
            },
            {
                "device_id": "sensor-machine-001",
                "config": {
                    "anomaly_type": "noise_injection",
                    "parameters": {
                        "noise_level": 0.8,
                        "affected_metrics": ["voltage", "current"]
                    },
                    "probability": 0.5
                }
            }
        ]
        
        for anomaly in anomalies:
            try:
                response = await client.post(
                    f"/devices/{anomaly['device_id']}/anomalies",
                    json=anomaly["config"]
                )
                if response.status_code == 200:
                    print(f"✅ 注入异常成功: {anomaly['device_id']} - {anomaly['config']['anomaly_type']}")
                else:
                    print(f"❌ 注入失败: {anomaly['device_id']} - {response.text}")
            except Exception as e:
                print(f"❌ 连接错误: {e}")
    
    print()


async def show_status():
    """显示当前状态"""
    print("=" * 60)
    print("系统状态")
    print("=" * 60)
    
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        try:
            response = await client.get("/devices")
            devices = response.json()
            print(f"\n设备列表:")
            for device in devices:
                status_resp = await client.get(f"/devices/{device['device_id']}/status")
                status = status_resp.json()
                anomalies_resp = await client.get(f"/devices/{device['device_id']}/anomalies")
                anomalies = anomalies_resp.json()
                
                status_text = "运行中" if status["is_running"] else "已停止"
                status_color = "🟢" if status["is_running"] else "🔴"
                
                print(f"\n  {status_color} {device['device_id']} - {status_text}")
                print(f"    指标: {', '.join(device['metrics'])}")
                print(f"    已处理: {status['stats']['processed']} | 已注入: {status['stats']['injected']}")
                if anomalies:
                    print(f"    异常: {', '.join([a['anomaly_type'] for a in anomalies])}")
                else:
                    print(f"    异常: 无")
            
            events_resp = await client.get("/anomaly-events?limit=10")
            events = events_resp.json()
            print(f"\n\n最近异常事件 ({len(events)} 条):")
            for event in events[:10]:
                print(f"  ⚡ {event['timestamp']} - {event['device_id']} - {event['anomaly_type']}")
                
        except Exception as e:
            print(f"❌ 获取状态失败: {e}")
    
    print()


async def main():
    print("\n" + "=" * 60)
    print("混沌测试平台 - 快速演示脚本")
    print("=" * 60)
    print()
    
    # 等待服务就绪
    print("等待服务就绪...")
    for i in range(30):
        try:
            async with httpx.AsyncClient(base_url=BASE_URL) as client:
                response = await client.get("/health")
                if response.status_code == 200:
                    print("✅ 服务已就绪!")
                    break
        except:
            pass
        time.sleep(1)
        print(f"  等待中... ({i+1}/30)")
    else:
        print("❌ 服务超时未就绪，请先启动服务")
        print("  运行: docker-compose up -d")
        return
    
    print()
    
    await create_demo_devices()
    await start_devices()
    await inject_anomalies()
    
    print("等待数据生成...")
    await asyncio.sleep(10)
    
    await show_status()
    
    print("=" * 60)
    print("演示完成!")
    print("=" * 60)
    print()
    print("接下来可以:")
    print("  1. 打开 http://localhost:3000 查看前端界面")
    print("  2. 访问 http://localhost:8000/docs 查看API文档")
    print("  3. 在 '异常编排' 页面创建更复杂的工作流")
    print("  4. 在 '时间旅行' 页面回放历史数据")
    print()


if __name__ == "__main__":
    asyncio.run(main())
