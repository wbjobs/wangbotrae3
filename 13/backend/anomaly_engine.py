import asyncio
import logging
import random
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Callable, Any, Tuple
from collections import deque
import uuid

from models import (
    DeviceData, AnomalyConfig, AnomalyEvent, AnomalyType,
    Workflow, WorkflowNode, WorkflowEdge, DataPoint
)

logger = logging.getLogger("anomaly_engine")


class WorkflowExecutor:
    def __init__(self, injector: 'AnomalyInjector'):
        self._injector = injector
        self._workflow_states: Dict[str, Dict[str, Any]] = {}
        self._node_execution_history: Dict[str, List[Dict[str, Any]]] = {}
        self._edge_delay_states: Dict[str, Dict[str, float]] = {}

    def _build_execution_graph(
        self, nodes: List[WorkflowNode], edges: List[WorkflowEdge]
    ) -> Dict[str, Any]:
        node_map = {node.id: node for node in nodes}
        outgoing_edges: Dict[str, List[WorkflowEdge]] = {node.id: [] for node in nodes}
        incoming_edges: Dict[str, List[WorkflowEdge]] = {node.id: [] for node in nodes}
        
        for edge in edges:
            if edge.source in outgoing_edges and edge.target in incoming_edges:
                outgoing_edges[edge.source].append(edge)
                incoming_edges[edge.target].append(edge)
        
        return {
            "node_map": node_map,
            "outgoing_edges": outgoing_edges,
            "incoming_edges": incoming_edges
        }

    def _get_start_nodes(
        self, nodes: List[WorkflowNode], incoming_edges: Dict[str, List[WorkflowEdge]]
    ) -> List[WorkflowNode]:
        return [node for node in nodes if len(incoming_edges[node.id]) == 0]

    def _group_parallel_nodes_by_group(
        self, nodes: List[WorkflowNode]
    ) -> Dict[str, List[WorkflowNode]]:
        groups: Dict[str, List[WorkflowNode]] = {}
        
        for node in nodes:
            if node.parallel_group:
                if node.parallel_group not in groups:
                    groups[node.parallel_group] = []
                groups[node.parallel_group].append(node)
        
        return groups

    async def _execute_with_chaining(
        self,
        node_id: str,
        graph: Dict[str, Any],
        data: DeviceData,
        context: Dict[str, Any],
        visited: set,
        path_delays: Dict[str, float]
    ) -> Tuple[Optional[DeviceData], bool, List[AnomalyEvent]]:
        if node_id in visited:
            return data, False, []
        
        visited.add(node_id)
        node_map = graph["node_map"]
        outgoing_edges = graph["outgoing_edges"]
        
        node = node_map[node_id]
        all_events: List[AnomalyEvent] = []
        
        accumulated_delay = path_delays.get(node_id, 0)
        if accumulated_delay > 0:
            await asyncio.sleep(accumulated_delay)
            all_events.append(
                self._injector._create_anomaly_event(
                    data.device_id, "chain_delay",
                    original_value=0,
                    injected_value=accumulated_delay,
                    parameters={"node_id": node_id, "delay_source": "chain"}
                )
            )
        
        result, was_injected, node_events = await self._execute_node(node, data, context)
        all_events.extend(node_events)
        
        if result is None:
            return None, True, all_events
        
        was_injected_any = was_injected
        
        edges = outgoing_edges[node_id]
        if len(edges) == 0:
            return result, was_injected_any, all_events
        
        parallel_groups = self._group_parallel_nodes_by_group([
            node_map[edge.target] for edge in edges if node_map[edge.target].parallel_group
        ])
        
        sequential_targets = [
            edge for edge in edges if not node_map[edge.target].parallel_group
        ]
        
        for group_name, group_nodes in parallel_groups.items():
            group_edge = next(
                (e for e in edges if node_map[e.target].parallel_group == group_name),
                None
            )
            if group_edge:
                parallel_results = await asyncio.gather(
                    *[
                        self._execute_with_chaining(
                            n.id,
                            graph,
                            result,
                            context,
                            set(visited),
                            {n.id: group_edge.delay_seconds or 0}
                        ) for n in group_nodes
                    ]
                )
                
                combined_result = result
                any_lost = False
                
                for pr, pi, pe in parallel_results:
                    if pr is None:
                        any_lost = True
                    else:
                        combined_result = pr
                    was_injected_any = was_injected_any or pi
                    all_events.extend(pe)
                
                if any_lost:
                    return None, True, all_events
                
                result = combined_result
        
        for edge in sequential_targets:
            edge_delay = edge.delay_seconds or 0
            
            if edge.condition and not self._evaluate_condition(edge.condition, result, context):
                all_events.append(
                    self._injector._create_anomaly_event(
                        data.device_id, "edge_condition_skipped",
                        original_value=edge.condition,
                        injected_value=False,
                        parameters={"edge_id": edge.id, "condition": edge.condition}
                    )
                )
                continue
            
            path_delays_new = {edge.target: edge_delay}
            target_result, target_injected, target_events = await self._execute_with_chaining(
                edge.target, graph, result, context, set(visited), path_delays_new
            )
            all_events.extend(target_events)
            
            if target_result is None:
                return None, True, all_events
            
            result = target_result
            was_injected_any = was_injected_any or target_injected
        
        return result, was_injected_any, all_events

    def _evaluate_condition(
        self, condition: Optional[str], data: DeviceData, context: Dict[str, Any]
    ) -> bool:
        if not condition:
            return True
        
        try:
            data_dict = data.model_dump()
            eval_context = {**context, **data_dict, "data": data}
            return bool(eval(condition, {"__builtins__": {}}, eval_context))
        except Exception as e:
            logger.warning(f"Condition evaluation failed: {condition}, error: {e}")
            return True

    async def _execute_node(
        self, node: WorkflowNode, data: DeviceData, context: Dict[str, Any]
    ) -> Tuple[Optional[DeviceData], bool, List[AnomalyEvent]]:
        events: List[AnomalyEvent] = []
        
        if node.delay_seconds and node.delay_seconds > 0:
            await asyncio.sleep(node.delay_seconds)
            events.append(
                self._injector._create_anomaly_event(
                    data.device_id, "node_delay",
                    original_value=0,
                    injected_value=node.delay_seconds,
                    parameters={"node_id": node.id, "node_type": node.type}
                )
            )
        
        if not self._evaluate_condition(node.condition_expression, data, context):
            return data, False, events
        
        if node.type == "anomaly" and node.anomaly_config:
            anomaly_type = node.anomaly_config.anomaly_type
            params = node.anomaly_config.parameters
            result = data
            injected = False
            
            try:
                if anomaly_type == "packet_loss":
                    result, injected = self._injector._apply_packet_loss(result, params)
                elif anomaly_type == "delay":
                    result, injected = self._injector._apply_delay(result, params)
                elif anomaly_type == "out_of_order":
                    result, injected = self._injector._apply_out_of_order(result, params, data.device_id)
                elif anomaly_type == "value_spike":
                    result, injected = self._injector._apply_value_spike(result, params)
                elif anomaly_type == "timestamp_drift":
                    result, injected = self._injector._apply_timestamp_drift(result, params)
                elif anomaly_type == "value_drift":
                    result, injected = self._injector._apply_value_drift(result, params)
                elif anomaly_type == "data_stagnation":
                    result, injected = self._injector._apply_data_stagnation(result, params, data.device_id)
                elif anomaly_type == "noise_injection":
                    result, injected = self._injector._apply_noise_injection(result, params)
            except Exception as e:
                logger.error(f"Error executing anomaly node {node.id}: {e}")
            
            return result, injected, events
        
        elif node.type == "delay":
            delay = node.config.get("delay_seconds", 1.0)
            await asyncio.sleep(delay)
            events.append(
                self._injector._create_anomaly_event(
                    data.device_id, "delay_node",
                    original_value=0,
                    injected_value=delay,
                    parameters={"node_id": node.id}
                )
            )
            return data, True, events
        
        elif node.type == "condition":
            condition = node.config.get("expression", "True")
            passed = self._evaluate_condition(condition, data, context)
            events.append(
                self._injector._create_anomaly_event(
                    data.device_id, "condition_node",
                    original_value=condition,
                    injected_value=passed,
                    parameters={"node_id": node.id, "condition": condition}
                )
            )
            return data, passed, events
        
        elif node.type == "parallel" or node.type == "branch":
            return data, False, events
        
        elif node.type == "device" or node.type == "input":
            return data, False, events
        
        elif node.type == "output":
            return data, False, events
        
        return data, False, events

    async def execute_workflow(
        self, workflow: Workflow, data: DeviceData
    ) -> Tuple[Optional[DeviceData], bool]:
        workflow_id = workflow.id or "default"
        if workflow_id not in self._workflow_states:
            self._workflow_states[workflow_id] = {
                "execution_count": 0,
                "node_results": {}
            }
        
        state = self._workflow_states[workflow_id]
        context = {
            "workflow_id": workflow_id,
            "execution_count": state["execution_count"],
            "device_id": data.device_id,
            "execution_mode": workflow.execution_mode,
        }
        
        graph = self._build_execution_graph(workflow.nodes, workflow.edges)
        start_nodes = self._get_start_nodes(workflow.nodes, graph["incoming_edges"])
        
        result = data
        was_injected = False
        
        for start_node in start_nodes:
            node_result, node_injected, _ = await self._execute_with_chaining(
                start_node.id,
                graph,
                result,
                context,
                set(),
                {}
            )
            
            if node_result is None:
                state["execution_count"] += 1
                return None, True
            
            result = node_result
            was_injected = was_injected or node_injected
        
        state["execution_count"] += 1
        return result, was_injected


class AnomalyInjector:
    def __init__(self):
        self._active_anomalies: Dict[str, List[AnomalyConfig]] = {}
        self._workflows: Dict[str, Workflow] = {}
        self._active_workflows: Dict[str, bool] = {}
        self._delay_buffers: Dict[str, deque] = {}
        self._out_of_order_buffers: Dict[str, deque] = {}
        self._anomaly_events: List[AnomalyEvent] = []
        self._event_callbacks: List[Callable[[AnomalyEvent], None]] = []
        self._processed_count: Dict[str, int] = {}
        self._injected_count: Dict[str, int] = {}
        self._last_emitted_timestamp: Dict[str, datetime] = {}
        self._monotonicity_corrections: Dict[str, int] = {}
        self._workflow_executor = WorkflowExecutor(self)

    def get_available_anomaly_types(self) -> List[AnomalyType]:
        return [
            AnomalyType(
                name="packet_loss",
                description="随机丢弃数据包",
                parameters={
                    "loss_rate": {"type": "float", "min": 0.0, "max": 1.0, "default": 0.1, "description": "丢包概率"}
                }
            ),
            AnomalyType(
                name="out_of_order",
                description="数据包乱序到达",
                parameters={
                    "window_size": {"type": "int", "min": 2, "max": 20, "default": 5, "description": "乱序窗口大小"},
                    "reorder_probability": {"type": "float", "min": 0.0, "max": 1.0, "default": 0.3, "description": "重排概率"}
                }
            ),
            AnomalyType(
                name="delay",
                description="数据包延迟到达",
                parameters={
                    "min_delay": {"type": "float", "min": 0.0, "default": 0.5, "description": "最小延迟(秒)"},
                    "max_delay": {"type": "float", "min": 0.0, "default": 2.0, "description": "最大延迟(秒)"}
                }
            ),
            AnomalyType(
                name="value_spike",
                description="数值突变",
                parameters={
                    "spike_factor": {"type": "float", "min": 1.0, "default": 3.0, "description": "突变倍数"},
                    "spike_probability": {"type": "float", "min": 0.0, "max": 1.0, "default": 0.05, "description": "突变概率"},
                    "affected_metrics": {"type": "array", "default": ["temperature", "humidity", "voltage"], "description": "受影响的指标"}
                }
            ),
            AnomalyType(
                name="timestamp_drift",
                description="时间戳漂移",
                parameters={
                    "drift_seconds": {"type": "float", "default": 5.0, "description": "漂移秒数(正向后漂移，负向前漂移)"},
                    "gradual": {"type": "boolean", "default": True, "description": "是否渐进式漂移"}
                }
            ),
            AnomalyType(
                name="value_drift",
                description="数值渐进式漂移",
                parameters={
                    "drift_rate": {"type": "float", "default": 0.1, "description": "每个数据包的漂移量"},
                    "affected_metrics": {"type": "array", "default": ["temperature"], "description": "受影响的指标"}
                }
            ),
            AnomalyType(
                name="data_stagnation",
                description="数据停滞(数值不变)",
                parameters={
                    "stagnation_probability": {"type": "float", "min": 0.0, "max": 1.0, "default": 0.1, "description": "停滞概率"},
                    "stagnation_duration": {"type": "int", "min": 1, "default": 5, "description": "停滞持续数据包数量"}
                }
            ),
            AnomalyType(
                name="noise_injection",
                description="注入随机噪声",
                parameters={
                    "noise_level": {"type": "float", "min": 0.0, "default": 0.5, "description": "噪声强度"},
                    "affected_metrics": {"type": "array", "default": ["temperature", "humidity"], "description": "受影响的指标"}
                }
            )
        ]

    def register_event_callback(self, callback: Callable[[AnomalyEvent], None]):
        self._event_callbacks.append(callback)

    def add_anomaly(self, device_id: str, config: AnomalyConfig) -> bool:
        if device_id not in self._active_anomalies:
            self._active_anomalies[device_id] = []
            self._delay_buffers[device_id] = deque()
            self._out_of_order_buffers[device_id] = deque()
            self._processed_count[device_id] = 0
            self._injected_count[device_id] = 0
            self._last_emitted_timestamp.setdefault(device_id, None)
            self._monotonicity_corrections.setdefault(device_id, 0)

        self._active_anomalies[device_id].append(config)
        return True

    def get_available_node_types(self) -> List[Dict[str, Any]]:
        return [
            {
                "type": "device",
                "name": "设备输入",
                "description": "从指定设备接收数据",
                "icon": "ApartmentOutlined",
                "has_input": False,
                "has_output": True,
            },
            {
                "type": "delay",
                "name": "延迟节点",
                "description": "在执行下一个节点前等待指定时间",
                "icon": "ClockCircleOutlined",
                "has_input": True,
                "has_output": True,
                "parameters": {
                    "delay_seconds": {"type": "float", "min": 0.0, "default": 2.0, "description": "延迟秒数"}
                }
            },
            {
                "type": "condition",
                "name": "条件判断",
                "description": "根据条件表达式决定是否执行后续节点",
                "icon": "QuestionCircleOutlined",
                "has_input": True,
                "has_output": True,
                "parameters": {
                    "expression": {"type": "string", "default": "temperature > 30", "description": "条件表达式"}
                }
            },
            {
                "type": "parallel",
                "name": "并行分支",
                "description": "同时触发多个子节点并行执行",
                "icon": "BranchOutlined",
                "has_input": True,
                "has_output": True,
                "parameters": {
                    "branch_count": {"type": "int", "min": 2, "default": 2, "description": "分支数量"}
                }
            },
            {
                "type": "anomaly",
                "name": "异常注入",
                "description": "注入指定类型的异常",
                "icon": "ThunderboltOutlined",
                "has_input": True,
                "has_output": True,
            },
            {
                "type": "output",
                "name": "数据输出",
                "description": "输出处理后的数据到下游系统",
                "icon": "DatabaseOutlined",
                "has_input": True,
                "has_output": False,
            }
        ]

    def remove_anomaly(self, device_id: str, anomaly_type: str) -> bool:
        if device_id not in self._active_anomalies:
            return False
        
        original_length = len(self._active_anomalies[device_id])
        self._active_anomalies[device_id] = [
            a for a in self._active_anomalies[device_id]
            if a.anomaly_type != anomaly_type
        ]
        return len(self._active_anomalies[device_id]) < original_length

    def clear_anomalies(self, device_id: str):
        if device_id in self._active_anomalies:
            self._active_anomalies[device_id] = []
            self._delay_buffers[device_id].clear()
            self._out_of_order_buffers[device_id].clear()
            self._last_emitted_timestamp[device_id] = None
            self._monotonicity_corrections[device_id] = 0

    def get_active_anomalies(self, device_id: str) -> List[AnomalyConfig]:
        return self._active_anomalies.get(device_id, [])

    def get_all_active_anomalies(self) -> Dict[str, List[AnomalyConfig]]:
        return self._active_anomalies

    def _is_anomaly_active(self, config: AnomalyConfig) -> bool:
        now = datetime.now(timezone.utc)
        if config.start_time and now < config.start_time:
            return False
        if config.end_time and now > config.end_time:
            return False
        return True

    def _enforce_timestamp_monotonicity(self, data: DeviceData) -> DeviceData:
        device_id = data.device_id
        last_ts = self._last_emitted_timestamp.get(device_id)

        if last_ts is not None and data.timestamp < last_ts:
            corrected = data.model_copy()
            original_ts = data.timestamp
            corrected.timestamp = last_ts

            corrected.metadata = corrected.metadata or {}
            corrected.metadata["timestamp_corrected"] = True
            corrected.metadata["original_timestamp"] = original_ts.isoformat()
            corrected.metadata["corrected_to"] = last_ts.isoformat()

            self._monotonicity_corrections[device_id] = (
                self._monotonicity_corrections.get(device_id, 0) + 1
            )

            logger.warning(
                "Timestamp monotonicity violation corrected for device %s: "
                "original_ts=%s, last_emitted=%s. Correction #%d",
                device_id,
                original_ts.isoformat(),
                last_ts.isoformat(),
                self._monotonicity_corrections[device_id],
            )

            self._create_anomaly_event(
                device_id, "timestamp_monotonicity_correction",
                original_value=original_ts.isoformat(),
                injected_value=last_ts.isoformat(),
                parameters={
                    "violation_type": "timestamp_regression",
                    "original_timestamp": original_ts.isoformat(),
                    "last_emitted_timestamp": last_ts.isoformat(),
                    "correction_count": self._monotonicity_corrections[device_id],
                },
            )

            data = corrected

        self._last_emitted_timestamp[device_id] = data.timestamp
        return data

    def _create_anomaly_event(
        self, device_id: str, anomaly_type: str,
        original_value: Optional[Any] = None,
        injected_value: Optional[Any] = None,
        parameters: Optional[Dict[str, Any]] = None
    ) -> AnomalyEvent:
        event = AnomalyEvent(
            id=str(uuid.uuid4()),
            device_id=device_id,
            anomaly_type=anomaly_type,
            timestamp=datetime.now(timezone.utc),
            parameters=parameters or {},
            original_value=original_value,
            injected_value=injected_value
        )
        self._anomaly_events.append(event)
        
        for callback in self._event_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"Event callback error: {e}")
        
        return event

    def _apply_packet_loss(self, data: DeviceData, params: Dict[str, Any]) -> Tuple[Optional[DeviceData], bool]:
        loss_rate = params.get("loss_rate", 0.1)
        if random.random() < loss_rate:
            self._create_anomaly_event(
                data.device_id, "packet_loss",
                original_value=data.model_dump(),
                injected_value=None,
                parameters=params
            )
            return None, True
        return data, False

    def _apply_delay(self, data: DeviceData, params: Dict[str, Any]) -> Tuple[Optional[DeviceData], bool]:
        min_delay = params.get("min_delay", 0.5)
        max_delay = params.get("max_delay", 2.0)
        delay = random.uniform(min_delay, max_delay)
        
        delayed_data = data.model_copy()
        delayed_data.metadata = delayed_data.metadata or {}
        delayed_data.metadata["original_timestamp"] = data.timestamp.isoformat()
        delayed_data.metadata["delayed_by"] = delay
        
        self._create_anomaly_event(
            data.device_id, "delay",
            original_value=data.timestamp.isoformat(),
            injected_value=delay,
            parameters=params
        )
        
        time.sleep(delay)
        return delayed_data, True

    def _apply_out_of_order(self, data: DeviceData, params: Dict[str, Any], device_id: str) -> Tuple[Optional[DeviceData], bool]:
        window_size = params.get("window_size", 5)
        reorder_probability = params.get("reorder_probability", 0.3)
        
        buffer = self._out_of_order_buffers[device_id]
        buffer.append(data)
        
        if len(buffer) >= window_size:
            if random.random() < reorder_probability:
                items = list(buffer)
                
                original_order = [d.timestamp for d in items]
                
                random.shuffle(items)
                
                items.sort(key=lambda d: d.timestamp)
                
                reordered_timestamps = [d.timestamp for d in items]
                
                buffer.clear()
                
                self._create_anomaly_event(
                    device_id, "out_of_order",
                    original_value=[ts.isoformat() for ts in original_order],
                    injected_value=[ts.isoformat() for ts in reordered_timestamps],
                    parameters={
                        **params,
                        "note": "reorder_applied_with_monotonic_sort"
                    }
                )
                
                for item in items[:-1]:
                    buffer.append(item)
                return items[-1], True
            else:
                return buffer.popleft(), False
        
        return None, False

    def _apply_value_spike(self, data: DeviceData, params: Dict[str, Any]) -> Tuple[DeviceData, bool]:
        spike_factor = params.get("spike_factor", 3.0)
        spike_probability = params.get("spike_probability", 0.05)
        affected_metrics = params.get("affected_metrics", ["temperature", "humidity", "voltage"])
        
        if random.random() < spike_probability:
            new_data = data.model_copy()
            original_values = {}
            injected_values = {}
            
            for metric in affected_metrics:
                original_val = getattr(data, metric, None)
                if original_val is not None:
                    direction = random.choice([-1, 1])
                    spike_value = original_val * (1 + direction * spike_factor)
                    setattr(new_data, metric, round(spike_value, 4))
                    original_values[metric] = original_val
                    injected_values[metric] = round(spike_value, 4)
            
            self._create_anomaly_event(
                data.device_id, "value_spike",
                original_value=original_values,
                injected_value=injected_values,
                parameters=params
            )
            
            return new_data, True
        
        return data, False

    def _apply_timestamp_drift(self, data: DeviceData, params: Dict[str, Any]) -> Tuple[DeviceData, bool]:
        drift_seconds = params.get("drift_seconds", 5.0)
        gradual = params.get("gradual", True)

        new_data = data.model_copy()
        original_ts = data.timestamp

        if gradual:
            drift_amount = drift_seconds * 0.01
        else:
            drift_amount = drift_seconds

        new_timestamp = original_ts + timedelta(seconds=drift_amount)

        last_ts = self._last_emitted_timestamp.get(data.device_id)
        if last_ts is not None and new_timestamp < last_ts:
            logger.warning(
                "Timestamp drift would cause regression for device %s: "
                "drifted_ts=%s, last_emitted=%s. Clamping to last_emitted.",
                data.device_id,
                new_timestamp.isoformat(),
                last_ts.isoformat(),
            )
            new_timestamp = last_ts

        new_data.timestamp = new_timestamp

        new_data.metadata = new_data.metadata or {}
        new_data.metadata["drift_applied"] = (new_timestamp - original_ts).total_seconds()

        self._create_anomaly_event(
            data.device_id, "timestamp_drift",
            original_value=original_ts.isoformat(),
            injected_value=new_timestamp.isoformat(),
            parameters=params
        )

        return new_data, True

    def _apply_value_drift(self, data: DeviceData, params: Dict[str, Any]) -> Tuple[DeviceData, bool]:
        drift_rate = params.get("drift_rate", 0.1)
        affected_metrics = params.get("affected_metrics", ["temperature"])
        
        new_data = data.model_copy()
        original_values = {}
        injected_values = {}
        
        for metric in affected_metrics:
            original_val = getattr(data, metric, None)
            if original_val is not None:
                new_val = original_val + drift_rate
                setattr(new_data, metric, round(new_val, 4))
                original_values[metric] = original_val
                injected_values[metric] = round(new_val, 4)
        
        self._create_anomaly_event(
            data.device_id, "value_drift",
            original_value=original_values,
            injected_value=injected_values,
            parameters=params
        )
        
        return new_data, True

    def _apply_data_stagnation(self, data: DeviceData, params: Dict[str, Any], device_id: str) -> Tuple[DeviceData, bool]:
        stagnation_probability = params.get("stagnation_probability", 0.1)
        stagnation_duration = params.get("stagnation_duration", 5)
        
        if not hasattr(self, '_stagnation_state'):
            self._stagnation_state = {}
        
        state = self._stagnation_state.get(device_id, {"remaining": 0, "last_values": {}})
        
        if state["remaining"] > 0:
            new_data = data.model_copy()
            for metric, value in state["last_values"].items():
                if hasattr(new_data, metric):
                    setattr(new_data, metric, value)
            state["remaining"] -= 1
            self._stagnation_state[device_id] = state
            return new_data, True
        
        if random.random() < stagnation_probability:
            state["remaining"] = stagnation_duration
            state["last_values"] = {}
            for metric in ["temperature", "humidity", "voltage", "current", "pressure"]:
                val = getattr(data, metric, None)
                if val is not None:
                    state["last_values"][metric] = val
            
            self._create_anomaly_event(
                device_id, "data_stagnation",
                original_value=stagnation_duration,
                injected_value=state["last_values"],
                parameters=params
            )
            
            self._stagnation_state[device_id] = state
        
        return data, False

    def _apply_noise_injection(self, data: DeviceData, params: Dict[str, Any]) -> Tuple[DeviceData, bool]:
        noise_level = params.get("noise_level", 0.5)
        affected_metrics = params.get("affected_metrics", ["temperature", "humidity"])
        
        new_data = data.model_copy()
        original_values = {}
        injected_values = {}
        
        for metric in affected_metrics:
            original_val = getattr(data, metric, None)
            if original_val is not None:
                noise = random.uniform(-noise_level, noise_level)
                new_val = original_val + noise
                setattr(new_data, metric, round(new_val, 4))
                original_values[metric] = original_val
                injected_values[metric] = round(new_val, 4)
        
        self._create_anomaly_event(
            data.device_id, "noise_injection",
            original_value=original_values,
            injected_value=injected_values,
            parameters=params
        )
        
        return new_data, True

    async def process_data(self, data: DeviceData) -> Optional[DeviceData]:
        device_id = data.device_id
        
        result = data
        was_injected = False
        
        for workflow_id, is_active in self._active_workflows.items():
            if not is_active:
                continue
            workflow = self._workflows.get(workflow_id)
            if not workflow or device_id not in workflow.device_ids:
                continue
            
            try:
                workflow_result, workflow_injected = await self._workflow_executor.execute_workflow(
                    workflow, result
                )
                if workflow_result is None:
                    self._injected_count[device_id] = (
                        self._injected_count.get(device_id, 0) + 1
                    )
                    return None
                result = workflow_result
                was_injected = was_injected or workflow_injected
            except Exception as e:
                logger.error(f"Error executing workflow {workflow_id}: {e}")
        
        anomalies = self._active_anomalies.get(device_id, [])
        
        if not anomalies and not was_injected:
            if result is not None:
                result = self._enforce_timestamp_monotonicity(result)
            return result
        
        if device_id not in self._processed_count:
            self._processed_count[device_id] = 0
            self._injected_count[device_id] = 0
        
        self._processed_count[device_id] += 1
        
        for anomaly_config in anomalies:
            if not self._is_anomaly_active(anomaly_config):
                continue
            
            if random.random() > anomaly_config.probability:
                continue
            
            anomaly_type = anomaly_config.anomaly_type
            params = anomaly_config.parameters
            
            try:
                if anomaly_type == "packet_loss":
                    result, injected = self._apply_packet_loss(result, params)
                    if result is None:
                        self._injected_count[device_id] += 1
                        return None
                elif anomaly_type == "delay":
                    result, injected = self._apply_delay(result, params)
                elif anomaly_type == "out_of_order":
                    buffered_result, injected = self._apply_out_of_order(result, params, device_id)
                    if buffered_result is not None:
                        result = buffered_result
                    else:
                        return None
                elif anomaly_type == "value_spike":
                    result, injected = self._apply_value_spike(result, params)
                elif anomaly_type == "timestamp_drift":
                    result, injected = self._apply_timestamp_drift(result, params)
                elif anomaly_type == "value_drift":
                    result, injected = self._apply_value_drift(result, params)
                elif anomaly_type == "data_stagnation":
                    result, injected = self._apply_data_stagnation(result, params, device_id)
                elif anomaly_type == "noise_injection":
                    result, injected = self._apply_noise_injection(result, params)
                else:
                    continue
                
                if injected:
                    was_injected = True
                    
            except Exception as e:
                print(f"Error applying anomaly {anomaly_type}: {e}")
                continue
        
        if was_injected:
            self._injected_count[device_id] += 1
            if result and result.metadata is None:
                result.metadata = {}
            result.metadata["anomaly_injected"] = True

        if result is not None:
            result = self._enforce_timestamp_monotonicity(result)

        return result

    def get_stats(self, device_id: str) -> Dict[str, int]:
        return {
            "processed": self._processed_count.get(device_id, 0),
            "injected": self._injected_count.get(device_id, 0),
            "monotonicity_corrections": self._monotonicity_corrections.get(device_id, 0)
        }

    def get_recent_events(self, limit: int = 100) -> List[AnomalyEvent]:
        return self._anomaly_events[-limit:]

    def add_workflow(self, workflow: Workflow) -> str:
        if workflow.id is None:
            workflow.id = str(uuid.uuid4())
        workflow.created_at = datetime.now(timezone.utc)
        self._workflows[workflow.id] = workflow
        return workflow.id

    def get_workflows(self) -> List[Workflow]:
        return list(self._workflows.values())

    def get_workflow(self, workflow_id: str) -> Optional[Workflow]:
        return self._workflows.get(workflow_id)

    def delete_workflow(self, workflow_id: str) -> bool:
        if workflow_id in self._workflows:
            self.stop_workflow(workflow_id)
            del self._workflows[workflow_id]
            return True
        return False

    def start_workflow(self, workflow_id: str) -> bool:
        workflow = self._workflows.get(workflow_id)
        if not workflow:
            return False
        
        for node in workflow.nodes:
            if node.anomaly_config:
                for device_id in workflow.device_ids:
                    self.add_anomaly(device_id, node.anomaly_config)
        
        self._active_workflows[workflow_id] = True
        return True

    def stop_workflow(self, workflow_id: str) -> bool:
        workflow = self._workflows.get(workflow_id)
        if not workflow:
            return False
        
        for node in workflow.nodes:
            if node.anomaly_config:
                for device_id in workflow.device_ids:
                    self.remove_anomaly(device_id, node.anomaly_config.anomaly_type)
        
        if workflow_id in self._active_workflows:
            del self._active_workflows[workflow_id]
        return True

    def is_workflow_active(self, workflow_id: str) -> bool:
        return self._active_workflows.get(workflow_id, False)


anomaly_injector = AnomalyInjector()
