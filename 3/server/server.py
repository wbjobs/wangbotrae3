import asyncio
import json
import time
import uuid
import sys
import io
import copy
from typing import Dict, Set, Optional, List, Callable
from dataclasses import dataclass, field

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import websockets

from chemistry_engine import (
    ChemistryEngine, get_available_reagents, get_reaction_templates,
    SolutionState, UndoToken, UndoType, ReagentType, MOLES_EPSILON
)


class LamportClock:
    def __init__(self):
        self.time: int = 0

    def tick(self) -> int:
        self.time += 1
        return self.time

    def update(self, received_time: int) -> int:
        self.time = max(self.time, received_time) + 1
        return self.time

    @property
    def current(self) -> int:
        return self.time


@dataclass
class Operation:
    op_type: str
    user_id: str
    lamport_time: int
    base_version: int
    data: dict
    wall_time: float = field(default_factory=time.time)


@dataclass
class RecordedEntry:
    index: int
    operation: Operation
    undo_token: UndoToken
    state_before: dict
    state_after: dict
    timestamp: float
    description: str = ""

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "op_type": self.operation.op_type,
            "user_id": self.operation.user_id,
            "lamport_time": self.operation.lamport_time,
            "data": self.operation.data,
            "timestamp": self.timestamp,
            "description": self.description,
            "state_summary": {
                "ph": round(self.state_after["state"].ph, 2),
                "temperature": round(self.state_after["state"].temperature, 1),
                "volume_ml": round(self.state_after["state"].volume_ml, 1),
                "precipitate_grams": round(self.state_after["state"].precipitate_grams, 3),
                "color_name": self.state_after["state"].color_name,
            }
        }


class PlaybackEngine:
    def __init__(self, engine: ChemistryEngine):
        self.engine = engine
        self.is_recording: bool = False
        self.is_playing: bool = False
        self.playback_direction: int = 0  # 1 = forward, -1 = backward, 0 = paused
        self.playback_speed: float = 1.0
        self.history: List[RecordedEntry] = []
        self.current_position: int = -1
        self._initial_state: Optional[dict] = None
        self._snapshots: List[dict] = []
        self._listeners: List[Callable] = []

    def on_state_change(self, callback: Callable):
        self._listeners.append(callback)

    def _notify(self, event_type: str, data: dict = None):
        for cb in self._listeners:
            try:
                cb(event_type, data)
            except Exception as e:
                print(f"Listener error: {e}")

    def start_recording(self):
        if self.is_recording:
            return
        if self._initial_state is None:
            self._initial_state = self.engine.snapshot()
        self.is_recording = True
        self.history = []
        self.current_position = -1
        self._snapshots = [self._initial_state]
        self._notify("recording_started")

    def stop_recording(self):
        self.is_recording = False
        self._notify("recording_stopped", {
            "entry_count": len(self.history),
            "total_entries": len(self.history),
        })

    def record(self, operation: Operation, undo_token: UndoToken) -> RecordedEntry:
        if not self.is_recording:
            return None

        index = len(self.history)
        state_before = self._snapshots[index]
        state_after = self.engine.snapshot()
        self._snapshots.append(state_after)

        desc = self._describe_operation(operation)
        entry = RecordedEntry(
            index=index,
            operation=operation,
            undo_token=undo_token,
            state_before=state_before,
            state_after=state_after,
            timestamp=operation.wall_time,
            description=desc,
        )
        self.history.append(entry)
        self.current_position = index
        self._notify("recorded", {"entry": entry.to_dict()})
        return entry

    def _describe_operation(self, op: Operation) -> str:
        if op.op_type == "add_reagent":
            return f"添加 {op.data.get('reagent', '?')} {op.data.get('volume', 0)}mL"
        elif op.op_type == "heat":
            return f"加热 {op.data.get('duration', 0)}s"
        elif op.op_type == "stir":
            return f"搅拌 {op.data.get('duration', 0)}s"
        elif op.op_type == "reset":
            return "重置实验"
        return op.op_type

    def step_forward(self) -> Optional[dict]:
        if self.current_position >= len(self.history) - 1:
            return None

        next_index = self.current_position + 1
        entry = self.history[next_index]

        target_snap = self._snapshots[next_index + 1]
        self.engine.restore(target_snap)
        self.current_position = next_index

        self._notify("stepped", {"direction": "forward", "position": self.current_position})
        return self.engine.snapshot()

    def step_backward(self) -> Optional[dict]:
        if self.current_position < 0:
            return None

        entry = self.history[self.current_position]
        target_snap = self._snapshots[self.current_position]
        self.engine.restore(target_snap)
        self.current_position -= 1

        self._notify("stepped", {"direction": "backward", "position": self.current_position})
        return self.engine.snapshot()

    def seek_to(self, position: int) -> dict:
        target = max(-1, min(position, len(self.history) - 1))
        snap_index = target + 1
        if snap_index < 0 or snap_index >= len(self._snapshots):
            snap_index = 0

        self.engine.restore(self._snapshots[snap_index])
        self.current_position = target
        self._notify("seeked", {"position": self.current_position})
        return self.engine.snapshot()

    def seek_to_beginning(self) -> dict:
        return self.seek_to(-1)

    def seek_to_end(self) -> dict:
        return self.seek_to(len(self.history) - 1)

    async def play(self, direction: int = 1, speed: float = 1.0):
        if self.is_playing:
            return
        self.is_playing = True
        self.playback_direction = direction
        self.playback_speed = speed
        self._notify("playback_started", {"direction": direction, "speed": speed})

        try:
            while self.is_playing:
                if direction > 0:
                    result = self.step_forward()
                    if result is None:
                        break
                else:
                    result = self.step_backward()
                    if result is None:
                        break

                self._notify("playback_state", {
                    "state": self.engine.state.to_dict(),
                    "position": self.current_position,
                    "total": len(self.history),
                })
                await asyncio.sleep(0.5 / speed)
        finally:
            self.is_playing = False
            self.playback_direction = 0
            self._notify("playback_stopped", {"position": self.current_position})

    def pause(self):
        self.is_playing = False
        self.playback_direction = 0
        self._notify("playback_paused", {"position": self.current_position})

    def reset(self):
        self.is_recording = False
        self.is_playing = False
        self.playback_direction = 0
        self.history = []
        self.current_position = -1
        self._initial_state = None
        self._snapshots = []
        self._notify("playback_reset")

    def get_timeline(self) -> dict:
        return {
            "entries": [e.to_dict() for e in self.history],
            "current_position": self.current_position,
            "total_entries": len(self.history),
            "is_recording": self.is_recording,
            "is_playing": self.is_playing,
            "playback_direction": self.playback_direction,
        }

    def get_current_state(self) -> dict:
        return self.engine.snapshot()


class OTMerger:
    def __init__(self):
        pass

    def transform(self, op_new: Operation, op_applied: Operation) -> Operation:
        if op_new.op_type == "reset" or op_applied.op_type == "reset":
            return op_new

        if op_new.op_type == "add_reagent":
            return op_new

        if op_new.op_type == "heat" and op_applied.op_type == "heat":
            new_data = copy.deepcopy(op_new.data)
            new_data["duration"] = op_new.data.get("duration", 5.0) + op_applied.data.get("duration", 0) * 0.1
            return Operation(
                op_type=op_new.op_type,
                user_id=op_new.user_id,
                lamport_time=op_new.lamport_time,
                base_version=op_new.base_version,
                data=new_data,
                wall_time=op_new.wall_time,
            )

        if op_new.op_type == "stir" and op_applied.op_type == "stir":
            new_data = copy.deepcopy(op_new.data)
            new_data["duration"] = op_new.data.get("duration", 3.0) + op_applied.data.get("duration", 0) * 0.1
            return Operation(
                op_type=op_new.op_type,
                user_id=op_new.user_id,
                lamport_time=op_new.lamport_time,
                base_version=op_new.base_version,
                data=new_data,
                wall_time=op_new.wall_time,
            )

        return op_new

    def merge(self, engine: ChemistryEngine, base_snapshot: dict, ops: List[Operation]) -> dict:
        engine.restore(base_snapshot)

        sorted_ops = sorted(ops, key=lambda x: (x.lamport_time, x.wall_time))

        add_reagent_ops = []
        other_ops = []

        for op in sorted_ops:
            if op.op_type == "add_reagent":
                add_reagent_ops.append(op)
            else:
                other_ops.append(op)

        for op in add_reagent_ops:
            engine._add_substance_only(op.data.get("reagent", ""), op.data.get("volume", 50))

        engine.commit_effects()

        for op in other_ops:
            if op.op_type == "heat":
                engine.heat(op.data.get("duration", 5.0), op.data.get("power", 50.0))
            elif op.op_type == "stir":
                engine.stir(op.data.get("duration", 3.0))
            elif op.op_type == "reset":
                engine.reset()

        return engine.snapshot()


@dataclass
class ExperimentTable:
    table_id: str
    engine: ChemistryEngine = field(default_factory=ChemistryEngine)
    lamport_clock: LamportClock = field(default_factory=LamportClock)
    users: Dict[str, dict] = field(default_factory=dict)
    operation_log: list = field(default_factory=list)
    snapshots: Dict[int, dict] = field(default_factory=dict)
    current_version: int = 0
    ot_merger: OTMerger = field(default_factory=OTMerger)
    playback: PlaybackEngine = field(init=False)

    def __post_init__(self):
        self.snapshots[0] = self.engine.snapshot()
        self.playback = PlaybackEngine(self.engine)

    def get_state(self) -> dict:
        return self.engine.state.to_dict()

    def save_snapshot(self):
        version = self.engine.version
        self.snapshots[version] = self.engine.snapshot()
        self.current_version = version
        self._prune_snapshots()

    def _prune_snapshots(self):
        min_base = min((op.base_version for op in self.operation_log), default=0)
        keys_to_remove = [k for k in self.snapshots if k < min_base]
        for k in keys_to_remove:
            del self.snapshots[k]

    def find_snapshot_for_version(self, target_version: int) -> dict:
        if target_version in self.snapshots:
            return copy.deepcopy(self.snapshots[target_version])

        available = sorted(self.snapshots.keys())
        best = 0
        for v in available:
            if v <= target_version:
                best = v
            else:
                break

        return copy.deepcopy(self.snapshots[best])


class ExperimentServer:
    def __init__(self):
        self.tables: Dict[str, ExperimentTable] = {}
        self.connections: Dict[str, websockets.WebSocketServerProtocol] = {}
        self.user_table_map: Dict[str, str] = {}
        self.user_colors = [
            "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4",
            "#ffeaa7", "#dfe6e9", "#fd79a8", "#6c5ce7",
            "#00b894", "#e17055", "#0984e3", "#fdcb6e",
        ]
        self.color_index = 0

    def _get_user_color(self) -> str:
        color = self.user_colors[self.color_index % len(self.user_colors)]
        self.color_index += 1
        return color

    def _get_or_create_table(self, table_id: str) -> ExperimentTable:
        if table_id not in self.tables:
            self.tables[table_id] = ExperimentTable(table_id=table_id)
        return self.tables[table_id]

    async def register(self, websocket, user_id: str, username: str, table_id: str):
        table = self._get_or_create_table(table_id)
        color = self._get_user_color()
        table.users[user_id] = {"username": username, "color": color}
        self.connections[user_id] = websocket
        self.user_table_map[user_id] = table_id

        table.playback.on_state_change(lambda event, data: self._on_playback_event(table, event, data))

        await self._send_to_user(user_id, {
            "type": "init",
            "user_id": user_id,
            "table_id": table_id,
            "username": username,
            "color": color,
            "state": table.get_state(),
            "server_version": table.current_version,
            "reagents": get_available_reagents(),
            "templates": get_reaction_templates(),
            "users": table.users,
            "timeline": table.playback.get_timeline(),
        })

        await self._broadcast_table(table_id, {
            "type": "user_joined",
            "user_id": user_id,
            "username": username,
            "color": color,
            "users": table.users,
        })

    async def unregister(self, user_id: str):
        table_id = self.user_table_map.get(user_id)
        if table_id and table_id in self.tables:
            table = self.tables[table_id]
            if user_id in table.users:
                del table.users[user_id]
                await self._broadcast_table(table_id, {
                    "type": "user_left",
                    "user_id": user_id,
                    "users": table.users,
                })
            if not table.users:
                del self.tables[table_id]

        self.connections.pop(user_id, None)
        self.user_table_map.pop(user_id, None)

    async def _on_playback_event(self, table: ExperimentTable, event_type: str, data: dict):
        if event_type == "playback_state":
            await self._broadcast_table(table.table_id, {
                "type": "playback_state",
                "state": table.get_state(),
                "position": table.playback.current_position,
                "timeline": table.playback.get_timeline(),
            })
            return

        event_map = {
            "playback_started": "playback_started",
            "playback_stopped": "playback_finished",
            "playback_paused": "playback_paused",
            "playback_reset": "playback_reset",
            "recording_started": "recording_started",
            "recording_stopped": "recording_stopped",
        }

        frontend_event = event_map.get(event_type, event_type)
        broadcast_data = {"type": "playback_event", "event": frontend_event}

        if frontend_event == "playback_started" and data:
            direction = "forward" if data.get("direction", 1) > 0 else "backward"
            broadcast_data["direction"] = direction
        elif frontend_event == "playback_finished":
            broadcast_data["direction"] = "forward" if table.playback.playback_direction > 0 else "backward"

        if data:
            broadcast_data.update(data)
        await self._broadcast_table(table.table_id, broadcast_data)

    async def process_operation(self, user_id: str, message: dict):
        table_id = self.user_table_map.get(user_id)
        if not table_id or table_id not in self.tables:
            return

        table = self.tables[table_id]

        if table.playback.is_playing:
            await self._send_to_user(user_id, {
                "type": "error",
                "message": "回放中不允许进行新操作"
            })
            return

        received_lamport = message.get("lamport_time", 0)
        local_lamport = table.lamport_clock.update(received_lamport)
        base_version = message.get("base_version", table.current_version)

        op = Operation(
            op_type=message.get("op_type", "unknown"),
            user_id=user_id,
            lamport_time=local_lamport,
            base_version=base_version,
            data=message.get("data", {}),
        )

        undo_token = None
        concurrent_ops = [
            logged_op for logged_op in table.operation_log
            if logged_op.base_version <= base_version
            and logged_op.lamport_time > local_lamport
        ]

        if base_version < table.current_version and len(concurrent_ops) > 0:
            await self._merge_concurrent_operation(table, op, base_version)
        else:
            undo_token = await self._apply_operation_fast(table, op)

        if table.playback.is_recording and undo_token is not None:
            table.playback.record(op, undo_token)

        table.operation_log.append(op)

        if len(table.operation_log) > 200:
            table.operation_log = table.operation_log[-100:]

        table.save_snapshot()

        state = table.get_state()

        await self._broadcast_table(table_id, {
            "type": "state_update",
            "state": state,
            "lamport_time": local_lamport,
            "server_version": table.current_version,
            "operation": {
                "op_type": op.op_type,
                "user_id": user_id,
                "data": op.data,
            },
            "timeline": table.playback.get_timeline(),
        })

    async def _apply_operation_fast(self, table: ExperimentTable, op: Operation):
        engine = table.engine
        data = op.data

        if op.op_type == "add_reagent":
            reagent = data.get("reagent", "")
            volume = data.get("volume", 50)
            return engine.add_reagent(reagent, volume)

        elif op.op_type == "heat":
            duration = data.get("duration", 5.0)
            power = data.get("power", 50.0)
            return engine.heat(duration, power)

        elif op.op_type == "stir":
            duration = data.get("duration", 3.0)
            return engine.stir(duration)

        elif op.op_type == "reset":
            token = engine.reset()
            table.operation_log.clear()
            table.snapshots.clear()
            table.snapshots[0] = engine.snapshot()
            return token

        return None

    async def _merge_concurrent_operation(self, table: ExperimentTable, new_op: Operation, base_version: int):
        base_snapshot = table.find_snapshot_for_version(base_version)

        concurrent_ops = []
        for logged_op in table.operation_log:
            if logged_op.lamport_time > new_op.lamport_time:
                transformed = table.ot_merger.transform(logged_op, new_op)
                concurrent_ops.append(transformed)
            else:
                concurrent_ops.append(logged_op)

        concurrent_ops.append(new_op)

        table.ot_merger.merge(table.engine, base_snapshot, concurrent_ops)

        table.operation_log = [
            op for op in table.operation_log
            if op.lamport_time <= new_op.lamport_time
        ] + [new_op]

    async def _send_to_user(self, user_id: str, data: dict):
        ws = self.connections.get(user_id)
        if ws:
            try:
                await ws.send(json.dumps(data, ensure_ascii=False))
            except websockets.exceptions.ConnectionClosed:
                pass

    async def _broadcast_table(self, table_id: str, data: dict):
        if table_id not in self.tables:
            return
        table = self.tables[table_id]
        message = json.dumps(data, ensure_ascii=False)
        disconnected = []

        for uid in table.users:
            ws = self.connections.get(uid)
            if ws:
                try:
                    await ws.send(message)
                except websockets.exceptions.ConnectionClosed:
                    disconnected.append(uid)

        for uid in disconnected:
            await self.unregister(uid)

    async def handle_connection(self, websocket):
        user_id = str(uuid.uuid4())

        try:
            async for raw_message in websocket:
                try:
                    message = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue

                msg_type = message.get("type", "")

                if msg_type == "join":
                    username = message.get("username", f"实验员{user_id[:4]}")
                    table_id = message.get("table_id", "default")
                    await self.register(websocket, user_id, username, table_id)

                elif msg_type == "operation":
                    await self.process_operation(user_id, message)

                elif msg_type == "get_reagents":
                    await self._send_to_user(user_id, {
                        "type": "reagents_list",
                        "reagents": get_available_reagents(),
                    })

                elif msg_type == "get_templates":
                    await self._send_to_user(user_id, {
                        "type": "templates_list",
                        "templates": get_reaction_templates(),
                    })

                elif msg_type == "get_state":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        await self._send_to_user(user_id, {
                            "type": "current_state",
                            "state": table.get_state(),
                            "server_version": table.current_version,
                        })

                elif msg_type == "get_timeline":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        await self._send_to_user(user_id, {
                            "type": "timeline_data",
                            "timeline": table.playback.get_timeline(),
                        })

                elif msg_type == "start_recording":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        table.playback.start_recording()
                        await self._broadcast_table(table_id, {
                            "type": "recording_status",
                            "timeline": table.playback.get_timeline(),
                        })

                elif msg_type == "stop_recording":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        table.playback.stop_recording()
                        await self._broadcast_table(table_id, {
                            "type": "recording_status",
                            "timeline": table.playback.get_timeline(),
                        })

                elif msg_type == "seek_to":
                    table_id = self.user_table_map.get(user_id)
                    position = message.get("position", 0)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        snap = table.playback.seek_to(position)
                        table.save_snapshot()
                        await self._broadcast_table(table_id, {
                            "type": "playback_state",
                            "state": table.get_state(),
                            "position": table.playback.current_position,
                            "timeline": table.playback.get_timeline(),
                        })

                elif msg_type == "step_forward":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        snap = table.playback.step_forward()
                        if snap:
                            table.save_snapshot()
                            await self._broadcast_table(table_id, {
                                "type": "playback_state",
                                "state": table.get_state(),
                                "position": table.playback.current_position,
                                "timeline": table.playback.get_timeline(),
                            })

                elif msg_type == "step_backward":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        snap = table.playback.step_backward()
                        if snap:
                            table.save_snapshot()
                            await self._broadcast_table(table_id, {
                                "type": "playback_state",
                                "state": table.get_state(),
                                "position": table.playback.current_position,
                                "timeline": table.playback.get_timeline(),
                            })

                elif msg_type == "play_forward":
                    table_id = self.user_table_map.get(user_id)
                    speed = message.get("speed", 1.0)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        if not table.playback.is_playing:
                            asyncio.create_task(table.playback.play(1, speed))

                elif msg_type == "play_backward":
                    table_id = self.user_table_map.get(user_id)
                    speed = message.get("speed", 1.0)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        if not table.playback.is_playing:
                            asyncio.create_task(table.playback.play(-1, speed))

                elif msg_type == "pause_playback":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        table.playback.pause()

                elif msg_type == "reset_playback":
                    table_id = self.user_table_map.get(user_id)
                    if table_id and table_id in self.tables:
                        table = self.tables[table_id]
                        table.playback.reset()
                        await self._broadcast_table(table_id, {
                            "type": "timeline_data",
                            "timeline": table.playback.get_timeline(),
                        })

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(user_id)


async def main():
    server = ExperimentServer()
    print("Chemistry Lab Server started on ws://localhost:8765")

    async with websockets.serve(
        server.handle_connection,
        "localhost",
        8765,
        ping_interval=20,
        ping_timeout=60,
    ):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
