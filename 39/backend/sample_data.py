import json
import numpy as np
import os


def generate_sample_bscan() -> dict:
    num_traces = 50
    num_samples = 256
    c = 3e8
    dielectric_constant = 6.0
    velocity = c / np.sqrt(dielectric_constant)
    twt_start = 0.0
    twt_end = 200e-9
    twt = np.linspace(twt_start, twt_end, num_samples)

    pipes = [
        {"x_center": 1.5, "y_pos": 0.0, "depth": 0.8, "radius": 0.15, "amplitude": 0.8},
        {"x_center": 3.0, "y_pos": 0.5, "depth": 1.2, "radius": 0.20, "amplitude": 0.6},
        {"x_center": 4.5, "y_pos": -0.3, "depth": 0.5, "radius": 0.10, "amplitude": 0.9},
    ]

    traces = []
    x_positions = np.linspace(0.0, 5.0, num_traces)

    for i, x in enumerate(x_positions):
        samples = []
        signal = np.zeros(num_samples)

        for pipe in pipes:
            dx = x - pipe["x_center"]
            hyperbolic_depth = pipe["depth"] + np.sqrt(dx ** 2 + pipe["radius"] ** 2)
            twt_pipe = 2.0 * hyperbolic_depth / velocity
            idx = np.argmin(np.abs(twt - twt_pipe))
            sigma = 8
            wavelet = pipe["amplitude"] * np.exp(-0.5 * ((np.arange(num_samples) - idx) / sigma) ** 2)
            ricker = wavelet * (1 - 2 * ((np.arange(num_samples) - idx) / sigma) ** 2)
            signal += ricker

        noise = np.random.normal(0, 0.05, num_samples)
        signal = signal + noise

        for j in range(num_samples):
            samples.append({
                "two_way_time": float(twt[j]),
                "amplitude": float(signal[j]),
            })

        traces.append({
            "position": [float(x), float(pipes[0]["y_pos"]) if i % 2 == 0 else float(pipes[1]["y_pos"])],
            "samples": samples,
        })

    return {"traces": traces}


def main() -> None:
    bscan_data = generate_sample_bscan()
    output_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(output_dir, "sample_bscan.json")

    with open(output_path, "w") as f:
        json.dump(bscan_data, f, indent=2)

    print(f"Sample B-scan data saved to {output_path}")


if __name__ == "__main__":
    main()
