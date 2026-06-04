import sys
import os
import io
import asyncio
import json
import websockets

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

async def _recv_of_type(websocket, expected_types, timeout=5.0):
    """接收指定类型的消息"""
    if isinstance(expected_types, str):
        expected_types = [expected_types]
    
    start_time = asyncio.get_event_loop().time()
    while asyncio.get_event_loop().time() - start_time < timeout:
        try:
            msg = await asyncio.wait_for(websocket.recv(), timeout=1.0)
            data = json.loads(msg)
            if data.get("type") in expected_types:
                return data
        except asyncio.TimeoutError:
            continue
    raise TimeoutError(f"超时等待消息类型: {expected_types}")

async def test_recording_playback():
    uri = "ws://localhost:8765"
    
    print("=" * 60)
    print("测试 1: 连接服务器")
    print("=" * 60)
    
    async with websockets.connect(uri) as websocket:
        await websocket.send(json.dumps({
            "type": "join",
            "username": "测试用户",
            "table_id": "test_table_2"
        }))
        
        init_data = await _recv_of_type(websocket, "init")
        print(f"✓ 已连接，用户ID: {init_data.get('user_id')}")
        print(f"  初始状态: pH={init_data.get('state', {}).get('ph')}, 体积={init_data.get('state', {}).get('volume_ml')}mL")
        
        initial_ph = init_data.get('state', {}).get('ph')
        initial_volume = init_data.get('state', {}).get('volume_ml')
        
        print("\n" + "=" * 60)
        print("测试 2: 开始录制")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "start_recording"}))
        data = await _recv_of_type(websocket, ["recording_status", "playback_event"])
        print(f"✓ 录制已开始")
        
        print("\n" + "=" * 60)
        print("测试 3: 添加试剂（盐酸 HCl 50mL）")
        print("=" * 60)
        
        await websocket.send(json.dumps({
            "type": "operation",
            "op_type": "add_reagent",
            "lamport_time": 1,
            "base_version": 0,
            "data": {"reagent": "HCl", "volume": 50}
        }))
        
        data = await _recv_of_type(websocket, "state_update")
        state = data.get("state", {})
        print(f"✓ 添加盐酸后: pH={state.get('ph'):.2f}, 体积={state.get('volume_ml'):.1f}mL")
        print(f"  时间轴条目数: {data.get('timeline', {}).get('total_entries')}")
        ph_after_hcl = state.get('ph')
        volume_after_hcl = state.get('volume_ml')
        
        print("\n" + "=" * 60)
        print("测试 4: 添加试剂（氢氧化钠 NaOH 50mL）")
        print("=" * 60)
        
        await websocket.send(json.dumps({
            "type": "operation",
            "op_type": "add_reagent",
            "lamport_time": 2,
            "base_version": 1,
            "data": {"reagent": "NaOH", "volume": 50}
        }))
        
        data = await _recv_of_type(websocket, "state_update")
        state = data.get("state", {})
        print(f"✓ 添加氢氧化钠后: pH={state.get('ph'):.2f}, 体积={state.get('volume_ml'):.1f}mL")
        print(f"  时间轴条目数: {data.get('timeline', {}).get('total_entries')}")
        ph_after_naoh = state.get('ph')
        volume_after_naoh = state.get('volume_ml')
        
        print("\n" + "=" * 60)
        print("测试 5: 停止录制")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "stop_recording"}))
        data = await _recv_of_type(websocket, "recording_status")
        print(f"✓ 录制已停止，共 {data.get('timeline', {}).get('total_entries')} 步操作")
        
        print("\n" + "=" * 60)
        print("测试 6: 逆向回放一步（回到添加 NaOH 之前）")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "step_backward"}))
        data = await _recv_of_type(websocket, "playback_state")
        state = data.get("state", {})
        print(f"✓ 后退一步后: pH={state.get('ph'):.2f}, 体积={state.get('volume_ml'):.1f}mL")
        print(f"  预期: pH={ph_after_hcl:.2f}, 体积={volume_after_hcl:.1f}mL")
        
        if abs(state.get('ph') - ph_after_hcl) < 0.01 and abs(state.get('volume_ml') - volume_after_hcl) < 0.1:
            print("  ✓ 状态精确匹配！")
        else:
            print(f"  ✗ 状态不匹配！pH差值: {abs(state.get('ph') - ph_after_hcl):.4f}")
        
        print("\n" + "=" * 60)
        print("测试 7: 再后退一步（回到初始状态）")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "step_backward"}))
        data = await _recv_of_type(websocket, "playback_state")
        state = data.get("state", {})
        print(f"✓ 再后退一步后: pH={state.get('ph'):.2f}, 体积={state.get('volume_ml'):.1f}mL")
        print(f"  预期: pH={initial_ph:.2f}, 体积={initial_volume:.1f}mL")
        
        if abs(state.get('ph') - initial_ph) < 0.01 and abs(state.get('volume_ml') - initial_volume) < 0.1:
            print("  ✓ 精确恢复到初始状态！")
        else:
            print(f"  ✗ 状态不匹配！pH差值: {abs(state.get('ph') - initial_ph):.4f}")
        
        print("\n" + "=" * 60)
        print("测试 8: 向前两步（回到最终状态）")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "step_forward"}))
        data = await _recv_of_type(websocket, "playback_state")
        state = data.get("state", {})
        print(f"✓ 前进一步后: pH={state.get('ph'):.2f}, 体积={state.get('volume_ml'):.1f}mL")
        
        await websocket.send(json.dumps({"type": "step_forward"}))
        data = await _recv_of_type(websocket, "playback_state")
        state = data.get("state", {})
        print(f"✓ 前进两步后: pH={state.get('ph'):.2f}, 体积={state.get('volume_ml'):.1f}mL")
        print(f"  预期: pH={ph_after_naoh:.2f}, 体积={volume_after_naoh:.1f}mL")
        
        if abs(state.get('ph') - ph_after_naoh) < 0.01 and abs(state.get('volume_ml') - volume_after_naoh) < 0.1:
            print("  ✓ 精确恢复到最终状态！")
        else:
            print(f"  ✗ 状态不匹配！pH差值: {abs(state.get('ph') - ph_after_naoh):.4f}")
        
        print("\n" + "=" * 60)
        print("测试 9: 时间轴滑块跳转（跳转到第 0 步）")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "seek_to", "position": 0}))
        data = await _recv_of_type(websocket, "playback_state")
        state = data.get("state", {})
        print(f"✓ 跳转到位置 0 后: pH={state.get('ph'):.2f}, 体积={state.get('volume_ml'):.1f}mL")
        print(f"  预期: pH={ph_after_hcl:.2f}, 体积={volume_after_hcl:.1f}mL")
        
        if abs(state.get('ph') - ph_after_hcl) < 0.01 and abs(state.get('volume_ml') - volume_after_hcl) < 0.1:
            print("  ✓ 跳转后状态精确匹配！")
        else:
            print(f"  ✗ 状态不匹配！pH差值: {abs(state.get('ph') - ph_after_hcl):.4f}")
        
        print("\n" + "=" * 60)
        print("测试 10: 获取时间轴数据")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "get_timeline"}))
        data = await _recv_of_type(websocket, "timeline_data")
        timeline = data.get("timeline", {})
        print(f"✓ 时间轴数据:")
        print(f"  - 总条目数: {timeline.get('total_entries')}")
        print(f"  - 当前位置: {timeline.get('current_position')}")
        print(f"  - 录制中: {timeline.get('is_recording')}")
        
        entries = timeline.get("entries", [])
        for i, entry in enumerate(entries):
            op = entry.get("operation", entry.get("data", {}))
            if isinstance(op, dict):
                op_type = op.get("op_type", entry.get("op_type", "unknown"))
                op_data = op.get("data", entry.get("data", {}))
                print(f"  - 步骤 {i}: {op_type} - {op_data}")
        
        print("\n" + "=" * 60)
        print("测试 11: 酸碱中和精确性验证")
        print("=" * 60)
        
        await websocket.send(json.dumps({"type": "reset_playback"}))
        await _recv_of_type(websocket, ["timeline_data", "playback_event"])
        
        await websocket.send(json.dumps({"type": "start_recording"}))
        await _recv_of_type(websocket, ["recording_status", "playback_event"])
        
        await websocket.send(json.dumps({
            "type": "operation",
            "op_type": "add_reagent",
            "lamport_time": 10,
            "base_version": 0,
            "data": {"reagent": "HCl", "volume": 50}
        }))
        await _recv_of_type(websocket, "state_update")
        
        await websocket.send(json.dumps({
            "type": "operation",
            "op_type": "add_reagent",
            "lamport_time": 11,
            "base_version": 1,
            "data": {"reagent": "NaOH", "volume": 50}
        }))
        data = await _recv_of_type(websocket, "state_update")
        final_ph = data.get("state", {}).get("ph")
        print(f"✓ 50mL HCl + 50mL NaOH 中和后 pH = {final_ph:.2f}")
        
        if abs(final_ph - 7.0) < 0.5:
            print("  ✓ 酸碱中和正确（pH 接近 7）！")
        else:
            print(f"  ⚠ 中和后 pH 偏离 7 较多，可能浓度不完全匹配")
        
        await websocket.send(json.dumps({"type": "stop_recording"}))
        await _recv_of_type(websocket, "recording_status")
        
        print("\n" + "=" * 60)
        print("测试 12: 连续逆向回放验证")
        print("=" * 60)
        
        for i in range(2):
            await websocket.send(json.dumps({"type": "step_backward"}))
            data = await _recv_of_type(websocket, "playback_state")
            pos = data.get("timeline", {}).get("current_position")
            ph = data.get("state", {}).get("ph")
            vol = data.get("state", {}).get("volume_ml")
            print(f"  后退 {i+1} 步: 位置={pos}, pH={ph:.2f}, 体积={vol:.1f}mL")
        
        print("✓ 连续逆向回放完成")
        
        print("\n" + "=" * 60)
        print("所有测试完成！✓✓✓")
        print("=" * 60)

if __name__ == "__main__":
    try:
        asyncio.run(test_recording_playback())
    except Exception as e:
        print(f"测试出错: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
