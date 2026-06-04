import numpy as np
from numba import njit, prange


@njit(cache=True)
def _fill_pits_numba(dem, rows, cols):
    result = dem.copy()
    max_iter = rows * cols
    for iteration in range(max_iter):
        changed = False
        for i in range(rows):
            for j in range(cols):
                if result[i, j] < 0:
                    continue
                min_neighbor = 1e30
                has_valid_neighbor = False
                for di in range(-1, 2):
                    for dj in range(-1, 2):
                        if di == 0 and dj == 0:
                            continue
                        ni = i + di
                        nj_c = j + dj
                        if 0 <= ni < rows and 0 <= nj_c < cols:
                            if result[ni, nj_c] >= 0:
                                has_valid_neighbor = True
                                if result[ni, nj_c] < min_neighbor:
                                    min_neighbor = result[ni, nj_c]
                if has_valid_neighbor and min_neighbor > result[i, j]:
                    result[i, j] = min_neighbor + 0.001
                    changed = True
        if not changed:
            break
    return result


def fill_pits(dem):
    rows, cols = dem.shape
    return _fill_pits_numba(dem.astype(np.float64), rows, cols)


@njit(cache=True)
def _get_target_numba(code, i, j):
    ni = i
    nj = j
    if code == 1:
        ni = i - 1; nj = j
    elif code == 2:
        ni = i - 1; nj = j + 1
    elif code == 4:
        ni = i; nj = j + 1
    elif code == 8:
        ni = i + 1; nj = j + 1
    elif code == 16:
        ni = i + 1; nj = j
    elif code == 32:
        ni = i + 1; nj = j - 1
    elif code == 64:
        ni = i; nj = j - 1
    elif code == 128:
        ni = i - 1; nj = j - 1
    return ni, nj


@njit(cache=True)
def _is_diagonal(code):
    return code == 2 or code == 8 or code == 32 or code == 128


@njit(cache=True)
def _compute_flow_dir_numba(dem, rows, cols):
    d8_code = np.zeros((rows, cols), dtype=np.int32)
    d8_code[:, :] = -1
    dx = np.array([-1, -1, 0, 1, 1, 1, 0, -1], dtype=np.int32)
    dy = np.array([0, 1, 1, 1, 0, -1, -1, -1], dtype=np.int32)
    d8_vals = np.array([1, 2, 4, 8, 16, 32, 64, 128], dtype=np.int32)

    for i in range(rows):
        for j in range(cols):
            if dem[i, j] < 0:
                continue
            max_drop = 0.0
            steepest = -1
            for k in range(8):
                ni = i + dx[k]
                nj = j + dy[k]
                if 0 <= ni < rows and 0 <= nj < cols:
                    if dem[ni, nj] < 0:
                        continue
                    dist = 1.4142135623730951 if (dx[k] != 0 and dy[k] != 0) else 1.0
                    drop = (dem[i, j] - dem[ni, nj]) / dist
                    if drop > max_drop:
                        max_drop = drop
                        steepest = k
            if steepest >= 0:
                d8_code[i, j] = d8_vals[steepest]
    return d8_code


def compute_flow_direction(dem):
    rows, cols = dem.shape
    return _compute_flow_dir_numba(dem.astype(np.float64), rows, cols)


@njit(cache=True)
def _compute_flow_acc_numba(flow_dir, rows, cols):
    acc = np.ones((rows, cols), dtype=np.float64)
    in_count = np.zeros((rows, cols), dtype=np.int32)

    for i in range(rows):
        for j in range(cols):
            code = flow_dir[i, j]
            if code > 0:
                ni, nj = _get_target_numba(code, i, j)
                if 0 <= ni < rows and 0 <= nj < cols:
                    in_count[ni, nj] += 1

    stack = np.zeros((rows * cols, 2), dtype=np.int32)
    top = 0
    for i in range(rows):
        for j in range(cols):
            if in_count[i, j] == 0:
                stack[top, 0] = i
                stack[top, 1] = j
                top += 1

    while top > 0:
        top -= 1
        ci = stack[top, 0]
        cj = stack[top, 1]
        code = flow_dir[ci, cj]
        if code > 0:
            ni, nj = _get_target_numba(code, ci, cj)
            if 0 <= ni < rows and 0 <= nj < cols:
                acc[ni, nj] += acc[ci, cj]
                in_count[ni, nj] -= 1
                if in_count[ni, nj] == 0:
                    stack[top, 0] = ni
                    stack[top, 1] = nj
                    top += 1

    return acc


def compute_flow_accumulation(flow_dir):
    rows, cols = flow_dir.shape
    return _compute_flow_acc_numba(flow_dir.astype(np.int32), rows, cols)


@njit(cache=True)
def _extract_stream_network_numba(flow_acc, threshold, rows, cols):
    stream = np.zeros((rows, cols), dtype=np.int32)
    for i in range(rows):
        for j in range(cols):
            if flow_acc[i, j] >= threshold:
                stream[i, j] = 1
    return stream


def extract_stream_network(flow_acc, threshold_ratio=0.02):
    threshold = flow_acc.max() * threshold_ratio
    if threshold < 2:
        threshold = 2
    rows, cols = flow_acc.shape
    return _extract_stream_network_numba(flow_acc, threshold, rows, cols)


@njit(cache=True)
def _delineate_subbasins_numba(flow_dir, stream, outlet_i, outlet_j, rows, cols):
    labels = np.zeros((rows, cols), dtype=np.int32)
    stack = np.zeros((rows * cols, 2), dtype=np.int32)

    top = 0
    stack[top, 0] = outlet_i
    stack[top, 1] = outlet_j
    top += 1

    while top > 0:
        top -= 1
        ci = stack[top, 0]
        cj = stack[top, 1]
        if labels[ci, cj] != 0:
            continue
        labels[ci, cj] = 1

        for di in range(-1, 2):
            for dj in range(-1, 2):
                if di == 0 and dj == 0:
                    continue
                ni = ci + di
                nj = cj + dj
                if 0 <= ni < rows and 0 <= nj < cols:
                    if labels[ni, nj] != 0:
                        continue
                    code = flow_dir[ni, nj]
                    if code > 0:
                        ti, tj = _get_target_numba(code, ni, nj)
                        if ti == ci and tj == cj:
                            stack[top, 0] = ni
                            stack[top, 1] = nj
                            top += 1

    return labels


@njit(cache=True)
def _find_outlets_numba(flow_dir, stream, flow_acc, rows, cols):
    n_junctions_max = rows * cols
    junction_i = np.zeros(n_junctions_max, dtype=np.int32)
    junction_j = np.zeros(n_junctions_max, dtype=np.int32)
    n_junctions = 0

    for i in range(rows):
        for j in range(cols):
            if stream[i, j] == 0:
                continue
            inflow_count = 0
            for di in range(-1, 2):
                for dj in range(-1, 2):
                    if di == 0 and dj == 0:
                        continue
                    ni = i + di
                    nj = j + dj
                    if 0 <= ni < rows and 0 <= nj < cols:
                        code = flow_dir[ni, nj]
                        if code <= 0:
                            continue
                        ti, tj = _get_target_numba(code, ni, nj)
                        if ti == i and tj == j:
                            inflow_count += 1
            if inflow_count >= 2 and n_junctions < n_junctions_max:
                junction_i[n_junctions] = i
                junction_j[n_junctions] = j
                n_junctions += 1

    n_outlets_max = rows * cols
    outlet_i = np.zeros(n_outlets_max, dtype=np.int32)
    outlet_j = np.zeros(n_outlets_max, dtype=np.int32)
    n_outlets = 0

    for i in range(rows):
        for j in range(cols):
            code = flow_dir[i, j]
            if code <= 0 and stream[i, j] == 1 and n_outlets < n_outlets_max:
                outlet_i[n_outlets] = i
                outlet_j[n_outlets] = j
                n_outlets += 1

    if n_outlets == 0:
        max_acc_val = -1.0
        best_i = 0
        best_j = 0
        for i in range(rows):
            for j in range(cols):
                if stream[i, j] == 1 and flow_acc[i, j] > max_acc_val:
                    max_acc_val = flow_acc[i, j]
                    best_i = i
                    best_j = j
        outlet_i[0] = best_i
        outlet_j[0] = best_j
        n_outlets = 1

    return junction_i[:n_junctions], junction_j[:n_junctions], outlet_i[:n_outlets], outlet_j[:n_outlets]


def partition_subbasins(flow_dir, stream, n_subbasins_target=4):
    rows, cols = flow_dir.shape
    flow_dir_i32 = flow_dir.astype(np.int32)
    flow_acc = compute_flow_accumulation(flow_dir)

    junc_i, junc_j, out_i, out_j = _find_outlets_numba(flow_dir_i32, stream, flow_acc, rows, cols)

    if len(out_i) == 0:
        return np.zeros((rows, cols), dtype=np.int32), [(0, 0)]

    main_outlet = (int(out_i[0]), int(out_j[0]))
    max_acc = -1
    for k in range(len(out_i)):
        oi, oj = int(out_i[k]), int(out_j[k])
        if flow_acc[oi, oj] > max_acc:
            max_acc = flow_acc[oi, oj]
            main_outlet = (oi, oj)

    watershed = _delineate_subbasins_numba(
        flow_dir_i32, stream, main_outlet[0], main_outlet[1], rows, cols
    )

    labels = np.zeros((rows, cols), dtype=np.int32)
    sub_outlets = [main_outlet]

    if len(junc_i) > 0 and n_subbasins_target > 1:
        junction_accs = []
        for k in range(len(junc_i)):
            ji, jj = int(junc_i[k]), int(junc_j[k])
            junction_accs.append((flow_acc[ji, jj], ji, jj))
        junction_accs.sort(reverse=True)

        selected = junction_accs[:min(len(junction_accs), n_subbasins_target - 1)]
        sub_outlets = [main_outlet]
        for _, ji, jj in selected:
            sub_outlets.append((ji, jj))

        sub_labels_list = []
        for idx, (oi, oj) in enumerate(sub_outlets):
            sub = _delineate_subbasins_numba(flow_dir_i32, stream, oi, oj, rows, cols)
            sub_labels_list.append(sub)

        for i in range(rows):
            for j in range(cols):
                if watershed[i, j] == 0:
                    continue
                max_label = -1
                for idx in range(len(sub_outlets)):
                    if sub_labels_list[idx][i, j] > 0:
                        if idx > max_label:
                            max_label = idx
                if max_label >= 0:
                    labels[i, j] = max_label + 1
                else:
                    labels[i, j] = 1
    else:
        labels = watershed.copy()

    return labels, sub_outlets


@njit(cache=True)
def _compute_strahler_order_numba(flow_dir, stream, rows, cols):
    order = np.zeros((rows, cols), dtype=np.int32)
    in_count = np.zeros((rows, cols), dtype=np.int32)

    for i in range(rows):
        for j in range(cols):
            code = flow_dir[i, j]
            if code > 0:
                ni, nj = _get_target_numba(code, i, j)
                if 0 <= ni < rows and 0 <= nj < cols:
                    in_count[ni, nj] += 1

    stack = np.zeros((rows * cols, 2), dtype=np.int32)
    top = 0
    for i in range(rows):
        for j in range(cols):
            if in_count[i, j] == 0 and stream[i, j] == 1:
                order[i, j] = 1
                stack[top, 0] = i
                stack[top, 1] = j
                top += 1

    while top > 0:
        top -= 1
        ci = stack[top, 0]
        cj = stack[top, 1]
        code = flow_dir[ci, cj]
        if code <= 0:
            continue
        ni, nj = _get_target_numba(code, ci, cj)

        if 0 <= ni < rows and 0 <= nj < cols and stream[ni, nj] == 1:
            current_max_order = 0
            same_order_count = 0
            for di in range(-1, 2):
                for dj in range(-1, 2):
                    if di == 0 and dj == 0:
                        continue
                    si = ni + di
                    sj = nj + dj
                    if 0 <= si < rows and 0 <= sj < cols:
                        sc = flow_dir[si, sj]
                        if sc <= 0:
                            continue
                        ti, tj = _get_target_numba(sc, si, sj)
                        if ti == ni and tj == nj and order[si, sj] > 0:
                            if order[si, sj] > current_max_order:
                                current_max_order = order[si, sj]
                                same_order_count = 1
                            elif order[si, sj] == current_max_order:
                                same_order_count += 1

            if current_max_order > 0:
                if same_order_count >= 2:
                    order[ni, nj] = current_max_order + 1
                else:
                    order[ni, nj] = current_max_order

            in_count[ni, nj] -= 1
            if in_count[ni, nj] == 0 and order[ni, nj] > 0:
                stack[top, 0] = ni
                stack[top, 1] = nj
                top += 1

    return order


@njit(cache=True)
def _compute_giuh_params_subbasin_numba(strahler, flow_dir, stream, dem, labels, sub_id, rows, cols, cell_size):
    max_order = 0
    for i in range(rows):
        for j in range(cols):
            if labels[i, j] == sub_id and strahler[i, j] > max_order:
                max_order = strahler[i, j]

    if max_order == 0:
        max_order = 1

    n_orders = max_order + 1
    lengths = np.zeros(n_orders, dtype=np.float64)
    slopes = np.zeros(n_orders, dtype=np.float64)
    counts = np.zeros(n_orders, dtype=np.int32)
    areas = np.zeros(n_orders, dtype=np.float64)
    sub_area = 0.0
    avg_slope_sum = 0.0
    avg_slope_cnt = 0

    for i in range(rows):
        for j in range(cols):
            if labels[i, j] != sub_id:
                continue
            sub_area += cell_size * cell_size
            code = flow_dir[i, j]
            if code > 0:
                ni, nj = _get_target_numba(code, i, j)
                if 0 <= ni < rows and 0 <= nj < cols:
                    dist = cell_size
                    if _is_diagonal(code):
                        dist = cell_size * 1.4142135623730951
                    sl = (dem[i, j] - dem[ni, nj]) / dist
                    if sl > 0:
                        avg_slope_sum += sl
                        avg_slope_cnt += 1
            if stream[i, j] == 0:
                continue
            o = strahler[i, j]
            if o == 0:
                o = 1
            if code <= 0:
                continue
            dist = cell_size
            if _is_diagonal(code):
                dist = cell_size * 1.4142135623730951
            lengths[o] += dist
            ni, nj = _get_target_numba(code, i, j)
            if 0 <= ni < rows and 0 <= nj < cols:
                sl = (dem[i, j] - dem[ni, nj]) / dist
                if sl > 0:
                    slopes[o] += sl
            counts[o] += 1
            areas[o] += cell_size * cell_size

    total_stream_area = 0.0
    for o in range(1, n_orders):
        total_stream_area += areas[o]

    if total_stream_area < sub_area * 0.01:
        avg_sl = 0.01
        if avg_slope_cnt > 0:
            avg_sl = avg_slope_sum / avg_slope_cnt
        areas[1] = sub_area
        lengths[1] = np.sqrt(sub_area) * 0.5
        slopes[1] = avg_sl
        counts[1] = 1
    else:
        for o in range(1, n_orders):
            if counts[o] > 0:
                lengths[o] /= counts[o]
                slopes[o] /= counts[o]
            else:
                lengths[o] = cell_size
                slopes[o] = 0.01

    if sub_area == 0:
        areas[1] = 0.0
        lengths[1] = 0.0
        slopes[1] = 0.0
        counts[1] = 0

    return max_order, lengths, slopes, areas, counts, sub_area


@njit(cache=True)
def _compute_giuh_numba(strahler, flow_dir, stream, dem, rows, cols, cell_size):
    max_order = 0
    for i in range(rows):
        for j in range(cols):
            if strahler[i, j] > max_order:
                max_order = strahler[i, j]

    if max_order == 0:
        max_order = 1

    n_orders = max_order + 1
    lengths = np.zeros(n_orders, dtype=np.float64)
    slopes = np.zeros(n_orders, dtype=np.float64)
    counts = np.zeros(n_orders, dtype=np.int32)
    areas = np.zeros(n_orders, dtype=np.float64)

    for i in range(rows):
        for j in range(cols):
            if stream[i, j] == 0:
                continue
            o = strahler[i, j]
            if o == 0:
                o = 1
            code = flow_dir[i, j]
            if code <= 0:
                continue
            dist = cell_size
            if _is_diagonal(code):
                dist = cell_size * 1.4142135623730951
            lengths[o] += dist
            ni, nj = _get_target_numba(code, i, j)
            if 0 <= ni < rows and 0 <= nj < cols:
                sl = (dem[i, j] - dem[ni, nj]) / dist
                if sl > 0:
                    slopes[o] += sl
            counts[o] += 1
            areas[o] += cell_size * cell_size

    for o in range(1, n_orders):
        if counts[o] > 0:
            lengths[o] /= counts[o]
            slopes[o] /= counts[o]
        else:
            lengths[o] = cell_size
            slopes[o] = 0.01

    return max_order, lengths, slopes, areas, counts


@njit(cache=True)
def _build_iuh_numba(max_order, lengths, slopes, areas, sub_area, t_step,
                    v_coeff=0.65, len_exp=0.33, slope_exp=0.20, min_velocity=0.5):
    velocities = np.zeros(max_order + 1, dtype=np.float64)
    for o in range(1, max_order + 1):
        if slopes[o] > 0:
            velocities[o] = v_coeff * (lengths[o] ** len_exp) * (slopes[o] ** slope_exp)
        else:
            velocities[o] = min_velocity

    travel_times = np.zeros(max_order + 1, dtype=np.float64)
    for o in range(1, max_order + 1):
        if velocities[o] > 0:
            travel_times[o] = lengths[o] / velocities[o]
        else:
            travel_times[o] = 1.0

    max_travel = 0.0
    for o in range(1, max_order + 1):
        if travel_times[o] > max_travel:
            max_travel = travel_times[o]

    uh_length = int(max_travel / t_step) * 2 + 1
    if uh_length < 3:
        uh_length = 3

    total_area = 0.0
    for o in range(1, max_order + 1):
        total_area += areas[o]

    uh = np.zeros(uh_length, dtype=np.float64)
    for t in range(uh_length):
        time_val = t * t_step
        prob = 0.0
        for o in range(1, max_order + 1):
            lam = 1.0 / travel_times[o] if travel_times[o] > 0 else 1.0
            if total_area > 0:
                area_frac = areas[o] / total_area
            else:
                area_frac = 1.0 / max_order
            if time_val > 0:
                exp_val = -lam * time_val
                if exp_val > -500:
                    prob += area_frac * lam * np.exp(exp_val) * t_step
        uh[t] = prob

    total_uh = 0.0
    for t in range(uh_length):
        total_uh += uh[t]
    if total_uh > 0:
        for t in range(uh_length):
            uh[t] /= total_uh

    return uh, uh_length


@njit(cache=True)
def _build_channel_iuh_numba(channel_length, channel_slope, t_step,
                              v_coeff=0.65, len_exp=0.33, slope_exp=0.20, min_velocity=0.5):
    if channel_length <= 0:
        uh = np.zeros(1, dtype=np.float64)
        uh[0] = 1.0
        return uh, 1

    velocity = v_coeff * (channel_length ** len_exp) * (max(channel_slope, 0.001) ** slope_exp)
    if velocity <= 0:
        velocity = min_velocity

    travel_time = channel_length / velocity

    if travel_time < t_step * 0.5:
        uh = np.zeros(1, dtype=np.float64)
        uh[0] = 1.0
        return uh, 1

    lam = 1.0 / travel_time

    uh_length = int(travel_time / t_step) * 3 + 1
    if uh_length < 2:
        uh_length = 2

    uh = np.zeros(uh_length, dtype=np.float64)
    for t in range(uh_length):
        time_val = t * t_step
        if time_val == 0:
            uh[t] = 1.0 - np.exp(-lam * t_step)
        else:
            exp_val = -lam * time_val
            if exp_val > -500:
                uh[t] = lam * np.exp(exp_val) * t_step

    total = 0.0
    for t in range(uh_length):
        total += uh[t]
    if total > 0:
        for t in range(uh_length):
            uh[t] /= total
    else:
        uh = np.zeros(1, dtype=np.float64)
        uh[0] = 1.0
        return uh, 1

    return uh, uh_length


@njit(cache=True)
def _convolve_numba(inflow, uh, n_time):
    outflow = np.zeros(n_time, dtype=np.float64)
    uh_len = len(uh)
    for t in range(n_time):
        if inflow[t] == 0.0:
            continue
        for k in range(min(uh_len, n_time - t)):
            outflow[t + k] += inflow[t] * uh[k]
    return outflow


@njit(cache=True)
def _giuh_convolution_numba(rainfall, t_step, max_order, lengths, slopes, areas, sub_area,
                            v_coeff=0.65, len_exp=0.33, slope_exp=0.20, min_velocity=0.5):
    n_time = len(rainfall)
    uh, uh_length = _build_iuh_numba(max_order, lengths, slopes, areas, sub_area, t_step,
                                     v_coeff, len_exp, slope_exp, min_velocity)

    hydrograph = np.zeros(n_time, dtype=np.float64)
    for t in range(n_time):
        if rainfall[t] <= 0:
            continue
        for k in range(min(uh_length, n_time - t)):
            hydrograph[t + k] += rainfall[t] * uh[k] * sub_area / 3600000.0

    return hydrograph


@njit(cache=True, parallel=True)
def _compute_subbasin_hydrograph_parallel(
    rainfall_array, t_step, subbasin_params_flat, n_subbasins, param_stride,
    v_coeff=0.65, len_exp=0.33, slope_exp=0.20, min_velocity=0.5
):
    n_time = rainfall_array.shape[1]
    results = np.zeros((n_subbasins, n_time), dtype=np.float64)

    for s in prange(n_subbasins):
        max_order = int(subbasin_params_flat[s * param_stride + 0])
        sub_area = subbasin_params_flat[s * param_stride + 1]
        lengths = np.zeros(max_order + 1, dtype=np.float64)
        slopes = np.zeros(max_order + 1, dtype=np.float64)
        areas = np.zeros(max_order + 1, dtype=np.float64)

        for o in range(1, max_order + 1):
            base = s * param_stride + 2 + (o - 1) * 3
            if base + 2 < subbasin_params_flat.shape[0]:
                lengths[o] = subbasin_params_flat[base]
                slopes[o] = subbasin_params_flat[base + 1]
                areas[o] = subbasin_params_flat[base + 2]

        rain = rainfall_array[s, :]
        results[s, :] = _giuh_convolution_numba(
            rain, t_step, max_order, lengths, slopes, areas, sub_area,
            v_coeff, len_exp, slope_exp, min_velocity
        )

    return results


@njit(cache=True)
def _compute_channel_params_numba(flow_dir, stream, dem, labels, outlets_i, outlets_j, rows, cols, cell_size):
    n_sub = len(outlets_i)
    downstream = np.full(n_sub, -1, dtype=np.int32)
    channel_length = np.zeros(n_sub, dtype=np.float64)
    channel_slope = np.zeros(n_sub, dtype=np.float64)

    for s in range(n_sub):
        oi = outlets_i[s]
        oj = outlets_j[s]
        code = flow_dir[oi, oj]
        if code <= 0:
            downstream[s] = -1
            continue

        ci, cj = oi, oj
        total_dist = 0.0
        total_slope = 0.0
        slope_count = 0

        for step in range(rows + cols):
            code = flow_dir[ci, cj]
            if code <= 0:
                break

            ni, nj = _get_target_numba(code, ci, cj)
            if ni < 0 or ni >= rows or nj < 0 or nj >= cols:
                break

            dist = cell_size
            if _is_diagonal(code):
                dist = cell_size * 1.4142135623730951

            elev_drop = dem[ci, cj] - dem[ni, nj]
            if elev_drop > 0:
                total_slope += elev_drop / dist
                slope_count += 1

            total_dist += dist

            target_label = labels[ni, nj]
            if target_label > 0 and target_label != (s + 1):
                for ds in range(n_sub):
                    if target_label == (ds + 1):
                        downstream[s] = ds
                        break
                break

            ci, cj = ni, nj

        channel_length[s] = total_dist
        if slope_count > 0:
            channel_slope[s] = total_slope / slope_count
        elif total_dist > 0 and elev_drop > 0:
            channel_slope[s] = elev_drop / total_dist
        else:
            channel_slope[s] = 0.01

    return downstream, channel_length, channel_slope


@njit(cache=True)
def _topological_sort_numba(downstream, n_sub):
    in_degree = np.zeros(n_sub, dtype=np.int32)
    for s in range(n_sub):
        if downstream[s] >= 0:
            in_degree[downstream[s]] += 1

    sorted_order = np.zeros(n_sub, dtype=np.int32)
    idx = 0
    queue = np.zeros(n_sub, dtype=np.int32)
    q_head = 0
    q_tail = 0

    for s in range(n_sub):
        if in_degree[s] == 0:
            queue[q_tail] = s
            q_tail += 1

    while q_head < q_tail:
        node = queue[q_head]
        q_head += 1
        sorted_order[idx] = node
        idx += 1
        ds = downstream[node]
        if ds >= 0:
            in_degree[ds] -= 1
            if in_degree[ds] == 0:
                queue[q_tail] = ds
                q_tail += 1

    return sorted_order


@njit(cache=True)
def _route_subbasins_numba(
    local_flows, downstream, channel_length, channel_slope, t_step, n_sub, n_time,
    ch_v_coeff=0.65, ch_len_exp=0.33, ch_slope_exp=0.20, ch_min_velocity=0.5
):
    total_flows = np.zeros((n_sub, n_time), dtype=np.float64)
    for s in range(n_sub):
        for t in range(n_time):
            total_flows[s, t] = local_flows[s, t]

    sorted_order = _topological_sort_numba(downstream, n_sub)

    for idx in range(n_sub):
        s = sorted_order[idx]
        ds = downstream[s]

        if ds >= 0:
            ch_uh, ch_uh_len = _build_channel_iuh_numba(
                channel_length[s], channel_slope[s], t_step,
                ch_v_coeff, ch_len_exp, ch_slope_exp, ch_min_velocity
            )
            routed = _convolve_numba(total_flows[s], ch_uh, n_time)
            for t in range(n_time):
                total_flows[ds, t] += routed[t]

    outlet_flow = np.zeros(n_time, dtype=np.float64)
    for s in range(n_sub):
        if downstream[s] < 0:
            for t in range(n_time):
                outlet_flow[t] += total_flows[s, t]

    return total_flows, outlet_flow


def build_subbasin_topology(flow_dir, stream, dem, labels, outlets):
    n_sub = len(outlets)
    rows, cols = flow_dir.shape

    outlets_i = np.array([o[0] for o in outlets], dtype=np.int32)
    outlets_j = np.array([o[1] for o in outlets], dtype=np.int32)

    downstream, channel_length, channel_slope = _compute_channel_params_numba(
        flow_dir.astype(np.int32), stream.astype(np.int32),
        dem.astype(np.float64), labels.astype(np.int32),
        outlets_i, outlets_j, rows, cols, 30.0
    )

    topology = {
        "downstream": downstream,
        "channel_length": channel_length,
        "channel_slope": channel_slope,
        "sorted_order": _topological_sort_numba(downstream, n_sub),
    }

    upstream_list = [[] for _ in range(n_sub)]
    for s in range(n_sub):
        ds = int(downstream[s])
        if ds >= 0:
            upstream_list[ds].append(s)
    topology["upstream"] = upstream_list

    return topology


class GIUHEngine:
    DEFAULT_PARAMS = {
        "v_coeff": 0.65,
        "len_exp": 0.33,
        "slope_exp": 0.20,
        "min_velocity": 0.5,
        "ch_v_coeff": 0.65,
        "ch_len_exp": 0.33,
        "ch_slope_exp": 0.20,
        "ch_min_velocity": 0.5,
    }

    def __init__(self, cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=4,
                 v_coeff=None, len_exp=None, slope_exp=None, min_velocity=None,
                 ch_v_coeff=None, ch_len_exp=None, ch_slope_exp=None, ch_min_velocity=None):
        self.cell_size = cell_size
        self.time_step = time_step
        self.stream_threshold = stream_threshold
        self.n_subbasins = n_subbasins

        self.v_coeff = v_coeff if v_coeff is not None else self.DEFAULT_PARAMS["v_coeff"]
        self.len_exp = len_exp if len_exp is not None else self.DEFAULT_PARAMS["len_exp"]
        self.slope_exp = slope_exp if slope_exp is not None else self.DEFAULT_PARAMS["slope_exp"]
        self.min_velocity = min_velocity if min_velocity is not None else self.DEFAULT_PARAMS["min_velocity"]

        self.ch_v_coeff = ch_v_coeff if ch_v_coeff is not None else self.DEFAULT_PARAMS["ch_v_coeff"]
        self.ch_len_exp = ch_len_exp if ch_len_exp is not None else self.DEFAULT_PARAMS["ch_len_exp"]
        self.ch_slope_exp = ch_slope_exp if ch_slope_exp is not None else self.DEFAULT_PARAMS["ch_slope_exp"]
        self.ch_min_velocity = ch_min_velocity if ch_min_velocity is not None else self.DEFAULT_PARAMS["ch_min_velocity"]

    def get_calib_params(self):
        return {
            "v_coeff": self.v_coeff,
            "len_exp": self.len_exp,
            "slope_exp": self.slope_exp,
            "min_velocity": self.min_velocity,
            "ch_v_coeff": self.ch_v_coeff,
            "ch_len_exp": self.ch_len_exp,
            "ch_slope_exp": self.ch_slope_exp,
            "ch_min_velocity": self.ch_min_velocity,
        }

    def set_calib_params(self, params_dict):
        for key, value in params_dict.items():
            if hasattr(self, key):
                setattr(self, key, value)

    def preprocess_dem(self, dem):
        dem_filled = fill_pits(dem)
        flow_dir = compute_flow_direction(dem_filled)
        flow_acc = compute_flow_accumulation(flow_dir)
        stream = extract_stream_network(flow_acc, self.stream_threshold)
        strahler = _compute_strahler_order_numba(flow_dir, stream, *flow_dir.shape)
        return dem_filled, flow_dir, flow_acc, stream, strahler

    def partition(self, flow_dir, stream):
        labels, outlets = partition_subbasins(flow_dir, stream, self.n_subbasins)
        return labels, outlets

    def compute_subbasin_params(self, dem, flow_dir, stream, strahler, labels, outlets):
        rows, cols = dem.shape
        n_sub = len(outlets)
        max_possible_order = int(strahler.max()) if strahler.max() > 0 else 1
        param_stride = 2 + max_possible_order * 3 + 10
        params_flat = np.zeros(n_sub * param_stride, dtype=np.float64)

        for s in range(n_sub):
            sub_id = s + 1
            max_order, lengths, slopes, areas, counts, sub_area = _compute_giuh_params_subbasin_numba(
                strahler.astype(np.int32),
                flow_dir.astype(np.int32),
                stream.astype(np.int32),
                dem.astype(np.float64),
                labels.astype(np.int32),
                sub_id,
                rows, cols,
                self.cell_size,
            )

            if max_order == 0:
                max_order = 1

            base = s * param_stride
            params_flat[base + 0] = float(max_order)
            params_flat[base + 1] = sub_area
            for o in range(1, min(max_order + 1, max_possible_order + 1)):
                idx = base + 2 + (o - 1) * 3
                if idx + 2 < len(params_flat):
                    params_flat[idx] = lengths[o] if o < len(lengths) else self.cell_size
                    params_flat[idx + 1] = slopes[o] if o < len(slopes) else 0.01
                    params_flat[idx + 2] = areas[o] if o < len(areas) else sub_area / max_order

        return params_flat, n_sub, param_stride

    def run_giuh(self, dem, rainfall_list, cell_size=None, time_step=None, calib_params=None):
        if cell_size is not None:
            self.cell_size = cell_size
        if time_step is not None:
            self.time_step = time_step
        if calib_params is not None:
            self.set_calib_params(calib_params)

        dem_filled, flow_dir, flow_acc, stream, strahler = self.preprocess_dem(dem)
        labels, outlets = self.partition(flow_dir, stream)

        topology = build_subbasin_topology(flow_dir, stream, dem_filled, labels, outlets)

        params_flat, n_sub, param_stride = self.compute_subbasin_params(
            dem_filled, flow_dir, stream, strahler, labels, outlets
        )

        n_time = len(rainfall_list[0]) if rainfall_list else 0
        rainfall_array = np.zeros((n_sub, n_time), dtype=np.float64)
        for s in range(n_sub):
            if s < len(rainfall_list):
                rainfall_array[s, :] = np.array(rainfall_list[s][:n_time], dtype=np.float64)
            else:
                rainfall_array[s, :] = np.array(rainfall_list[0][:n_time], dtype=np.float64)

        local_flows = _compute_subbasin_hydrograph_parallel(
            rainfall_array, self.time_step, params_flat, n_sub, param_stride,
            self.v_coeff, self.len_exp, self.slope_exp, self.min_velocity
        )

        total_flows, outlet_flow = _route_subbasins_numba(
            local_flows,
            topology["downstream"],
            topology["channel_length"],
            topology["channel_slope"],
            self.time_step,
            n_sub,
            n_time,
            self.ch_v_coeff, self.ch_len_exp, self.ch_slope_exp, self.ch_min_velocity,
        )

        return {
            "flow": outlet_flow,
            "sub_flows": total_flows,
            "local_flows": local_flows,
            "labels": labels,
            "outlets": outlets,
            "flow_dir": flow_dir,
            "flow_acc": flow_acc,
            "stream": stream,
            "strahler": strahler,
            "n_subbasins": n_sub,
            "time_step": self.time_step,
            "topology": topology,
            "calib_params": self.get_calib_params(),
        }

    @staticmethod
    def check_water_balance(result, rainfall_list, cell_size):
        flow = result["flow"]
        labels = result["labels"]
        t_step = result["time_step"]
        n_sub = result["n_subbasins"]
        n_time = len(flow)

        total_area = 0.0
        for s in range(n_sub):
            sub_mask = labels == (s + 1)
            total_area += float(np.sum(sub_mask)) * cell_size * cell_size

        total_rain_volume = 0.0
        for s in range(n_sub):
            rain = rainfall_list[s] if s < len(rainfall_list) else rainfall_list[0]
            sub_mask = labels == (s + 1)
            sub_area = float(np.sum(sub_mask)) * cell_size * cell_size
            for t in range(len(rain)):
                total_rain_volume += rain[t] * sub_area / 1000.0

        total_flow_volume = float(np.sum(flow)) * t_step

        if total_rain_volume > 0:
            ratio = total_flow_volume / total_rain_volume
        else:
            ratio = 0.0

        return {
            "total_rainfall_volume_m3": total_rain_volume,
            "total_outflow_volume_m3": total_flow_volume,
            "conservation_ratio": ratio,
            "total_area_m2": total_area,
            "is_conserved": 0.90 <= ratio <= 1.10,
        }


def nash_sutcliffe_efficiency(simulated, observed):
    sim = np.asarray(simulated, dtype=np.float64)
    obs = np.asarray(observed, dtype=np.float64)

    if len(sim) != len(obs):
        raise ValueError("Simulated and observed arrays must have the same length")

    mask = ~np.isnan(obs)
    if np.sum(mask) < 2:
        return -np.inf

    sim_valid = sim[mask]
    obs_valid = obs[mask]

    obs_mean = np.mean(obs_valid)
    ss_total = np.sum((obs_valid - obs_mean) ** 2)
    ss_residual = np.sum((obs_valid - sim_valid) ** 2)

    if ss_total == 0:
        return -np.inf

    nse = 1 - (ss_residual / ss_total)
    return float(nse)


class BayesianOptimizer:
    PARAM_BOUNDS = {
        "v_coeff": (0.1, 2.0),
        "len_exp": (0.1, 0.8),
        "slope_exp": (0.05, 0.5),
        "min_velocity": (0.01, 2.0),
        "ch_v_coeff": (0.1, 2.0),
        "ch_len_exp": (0.1, 0.8),
        "ch_slope_exp": (0.05, 0.5),
        "ch_min_velocity": (0.01, 2.0),
    }

    def __init__(self, engine, dem, rainfall_list, observed_flow,
                 param_names=None, max_iterations=50, random_seed=42):
        self.engine = engine
        self.dem = dem
        self.rainfall_list = rainfall_list
        self.observed_flow = np.asarray(observed_flow, dtype=np.float64)
        self.max_iterations = max_iterations
        self.random_seed = random_seed

        if param_names is None:
            self.param_names = ["v_coeff", "len_exp", "slope_exp", "min_velocity"]
        else:
            self.param_names = param_names

        self.bounds = np.array([self.PARAM_BOUNDS[p] for p in self.param_names])
        self.best_params = engine.get_calib_params()
        self.best_nse = -np.inf
        self.history = []

    def _params_array_to_dict(self, params_array):
        return {name: float(val) for name, val in zip(self.param_names, params_array)}

    def _evaluate(self, params_array):
        params_dict = self._params_array_to_dict(params_array)

        try:
            result = self.engine.run_giuh(self.dem, self.rainfall_list, calib_params=params_dict)
            simulated = result["flow"][:len(self.observed_flow)]
            nse = nash_sutcliffe_efficiency(simulated, self.observed_flow)
            return nse
        except Exception:
            return -np.inf

    def _sample_from_prior(self, n_samples):
        rng = np.random.RandomState(self.random_seed)
        samples = rng.uniform(
            low=self.bounds[:, 0],
            high=self.bounds[:, 1],
            size=(n_samples, len(self.param_names))
        )
        return samples

    def _gp_predict(self, X, y, X_pred):
        from scipy.stats import norm

        if len(X) < 2:
            return np.zeros(len(X_pred)), np.ones(len(X_pred))

        from scipy.spatial.distance import cdist

        def rbf_kernel(a, b, length_scale=1.0):
            dist = cdist(a / length_scale, b / length_scale, metric="sqeuclidean")
            return np.exp(-0.5 * dist)

        X_train = np.array(X)
        y_train = np.array(y)

        kernel = rbf_kernel(X_train, X_train)
        kernel += 1e-6 * np.eye(len(X_train))

        try:
            L = np.linalg.cholesky(kernel)
            alpha = np.linalg.solve(L.T, np.linalg.solve(L, y_train - np.mean(y_train)))
            K_pred = rbf_kernel(X_train, X_pred)
            mu = np.mean(y_train) + K_pred.T @ alpha
            v = np.linalg.solve(L, K_pred)
            var = 1.0 - np.sum(v ** 2, axis=0)
            var = np.maximum(var, 1e-6)
            sigma = np.sqrt(var)
        except Exception:
            mu = np.full(len(X_pred), np.mean(y_train))
            sigma = np.full(len(X_pred), 1.0)

        return mu, sigma

    def _expected_improvement(self, X, y, X_candidates):
        mu, sigma = self._gp_predict(X, y, X_candidates)
        best_y = np.max(y) if len(y) > 0 else 0.0

        xi = 0.01
        with np.errstate(divide='ignore'):
            z = (mu - best_y - xi) / sigma
            ei = (mu - best_y - xi) * norm.cdf(z) + sigma * norm.pdf(z)
            ei[sigma == 0] = 0.0

        return ei

    def optimize(self, callback=None):
        rng = np.random.RandomState(self.random_seed)

        initial_samples = min(10, self.max_iterations // 2)
        X_samples = []
        y_samples = []

        initial_points = self._sample_from_prior(initial_samples)
        for i, params in enumerate(initial_points):
            nse = self._evaluate(params)
            X_samples.append(params)
            y_samples.append(nse)

            if nse > self.best_nse:
                self.best_nse = nse
                self.best_params = self._params_array_to_dict(params)

            self.history.append({
                "iteration": i + 1,
                "params": self._params_array_to_dict(params),
                "nse": nse,
                "best_nse": self.best_nse,
                "type": "initial"
            })

            if callback is not None:
                callback(self.history[-1])

        for i in range(initial_samples, self.max_iterations):
            if len(y_samples) > 0 and np.max(y_samples) >= 0.999:
                break

            n_candidates = 1000
            candidates = rng.uniform(
                low=self.bounds[:, 0],
                high=self.bounds[:, 1],
                size=(n_candidates, len(self.param_names))
            )

            ei_values = self._expected_improvement(X_samples, y_samples, candidates)
            best_idx = int(np.argmax(ei_values))

            if ei_values[best_idx] < 1e-9:
                best_idx = rng.randint(0, n_candidates)

            next_params = candidates[best_idx]
            nse = self._evaluate(next_params)

            X_samples.append(next_params)
            y_samples.append(nse)

            if nse > self.best_nse:
                self.best_nse = nse
                self.best_params = self._params_array_to_dict(next_params)

            self.history.append({
                "iteration": i + 1,
                "params": self._params_array_to_dict(next_params),
                "nse": nse,
                "best_nse": self.best_nse,
                "type": "bayesian"
            })

            if callback is not None:
                callback(self.history[-1])

        self.engine.set_calib_params(self.best_params)

        return {
            "best_params": self.best_params,
            "best_nse": float(self.best_nse),
            "history": self.history,
            "final_params": self.engine.get_calib_params(),
            "n_iterations": len(self.history),
        }


def calibrate_model(engine, dem, rainfall_list, observed_flow,
                    param_names=None, max_iterations=50, random_seed=42,
                    callback=None):
    optimizer = BayesianOptimizer(
        engine=engine,
        dem=dem,
        rainfall_list=rainfall_list,
        observed_flow=observed_flow,
        param_names=param_names,
        max_iterations=max_iterations,
        random_seed=random_seed
    )
    return optimizer.optimize(callback=callback)
