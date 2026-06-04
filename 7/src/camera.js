export class CameraController {
    constructor(canvas) {
        this.canvas = canvas;
        
        this.position = [0, 0, 12];
        this.target = [0, 0, 0];
        this.up = [0, 1, 0];
        
        this.yaw = Math.PI / 2;
        this.pitch = Math.PI / 6;
        this.distance = 12;
        this.minDistance = 6;
        this.maxDistance = 25;
        
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
        this.targetDistance = this.distance;
        
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        this.rotateSpeed = 0.005;
        this.zoomSpeed = 0.01;
        this.smoothness = 8.0;
        
        this.fov = Math.PI / 3;
        this.aspect = 16 / 9;
        this.near = 0.1;
        this.far = 100;
        
        this.viewMatrix = new Float32Array(16);
        this.projectionMatrix = new Float32Array(16);
        this.invViewProjMatrix = new Float32Array(16);
        
        this.autoRotate = false;
        this.autoRotateSpeed = 0.1;
    }
    
    startDrag(x, y) {
        this.isDragging = true;
        this.lastMouseX = x;
        this.lastMouseY = y;
    }
    
    endDrag() {
        this.isDragging = false;
    }
    
    onDrag(x, y) {
        if (!this.isDragging) return;
        
        const deltaX = x - this.lastMouseX;
        const deltaY = y - this.lastMouseY;
        
        this.targetYaw -= deltaX * this.rotateSpeed;
        this.targetPitch += deltaY * this.rotateSpeed;
        
        this.targetPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.targetPitch));
        
        this.lastMouseX = x;
        this.lastMouseY = y;
    }
    
    zoom(amount) {
        this.targetDistance += amount * this.zoomSpeed * this.targetDistance;
        this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.targetDistance));
    }
    
    update(deltaTime) {
        if (this.autoRotate && !this.isDragging) {
            this.targetYaw += this.autoRotateSpeed * deltaTime;
        }
        
        this.yaw += (this.targetYaw - this.yaw) * this.smoothness * deltaTime;
        this.pitch += (this.targetPitch - this.pitch) * this.smoothness * deltaTime;
        this.distance += (this.targetDistance - this.distance) * this.smoothness * deltaTime;
        
        this.position[0] = this.target[0] + Math.cos(this.pitch) * Math.sin(this.yaw) * this.distance;
        this.position[1] = this.target[1] + Math.sin(this.pitch) * this.distance;
        this.position[2] = this.target[2] + Math.cos(this.pitch) * Math.cos(this.yaw) * this.distance;
        
        this.updateMatrices();
    }
    
    updateMatrices() {
        const zAxis = this.normalize([
            this.position[0] - this.target[0],
            this.position[1] - this.target[1],
            this.position[2] - this.target[2]
        ]);
        const xAxis = this.normalize(this.cross(this.up, zAxis));
        const yAxis = this.cross(zAxis, xAxis);
        
        this.viewMatrix[0] = xAxis[0];
        this.viewMatrix[1] = yAxis[0];
        this.viewMatrix[2] = zAxis[0];
        this.viewMatrix[3] = 0;
        
        this.viewMatrix[4] = xAxis[1];
        this.viewMatrix[5] = yAxis[1];
        this.viewMatrix[6] = zAxis[1];
        this.viewMatrix[7] = 0;
        
        this.viewMatrix[8] = xAxis[2];
        this.viewMatrix[9] = yAxis[2];
        this.viewMatrix[10] = zAxis[2];
        this.viewMatrix[11] = 0;
        
        this.viewMatrix[12] = -this.dot(xAxis, this.position);
        this.viewMatrix[13] = -this.dot(yAxis, this.position);
        this.viewMatrix[14] = -this.dot(zAxis, this.position);
        this.viewMatrix[15] = 1;
        
        const f = 1 / Math.tan(this.fov / 2);
        const nf = 1 / (this.near - this.far);
        
        this.projectionMatrix[0] = f / this.aspect;
        this.projectionMatrix[1] = 0;
        this.projectionMatrix[2] = 0;
        this.projectionMatrix[3] = 0;
        
        this.projectionMatrix[4] = 0;
        this.projectionMatrix[5] = f;
        this.projectionMatrix[6] = 0;
        this.projectionMatrix[7] = 0;
        
        this.projectionMatrix[8] = 0;
        this.projectionMatrix[9] = 0;
        this.projectionMatrix[10] = (this.far + this.near) * nf;
        this.projectionMatrix[11] = -1;
        
        this.projectionMatrix[12] = 0;
        this.projectionMatrix[13] = 0;
        this.projectionMatrix[14] = 2 * this.far * this.near * nf;
        this.projectionMatrix[15] = 0;
    }
    
    getRayDirection(ndcX, ndcY) {
        const viewProj = this.multiplyMatrices(this.projectionMatrix, this.viewMatrix);
        const invViewProj = this.invertMatrix(viewProj);
        
        const nearPoint = this.transformPoint([ndcX, ndcY, -1], invViewProj);
        const farPoint = this.transformPoint([ndcX, ndcY, 1], invViewProj);
        
        const direction = [
            farPoint[0] - nearPoint[0],
            farPoint[1] - nearPoint[1],
            farPoint[2] - nearPoint[2]
        ];
        
        return this.normalize(direction);
    }
    
    normalize(v) {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return [v[0] / len, v[1] / len, v[2] / len];
    }
    
    cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }
    
    dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
    
    multiplyMatrices(a, b) {
        const result = new Float32Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                result[i * 4 + j] = 0;
                for (let k = 0; k < 4; k++) {
                    result[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
                }
            }
        }
        return result;
    }
    
    invertMatrix(m) {
        const inv = new Float32Array(16);
        
        inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] +
                 m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
        inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] -
                 m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
        inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] +
                 m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
        inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] -
                  m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
        inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] -
                 m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
        inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] +
                 m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
        inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] -
                 m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
        inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] +
                  m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
        inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] +
                 m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
        inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] -
                 m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
        inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] +
                  m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
        inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] -
                  m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
        inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] -
                 m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
        inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] +
                 m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
        inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] -
                  m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
        inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] +
                  m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
        
        let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
        if (det === 0) return this.identityMatrix();
        
        det = 1.0 / det;
        for (let i = 0; i < 16; i++) {
            inv[i] *= det;
        }
        
        return inv;
    }
    
    identityMatrix() {
        const m = new Float32Array(16);
        m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
        return m;
    }
    
    transformPoint(point, matrix) {
        const x = point[0] * matrix[0] + point[1] * matrix[4] + point[2] * matrix[8] + matrix[12];
        const y = point[0] * matrix[1] + point[1] * matrix[5] + point[2] * matrix[9] + matrix[13];
        const z = point[0] * matrix[2] + point[1] * matrix[6] + point[2] * matrix[10] + matrix[14];
        const w = point[0] * matrix[3] + point[1] * matrix[7] + point[2] * matrix[11] + matrix[15];
        return [x / w, y / w, z / w];
    }
    
    setTarget(target) {
        this.target = [...target];
    }
    
    reset() {
        this.yaw = Math.PI / 2;
        this.pitch = Math.PI / 6;
        this.distance = 12;
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
        this.targetDistance = this.distance;
    }
}
