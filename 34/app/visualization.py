import io
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from matplotlib.figure import Figure


def plot_hydrograph(
    flow,
    time_step,
    sub_flows=None,
    n_subbasins=0,
    rainfall=None,
    title="Watershed Outlet Hydrograph",
    output_format="png",
    dpi=150,
):
    n_time = len(flow)
    time_hours = np.arange(n_time) * time_step / 3600.0

    fig, ax1 = plt.subplots(figsize=(12, 6))

    if rainfall is not None and len(rainfall) > 0:
        ax2 = ax1.twinx()
        rain_time = np.arange(len(rainfall)) * time_step / 3600.0
        ax2.bar(rain_time, rainfall, width=time_step / 3600.0 * 0.8,
                color="lightskyblue", alpha=0.5, label="Rainfall")
        ax2.set_ylabel("Rainfall Intensity (mm/h)", color="steelblue", fontsize=11)
        ax2.invert_yaxis()
        ax2.tick_params(axis="y", labelcolor="steelblue")

    if sub_flows is not None and n_subbasins > 1:
        cmap = plt.cm.Set2
        for s in range(n_subbasins):
            color = cmap(s / max(n_subbasins - 1, 1))
            ax1.plot(time_hours, sub_flows[s], "--", color=color,
                     alpha=0.7, linewidth=1.0, label=f"Sub-basin {s + 1}")

    ax1.plot(time_hours, flow, "b-", linewidth=2.0, label="Total Flow")
    ax1.fill_between(time_hours, flow, alpha=0.15, color="blue")

    peak_idx = np.argmax(flow)
    peak_flow = flow[peak_idx]
    peak_time = time_hours[peak_idx]
    ax1.annotate(
        f"Peak: {peak_flow:.2f} m³/s\nTime: {peak_time:.1f} h",
        xy=(peak_time, peak_flow),
        xytext=(peak_time + n_time * time_step / 3600.0 * 0.05, peak_flow * 0.9),
        arrowprops=dict(arrowstyle="->", color="red"),
        fontsize=10,
        color="red",
        bbox=dict(boxstyle="round,pad=0.3", facecolor="lightyellow", edgecolor="red", alpha=0.8),
    )

    ax1.set_xlabel("Time (hours)", fontsize=12)
    ax1.set_ylabel("Discharge (m³/s)", fontsize=12)
    ax1.set_title(title, fontsize=14, fontweight="bold")
    ax1.legend(loc="upper right", fontsize=9)
    ax1.grid(True, alpha=0.3)
    ax1.set_xlim(0, time_hours[-1])
    ax1.set_ylim(bottom=0)

    plt.tight_layout()

    if output_format == "png":
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return buf
    elif output_format == "svg":
        buf = io.BytesIO()
        fig.savefig(buf, format="svg", bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return buf
    else:
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return buf


def plot_subbasins_map(labels, dem, outlets, cell_size=30.0):
    rows, cols = labels.shape
    n_sub = len(outlets)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    ax0 = axes[0]
    im0 = ax0.imshow(dem, cmap="terrain", aspect="equal")
    ax0.set_title("DEM Elevation", fontsize=12, fontweight="bold")
    ax0.set_xlabel("Column")
    ax0.set_ylabel("Row")
    plt.colorbar(im0, ax=ax0, label="Elevation (m)", shrink=0.8)

    ax1 = axes[1]
    display_labels = labels.copy().astype(float)
    display_labels[display_labels == 0] = np.nan

    cmap_sub = plt.cm.Set2
    bounds = np.arange(0.5, n_sub + 1.5, 1)
    norm = mcolors.BoundaryNorm(bounds, cmap_sub.N)

    im1 = ax1.imshow(display_labels, cmap=cmap_sub, norm=norm, aspect="equal")
    ax1.set_title(f"Sub-basin Map ({n_sub} sub-basins)", fontsize=12, fontweight="bold")
    ax1.set_xlabel("Column")
    ax1.set_ylabel("Row")

    for s, (oi, oj) in enumerate(outlets):
        ax1.plot(oj, oi, "r*", markersize=12, markeredgecolor="black", markeredgewidth=0.5)
        ax1.annotate(f"O{s+1}", (oj, oi), textcoords="offset points",
                     xytext=(5, 5), fontsize=8, color="red", fontweight="bold")

    cbar = plt.colorbar(im1, ax=ax1, shrink=0.8)
    cbar.set_ticks(range(1, n_sub + 1))
    cbar.set_ticklabels([f"Sub-{i+1}" for i in range(n_sub)])

    plt.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def generate_csv(flow, time_step, sub_flows=None, n_subbasins=0):
    n_time = len(flow)
    time_hours = np.arange(n_time) * time_step / 3600.0

    lines = []
    if sub_flows is not None and n_subbasins > 1:
        header = "time_h,total_flow_m3s"
        for s in range(n_subbasins):
            header += f",subbasin_{s+1}_flow_m3s"
        lines.append(header)
        for t in range(n_time):
            line = f"{time_hours[t]:.2f},{flow[t]:.4f}"
            for s in range(n_subbasins):
                line += f",{sub_flows[s, t]:.4f}"
            lines.append(line)
    else:
        lines.append("time_h,total_flow_m3s")
        for t in range(n_time):
            lines.append(f"{time_hours[t]:.2f},{flow[t]:.4f}")

    return "\n".join(lines)
