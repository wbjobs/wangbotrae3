struct Particle {
    position: vec4<f32>,
    velocity: vec4<f32>,
    density: f32,
    pressure: f32,
    color: vec4<f32>,
};

struct GridParams {
    gridSize: vec3<u32>,
    cellSize: f32,
    gridOrigin: vec3<f32>,
    totalCells: u32,
    numParticles: u32,
};

struct SortEntry {
    cellHash: u32,
    particleIndex: u32,
};

@group(0) @binding(0) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(1) var<storage, read_write> sortEntries: array<SortEntry>;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> particlesOut: array<Particle>;
@group(0) @binding(5) var<uniform> gridParams: GridParams;

fn getCellHash(pos: vec3<f32>) -> u32 {
    let gridPos = vec3<i32>(floor((pos - gridParams.gridOrigin) / gridParams.cellSize));
    
    if (any(gridPos < vec3<i32>(0)) || any(gridPos >= vec3<i32>(gridParams.gridSize))) {
        return gridParams.totalCells;
    }
    
    return u32(gridPos.x) + 
           u32(gridPos.y) * gridParams.gridSize.x + 
           u32(gridPos.z) * gridParams.gridSize.x * gridParams.gridSize.y;
}

@compute @workgroup_size(256)
fn computeHashes(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let idx = globalId.x;
    if (idx >= gridParams.numParticles) { return; }
    
    let pos = particlesIn[idx].position.xyz;
    let hash = getCellHash(pos);
    
    sortEntries[idx].cellHash = hash;
    sortEntries[idx].particleIndex = idx;
}

@compute @workgroup_size(256)
fn clearCellCounts(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let idx = globalId.x;
    if (idx >= gridParams.totalCells + 1) { return; }
    
    cellCounts[idx] = 0;
    cellOffsets[idx] = 0;
}

@compute @workgroup_size(256)
fn countCells(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let idx = globalId.x;
    if (idx >= gridParams.numParticles) { return; }
    
    let hash = sortEntries[idx].cellHash;
    if (hash <= gridParams.totalCells) {
        atomicAdd(&cellCounts[hash], 1u);
    }
}

@compute @workgroup_size(1)
fn scanCellCounts(@builtin(global_invocation_id) globalId: vec3<u32>) {
    var prefixSum: u32 = 0;
    
    for (var i: u32 = 0; i <= gridParams.totalCells; i++) {
        cellOffsets[i] = prefixSum;
        prefixSum += cellCounts[i];
    }
}

@compute @workgroup_size(256)
fn sortParticles(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let idx = globalId.x;
    if (idx >= gridParams.numParticles) { return; }
    
    let hash = sortEntries[idx].cellHash;
    if (hash > gridParams.totalCells) { return; }
    
    let writePos = atomicAdd(&cellOffsets[hash], 1u);
    particlesOut[writePos] = particlesIn[sortEntries[idx].particleIndex];
}

@compute @workgroup_size(256)
fn copyBackParticles(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let idx = globalId.x;
    if (idx >= gridParams.numParticles) { return; }
    
    particlesIn[idx] = particlesOut[idx];
}

var<private> sortShift: u32 = 0u;

@compute @workgroup_size(1)
fn setSortShift0(@builtin(global_invocation_id) gid: vec3<u32>) { sortShift = 0u; }

@compute @workgroup_size(1)
fn setSortShift8(@builtin(global_invocation_id) gid: vec3<u32>) { sortShift = 8u; }

@compute @workgroup_size(1)
fn setSortShift16(@builtin(global_invocation_id) gid: vec3<u32>) { sortShift = 16u; }

@compute @workgroup_size(1)
fn setSortShift24(@builtin(global_invocation_id) gid: vec3<u32>) { sortShift = 24u; }

@compute @workgroup_size(256)
fn radixCount(@builtin(global_invocation_id) globalId: vec3<u32>,
              @builtin(local_invocation_id) localId: vec3<u32>) {
    var<workgroup> localHist: array<u32, 256>;
    localHist[localId.x] = 0;
    workgroupBarrier();
    
    let n = gridParams.numParticles;
    for (var i = globalId.x; i < n; i += 256u * 64u) {
        let key = sortEntries[i].cellHash;
        let bin = (key >> sortShift) & 0xFFu;
        atomicAdd(&localHist[bin], 1u);
    }
    
    workgroupBarrier();
    
    if (localId.x < 256u) {
        atomicAdd(&cellCounts[localId.x], localHist[localId.x]);
    }
}

@compute @workgroup_size(1)
fn radixScan(@builtin(global_invocation_id) gid: vec3<u32>) {
    var sum: u32 = 0;
    for (var i: u32 = 0; i < 256u; i++) {
        let temp = cellCounts[i];
        cellCounts[i] = sum;
        sum += temp;
    }
}

@compute @workgroup_size(256)
fn radixScatter(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let n = gridParams.numParticles;
    for (var i = globalId.x; i < n; i += 256u * 64u) {
        let key = sortEntries[i].cellHash;
        let bin = (key >> sortShift) & 0xFFu;
        let dest = atomicAdd(&cellCounts[bin], 1u);
    }
}
