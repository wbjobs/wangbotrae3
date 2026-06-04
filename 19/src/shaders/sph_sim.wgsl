struct Particle {
    position: vec4<f32>,
    velocity: vec4<f32>,
    density: f32,
    pressure: f32,
    color: vec4<f32>,
};

struct SimulationParams {
    dt: f32,
    smoothingRadius: f32,
    restDensity: f32,
    stiffness: f32,
    viscosity: f32,
    surfaceTension: f32,
    gravity: vec3<f32>,
    particleRadius: f32,
    restitution: f32,
    boundaryType: u32,
    numParticles: u32,
};

struct GridParams {
    gridSize: vec3<u32>,
    cellSize: f32,
    gridOrigin: vec3<f32>,
    totalCells: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> sortedParticles: array<Particle>;
@group(0) @binding(2) var<storage, read> particleIndices: array<u32>;
@group(0) @binding(3) var<storage, read> cellStart: array<i32>;
@group(0) @binding(4) var<storage, read> cellEnd: array<i32>;
@group(0) @binding(5) var<uniform> simParams: SimulationParams;
@group(0) @binding(6) var<uniform> gridParams: GridParams;

fn hashPosition(pos: vec3<f32>) -> u32 {
    let gridPos = vec3<i32>(floor((pos - gridParams.gridOrigin) / gridParams.cellSize));
    
    if (any(gridPos < vec3<i32>(0)) || any(gridPos >= vec3<i32>(gridParams.gridSize))) {
        return gridParams.totalCells;
    }
    
    return u32(gridPos.x) + 
           u32(gridPos.y) * gridParams.gridSize.x + 
           u32(gridPos.z) * gridParams.gridSize.x * gridParams.gridSize.y;
}

const PI: f32 = 3.14159265359;

fn kernelPoly6(r: f32, h: f32) -> f32 {
    if (r > h) { return 0.0; }
    let hr2 = h * h - r * r;
    return (315.0 / (64.0 * PI * pow(h, 9.0))) * hr2 * hr2 * hr2;
}

fn kernelSpikyGradient(r: vec3<f32>, h: f32) -> vec3<f32> {
    let rLen = length(r);
    if (rLen > h || rLen < 0.0001) { return vec3<f32>(0.0); }
    let hr = h - rLen;
    let factor = (-45.0 / (PI * pow(h, 6.0))) * hr * hr;
    return normalize(r) * factor;
}

fn kernelViscosityLaplacian(r: f32, h: f32) -> f32 {
    if (r > h) { return 0.0; }
    return (45.0 / (PI * pow(h, 6.0))) * (h - r);
}

fn kernelSurfaceTension(r: f32, h: f32) -> f32 {
    if (r > h) { return 0.0; }
    let hr2 = h * h - r * r;
    return (945.0 / (32.0 * PI * pow(h, 9.0))) * hr2 * (r * r - 0.75 * hr2);
}

@compute @workgroup_size(256)
fn computeDensityPressure(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let i = globalId.x;
    if (i >= simParams.numParticles) { return; }

    let pi = sortedParticles[i];
    let h = simParams.smoothingRadius;
    
    var density: f32 = 0.0;
    
    let cellHash = hashPosition(pi.position.xyz);
    
    for (var dz: i32 = -1; dz <= 1; dz++) {
        for (var dy: i32 = -1; dy <= 1; dy++) {
            for (var dx: i32 = -1; dx <= 1; dx++) {
                let neighborPos = pi.position.xyz + vec3<f32>(f32(dx), f32(dy), f32(dz)) * gridParams.cellSize;
                let neighborHash = hashPosition(neighborPos);
                
                if (neighborHash >= gridParams.totalCells) { continue; }
                
                let start = cellStart[neighborHash];
                if (start == -1) { continue; }
                
                let end = cellEnd[neighborHash];
                
                for (var j = start; j <= end; j++) {
                    let pj = sortedParticles[u32(j)];
                    let r = distance(pi.position.xyz, pj.position.xyz);
                    density += kernelPoly6(r, h);
                }
            }
        }
    }
    
    density *= 1.0;
    
    particles[i].density = density;
    particles[i].pressure = simParams.stiffness * max(density - simParams.restDensity, 0.0);
}

@compute @workgroup_size(256)
fn computeForces(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let i = globalId.x;
    if (i >= simParams.numParticles) { return; }

    let pi = particles[i];
    let h = simParams.smoothingRadius;
    
    var pressureForce = vec3<f32>(0.0);
    var viscosityForce = vec3<f32>(0.0);
    var surfaceTensionForce = vec3<f32>(0.0);
    var colorLaplacian: f32 = 0.0;
    var colorGradient = vec3<f32>(0.0);
    
    let cellHash = hashPosition(pi.position.xyz);
    
    for (var dz: i32 = -1; dz <= 1; dz++) {
        for (var dy: i32 = -1; dy <= 1; dy++) {
            for (var dx: i32 = -1; dx <= 1; dx++) {
                let neighborPos = pi.position.xyz + vec3<f32>(f32(dx), f32(dy), f32(dz)) * gridParams.cellSize;
                let neighborHash = hashPosition(neighborPos);
                
                if (neighborHash >= gridParams.totalCells) { continue; }
                
                let start = cellStart[neighborHash];
                if (start == -1) { continue; }
                
                let end = cellEnd[neighborHash];
                
                for (var j = start; j <= end; j++) {
                    let jIdx = u32(j);
                    if (jIdx == i) { continue; }
                    
                    let pj = particles[jIdx];
                    let r = pi.position.xyz - pj.position.xyz;
                    let rLen = length(r);
                    
                    if (rLen > h || rLen < 0.0001) { continue; }
                    
                    let pressureTerm = (pi.pressure + pj.pressure) / (2.0 * max(pj.density, 0.001));
                    pressureForce -= pressureTerm * kernelSpikyGradient(r, h);
                    
                    let velDiff = pj.velocity.xyz - pi.velocity.xyz;
                    viscosityForce += velDiff * kernelViscosityLaplacian(rLen, h) / max(pj.density, 0.001);
                    
                    let stCoeff = kernelSurfaceTension(rLen, h) / max(pj.density, 0.001);
                    surfaceTensionForce -= r * stCoeff;
                    
                    let cGrad = kernelSpikyGradient(r, h);
                    colorGradient += cGrad / max(pj.density, 0.001);
                    colorLaplacian += kernelViscosityLaplacian(rLen, h) / max(pj.density, 0.001);
                }
            }
        }
    }
    
    viscosityForce *= simParams.viscosity;
    surfaceTensionForce *= simParams.surfaceTension;
    
    let gradLen = length(colorGradient);
    if (gradLen > 0.001) {
        surfaceTensionForce = -colorLaplacian * normalize(colorGradient) * simParams.surfaceTension;
    }
    
    var totalForce = pressureForce + viscosityForce + surfaceTensionForce;
    totalForce += simParams.gravity * pi.density;
    
    var acceleration = totalForce / max(pi.density, 0.001);
    
    particles[i].velocity.xyz += acceleration * simParams.dt;
    
    let speed = length(particles[i].velocity.xyz);
    let maxSpeed = 10.0;
    if (speed > maxSpeed) {
        particles[i].velocity.xyz = normalize(particles[i].velocity.xyz) * maxSpeed;
    }
}

@compute @workgroup_size(256)
fn integrate(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let i = globalId.x;
    if (i >= simParams.numParticles) { return; }

    particles[i].position.xyz += particles[i].velocity.xyz * simParams.dt;
    
    handleBoundary(i);
}

fn handleBoundary(i: u32) {
    let pos = particles[i].position.xyz;
    let vel = particles[i].velocity.xyz;
    let r = simParams.particleRadius;
    let e = simParams.restitution;
    
    var newPos = pos;
    var newVel = vel;
    
    switch (simParams.boundaryType) {
        case 0u: {
            let boxMin = vec3<f32>(-1.0, -1.0, -1.0);
            let boxMax = vec3<f32>(1.0, 1.0, 1.0);
            
            if (newPos.x < boxMin.x + r) {
                newPos.x = boxMin.x + r;
                newVel.x = -newVel.x * e;
            }
            if (newPos.x > boxMax.x - r) {
                newPos.x = boxMax.x - r;
                newVel.x = -newVel.x * e;
            }
            if (newPos.y < boxMin.y + r) {
                newPos.y = boxMin.y + r;
                newVel.y = -newVel.y * e;
            }
            if (newPos.y > boxMax.y - r) {
                newPos.y = boxMax.y - r;
                newVel.y = -newVel.y * e;
            }
            if (newPos.z < boxMin.z + r) {
                newPos.z = boxMin.z + r;
                newVel.z = -newVel.z * e;
            }
            if (newPos.z > boxMax.z - r) {
                newPos.z = boxMax.z - r;
                newVel.z = -newVel.z * e;
            }
        }
        case 1u: {
            let sphereCenter = vec3<f32>(0.0, 0.0, 0.0);
            let sphereRadius = 1.2;
            
            let toCenter = newPos - sphereCenter;
            let dist = length(toCenter);
            
            if (dist > sphereRadius - r) {
                let normal = normalize(toCenter);
                newPos = sphereCenter + normal * (sphereRadius - r);
                let vn = dot(newVel, normal);
                newVel = newVel - (1.0 + e) * vn * normal;
            }
        }
        case 2u: {
            let boxMin = vec3<f32>(-1.0, -0.5, -1.0);
            let boxMax = vec3<f32>(1.0, 1.5, 1.0);
            
            let center = (boxMin + boxMax) * 0.5;
            let toCenter = newPos - center;
            let funnelWidth = 0.8 + 0.5 * (newPos.y - boxMin.y) / (boxMax.y - boxMin.y);
            
            let horizDist = sqrt(toCenter.x * toCenter.x + toCenter.z * toCenter.z);
            if (horizDist > funnelWidth - r) {
                let horizNormal = normalize(vec3<f32>(toCenter.x, 0.0, toCenter.z));
                newPos.x = center.x + horizNormal.x * (funnelWidth - r);
                newPos.z = center.z + horizNormal.z * (funnelWidth - r);
                let vn = dot(newVel, horizNormal);
                newVel.x -= (1.0 + e) * vn * horizNormal.x;
                newVel.z -= (1.0 + e) * vn * horizNormal.z;
            }
            
            if (newPos.y < boxMin.y + r) {
                newPos.y = boxMin.y + r;
                newVel.y = -newVel.y * e;
            }
            if (newPos.y > boxMax.y - r) {
                newPos.y = boxMax.y - r;
                newVel.y = -newVel.y * e;
            }
        }
        case 3u: {
            let boxMin = vec3<f32>(-1.5, -1.0, -1.0);
            let boxMax = vec3<f32>(1.5, 1.0, 1.0);
            
            if (newPos.x < boxMin.x + r) {
                newPos.x = boxMin.x + r;
                newVel.x = -newVel.x * e;
            }
            if (newPos.x > boxMax.x - r) {
                newPos.x = boxMax.x - r;
                newVel.x = -newVel.x * e;
            }
            if (newPos.y < boxMin.y + r) {
                newPos.y = boxMin.y + r;
                newVel.y = -newVel.y * e;
            }
            if (newPos.y > boxMax.y - r) {
                newPos.y = boxMax.y - r;
                newVel.y = -newVel.y * e;
            }
            if (newPos.z < boxMin.z + r) {
                newPos.z = boxMin.z + r;
                newVel.z = -newVel.z * e;
            }
            if (newPos.z > boxMax.z - r) {
                newPos.z = boxMax.z - r;
                newVel.z = -newVel.z * e;
            }
        }
        default: {
            let boxMin = vec3<f32>(-1.0, -1.0, -1.0);
            let boxMax = vec3<f32>(1.0, 1.0, 1.0);
            
            if (newPos.x < boxMin.x + r) { newPos.x = boxMin.x + r; newVel.x = -newVel.x * e; }
            if (newPos.x > boxMax.x - r) { newPos.x = boxMax.x - r; newVel.x = -newVel.x * e; }
            if (newPos.y < boxMin.y + r) { newPos.y = boxMin.y + r; newVel.y = -newVel.y * e; }
            if (newPos.y > boxMax.y - r) { newPos.y = boxMax.y - r; newVel.y = -newVel.y * e; }
            if (newPos.z < boxMin.z + r) { newPos.z = boxMin.z + r; newVel.z = -newVel.z * e; }
            if (newPos.z > boxMax.z - r) { newPos.z = boxMax.z - r; newVel.z = -newVel.z * e; }
        }
    }
    
    newVel *= 0.998;
    
    particles[i].position.xyz = newPos;
    particles[i].velocity.xyz = newVel;
}
