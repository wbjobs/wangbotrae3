import numpy as np
from flask import Flask, send_from_directory
from flask_sock import Sock
import json
import threading
import time
import random

app = Flask(__name__)
sock = Sock(app)

BOX_SIZE = 10.0
NUM_PARTICLES = 200
SIGMA = 1.0
EPSILON = 1.0
MASS = 1.0
DT = 0.02
K_B = 1.0
TARGET_TEMP = 1.0
FPS = 60

def initialize_positions():
    positions = np.zeros((NUM_PARTICLES, 3))
    grid_size = int(np.ceil(NUM_PARTICLES ** (1/3)))
    spacing = BOX_SIZE / (grid_size + 1)
    idx = 0
    for x in range(grid_size):
        for y in range(grid_size):
            for z in range(grid_size):
                if idx < NUM_PARTICLES:
                    positions[idx] = [(x + 1) * spacing, (y + 1) * spacing, (z + 1) * spacing]
                    idx += 1
    return positions

positions = initialize_positions()
velocities = (np.random.rand(NUM_PARTICLES, 3) - 0.5) * 0.5
forces = np.zeros((NUM_PARTICLES, 3))

current_client = None
client_lock = threading.Lock()


def apply_pbc(pos):
    return pos - BOX_SIZE * np.floor(pos / BOX_SIZE)


def compute_forces_and_potential():
    global positions
    forces = np.zeros((NUM_PARTICLES, 3))
    potential = 0.0

    for i in range(NUM_PARTICLES):
        for j in range(i + 1, NUM_PARTICLES):
            r_vec = positions[i] - positions[j]
            r_vec = apply_pbc(r_vec)
            r_sq = np.sum(r_vec ** 2)

            if r_sq < (BOX_SIZE / 2) ** 2 and r_sq > 0.01:
                r = np.sqrt(r_sq)
                sigma_over_r = SIGMA / r
                sigma_over_r6 = sigma_over_r ** 6
                sigma_over_r12 = sigma_over_r6 ** 2

                force_mag = 24 * EPSILON * (2 * sigma_over_r12 - sigma_over_r6) / r_sq
                force_vec = force_mag * r_vec

                forces[i] += force_vec
                forces[j] -= force_vec
                potential += 4 * EPSILON * (sigma_over_r12 - sigma_over_r6)

    return forces, potential


def compute_kinetic_energy():
    return 0.5 * MASS * np.sum(velocities ** 2)


def velocity_verlet_step():
    global positions, velocities, forces

    positions += velocities * DT + 0.5 * forces / MASS * DT ** 2
    positions = apply_pbc(positions)

    new_forces, potential = compute_forces_and_potential()

    velocities += 0.5 * (forces + new_forces) / MASS * DT

    forces = new_forces

    kinetic = compute_kinetic_energy()
    temperature = (2.0 / 3.0) * kinetic / (NUM_PARTICLES * K_B)

    if temperature > 0.1:
        scale = np.sqrt(TARGET_TEMP / temperature)
        velocities *= scale
        kinetic = compute_kinetic_energy()
        temperature = (2.0 / 3.0) * kinetic / (NUM_PARTICLES * K_B)

    return positions, velocities, kinetic, potential, temperature


def simulation_loop():
    global forces
    forces, _ = compute_forces_and_potential()

    frame_interval = 1.0 / FPS

    while True:
        frame_start = time.time()

        pos, vel, kinetic, potential, temperature = velocity_verlet_step()

        with client_lock:
            if current_client is not None:
                try:
                    data = {
                        'positions': pos.flatten().tolist(),
                        'velocities': vel.flatten().tolist(),
                        'kinetic_energy': float(kinetic),
                        'potential_energy': float(potential),
                        'temperature': float(temperature)
                    }
                    current_client.send(json.dumps(data))
                except:
                    pass

        elapsed = time.time() - frame_start
        sleep_time = max(0, frame_interval - elapsed)
        time.sleep(sleep_time)


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@sock.route('/ws')
def websocket(ws):
    global current_client

    with client_lock:
        current_client = ws

    while True:
        try:
            message = ws.receive()
            if message is None:
                break
            data = json.loads(message)
            if data.get('action') == 'apply_force':
                idx = random.randint(0, NUM_PARTICLES - 1)
                impulse = np.random.randn(3) * 5.0
                velocities[idx] += impulse / MASS
        except:
            break

    with client_lock:
        if current_client == ws:
            current_client = None


if __name__ == '__main__':
    sim_thread = threading.Thread(target=simulation_loop, daemon=True)
    sim_thread.start()
    app.run(host='0.0.0.0', port=5000, debug=False)
