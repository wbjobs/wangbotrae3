import json
import redis
import asyncio
import numpy as np
import time
from collections import defaultdict
from typing import Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from config import CHANNELS_CONFIG, REDIS_CONFIG, ANOMALY_CONFIG, MULTI_PATIENT_CONFIG, PATIENT_PROFILES
from feature_extractor import FeatureExtractor
from anomaly_detector import AnomalyDetector
from anomaly_clustering import AnomalyPatternRecognizer
from report_generator import ReportGenerator

app = FastAPI(title="多患者生理信号实时监测系统")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_client = redis.Redis(
    host=REDIS_CONFIG['host'],
    port=REDIS_CONFIG['port'],
    db=REDIS_CONFIG['db']
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

class PatientProcessor:
    def __init__(self, patient_id):
        self.patient_id = patient_id
        self.feature_extractors = {
            channel: FeatureExtractor(config['sampling_rate'])
            for channel, config in CHANNELS_CONFIG.items()
        }
        self.anomaly_detectors = {
            channel: AnomalyDetector(channel)
            for channel in CHANNELS_CONFIG.keys()
        }
        self.channel_buffers = {
            channel: []
            for channel in CHANNELS_CONFIG.keys()
        }
        self.anomaly_history = []

BUFFER_SIZE = 1000

patient_processors: Dict[str, PatientProcessor] = {
    pid: PatientProcessor(pid)
    for pid in PATIENT_PROFILES.keys()
}

pattern_recognizer = AnomalyPatternRecognizer()
report_generator = ReportGenerator()

global_anomaly_history = []
heatmap_data = defaultdict(lambda: defaultdict(int))
HEATMAP_BINS = MULTI_PATIENT_CONFIG['heatmap_time_bins']

class AnomalyLabelRequest(BaseModel):
    patient_id: str
    channel: str
    anomaly_id: int
    status: str
    notes: Optional[str] = ""

class BaselineResetRequest(BaseModel):
    patient_id: Optional[str] = None
    channel: Optional[str] = None

class ReportRequest(BaseModel):
    patient_ids: List[str]
    channel: str
    format: str = "html"

@app.get("/")
async def root():
    return {"message": "多患者生理信号实时监测系统 API"}

@app.get("/api/patients")
async def get_patients():
    return {
        pid: {
            **profile,
            'id': pid,
            'color': MULTI_PATIENT_CONFIG['patient_colors'][
                list(PATIENT_PROFILES.keys()).index(pid) % len(MULTI_PATIENT_CONFIG['patient_colors'])
            ]
        }
        for pid, profile in PATIENT_PROFILES.items()
    }

@app.get("/api/channels")
async def get_channels():
    return CHANNELS_CONFIG

@app.get("/api/anomalies")
async def get_anomalies(patient_id: Optional[str] = None):
    if patient_id:
        if patient_id not in patient_processors:
            raise HTTPException(status_code=404, detail="Patient not found")
        return {patient_id: patient_processors[patient_id].anomaly_history}
    
    all_anomalies = []
    for pid, processor in patient_processors.items():
        for anomaly in processor.anomaly_history:
            anomaly['patient_id'] = pid
            all_anomalies.append(anomaly)
    all_anomalies.sort(key=lambda x: x.get('start_time', 0), reverse=True)
    return {'all': all_anomalies}

@app.post("/api/anomalies/label")
async def label_anomaly(request: AnomalyLabelRequest):
    if request.patient_id not in patient_processors:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    processor = patient_processors[request.patient_id]
    success = processor.anomaly_detectors[request.channel].label_anomaly(
        request.anomaly_id,
        request.status,
        request.notes
    )
    
    if not success:
        raise HTTPException(status_code=404, detail="Anomaly not found")
    
    return {"success": True}

@app.get("/api/baseline/status")
async def get_baseline_status(patient_id: Optional[str] = None):
    current_time = time.time()
    if patient_id:
        if patient_id not in patient_processors:
            raise HTTPException(status_code=404, detail="Patient not found")
        processor = patient_processors[patient_id]
        return {
            patient_id: {
                channel: detector.get_baseline_status(current_time)
                for channel, detector in processor.anomaly_detectors.items()
            }
        }
    result = {}
    for pid, processor in patient_processors.items():
        result[pid] = {
            channel: detector.get_baseline_status(current_time)
            for channel, detector in processor.anomaly_detectors.items()
        }
    return result

@app.post("/api/baseline/reset")
async def reset_baseline(request: BaselineResetRequest):
    if request.patient_id:
        if request.patient_id not in patient_processors:
            raise HTTPException(status_code=404, detail="Patient not found")
        processor = patient_processors[request.patient_id]
        if request.channel:
            if request.channel in processor.anomaly_detectors:
                processor.anomaly_detectors[request.channel].reset_baseline()
        else:
            for detector in processor.anomaly_detectors.values():
                detector.reset_baseline()
        return {"success": True, "patient_id": request.patient_id, "message": "基线已重置"}
    else:
        for processor in patient_processors.values():
            for detector in processor.anomaly_detectors.values():
                detector.reset_baseline()
        return {"success": True, "message": "所有患者基线已重置"}

@app.get("/api/heatmap")
async def get_heatmap():
    global heatmap_data
    times = sorted(heatmap_data.keys())[-HEATMAP_BINS:]
    channels = list(CHANNELS_CONFIG.keys())
    
    heatmap_matrix = []
    for t in times:
        row = []
        for ch in channels:
            row.append(heatmap_data[t][ch])
        heatmap_matrix.append(row)
    
    return {
        'times': times,
        'channels': channels,
        'matrix': heatmap_matrix
    }

@app.get("/api/clusters")
async def get_clusters():
    return {
        'clusters': pattern_recognizer.get_clusters_summary(),
        'statistics': pattern_recognizer.get_pattern_statistics()
    }

@app.post("/api/report/generate")
async def generate_report(request: ReportRequest):
    patients_data = {}
    for pid in request.patient_ids:
        if pid in patient_processors:
            patients_data[pid] = {
                'name': PATIENT_PROFILES[pid]['name'],
                'anomalies': patient_processors[pid].anomaly_history[-100:]
            }
    
    html_report = report_generator.generate_comparison_report(
        patients_data,
        request.channel,
        None
    )
    
    return Response(
        content=html_report,
        media_type="text/html",
        headers={"Content-Disposition": f"attachment; filename=comparison_report.html"}
    )

@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        last_id = '0-0'
        while True:
            try:
                messages = redis_client.xread(
                    {REDIS_CONFIG['stream_name']: last_id},
                    count=10,
                    block=100
                )
                
                if messages:
                    for stream, message_list in messages:
                        for msg_id, msg_data in message_list:
                            last_id = msg_id
                            data = json.loads(msg_data[b'data'])
                            
                            processed_data = process_multi_patient_data(data)
                            await manager.broadcast(processed_data)
                            
            except Exception as e:
                print(f"Error reading stream: {e}")
            
            await asyncio.sleep(0.01)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)

def process_multi_patient_data(data: dict) -> dict:
    global global_anomaly_history, heatmap_data
    
    timestamp = data['timestamp']
    patients_data = data.get('patients', {})
    
    result = {
        'timestamp': timestamp,
        'patients': {},
        'all_anomalies': [],
        'heatmap_update': {}
    }
    
    time_bin = int(timestamp)
    
    for patient_id, patient_data in patients_data.items():
        if patient_id not in patient_processors:
            continue
        
        processor = patient_processors[patient_id]
        channels_data = patient_data['channels']
        
        patient_result = {
            'channels': {},
            'anomalies': []
        }
        
        for channel, channel_data in channels_data.items():
            values = channel_data['values']
            timestamps = channel_data['timestamps']
            
            processor.channel_buffers[channel].extend(values)
            if len(processor.channel_buffers[channel]) > BUFFER_SIZE:
                processor.channel_buffers[channel] = processor.channel_buffers[channel][-BUFFER_SIZE:]
            
            if len(values) >= 50:
                features = processor.feature_extractors[channel].extract_all(np.array(values))
                time_features = {k: features[k] for k in ['mean', 'variance', 'peak', 'rms', 'zero_crossing_rate']}
                freq_features = {k: features[k] for k in ['delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power']}
                
                anomaly_result = processor.anomaly_detectors[channel].detect_combined(
                    time_features,
                    freq_features,
                    timestamp
                )
                
                if anomaly_result['is_anomaly']:
                    clustered_event = pattern_recognizer.add_event(
                        patient_id,
                        {
                            **anomaly_result,
                            'score': anomaly_result['combined_score'],
                            'timestamp': timestamp
                        }
                    )
                    patient_result['anomalies'].append(clustered_event)
                    result['all_anomalies'].append({
                        **clustered_event,
                        'patient_id': patient_id,
                        'patient_name': PATIENT_PROFILES[patient_id]['name']
                    })
                    
                    heatmap_data[time_bin][channel] += 1
                    processor.anomaly_history.append({
                        'start_time': timestamp,
                        'channel': channel,
                        'score': anomaly_result['combined_score'],
                        'status': 'detected'
                    })
                
                spectrogram, frequencies = processor.feature_extractors[channel].extract_spectrogram(np.array(values))
                
                patient_result['channels'][channel] = {
                    'values': values,
                    'timestamps': timestamps,
                    'features': features,
                    'spectrogram': spectrogram.tolist(),
                    'frequencies': frequencies.tolist()
                }
            else:
                patient_result['channels'][channel] = {
                    'values': values,
                    'timestamps': timestamps
                }
        
        result['patients'][patient_id] = patient_result
    
    if len(heatmap_data) > HEATMAP_BINS * 2:
        old_times = sorted(heatmap_data.keys())[:-HEATMAP_BINS]
        for t in old_times:
            del heatmap_data[t]
    
    return result

@app.on_event("startup")
async def startup_event():
    try:
        redis_client.ping()
        print("Redis连接成功")
    except redis.ConnectionError:
        print("警告: Redis连接失败，请确保Redis服务已启动")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
