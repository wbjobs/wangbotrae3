import numpy as np
import asyncio
import concurrent.futures
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import threading

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

SINGULARITY_THRESHOLD = 0.2
MAX_CONCURRENT = 4

m = np.array([0, 0, 1.0])
executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENT)

def magnetic_dipole_field(r):
    r_mag = np.linalg.norm(r)
    if r_mag < 1e-6:
        return np.array([0, 0, 0])
    r_hat = r / r_mag
    m_dot_rhat = np.dot(m, r_hat)
    B = (3 * m_dot_rhat * r_hat - m) / (r_mag ** 3)
    return B

def generate_vector_field():
    grid_size = 20
    x = np.linspace(-5, 5, grid_size)
    y = np.linspace(-5, 5, grid_size)
    z = np.linspace(-5, 5, grid_size)
    
    vectors = []
    for i in range(grid_size):
        for j in range(grid_size):
            for k in range(grid_size):
                if i % 2 == 0 and j % 2 == 0 and k % 2 == 0:
                    r = np.array([x[i], y[j], z[k]])
                    B = magnetic_dipole_field(r)
                    vectors.append({
                        'position': [float(x[i]), float(y[j]), float(z[k])],
                        'vector': [float(B[0]), float(B[1]), float(B[2])],
                        'magnitude': float(np.linalg.norm(B))
                    })
    return vectors

def check_singularity(seed_point):
    r = np.array(seed_point, dtype=float)
    return np.linalg.norm(r) < SINGULARITY_THRESHOLD

def rk4_integrate(seed_point, step_size=0.1, max_steps=50, sid=None, streamline_id=None):
    points_forward = []
    points_backward = []
    
    current = np.array(seed_point, dtype=float)
    points_forward.append(current.copy())
    
    for step in range(max_steps):
        k1 = magnetic_dipole_field(current)
        k2 = magnetic_dipole_field(current + 0.5 * step_size * k1)
        k3 = magnetic_dipole_field(current + 0.5 * step_size * k2)
        k4 = magnetic_dipole_field(current + step_size * k3)
        
        current = current + (step_size / 6.0) * (k1 + 2*k2 + 2*k3 + k4)
        
        if np.linalg.norm(current) > 10 or np.linalg.norm(current) < 0.1:
            break
        
        if np.any(np.isnan(current)) or np.any(np.isinf(current)):
            break
        
        points_forward.append(current.copy())
        
        if sid and streamline_id is not None:
            socketio.emit('streamline_progress', {
                'streamline_id': streamline_id,
                'phase': 'forward',
                'step': step + 1,
                'total': max_steps,
                'point': [float(current[0]), float(current[1]), float(current[2])]
            }, room=sid)
    
    current = np.array(seed_point, dtype=float)
    
    for step in range(max_steps):
        k1 = -magnetic_dipole_field(current)
        k2 = -magnetic_dipole_field(current + 0.5 * step_size * k1)
        k3 = -magnetic_dipole_field(current + 0.5 * step_size * k2)
        k4 = -magnetic_dipole_field(current + step_size * k3)
        
        current = current + (step_size / 6.0) * (k1 + 2*k2 + 2*k3 + k4)
        
        if np.linalg.norm(current) > 10 or np.linalg.norm(current) < 0.1:
            break
        
        if np.any(np.isnan(current)) or np.any(np.isinf(current)):
            break
        
        points_backward.insert(0, current.copy())
        
        if sid and streamline_id is not None:
            socketio.emit('streamline_progress', {
                'streamline_id': streamline_id,
                'phase': 'backward',
                'step': step + 1,
                'total': max_steps,
                'point': [float(current[0]), float(current[1]), float(current[2])]
            }, room=sid)
    
    all_points = points_backward + points_forward
    return [[float(p[0]), float(p[1]), float(p[2])] for p in all_points]

async def compute_streamline_async(seed_point, step_size, max_steps, sid, streamline_id, loop):
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    async with semaphore:
        points = await loop.run_in_executor(
            executor, rk4_integrate, seed_point, step_size, max_steps, sid, streamline_id
        )
        return points

def run_async_batch(valid_tasks, step_size, max_steps, sid):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    async def compute_batch():
        tasks = []
        for original_index, sp in valid_tasks:
            tasks.append(compute_streamline_async(sp, step_size, max_steps, sid, original_index, loop))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for (original_index, sp), result in zip(valid_tasks, results):
            if isinstance(result, Exception):
                socketio.emit('streamline_error', {
                    'streamline_id': original_index,
                    'message': f'流线计算出错: {str(result)}'
                }, room=sid)
            else:
                socketio.emit('streamline_complete', {
                    'points': result,
                    'streamline_id': original_index
                }, room=sid)
    
    loop.run_until_complete(compute_batch())
    loop.close()

def run_async_single(seed_point, step_size, max_steps, sid):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    async def compute():
        points = await loop.run_in_executor(
            executor, rk4_integrate, seed_point, step_size, max_steps, sid, 0
        )
        socketio.emit('streamline_complete', {'points': points, 'streamline_id': 0}, room=sid)
    
    loop.run_until_complete(compute())
    loop.close()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/vector_field')
def get_vector_field():
    vectors = generate_vector_field()
    return jsonify({'vectors': vectors})

@app.route('/api/streamline', methods=['POST'])
def get_streamline():
    data = request.json
    seed_point = data.get('seed_point', [0, 0, 0])
    step_size = data.get('step_size', 0.1)
    max_steps = data.get('max_steps', 50)
    
    if check_singularity(seed_point):
        return jsonify({'error': '种子点距奇点过近（距离<0.2），请选择其他位置', 'points': []}), 400
    
    points = rk4_integrate(seed_point, step_size, max_steps)
    return jsonify({'points': points})

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('start_streamline')
def handle_start_streamline(data):
    seed_point = data.get('seed_point', [0, 0, 0])
    step_size = data.get('step_size', 0.1)
    max_steps = data.get('max_steps', 50)
    sid = request.sid
    
    if check_singularity(seed_point):
        emit('streamline_error', {
            'message': f'种子点距奇点过近（距离 {np.linalg.norm(np.array(seed_point)):.3f} < {SINGULARITY_THRESHOLD}），请选择其他位置'
        }, room=sid)
        return
    
    thread = threading.Thread(
        target=run_async_single,
        args=(seed_point, step_size, max_steps, sid)
    )
    thread.start()

@socketio.on('start_streamlines_batch')
def handle_start_streamlines_batch(data):
    seed_points = data.get('seed_points', [])
    step_size = data.get('step_size', 0.1)
    max_steps = data.get('max_steps', 50)
    sid = request.sid
    
    valid_tasks = []
    errors = []
    
    for i, sp in enumerate(seed_points):
        if check_singularity(sp):
            errors.append({
                'index': i,
                'seed_point': sp,
                'distance': float(np.linalg.norm(np.array(sp))),
                'message': f'种子点 [{sp[0]:.2f},{sp[1]:.2f},{sp[2]:.2f}] 距奇点过近（距离 {np.linalg.norm(np.array(sp)):.3f} < {SINGULARITY_THRESHOLD}）'
            })
        else:
            valid_tasks.append((i, sp))
    
    if errors:
        socketio.emit('streamline_batch_errors', {'errors': errors}, room=sid)
    
    if not valid_tasks:
        return
    
    thread = threading.Thread(
        target=run_async_batch,
        args=(valid_tasks, step_size, max_steps, sid)
    )
    thread.start()

def compute_cumulative_lengths(points):
    points_np = np.array(points)
    if len(points_np) < 2:
        return np.array([0.0])
    diffs = np.linalg.norm(points_np[1:] - points_np[:-1], axis=1)
    return np.cumsum(np.concatenate([[0], diffs]))

def sample_point_on_streamline(points, cum_lengths, t_param):
    total_len = cum_lengths[-1]
    target_len = t_param * total_len
    idx = np.searchsorted(cum_lengths, target_len) - 1
    idx = np.clip(idx, 0, len(cum_lengths) - 2)
    
    segment_start = cum_lengths[idx]
    segment_end = cum_lengths[idx + 1]
    segment_len = segment_end - segment_start
    
    if segment_len < 1e-10:
        return points[idx]
    
    local_t = (target_len - segment_start) / segment_len
    p0 = np.array(points[idx])
    p1 = np.array(points[idx + 1])
    return p0 + local_t * (p1 - p0)

def generate_particle_trajectory(streamline_points, start_t_param, speed=1.0, duration=3.0, fps=60):
    cum_lengths = compute_cumulative_lengths(streamline_points)
    total_len = cum_lengths[-1]
    total_frames = int(duration * fps)
    
    distance_per_frame = speed * total_len / (duration * fps)
    
    trajectory = []
    current_len = start_t_param * total_len
    
    for frame in range(total_frames):
        t_param = current_len / total_len
        if t_param > 1.0:
            t_param = t_param - int(t_param)
        elif t_param < 0:
            t_param = t_param - int(t_param) + 1
        
        pos = sample_point_on_streamline(streamline_points, cum_lengths, t_param)
        trajectory.append([float(pos[0]), float(pos[1]), float(pos[2])])
        current_len += distance_per_frame
    
    return trajectory

streamline_cache = {}
next_streamline_id = 0

@socketio.on('register_streamline')
def handle_register_streamline(data):
    global next_streamline_id
    points = data.get('points', [])
    sid = request.sid
    
    if sid not in streamline_cache:
        streamline_cache[sid] = {}
    
    streamline_id = next_streamline_id
    next_streamline_id += 1
    
    streamline_cache[sid][streamline_id] = {
        'points': points,
        'cum_lengths': compute_cumulative_lengths(points).tolist()
    }
    
    emit('streamline_registered', {'streamline_id': streamline_id}, room=sid)

@socketio.on('trace_particle')
def handle_trace_particle(data):
    streamline_id = data.get('streamline_id', 0)
    start_t_param = max(0.0, min(1.0, data.get('start_t', 0.5)))
    speed = max(0.1, min(5.0, data.get('speed', 1.0)))
    duration = max(1.0, min(10.0, data.get('duration', 3.0)))
    fps = data.get('fps', 60)
    sid = request.sid
    
    if sid not in streamline_cache or streamline_id not in streamline_cache[sid]:
        emit('particle_error', {'message': '流线不存在'}, room=sid)
        return
    
    streamline = streamline_cache[sid][streamline_id]
    points = streamline['points']
    
    def compute_trajectory():
        trajectory = generate_particle_trajectory(points, start_t_param, speed, duration, fps)
        emit('particle_trajectory', {
            'streamline_id': streamline_id,
            'trajectory': trajectory,
            'fps': fps
        }, room=sid)
    
    thread = threading.Thread(target=compute_trajectory)
    thread.start()

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
