#!/usr/bin/env python3
import argparse
import json
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from typing import List

import requests

API_ENDPOINT = "http://localhost:8080/api/v1/logs"

LOG_TEMPLATES = [
    "CPU usage at {value}% on core {core}",
    "Memory usage: {value}MB / {total}MB",
    "Disk I/O error on device {device}",
    "Network connection from {ip}:{port}",
    "Connection timeout after {seconds}s",
    "Failed to read file: {path}",
    "Successfully processed request {request_id} in {ms}ms",
    "Warning: temperature {temp}C exceeds threshold {threshold}C",
    "Service {service} restarted (attempt {attempt})",
    "Database query executed in {ms}ms (rows: {rows})",
    "Authentication failed for user {user}",
    "Cache miss for key {key}",
    "Rate limit exceeded for IP {ip}",
    "SSL certificate expiring in {days} days",
    "Pod {pod_name} scheduled on node {node}",
]

LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]


@dataclass
class EdgeNode:
    node_id: str
    anomaly_probability: float = 0.1
    base_interval: float = 1.0


def generate_log_message(template: str) -> str:
    values = {
        "value": random.randint(0, 100),
        "core": random.randint(0, 7),
        "total": random.choice([4096, 8192, 16384]),
        "device": random.choice(["sda", "sdb", "nvme0n1", "vda"]),
        "ip": f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}",
        "port": random.randint(1024, 65535),
        "seconds": random.randint(1, 120),
        "path": f"/var/log/{random.choice(['app', 'system', 'nginx'])}/log{random.randint(1, 10)}.log",
        "request_id": f"{random.randint(100000, 999999)}",
        "ms": random.randint(1, 5000),
        "temp": random.randint(30, 90),
        "threshold": random.choice([70, 75, 80]),
        "service": random.choice(["api", "worker", "cache", "db", "monitor"]),
        "attempt": random.randint(1, 5),
        "rows": random.randint(0, 10000),
        "user": f"user{random.randint(1, 1000)}",
        "key": f"cache:{random.choice(['user', 'session', 'data'])}:{random.randint(1, 10000)}",
        "days": random.randint(1, 30),
        "pod_name": f"{random.choice(['web', 'api', 'worker'])}-{random.randint(1, 50)}",
        "node": f"k8s-node-{random.randint(1, 20)}",
    }
    return template.format(**values)


def send_log(node_id: str, message: str, level: str = "INFO") -> bool:
    payload = {
        "node_id": node_id,
        "message": message,
        "level": level,
        "timestamp": int(time.time()),
    }
    try:
        response = requests.post(API_ENDPOINT, json=payload, timeout=5)
        return response.status_code == 201
    except Exception as e:
        print(f"[{node_id}] Error sending log: {e}")
        return False


def simulate_node(node: EdgeNode, duration: int, burst_mode: bool = False):
    start_time = time.time()
    logs_sent = 0
    anomalies_generated = 0

    print(f"[{node.node_id}] Starting simulation for {duration}s...")

    while time.time() - start_time < duration:
        template = random.choice(LOG_TEMPLATES)

        if burst_mode and random.random() < node.anomaly_probability:
            burst_count = random.randint(60, 150)
            level = random.choice(["ERROR", "CRITICAL"])
            for _ in range(burst_count):
                message = generate_log_message(template)
                if send_log(node.node_id, message, level):
                    logs_sent += 1
                    anomalies_generated += 1
            print(f"[{node.node_id}] Generated anomaly burst: {burst_count} logs")
            time.sleep(node.base_interval)
        else:
            level = random.choices(LEVELS, weights=[5, 60, 25, 8, 2])[0]
            message = generate_log_message(template)
            if send_log(node.node_id, message, level):
                logs_sent += 1

            time.sleep(random.uniform(node.base_interval * 0.5, node.base_interval * 2))

    print(f"[{node.node_id}] Simulation complete. Sent {logs_sent} logs, {anomalies_generated} anomaly logs")
    return logs_sent, anomalies_generated


def run_simulation(num_nodes: int, duration: int, burst_mode: bool, concurrency: int):
    nodes = [
        EdgeNode(
            node_id=f"edge-node-{i:03d}",
            anomaly_probability=random.uniform(0.05, 0.15),
            base_interval=random.uniform(0.3, 2.0),
        )
        for i in range(num_nodes)
    ]

    print(f"Starting simulation with {num_nodes} edge nodes...")
    print(f"Duration: {duration}s, Burst mode: {burst_mode}, Concurrency: {concurrency}")
    print("-" * 60)

    total_logs = 0
    total_anomalies = 0

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = []
        for node in nodes:
            future = executor.submit(simulate_node, node, duration, burst_mode)
            futures.append(future)

        for future in as_completed(futures):
            logs, anomalies = future.result()
            total_logs += logs
            total_anomalies += anomalies

    print("=" * 60)
    print(f"Simulation complete!")
    print(f"Total logs sent: {total_logs}")
    print(f"Total anomaly logs: {total_anomalies}")
    print(f"Average logs/node: {total_logs / num_nodes:.1f}")


def main():
    parser = argparse.ArgumentParser(description="Edge Node Log Simulator")
    parser.add_argument("-n", "--nodes", type=int, default=10, help="Number of edge nodes (default: 10)")
    parser.add_argument("-d", "--duration", type=int, default=60, help="Simulation duration in seconds (default: 60)")
    parser.add_argument("-b", "--burst", action="store_true", help="Enable anomaly burst mode")
    parser.add_argument("-c", "--concurrency", type=int, default=20, help="Max concurrent threads (default: 20)")
    parser.add_argument("-e", "--endpoint", type=str, default=API_ENDPOINT, help="API endpoint")

    args = parser.parse_args()

    global API_ENDPOINT
    API_ENDPOINT = args.endpoint

    run_simulation(args.nodes, args.duration, args.burst, args.concurrency)


if __name__ == "__main__":
    main()
