from typing import List, Dict, Any
import uuid


def generate_node_id(prefix: str = "") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def create_network_jitter_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    packet_loss_id = generate_node_id("anomaly")
    delay_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "network_jitter",
        "name": "网络抖动",
        "description": "模拟不稳定网络，包含随机丢包和随机延迟同时发生",
        "category": "network",
        "icon": "WifiOutlined",
        "default_parameters": {
            "loss_rate": 0.15,
            "min_delay_ms": 100,
            "max_delay_ms": 500
        },
        "workflow_data": {
            "name": "网络抖动模板",
            "description": "丢包和延迟组合，模拟不稳定网络",
            "execution_mode": "parallel",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 100, "y": 200},
                    "config": {}
                },
                {
                    "id": packet_loss_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 150},
                    "parallel_group": "parallel_1",
                    "anomaly_config": {
                        "anomaly_type": "packet_loss",
                        "parameters": {"loss_rate": 0.15},
                        "probability": 0.8
                    },
                    "config": {}
                },
                {
                    "id": delay_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 280},
                    "parallel_group": "parallel_1",
                    "anomaly_config": {
                        "anomaly_type": "delay",
                        "parameters": {
                            "min_delay_ms": 100,
                            "max_delay_ms": 500
                        },
                        "probability": 0.6
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 600, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{packet_loss_id}",
                    "source": device_node_id,
                    "target": packet_loss_id
                },
                {
                    "id": f"edge_{device_node_id}_{delay_id}",
                    "source": device_node_id,
                    "target": delay_id
                },
                {
                    "id": f"edge_{packet_loss_id}_{output_id}",
                    "source": packet_loss_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{delay_id}_{output_id}",
                    "source": delay_id,
                    "target": output_id
                }
            ]
        }
    }


def create_sensor_failure_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    condition_id = generate_node_id("condition")
    value_spike_id = generate_node_id("anomaly")
    data_stagnation_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "sensor_failure",
        "name": "传感器故障",
        "description": "当温度异常时，先数值突变，后数据停滞",
        "category": "sensor",
        "icon": "ThunderboltOutlined",
        "default_parameters": {
            "condition": "temperature > 80",
            "spike_factor": 3.0,
            "stagnation_seconds": 5
        },
        "workflow_data": {
            "name": "传感器故障模板",
            "description": "条件触发：数值突变→数据停滞",
            "execution_mode": "sequential",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 100, "y": 200},
                    "config": {}
                },
                {
                    "id": condition_id,
                    "type": "condition",
                    "position": {"x": 300, "y": 200},
                    "config": {"expression": "temperature > 80"}
                },
                {
                    "id": value_spike_id,
                    "type": "anomaly",
                    "position": {"x": 500, "y": 150},
                    "anomaly_config": {
                        "anomaly_type": "value_spike",
                        "parameters": {
                            "spike_factor": 3.0,
                            "affected_metrics": ["temperature"]
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": data_stagnation_id,
                    "type": "anomaly",
                    "position": {"x": 500, "y": 280},
                    "delay_seconds": 2.0,
                    "anomaly_config": {
                        "anomaly_type": "data_stagnation",
                        "parameters": {
                            "stagnation_seconds": 5,
                            "affected_metrics": ["temperature", "humidity"]
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 700, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{condition_id}",
                    "source": device_node_id,
                    "target": condition_id
                },
                {
                    "id": f"edge_{condition_id}_{value_spike_id}",
                    "source": condition_id,
                    "target": value_spike_id
                },
                {
                    "id": f"edge_{condition_id}_{data_stagnation_id}",
                    "source": condition_id,
                    "target": data_stagnation_id,
                    "delay_seconds": 2.0
                },
                {
                    "id": f"edge_{value_spike_id}_{output_id}",
                    "source": value_spike_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{data_stagnation_id}_{output_id}",
                    "source": data_stagnation_id,
                    "target": output_id
                }
            ]
        }
    }


def create_data_quality_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    noise_id = generate_node_id("anomaly")
    drift_id = generate_node_id("anomaly")
    delay_node_id = generate_node_id("delay")
    spike_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "data_quality_issues",
        "name": "数据质量问题",
        "description": "噪声注入 → 2秒后 → 时间戳漂移 → 500ms延迟 → 数值突变",
        "category": "data",
        "icon": "DatabaseOutlined",
        "default_parameters": {
            "noise_level": 0.05,
            "drift_rate_ms": 50,
            "delay_ms": 500,
            "spike_factor": 2.5
        },
        "workflow_data": {
            "name": "数据质量问题模板",
            "description": "异常链：噪声→延迟→漂移→数值突变",
            "execution_mode": "sequential",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 50, "y": 200},
                    "config": {}
                },
                {
                    "id": noise_id,
                    "type": "anomaly",
                    "position": {"x": 200, "y": 200},
                    "anomaly_config": {
                        "anomaly_type": "noise_injection",
                        "parameters": {
                            "noise_level": 0.05,
                            "affected_metrics": ["temperature", "humidity"]
                        },
                        "probability": 0.9
                    },
                    "config": {}
                },
                {
                    "id": delay_node_id,
                    "type": "delay",
                    "position": {"x": 350, "y": 200},
                    "delay_seconds": 2.0,
                    "config": {"delay_seconds": 2.0}
                },
                {
                    "id": drift_id,
                    "type": "anomaly",
                    "position": {"x": 500, "y": 200},
                    "anomaly_config": {
                        "anomaly_type": "timestamp_drift",
                        "parameters": {
                            "drift_rate_ms": 50,
                            "max_drift_ms": 2000
                        },
                        "probability": 0.7
                    },
                    "config": {}
                },
                {
                    "id": spike_id,
                    "type": "anomaly",
                    "position": {"x": 650, "y": 200},
                    "delay_seconds": 0.5,
                    "anomaly_config": {
                        "anomaly_type": "value_spike",
                        "parameters": {
                            "spike_factor": 2.5,
                            "affected_metrics": ["voltage"]
                        },
                        "probability": 0.8
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 800, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{noise_id}",
                    "source": device_node_id,
                    "target": noise_id
                },
                {
                    "id": f"edge_{noise_id}_{delay_node_id}",
                    "source": noise_id,
                    "target": delay_node_id
                },
                {
                    "id": f"edge_{delay_node_id}_{drift_id}",
                    "source": delay_node_id,
                    "target": drift_id
                },
                {
                    "id": f"edge_{drift_id}_{spike_id}",
                    "source": drift_id,
                    "target": spike_id
                },
                {
                    "id": f"edge_{spike_id}_{output_id}",
                    "source": spike_id,
                    "target": output_id
                }
            ]
        }
    }


def create_network_out_of_order_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    packet_loss_id = generate_node_id("anomaly")
    out_of_order_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "network_congestion",
        "name": "网络拥塞",
        "description": "模拟高负载网络，乱序+丢包同时生效",
        "category": "network",
        "icon": "LoadingOutlined",
        "default_parameters": {
            "loss_rate": 0.2,
            "window_size": 8,
            "reorder_probability": 0.5
        },
        "workflow_data": {
            "name": "网络拥塞模板",
            "description": "混合模式：乱序和丢包同时注入",
            "execution_mode": "parallel",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 100, "y": 200},
                    "config": {}
                },
                {
                    "id": packet_loss_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 150},
                    "parallel_group": "parallel_1",
                    "anomaly_config": {
                        "anomaly_type": "packet_loss",
                        "parameters": {"loss_rate": 0.2},
                        "probability": 0.7
                    },
                    "config": {}
                },
                {
                    "id": out_of_order_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 280},
                    "parallel_group": "parallel_1",
                    "anomaly_config": {
                        "anomaly_type": "out_of_order",
                        "parameters": {
                            "window_size": 8,
                            "reorder_probability": 0.5
                        },
                        "probability": 0.6
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 600, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{packet_loss_id}",
                    "source": device_node_id,
                    "target": packet_loss_id
                },
                {
                    "id": f"edge_{device_node_id}_{out_of_order_id}",
                    "source": device_node_id,
                    "target": out_of_order_id
                },
                {
                    "id": f"edge_{packet_loss_id}_{output_id}",
                    "source": packet_loss_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{out_of_order_id}_{output_id}",
                    "source": out_of_order_id,
                    "target": output_id
                }
            ]
        }
    }


def create_power_fluctuation_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    delay1_id = generate_node_id("delay")
    voltage_spike_id = generate_node_id("anomaly")
    delay2_id = generate_node_id("delay")
    voltage_drop_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "power_fluctuation",
        "name": "电源波动",
        "description": "模拟供电不稳：电压突变→1秒后→电压骤降",
        "category": "hardware",
        "icon": "BulbOutlined",
        "default_parameters": {
            "spike_factor": 1.8,
            "drop_factor": 0.6
        },
        "workflow_data": {
            "name": "电源波动模板",
            "description": "异常链：电压突变→延迟→电压骤降",
            "execution_mode": "sequential",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 50, "y": 200},
                    "config": {}
                },
                {
                    "id": voltage_spike_id,
                    "type": "anomaly",
                    "position": {"x": 200, "y": 200},
                    "anomaly_config": {
                        "anomaly_type": "value_spike",
                        "parameters": {
                            "spike_factor": 1.8,
                            "affected_metrics": ["voltage"]
                        },
                        "probability": 0.9
                    },
                    "config": {}
                },
                {
                    "id": delay1_id,
                    "type": "delay",
                    "position": {"x": 350, "y": 200},
                    "delay_seconds": 1.0,
                    "config": {"delay_seconds": 1.0}
                },
                {
                    "id": voltage_drop_id,
                    "type": "anomaly",
                    "position": {"x": 500, "y": 200},
                    "anomaly_config": {
                        "anomaly_type": "value_drift",
                        "parameters": {
                            "drift_rate": -0.4,
                            "affected_metrics": ["voltage"]
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": delay2_id,
                    "type": "delay",
                    "position": {"x": 650, "y": 200},
                    "delay_seconds": 3.0,
                    "config": {"delay_seconds": 3.0}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 800, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{voltage_spike_id}",
                    "source": device_node_id,
                    "target": voltage_spike_id
                },
                {
                    "id": f"edge_{voltage_spike_id}_{delay1_id}",
                    "source": voltage_spike_id,
                    "target": delay1_id
                },
                {
                    "id": f"edge_{delay1_id}_{voltage_drop_id}",
                    "source": delay1_id,
                    "target": voltage_drop_id
                },
                {
                    "id": f"edge_{voltage_drop_id}_{delay2_id}",
                    "source": voltage_drop_id,
                    "target": delay2_id
                },
                {
                    "id": f"edge_{delay2_id}_{output_id}",
                    "source": delay2_id,
                    "target": output_id
                }
            ]
        }
    }


def create_anomaly_chain_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    packet_loss_id = generate_node_id("anomaly")
    delay_node_id = generate_node_id("delay")
    delay_id = generate_node_id("anomaly")
    value_spike_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "anomaly_chain",
        "name": "异常链编排",
        "description": "丢包30% → 2秒后延迟500ms → 同时注入数值突变",
        "category": "custom",
        "icon": "ApartmentOutlined",
        "default_parameters": {
            "loss_rate": 0.3,
            "chain_delay": 2.0,
            "delay_ms": 500,
            "spike_factor": 3.0
        },
        "workflow_data": {
            "name": "异常链编排模板",
            "description": "链式异常：丢包→延迟→数值突变",
            "execution_mode": "sequential",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 50, "y": 200},
                    "config": {}
                },
                {
                    "id": packet_loss_id,
                    "type": "anomaly",
                    "position": {"x": 200, "y": 200},
                    "anomaly_config": {
                        "anomaly_type": "packet_loss",
                        "parameters": {"loss_rate": 0.3},
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": delay_node_id,
                    "type": "delay",
                    "position": {"x": 350, "y": 200},
                    "delay_seconds": 2.0,
                    "config": {"delay_seconds": 2.0}
                },
                {
                    "id": delay_id,
                    "type": "anomaly",
                    "position": {"x": 500, "y": 150},
                    "parallel_group": "chain_parallel_1",
                    "anomaly_config": {
                        "anomaly_type": "delay",
                        "parameters": {
                            "min_delay": 0.5,
                            "max_delay": 0.5
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": value_spike_id,
                    "type": "anomaly",
                    "position": {"x": 500, "y": 280},
                    "parallel_group": "chain_parallel_1",
                    "anomaly_config": {
                        "anomaly_type": "value_spike",
                        "parameters": {
                            "spike_factor": 3.0,
                            "spike_probability": 1.0,
                            "affected_metrics": ["temperature", "voltage"]
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 700, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{packet_loss_id}",
                    "source": device_node_id,
                    "target": packet_loss_id
                },
                {
                    "id": f"edge_{packet_loss_id}_{delay_node_id}",
                    "source": packet_loss_id,
                    "target": delay_node_id
                },
                {
                    "id": f"edge_{delay_node_id}_{delay_id}",
                    "source": delay_node_id,
                    "target": delay_id
                },
                {
                    "id": f"edge_{delay_node_id}_{value_spike_id}",
                    "source": delay_node_id,
                    "target": value_spike_id
                },
                {
                    "id": f"edge_{delay_id}_{output_id}",
                    "source": delay_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{value_spike_id}_{output_id}",
                    "source": value_spike_id,
                    "target": output_id
                }
            ]
        }
    }


def create_mixed_mode_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    out_of_order_id = generate_node_id("anomaly")
    packet_loss_id = generate_node_id("anomaly")
    noise_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "mixed_mode",
        "name": "混合模式",
        "description": "乱序+丢包+噪声同时生效，模拟复杂网络环境",
        "category": "network",
        "icon": "CloudServerOutlined",
        "default_parameters": {
            "loss_rate": 0.15,
            "window_size": 8,
            "reorder_probability": 0.4,
            "noise_level": 0.3
        },
        "workflow_data": {
            "name": "混合模式模板",
            "description": "并行异常：乱序+丢包+噪声",
            "execution_mode": "parallel",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 100, "y": 200},
                    "config": {}
                },
                {
                    "id": out_of_order_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 100},
                    "parallel_group": "mixed_1",
                    "anomaly_config": {
                        "anomaly_type": "out_of_order",
                        "parameters": {
                            "window_size": 8,
                            "reorder_probability": 0.4
                        },
                        "probability": 0.8
                    },
                    "config": {}
                },
                {
                    "id": packet_loss_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 220},
                    "parallel_group": "mixed_1",
                    "anomaly_config": {
                        "anomaly_type": "packet_loss",
                        "parameters": {"loss_rate": 0.15},
                        "probability": 0.7
                    },
                    "config": {}
                },
                {
                    "id": noise_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 340},
                    "parallel_group": "mixed_1",
                    "anomaly_config": {
                        "anomaly_type": "noise_injection",
                        "parameters": {
                            "noise_level": 0.3,
                            "affected_metrics": ["temperature", "humidity", "voltage"]
                        },
                        "probability": 0.9
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 600, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{out_of_order_id}",
                    "source": device_node_id,
                    "target": out_of_order_id
                },
                {
                    "id": f"edge_{device_node_id}_{packet_loss_id}",
                    "source": device_node_id,
                    "target": packet_loss_id
                },
                {
                    "id": f"edge_{device_node_id}_{noise_id}",
                    "source": device_node_id,
                    "target": noise_id
                },
                {
                    "id": f"edge_{out_of_order_id}_{output_id}",
                    "source": out_of_order_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{packet_loss_id}_{output_id}",
                    "source": packet_loss_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{noise_id}_{output_id}",
                    "source": noise_id,
                    "target": output_id
                }
            ]
        }
    }


def create_sensor_drift_failure_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    condition_id = generate_node_id("condition")
    value_drift_id = generate_node_id("anomaly")
    delay_node_id = generate_node_id("delay")
    data_stagnation_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "sensor_drift_failure",
        "name": "传感器漂移故障",
        "description": "当温度过高时：数值漂移→3秒后→数据完全停滞",
        "category": "sensor",
        "icon": "WarningOutlined",
        "default_parameters": {
            "condition": "temperature > 75",
            "drift_rate": 0.5,
            "stagnation_duration": 10
        },
        "workflow_data": {
            "name": "传感器漂移故障模板",
            "description": "条件触发：漂移→延迟→停滞",
            "execution_mode": "sequential",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 50, "y": 200},
                    "config": {}
                },
                {
                    "id": condition_id,
                    "type": "condition",
                    "position": {"x": 200, "y": 200},
                    "config": {"expression": "temperature > 75"}
                },
                {
                    "id": value_drift_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 200},
                    "anomaly_config": {
                        "anomaly_type": "value_drift",
                        "parameters": {
                            "drift_rate": 0.5,
                            "affected_metrics": ["temperature"]
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": delay_node_id,
                    "type": "delay",
                    "position": {"x": 500, "y": 200},
                    "delay_seconds": 3.0,
                    "config": {"delay_seconds": 3.0}
                },
                {
                    "id": data_stagnation_id,
                    "type": "anomaly",
                    "position": {"x": 650, "y": 200},
                    "anomaly_config": {
                        "anomaly_type": "data_stagnation",
                        "parameters": {
                            "stagnation_probability": 1.0,
                            "stagnation_duration": 10
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 800, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{condition_id}",
                    "source": device_node_id,
                    "target": condition_id
                },
                {
                    "id": f"edge_{condition_id}_{value_drift_id}",
                    "source": condition_id,
                    "target": value_drift_id
                },
                {
                    "id": f"edge_{value_drift_id}_{delay_node_id}",
                    "source": value_drift_id,
                    "target": delay_node_id
                },
                {
                    "id": f"edge_{delay_node_id}_{data_stagnation_id}",
                    "source": delay_node_id,
                    "target": data_stagnation_id
                },
                {
                    "id": f"edge_{data_stagnation_id}_{output_id}",
                    "source": data_stagnation_id,
                    "target": output_id
                }
            ]
        }
    }


def create_network_storm_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    delay1_id = generate_node_id("anomaly")
    packet_loss1_id = generate_node_id("anomaly")
    delay_node_id = generate_node_id("delay")
    out_of_order_id = generate_node_id("anomaly")
    packet_loss2_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "network_storm",
        "name": "网络风暴",
        "description": "分阶段网络恶化：延迟+丢包→暂停→乱序+高丢包",
        "category": "network",
        "icon": "CloudOutlined",
        "default_parameters": {
            "phase1_delay": 1000,
            "phase1_loss": 0.2,
            "pause_seconds": 5,
            "phase2_reorder": 0.7,
            "phase2_loss": 0.4
        },
        "workflow_data": {
            "name": "网络风暴模板",
            "description": "多阶段网络异常模拟",
            "execution_mode": "mixed",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 50, "y": 200},
                    "config": {}
                },
                {
                    "id": delay1_id,
                    "type": "anomaly",
                    "position": {"x": 200, "y": 140},
                    "parallel_group": "phase1",
                    "anomaly_config": {
                        "anomaly_type": "delay",
                        "parameters": {
                            "min_delay": 0.5,
                            "max_delay": 1.5
                        },
                        "probability": 0.8
                    },
                    "config": {}
                },
                {
                    "id": packet_loss1_id,
                    "type": "anomaly",
                    "position": {"x": 200, "y": 260},
                    "parallel_group": "phase1",
                    "anomaly_config": {
                        "anomaly_type": "packet_loss",
                        "parameters": {"loss_rate": 0.2},
                        "probability": 0.6
                    },
                    "config": {}
                },
                {
                    "id": delay_node_id,
                    "type": "delay",
                    "position": {"x": 380, "y": 200},
                    "delay_seconds": 5.0,
                    "config": {"delay_seconds": 5.0}
                },
                {
                    "id": out_of_order_id,
                    "type": "anomaly",
                    "position": {"x": 560, "y": 140},
                    "parallel_group": "phase2",
                    "anomaly_config": {
                        "anomaly_type": "out_of_order",
                        "parameters": {
                            "window_size": 10,
                            "reorder_probability": 0.7
                        },
                        "probability": 0.9
                    },
                    "config": {}
                },
                {
                    "id": packet_loss2_id,
                    "type": "anomaly",
                    "position": {"x": 560, "y": 260},
                    "parallel_group": "phase2",
                    "anomaly_config": {
                        "anomaly_type": "packet_loss",
                        "parameters": {"loss_rate": 0.4},
                        "probability": 0.8
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 750, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{delay1_id}",
                    "source": device_node_id,
                    "target": delay1_id
                },
                {
                    "id": f"edge_{device_node_id}_{packet_loss1_id}",
                    "source": device_node_id,
                    "target": packet_loss1_id
                },
                {
                    "id": f"edge_{delay1_id}_{delay_node_id}",
                    "source": delay1_id,
                    "target": delay_node_id
                },
                {
                    "id": f"edge_{packet_loss1_id}_{delay_node_id}",
                    "source": packet_loss1_id,
                    "target": delay_node_id
                },
                {
                    "id": f"edge_{delay_node_id}_{out_of_order_id}",
                    "source": delay_node_id,
                    "target": out_of_order_id
                },
                {
                    "id": f"edge_{delay_node_id}_{packet_loss2_id}",
                    "source": delay_node_id,
                    "target": packet_loss2_id
                },
                {
                    "id": f"edge_{out_of_order_id}_{output_id}",
                    "source": out_of_order_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{packet_loss2_id}_{output_id}",
                    "source": packet_loss2_id,
                    "target": output_id
                }
            ]
        }
    }


def create_hardware_degradation_template() -> Dict[str, Any]:
    device_node_id = generate_node_id("device")
    noise_id = generate_node_id("anomaly")
    timestamp_drift_id = generate_node_id("anomaly")
    value_drift_id = generate_node_id("anomaly")
    output_id = generate_node_id("output")

    return {
        "template_id": "hardware_degradation",
        "name": "硬件老化",
        "description": "渐进式硬件老化：噪声增大+时间戳漂移+数值偏移同时发生",
        "category": "hardware",
        "icon": "ToolOutlined",
        "default_parameters": {
            "noise_level": 0.8,
            "drift_seconds": 2.0,
            "value_drift_rate": 0.2
        },
        "workflow_data": {
            "name": "硬件老化模板",
            "description": "并行异常模拟硬件老化",
            "execution_mode": "parallel",
            "device_ids": [],
            "nodes": [
                {
                    "id": device_node_id,
                    "type": "device",
                    "position": {"x": 100, "y": 200},
                    "config": {}
                },
                {
                    "id": noise_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 100},
                    "parallel_group": "degradation",
                    "anomaly_config": {
                        "anomaly_type": "noise_injection",
                        "parameters": {
                            "noise_level": 0.8,
                            "affected_metrics": ["temperature", "humidity", "voltage", "current"]
                        },
                        "probability": 1.0
                    },
                    "config": {}
                },
                {
                    "id": timestamp_drift_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 220},
                    "parallel_group": "degradation",
                    "anomaly_config": {
                        "anomaly_type": "timestamp_drift",
                        "parameters": {
                            "drift_seconds": 2.0,
                            "gradual": True
                        },
                        "probability": 0.9
                    },
                    "config": {}
                },
                {
                    "id": value_drift_id,
                    "type": "anomaly",
                    "position": {"x": 350, "y": 340},
                    "parallel_group": "degradation",
                    "anomaly_config": {
                        "anomaly_type": "value_drift",
                        "parameters": {
                            "drift_rate": 0.2,
                            "affected_metrics": ["voltage", "current"]
                        },
                        "probability": 0.95
                    },
                    "config": {}
                },
                {
                    "id": output_id,
                    "type": "output",
                    "position": {"x": 600, "y": 200},
                    "config": {}
                }
            ],
            "edges": [
                {
                    "id": f"edge_{device_node_id}_{noise_id}",
                    "source": device_node_id,
                    "target": noise_id
                },
                {
                    "id": f"edge_{device_node_id}_{timestamp_drift_id}",
                    "source": device_node_id,
                    "target": timestamp_drift_id
                },
                {
                    "id": f"edge_{device_node_id}_{value_drift_id}",
                    "source": device_node_id,
                    "target": value_drift_id
                },
                {
                    "id": f"edge_{noise_id}_{output_id}",
                    "source": noise_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{timestamp_drift_id}_{output_id}",
                    "source": timestamp_drift_id,
                    "target": output_id
                },
                {
                    "id": f"edge_{value_drift_id}_{output_id}",
                    "source": value_drift_id,
                    "target": output_id
                }
            ]
        }
    }


def get_builtin_templates() -> List[Dict[str, Any]]:
    return [
        create_anomaly_chain_template(),
        create_mixed_mode_template(),
        create_network_jitter_template(),
        create_sensor_failure_template(),
        create_sensor_drift_failure_template(),
        create_data_quality_template(),
        create_network_out_of_order_template(),
        create_network_storm_template(),
        create_power_fluctuation_template(),
        create_hardware_degradation_template()
    ]
