import asyncio
import json
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from config import settings
from models import (
    DeviceData, DeviceSimulatorConfig, AnomalyConfig, AnomalyType,
    Workflow, TimeTravelRequest, DataPoint, AnomalyEvent,
    InjectionRecordBase, InjectionRecordDB, AnomalyTemplate, WorkflowNode
)
from device_simulator import device_simulator
from anomaly_engine import anomaly_injector
from time_travel import time_travel_engine
from database import db_manager
from websocket_manager import ws_manager
from builtin_templates import get_builtin_templates


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_manager.connect()
    
    time_travel_engine.set_influxdb_client(db_manager.get_influxdb_client())
    
    async def data_callback(data: DeviceData):
        db_manager.write_data_point(data, is_injected=False)
        await ws_manager.broadcast_device_data(data, is_injected=False)
        
        processed = await anomaly_injector.process_data(data)
        if processed is not None and processed != data:
            db_manager.write_data_point(processed, is_injected=True)
            await ws_manager.broadcast_device_data(processed, is_injected=True)
    
    device_simulator.register_callback(data_callback)
    
    async def anomaly_callback(event: AnomalyEvent):
        await ws_manager.broadcast_anomaly_event(event)
    
    anomaly_injector.register_event_callback(anomaly_callback)
    time_travel_engine.register_anomaly_callback(anomaly_callback)
    
    async def playback_callback(data: DeviceData):
        processed = await anomaly_injector.process_data(data)
        if processed is not None:
            db_manager.write_data_point(processed, is_injected=True)
            await ws_manager.broadcast_device_data(processed, is_injected=True)
    
    time_travel_engine.register_callback(playback_callback)
    
    async def stats_monitor():
        while True:
            for device_id in device_simulator.get_devices():
                stats = anomaly_injector.get_stats(device_id.device_id)
                await ws_manager.broadcast_stats(device_id.device_id, stats)
            await asyncio.sleep(5)
    
    stats_task = asyncio.create_task(stats_monitor())
    
    builtin_templates = get_builtin_templates()
    db_manager.init_builtin_templates(builtin_templates)
    
    yield
    
    stats_task.cancel()
    device_simulator.stop_all()
    time_travel_engine.stop_all_playbacks()
    db_manager.close()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/devices", response_model=DeviceSimulatorConfig)
async def add_device(config: DeviceSimulatorConfig):
    if not device_simulator.add_device(config):
        raise HTTPException(status_code=400, detail="Device already exists")
    return config


@app.delete("/devices/{device_id}")
async def remove_device(device_id: str):
    if not device_simulator.remove_device(device_id):
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device removed"}


@app.get("/devices", response_model=List[DeviceSimulatorConfig])
async def list_devices():
    return device_simulator.get_devices()


@app.get("/devices/{device_id}", response_model=Optional[DeviceSimulatorConfig])
async def get_device(device_id: str):
    device = device_simulator.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@app.post("/devices/{device_id}/start")
async def start_device(device_id: str):
    if not device_simulator.get_device(device_id):
        raise HTTPException(status_code=404, detail="Device not found")
    if not device_simulator.start_device(device_id):
        raise HTTPException(status_code=400, detail="Device already running")
    return {"message": "Device started"}


@app.post("/devices/{device_id}/stop")
async def stop_device(device_id: str):
    if not device_simulator.get_device(device_id):
        raise HTTPException(status_code=404, detail="Device not found")
    if not device_simulator.stop_device(device_id):
        raise HTTPException(status_code=400, detail="Device not running")
    return {"message": "Device stopped"}


@app.get("/devices/{device_id}/status")
async def get_device_status(device_id: str):
    if not device_simulator.get_device(device_id):
        raise HTTPException(status_code=404, detail="Device not found")
    return {
        "device_id": device_id,
        "is_running": device_simulator.is_running(device_id),
        "stats": anomaly_injector.get_stats(device_id)
    }


@app.post("/devices/start-all")
async def start_all_devices():
    device_simulator.start_all()
    return {"message": "All devices started"}


@app.post("/devices/stop-all")
async def stop_all_devices():
    device_simulator.stop_all()
    return {"message": "All devices stopped"}


@app.get("/anomaly-types", response_model=List[AnomalyType])
async def get_anomaly_types():
    return anomaly_injector.get_available_anomaly_types()


@app.get("/node-types")
async def get_node_types():
    return anomaly_injector.get_available_node_types()


@app.get("/templates")
async def get_templates(
    category: Optional[str] = Query(None, description="按分类过滤"),
    include_builtin: bool = Query(True, description="是否包含内置模板")
):
    return db_manager.get_templates(category=category, include_builtin=include_builtin)


@app.get("/templates/{template_id}")
async def get_template(template_id: str):
    template = db_manager.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@app.post("/templates", status_code=201)
async def create_template(template: AnomalyTemplate):
    import uuid
    if not template.id:
        template.id = f"tpl_{uuid.uuid4().hex[:8]}"
    
    template_dict = template.model_dump(mode="json")
    workflow_data = template_dict.pop("workflow_data")
    
    db_manager.save_template(
        template_id=template.id,
        name=template.name,
        description=template.description,
        category=template.category,
        icon=template.icon or "",
        workflow_data=workflow_data,
        default_parameters=template_dict.get("default_parameters", {}),
        is_builtin=False
    )
    
    return {"message": "Template created", "template_id": template.id}


@app.delete("/templates/{template_id}")
async def delete_template(template_id: str):
    if not db_manager.delete_template(template_id):
        template = db_manager.get_template(template_id)
        if template and template.get("is_builtin"):
            raise HTTPException(status_code=400, detail="Builtin templates cannot be deleted")
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Template deleted"}


@app.post("/templates/{template_id}/apply")
async def apply_template(template_id: str, body: Dict[str, Any]):
    device_ids = body.get("device_ids", [])
    template = db_manager.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    import uuid
    workflow_data = template["workflow_data"]
    workflow = Workflow(
        id=f"wf_{uuid.uuid4().hex[:8]}",
        name=f"{template['name']} - {datetime.now().strftime('%Y%m%d%H%M%S')}",
        description=template["description"],
        template_id=template_id,
        nodes=[WorkflowNode(**node) for node in workflow_data.get("nodes", [])],
        edges=workflow_data.get("edges", []),
        device_ids=device_ids,
        execution_mode=workflow_data.get("execution_mode", "sequential")
    )
    
    anomaly_injector.add_workflow(workflow)
    anomaly_injector.start_workflow(workflow.id)
    
    return {"message": "Template applied", "workflow_id": workflow.id}


@app.get("/template-categories")
async def get_template_categories():
    return [
        {"id": "network", "name": "网络异常", "icon": "WifiOutlined"},
        {"id": "sensor", "name": "传感器异常", "icon": "ThunderboltOutlined"},
        {"id": "data", "name": "数据质量", "icon": "DatabaseOutlined"},
        {"id": "hardware", "name": "硬件故障", "icon": "BulbOutlined"},
        {"id": "custom", "name": "自定义", "icon": "SettingOutlined"}
    ]


@app.post("/devices/{device_id}/anomalies")
async def add_anomaly(device_id: str, config: AnomalyConfig):
    if not device_simulator.get_device(device_id):
        raise HTTPException(status_code=404, detail="Device not found")
    
    anomaly_injector.add_anomaly(device_id, config)
    
    record = InjectionRecordBase(
        device_id=device_id,
        anomaly_type=config.anomaly_type,
        parameters=config.parameters,
        start_time=config.start_time or datetime.now(timezone.utc),
        end_time=config.end_time
    )
    db_manager.save_injection_record(record)
    
    return {"message": "Anomaly added"}


@app.delete("/devices/{device_id}/anomalies/{anomaly_type}")
async def remove_anomaly(device_id: str, anomaly_type: str):
    if not anomaly_injector.remove_anomaly(device_id, anomaly_type):
        raise HTTPException(status_code=404, detail="Anomaly not found")
    return {"message": "Anomaly removed"}


@app.delete("/devices/{device_id}/anomalies")
async def clear_anomalies(device_id: str):
    anomaly_injector.clear_anomalies(device_id)
    return {"message": "All anomalies cleared"}


@app.get("/devices/{device_id}/anomalies", response_model=List[AnomalyConfig])
async def get_device_anomalies(device_id: str):
    return anomaly_injector.get_active_anomalies(device_id)


@app.get("/anomalies", response_model=Dict[str, List[AnomalyConfig]])
async def get_all_anomalies():
    return anomaly_injector.get_all_active_anomalies()


@app.get("/anomaly-events")
async def get_anomaly_events(limit: int = Query(100, ge=1, le=1000)):
    return anomaly_injector.get_recent_events(limit)


@app.post("/workflows")
async def create_workflow(workflow: Workflow):
    workflow_id = anomaly_injector.add_workflow(workflow)
    return {"workflow_id": workflow_id}


@app.get("/workflows", response_model=List[Workflow])
async def list_workflows():
    return anomaly_injector.get_workflows()


@app.get("/workflows/{workflow_id}", response_model=Optional[Workflow])
async def get_workflow(workflow_id: str):
    workflow = anomaly_injector.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@app.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str):
    if not anomaly_injector.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"message": "Workflow deleted"}


@app.post("/workflows/{workflow_id}/start")
async def start_workflow(workflow_id: str):
    if not anomaly_injector.get_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not anomaly_injector.start_workflow(workflow_id):
        raise HTTPException(status_code=400, detail="Could not start workflow")
    
    await ws_manager.broadcast_workflow_update(workflow_id, "started")
    return {"message": "Workflow started"}


@app.post("/workflows/{workflow_id}/stop")
async def stop_workflow(workflow_id: str):
    if not anomaly_injector.get_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not anomaly_injector.stop_workflow(workflow_id):
        raise HTTPException(status_code=400, detail="Could not stop workflow")
    
    await ws_manager.broadcast_workflow_update(workflow_id, "stopped")
    return {"message": "Workflow stopped"}


@app.get("/workflows/{workflow_id}/status")
async def get_workflow_status(workflow_id: str):
    if not anomaly_injector.get_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {
        "workflow_id": workflow_id,
        "is_active": anomaly_injector.is_workflow_active(workflow_id)
    }


@app.post("/test-cases")
async def create_test_case(workflow: Workflow, name: str, description: str = ""):
    workflow_id = anomaly_injector.add_workflow(workflow)
    test_case_id = db_manager.save_test_case(workflow, name, description)
    return {"test_case_id": test_case_id, "workflow_id": workflow_id}


@app.get("/test-cases")
async def list_test_cases():
    return db_manager.get_test_cases()


@app.get("/test-cases/{test_case_id}")
async def get_test_case(test_case_id: int):
    test_case = db_manager.get_test_case(test_case_id)
    if not test_case:
        raise HTTPException(status_code=404, detail="Test case not found")
    return test_case


@app.delete("/test-cases/{test_case_id}")
async def delete_test_case(test_case_id: int):
    if not db_manager.delete_test_case(test_case_id):
        raise HTTPException(status_code=404, detail="Test case not found")
    return {"message": "Test case deleted"}


@app.get("/injection-records")
async def list_injection_records(device_id: Optional[str] = None, limit: int = 100):
    return db_manager.get_injection_records(device_id, limit)


@app.post("/time-travel/start")
async def start_time_travel(request: TimeTravelRequest):
    try:
        playback_id = await time_travel_engine.start_playback(request)
        return {"playback_id": playback_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/time-travel/{playback_id}/stop")
async def stop_time_travel(playback_id: str):
    if not time_travel_engine.stop_playback(playback_id):
        raise HTTPException(status_code=404, detail="Playback not found")
    return {"message": "Playback stopped"}


@app.get("/time-travel/{playback_id}")
async def get_playback_status(playback_id: str):
    status = time_travel_engine.get_playback_status(playback_id)
    if not status:
        raise HTTPException(status_code=404, detail="Playback not found")
    return status


@app.get("/time-travel")
async def list_playbacks():
    return time_travel_engine.get_all_playbacks()


@app.get("/data/query")
async def query_data(
    device_id: str,
    start_time: datetime,
    end_time: datetime,
    metrics: Optional[List[str]] = None
):
    data = await time_travel_engine.query_data_range(device_id, start_time, end_time, metrics)
    return data


@app.get("/data/recent")
async def get_recent_data(
    device_id: str,
    minutes: int = Query(5, ge=1, le=60),
    is_injected: Optional[bool] = None
):
    if not db_manager._influxdb_query_api:
        raise HTTPException(status_code=503, detail="Database not connected")
    
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(minutes=minutes)
    
    injected_filter = ""
    if is_injected is not None:
        injected_filter = f'|> filter(fn: (r) => r["is_injected"] == "{str(is_injected).lower()}")'
    
    query = f'''
        from(bucket: "{settings.INFLUXDB_BUCKET}")
            |> range(start: {start_time.isoformat()}, stop: {end_time.isoformat()})
            |> filter(fn: (r) => r["device_id"] == "{device_id}")
            {injected_filter}
            |> sort(columns: ["_time"])
    '''
    
    try:
        tables = db_manager._influxdb_query_api.query(query, org=settings.INFLUXDB_ORG)
        result = []
        for table in tables:
            for record in table.records:
                result.append({
                    "timestamp": record.get_time().isoformat(),
                    "metric": record.get_field(),
                    "value": record.get_value(),
                    "device_id": record.values.get("device_id"),
                    "is_injected": record.values.get("is_injected") == "true"
                })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, device_id: Optional[str] = None):
    await ws_manager.handle_websocket(websocket, device_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.BACKEND_HOST,
        port=settings.BACKEND_PORT,
        reload=True
    )
