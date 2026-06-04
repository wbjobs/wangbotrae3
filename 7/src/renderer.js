export class WebGPURenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.device = null;
        this.context = null;
        this.format = null;
        
        this.width = 0;
        this.height = 0;
        this.renderScale = 0.5;
        this.minRenderScale = 0.25;
        this.maxRenderScale = 1.0;
        this.targetFPS = 60;
        this.fpsHistory = [];
        this.adaptiveScaleEnabled = true;
        
        this.raytracePipeline = null;
        this.denoisePipeline = null;
        this.compositePipeline = null;
        
        this.uniformBuffer = null;
        this.sphereBuffer = null;
        this.particleBuffer = null;
        this.bvhBuffer = null;
        
        this.colorTexture = null;
        this.albedoTexture = null;
        this.normalTexture = null;
        this.motionVectorTexture = null;
        this.depthTexture = null;
        
        this.prevColorTexture = null;
        this.prevDepthTexture = null;
        this.prevViewProjMatrix = null;
        
        this.frameIndex = 0;
        this.jitterOffset = [0, 0];
        
        this.light = {
            dir: [0.5, 0.8, 0.3],
            color: [1.0, 0.95, 0.8],
            intensity: 2.0,
            temperature: 6500,
            targetColor: [1.0, 0.95, 0.8],
            targetIntensity: 2.0,
            targetTemperature: 6500,
            combo: 1,
            smoothSpeed: 3.0,
            baseIntensity: 2.0,
            baseTemperature: 6500,
            maxIntensity: 8.0,
            minTemperature: 2500,
            maxTemperature: 6500
        };
        
        this.bindGroupLayouts = {};
        this.bindGroups = {};
    }
    
    async init() {
        const entry = navigator.gpu;
        if (!entry) {
            throw new Error('WebGPU 不受支持');
        }
        
        const adapter = await entry.requestAdapter({
            powerPreference: 'high-performance'
        });
        
        if (!adapter) {
            throw new Error('无法获取 GPU 适配器');
        }
        
        const availableFeatures = adapter.features;
        const requiredFeatures = [];
        
        if (availableFeatures.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        }
        if (availableFeatures.has('timestamp-query')) {
            requiredFeatures.push('timestamp-query');
        }
        
        this.device = await adapter.requestDevice({
            requiredFeatures: requiredFeatures,
            requiredLimits: {
                maxComputeWorkgroupStorageSize: 32768,
                maxComputeInvocationsPerWorkgroup: 256,
                maxStorageBufferBindingSize: 134217728
            }
        });
        
        this.context = this.canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        
        this.context.configure({
            device: this.device,
            format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
        });
        
        this.createPipelines();
        this.createBuffers();
    }
    
    createPipelines() {
        this.createBindGroupLayouts();
        this.createRaytracePipeline();
        this.createDenoisePipeline();
        this.createCompositePipeline();
    }
    
    createBindGroupLayouts() {
        this.bindGroupLayouts.raytrace = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rg16float', access: 'write' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'r32float', access: 'write' } }
            ]
        });
        
        this.bindGroupLayouts.denoise = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'read' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'read' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'read' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rg16float', access: 'read' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'r32float', access: 'read' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'read' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'r32float', access: 'read' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write' } }
            ]
        });
        
        this.bindGroupLayouts.composite = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
            ]
        });
    }
    
    createRaytracePipeline() {
        const shaderModule = this.device.createShaderModule({
            code: this.getRaytraceShader()
        });
        
        this.raytracePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayouts.raytrace]
            }),
            compute: {
                module: shaderModule,
                entryPoint: 'main'
            }
        });
    }
    
    createDenoisePipeline() {
        const shaderModule = this.device.createShaderModule({
            code: this.getDenoiseShader()
        });
        
        this.denoisePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayouts.denoise]
            }),
            compute: {
                module: shaderModule,
                entryPoint: 'main'
            }
        });
    }
    
    createCompositePipeline() {
        const shaderModule = this.device.createShaderModule({
            code: this.getCompositeShader()
        });
        
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
            ]
        });
        
        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });
        
        this.compositePipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main'
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-list'
            }
        });
        
        this.compositeBindGroupLayout = bindGroupLayout;
    }
    
    createBuffers() {
        const uniformSize = 512;
        this.uniformBuffer = this.device.createBuffer({
            size: uniformSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        const sphereBufferSize = 1024 * 64;
        this.sphereBuffer = this.device.createBuffer({
            size: sphereBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        
        const particleBufferSize = 2048 * 64;
        this.particleBuffer = this.device.createBuffer({
            size: particleBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        
        const bvhSize = 1024 * 64;
        this.bvhBuffer = this.device.createBuffer({
            size: bvhSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        
        this.prevViewProjMatrix = new Float32Array(16);
    }
    
    createTextures(width, height) {
        const rtWidth = Math.floor(width * this.renderScale);
        const rtHeight = Math.floor(height * this.renderScale);
        
        const createRT = (format, usage) => this.device.createTexture({
            size: [rtWidth, rtHeight],
            format: format,
            usage: usage,
            mipLevelCount: 1
        });
        
        const texUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
        
        this.colorTexture = createRT('rgba16float', texUsage);
        this.albedoTexture = createRT('rgba16float', texUsage);
        this.normalTexture = createRT('rgba16float', texUsage);
        this.motionVectorTexture = createRT('rg16float', texUsage);
        this.depthTexture = createRT('r32float', texUsage);
        
        this.prevColorTexture = createRT('rgba16float', texUsage);
        this.prevDepthTexture = createRT('r32float', texUsage);
        
        this.denoisedTexture = createRT('rgba16float', texUsage);
        
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        });
    }
    
    resize(width, height) {
        this.width = width;
        this.height = height;
        this.createTextures(width, height);
        this.createBindGroups();
    }
    
    createBindGroups() {
        this.raytraceBindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayouts.raytrace,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.sphereBuffer } },
                { binding: 2, resource: { buffer: this.particleBuffer } },
                { binding: 3, resource: { buffer: this.bvhBuffer } },
                { binding: 4, resource: this.colorTexture.createView() },
                { binding: 5, resource: this.albedoTexture.createView() },
                { binding: 6, resource: this.normalTexture.createView() },
                { binding: 7, resource: this.motionVectorTexture.createView() },
                { binding: 8, resource: this.depthTexture.createView() }
            ]
        });
        
        this.denoiseBindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayouts.denoise,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.colorTexture.createView() },
                { binding: 2, resource: this.albedoTexture.createView() },
                { binding: 3, resource: this.normalTexture.createView() },
                { binding: 4, resource: this.motionVectorTexture.createView() },
                { binding: 5, resource: this.depthTexture.createView() },
                { binding: 6, resource: this.prevColorTexture.createView() },
                { binding: 7, resource: this.prevDepthTexture.createView() },
                { binding: 8, resource: this.denoisedTexture.createView() }
            ]
        });
        
        this.compositeBindGroup = this.device.createBindGroup({
            layout: this.compositeBindGroupLayout,
            entries: [
                { binding: 0, resource: this.denoisedTexture.createView() },
                { binding: 1, resource: this.sampler }
            ]
        });
    }
    
    updateUniforms(camera, sphereCount, particleCount, selectedIndex, highlightedIndices) {
        const data = new Float32Array(128);
        const viewProj = this.multiplyMatrices(camera.projectionMatrix, camera.viewMatrix);
        
        const jitterX = (Math.random() * 2 - 1) / (this.width * this.renderScale);
        const jitterY = (Math.random() * 2 - 1) / (this.height * this.renderScale);
        this.jitterOffset = [jitterX, jitterY];
        
        let offset = 0;
        data.set(camera.position, offset); offset += 4;
        data.set([this.width * this.renderScale, this.height * this.renderScale, this.frameIndex, this.renderScale], offset); offset += 4;
        data.set(viewProj, offset); offset += 16;
        data.set(this.prevViewProjMatrix, offset); offset += 16;
        data.set([jitterX, jitterY, sphereCount, particleCount], offset); offset += 4;
        data.set([selectedIndex, camera.yaw, camera.pitch, camera.distance], offset); offset += 4;
        
        const highlighted = new Float32Array(8);
        for (let i = 0; i < Math.min(highlightedIndices.length, 8); i++) {
            highlighted[i] = highlightedIndices[i];
        }
        data.set(highlighted, offset); offset += 8;
        
        const lightDirNorm = this.normalize(this.light.dir);
        data.set([lightDirNorm[0], lightDirNorm[1], lightDirNorm[2], 0], offset); offset += 4;
        data.set([this.light.color[0], this.light.color[1], this.light.color[2], this.light.intensity], offset); offset += 4;
        data.set([this.light.targetColor[0], this.light.targetColor[1], this.light.targetColor[2], this.light.targetIntensity], offset); offset += 4;
        
        const tempProgress = (this.light.temperature - this.light.minTemperature) / (this.light.maxTemperature - this.light.minTemperature);
        data.set([tempProgress, this.light.combo, this.getDynamicSampleCount(), 0], offset); offset += 4;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
        
        this.prevViewProjMatrix.set(viewProj);
    }
    
    normalize(v) {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return [v[0] / len, v[1] / len, v[2] / len];
    }
    
    updateSphereBuffer(spheres) {
        const data = new Float32Array(spheres.length * 16);
        
        for (let i = 0; i < spheres.length; i++) {
            const sphere = spheres[i];
            const offset = i * 16;
            
            data[offset] = sphere.position[0];
            data[offset + 1] = sphere.position[1];
            data[offset + 2] = sphere.position[2];
            data[offset + 3] = sphere.radius;
            
            data[offset + 4] = sphere.color[0];
            data[offset + 5] = sphere.color[1];
            data[offset + 6] = sphere.color[2];
            data[offset + 7] = sphere.materialType;
            
            data[offset + 8] = sphere.metalness;
            data[offset + 9] = sphere.roughness;
            data[offset + 10] = sphere.emissiveIntensity;
            data[offset + 11] = sphere.ior;
            
            data[offset + 12] = sphere.active ? 1 : 0;
            data[offset + 13] = sphere.scale;
            data[offset + 14] = sphere.gridX;
            data[offset + 15] = sphere.gridY;
        }
        
        this.device.queue.writeBuffer(this.sphereBuffer, 0, data);
    }
    
    updateParticleBuffer(particles) {
        const data = new Float32Array(particles.length * 16);
        
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const offset = i * 16;
            
            data[offset] = p.position[0];
            data[offset + 1] = p.position[1];
            data[offset + 2] = p.position[2];
            data[offset + 3] = p.size;
            
            data[offset + 4] = p.color[0];
            data[offset + 5] = p.color[1];
            data[offset + 6] = p.color[2];
            data[offset + 7] = p.alpha;
            
            data[offset + 8] = p.velocity[0];
            data[offset + 9] = p.velocity[1];
            data[offset + 10] = p.velocity[2];
            data[offset + 11] = p.life;
            
            data[offset + 12] = p.emissiveFactor;
            data[offset + 13] = p.emissive ? 1.0 : 0.0;
            data[offset + 14] = 0;
            data[offset + 15] = 0;
        }
        
        this.device.queue.writeBuffer(this.particleBuffer, 0, data);
    }
    
    buildBVH(spheres) {
        const activeSpheres = spheres.filter(s => s.active);
        const bvhData = this.buildBVHRecursive(activeSpheres, 0, activeSpheres.length, 0);
        this.device.queue.writeBuffer(this.bvhBuffer, 0, bvhData);
    }
    
    buildBVHRecursive(spheres, start, end, depth) {
        const data = new Float32Array(8);
        
        if (end - start <= 4 || depth > 16) {
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            
            for (let i = start; i < end; i++) {
                const s = spheres[i];
                minX = Math.min(minX, s.position[0] - s.radius);
                minY = Math.min(minY, s.position[1] - s.radius);
                minZ = Math.min(minZ, s.position[2] - s.radius);
                maxX = Math.max(maxX, s.position[0] + s.radius);
                maxY = Math.max(maxY, s.position[1] + s.radius);
                maxZ = Math.max(maxZ, s.position[2] + s.radius);
            }
            
            data[0] = minX; data[1] = minY; data[2] = minZ; data[3] = 0;
            data[4] = maxX; data[5] = maxY; data[6] = maxZ; data[7] = end - start;
            
            return data;
        }
        
        const axis = depth % 3;
        const mid = Math.floor((start + end) / 2);
        
        spheres.slice(start, end).sort((a, b) => a.position[axis] - b.position[axis]);
        
        const left = this.buildBVHRecursive(spheres, start, mid, depth + 1);
        const right = this.buildBVHRecursive(spheres, mid, end, depth + 1);
        
        const minX = Math.min(left[0], right[0]);
        const minY = Math.min(left[1], right[1]);
        const minZ = Math.min(left[2], right[2]);
        const maxX = Math.max(left[4], right[4]);
        const maxY = Math.max(left[5], right[5]);
        const maxZ = Math.max(left[6], right[6]);
        
        data[0] = minX; data[1] = minY; data[2] = minZ; data[3] = 1;
        data[4] = maxX; data[5] = maxY; data[6] = maxZ; data[7] = 0;
        
        return data;
    }
    
    render(camera, spheres, particles, selectedSphere, highlightedSpheres) {
        if (!this.device) return;
        
        const commandEncoder = this.device.createCommandEncoder();
        
        const selectedIndex = selectedSphere ? spheres.indexOf(selectedSphere) : -1;
        const highlightedIndices = highlightedSpheres.map(s => spheres.indexOf(s));
        
        this.updateUniforms(camera, spheres.length, particles.length, selectedIndex, highlightedIndices);
        this.updateSphereBuffer(spheres);
        this.updateParticleBuffer(particles);
        
        const rtWidth = Math.floor(this.width * this.renderScale);
        const rtHeight = Math.floor(this.height * this.renderScale);
        
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.raytracePipeline);
        passEncoder.setBindGroup(0, this.raytraceBindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(rtWidth / 8),
            Math.ceil(rtHeight / 8),
            1
        );
        passEncoder.end();
        
        const denoisePass = commandEncoder.beginComputePass();
        denoisePass.setPipeline(this.denoisePipeline);
        denoisePass.setBindGroup(0, this.denoiseBindGroup);
        denoisePass.dispatchWorkgroups(
            Math.ceil(rtWidth / 8),
            Math.ceil(rtHeight / 8),
            1
        );
        denoisePass.end();
        
        commandEncoder.copyTextureToTexture(
            { texture: this.colorTexture },
            { texture: this.prevColorTexture },
            [rtWidth, rtHeight]
        );
        
        commandEncoder.copyTextureToTexture(
            { texture: this.depthTexture },
            { texture: this.prevDepthTexture },
            [rtWidth, rtHeight]
        );
        
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        
        renderPass.setPipeline(this.compositePipeline);
        renderPass.setBindGroup(0, this.compositeBindGroup);
        renderPass.draw(3, 1, 0, 0);
        renderPass.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
        this.frameIndex++;
    }
    
    updateRenderScale(currentFPS, deltaTime) {
        if (!this.adaptiveScaleEnabled) return;
        
        this.fpsHistory.push(currentFPS);
        if (this.fpsHistory.length > 10) {
            this.fpsHistory.shift();
        }
        
        if (this.fpsHistory.length < 5) return;
        
        const avgFPS = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
        
        if (avgFPS < this.targetFPS * 0.9) {
            this.renderScale = Math.max(this.minRenderScale, this.renderScale - 0.05);
            this.fpsHistory = [];
            this.resize(this.width, this.height);
        } else if (avgFPS > this.targetFPS * 1.1 && this.renderScale < this.maxRenderScale) {
            this.renderScale = Math.min(this.maxRenderScale, this.renderScale + 0.02);
            this.fpsHistory = [];
            this.resize(this.width, this.height);
        }
    }
    
    temperatureToRGB(kelvin) {
        const temp = kelvin / 100;
        let red, green, blue;
        
        if (temp <= 66) {
            red = 255;
            green = Math.min(255, Math.max(0, 99.4708025861 * Math.log(temp) - 161.1195681661));
        } else {
            red = Math.min(255, Math.max(0, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
            green = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
        }
        
        if (temp >= 66) {
            blue = 255;
        } else if (temp <= 19) {
            blue = 0;
        } else {
            blue = Math.min(255, Math.max(0, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
        }
        
        return [red / 255, green / 255, blue / 255];
    }
    
    easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }
    
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    
    setCombo(combo) {
        const clampedCombo = Math.max(1, Math.min(combo, 10));
        this.light.combo = clampedCombo;
        
        const comboProgress = (clampedCombo - 1) / 9;
        
        const easedProgress = this.easeInOutCubic(comboProgress);
        
        const intensityRange = this.light.maxIntensity - this.light.baseIntensity;
        this.light.targetIntensity = this.light.baseIntensity + intensityRange * easedProgress;
        
        const tempRange = this.light.maxTemperature - this.light.minTemperature;
        this.light.targetTemperature = this.light.maxTemperature - tempRange * easedProgress;
        
        this.light.targetColor = this.temperatureToRGB(this.light.targetTemperature);
    }
    
    updateLight(deltaTime) {
        const speed = this.light.smoothSpeed * deltaTime;
        
        this.light.intensity += (this.light.targetIntensity - this.light.intensity) * speed;
        this.light.temperature += (this.light.targetTemperature - this.light.temperature) * speed;
        
        for (let i = 0; i < 3; i++) {
            this.light.color[i] += (this.light.targetColor[i] - this.light.color[i]) * speed;
        }
        
        this.light.intensity = Math.max(this.light.baseIntensity, Math.min(this.light.maxIntensity, this.light.intensity));
        this.light.temperature = Math.max(this.light.minTemperature, Math.min(this.light.maxTemperature, this.light.temperature));
    }
    
    getDynamicSampleCount() {
        const intensityRatio = (this.light.intensity - this.light.baseIntensity) / (this.light.maxIntensity - this.light.baseIntensity);
        const baseSamples = 4;
        const maxExtraSamples = 4;
        return baseSamples + Math.floor(intensityRatio * maxExtraSamples);
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
    
    getRaytraceShader() {
        return /* wgsl */ `
        
struct Uniforms {
    cameraPos: vec4f,
    screenSize: vec4f,
    viewProj: mat4x4f,
    prevViewProj: mat4x4f,
    jitter: vec4f,
    extra: vec4f,
    highlighted: vec4f,
    highlighted2: vec4f,
    lightDir: vec4f,
    lightColor: vec4f,
    lightTarget: vec4f,
    lightParams: vec4f,
};

struct Sphere {
    pos: vec4f,
    color: vec4f,
    material: vec4f,
    extra: vec4f,
};

struct Particle {
    pos: vec4f,
    color: vec4f,
    vel: vec4f,
    emissiveData: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(2) var<storage, read> particles: array<Particle>;
@group(0) @binding(4) var imageColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var imageAlbedo: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var imageNormal: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var imageMotion: texture_storage_2d<rg16float, write>;
@group(0) @binding(8) var imageDepth: texture_storage_2d<r32float, write>;

struct Ray {
    origin: vec3f,
    dir: vec3f,
    t: f32,
    hit: bool,
    hitPoint: vec3f,
    normal: vec3f,
    albedo: vec3f,
    metalness: f32,
    roughness: f32,
    emissive: vec3f,
    ior: f32,
    matType: f32,
    sphereIndex: i32,
};

fn random(seed: vec2f) -> f32 {
    return fract(sin(dot(seed, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn random3(seed: vec2f) -> vec3f {
    return vec3f(
        random(seed + vec2f(1.0, 2.0)),
        random(seed + vec2f(3.0, 4.0)),
        random(seed + vec2f(5.0, 6.0))
    );
}

fn intersectSphere(ray: ptr<function, Ray>, sphere: Sphere, index: i32) {
    var oc = (*ray).origin - sphere.pos.xyz;
    var a = dot((*ray).dir, (*ray).dir);
    var b = 2.0 * dot(oc, (*ray).dir);
    var c = dot(oc, oc) - sphere.pos.w * sphere.pos.w;
    var d = b * b - 4.0 * a * c;
    
    if (d < 0.0) { return; }
    
    var t1 = (-b - sqrt(d)) / (2.0 * a);
    var t2 = (-b + sqrt(d)) / (2.0 * a);
    var t = select(t2, t1, t1 > 0.001);
    
    if (t > 0.001 && t < (*ray).t && sphere.extra.x > 0.5) {
        (*ray).t = t;
        (*ray).hit = true;
        (*ray).hitPoint = (*ray).origin + (*ray).dir * t;
        (*ray).normal = normalize((*ray).hitPoint - sphere.pos.xyz);
        (*ray).albedo = sphere.color.rgb;
        (*ray).metalness = sphere.material.x;
        (*ray).roughness = sphere.material.y;
        (*ray).emissive = sphere.color.rgb * sphere.material.z;
        (*ray).ior = sphere.material.w;
        (*ray).matType = sphere.color.w;
        (*ray).sphereIndex = index;
    }
}

fn intersectParticle(ray: ptr<function, Ray>, particle: Particle) {
    var emissiveFactor = particle.emissiveData.x;
    var isActive = particle.emissiveData.y;
    
    if (isActive < 0.5) { return; }
    if (particle.pos.w < 0.001) { return; }
    
    var oc = (*ray).origin - particle.pos.xyz;
    var a = dot((*ray).dir, (*ray).dir);
    var b = 2.0 * dot(oc, (*ray).dir);
    var c = dot(oc, oc) - particle.pos.w * particle.pos.w;
    var d = b * b - 4.0 * a * c;
    
    if (d < 0.0) { return; }
    
    var t = (-b - sqrt(d)) / (2.0 * a);
    
    if (t > 0.001 && t < (*ray).t) {
        (*ray).t = t;
        (*ray).hit = true;
        (*ray).hitPoint = (*ray).origin + (*ray).dir * t;
        (*ray).normal = normalize((*ray).hitPoint - particle.pos.xyz);
        (*ray).albedo = particle.color.rgb;
        (*ray).metalness = 0.0;
        (*ray).roughness = 1.0;
        (*ray).emissive = particle.color.rgb * emissiveFactor;
        (*ray).ior = 1.0;
        (*ray).matType = 2.0;
        (*ray).sphereIndex = -1;
    }
}

fn traceScene(ray: ptr<function, Ray>) {
    var sphereCount = i32(uniforms.jitter.z);
    var particleCount = i32(uniforms.jitter.w);
    
    for (var i = 0; i < sphereCount; i++) {
        intersectSphere(ray, spheres[i], i);
    }
    
    for (var i = 0; i < particleCount; i++) {
        intersectParticle(ray, particles[i]);
    }
}

fn sampleParticleEmission(hitPoint: vec3f, normal: vec3f, randVal: f32, particleCount: i32) -> vec3f {
    var contribution = vec3f(0.0);
    
    if (particleCount <= 0) { return contribution; }
    
    var sampledIndex = i32(randVal * f32(particleCount));
    sampledIndex = clamp(sampledIndex, 0, particleCount - 1);
    
    var p = particles[sampledIndex];
    var emissiveFactor = p.emissiveData.x;
    var isActive = p.emissiveData.y;
    
    if (isActive < 0.5 || emissiveFactor < 0.01) { return contribution; }
    if (p.pos.w < 0.001) { return contribution; }
    
    var toParticle = p.pos.xyz - hitPoint;
    var dist2 = dot(toParticle, toParticle);
    var dist = sqrt(dist2);
    
    if (dist < 0.001) { return contribution; }
    
    var dirToParticle = toParticle / dist;
    var NdotL = dot(normal, dirToParticle);
    
    if (NdotL <= 0.0) { return contribution; }
    
    var shadowRay: Ray;
    shadowRay.origin = hitPoint + normal * 0.002;
    shadowRay.dir = dirToParticle;
    shadowRay.t = dist - 0.01;
    shadowRay.hit = false;
    shadowRay.sphereIndex = -1;
    
    var sphereCount = i32(uniforms.jitter.z);
    for (var i = 0; i < sphereCount; i++) {
        intersectSphere(&shadowRay, spheres[i], i);
    }
    
    if (shadowRay.hit) { return contribution; }
    
    var particleRadius = p.pos.w;
    var solidAngleApprox = (particleRadius * particleRadius) / max(dist2, 0.001);
    var pdf = 1.0 / f32(particleCount);
    
    var emissiveColor = p.color.rgb * emissiveFactor;
    contribution = emissiveColor * solidAngleApprox * NdotL / max(pdf, 0.001);
    
    return contribution;
}

fn sampleSphereEmission(hitPoint: vec3f, normal: vec3f, randVal: f32, sphereCount: i32) -> vec3f {
    var contribution = vec3f(0.0);
    
    if (sphereCount <= 0) { return contribution; }
    
    var sampledIndex = i32(randVal * f32(sphereCount));
    sampledIndex = clamp(sampledIndex, 0, sphereCount - 1);
    
    var s = spheres[sampledIndex];
    
    if (s.extra.x < 0.5) { return contribution; }
    if (s.material.z < 0.01) { return contribution; }
    
    var toSphere = s.pos.xyz - hitPoint;
    var dist2 = dot(toSphere, toSphere);
    var dist = sqrt(dist2);
    
    if (dist < 0.001) { return contribution; }
    
    var dirToSphere = toSphere / dist;
    var NdotL = dot(normal, dirToSphere);
    
    if (NdotL <= 0.0) { return contribution; }
    
    var shadowRay: Ray;
    shadowRay.origin = hitPoint + normal * 0.002;
    shadowRay.dir = dirToSphere;
    shadowRay.t = dist - s.pos.w - 0.01;
    shadowRay.hit = false;
    shadowRay.sphereIndex = -1;
    
    for (var i = 0; i < sphereCount; i++) {
        if (i == sampledIndex) { continue; }
        intersectSphere(&shadowRay, spheres[i], i);
    }
    
    if (shadowRay.hit) { return contribution; }
    
    var sphereRadius = s.pos.w;
    var solidAngleApprox = (sphereRadius * sphereRadius) / max(dist2, 0.001);
    var pdf = 1.0 / f32(sphereCount);
    
    var emissiveColor = s.color.rgb * s.material.z;
    contribution = emissiveColor * solidAngleApprox * NdotL / max(pdf, 0.001);
    
    return contribution;
}

fn getSkyColor(dir: vec3f) -> vec3f {
    var t = 0.5 * (dir.y + 1.0);
    
    var warmColor = vec3f(0.15, 0.12, 0.08);
    var coolColor = vec3f(0.1, 0.15, 0.3);
    var skyBase = mix(coolColor, warmColor, uniforms.lightParams.x / 10.0);
    
    var sky = mix(skyBase, vec3f(0.02, 0.02, 0.05), t);
    
    var sunDir = normalize(uniforms.lightDir.xyz);
    var sunColor = uniforms.lightColor.rgb;
    var sunIntensity = uniforms.lightColor.w;
    var sun = pow(max(dot(dir, sunDir), 0.0), 64.0) * sunColor * sunIntensity;
    
    return sky + sun;
}

fn fresnel(cosTheta: f32, ior: f32) -> f32 {
    var f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

fn isHighlighted(index: i32) -> f32 {
    if (index < 0) { return 0.0; }
    var idx = f32(index);
    if (abs(uniforms.highlighted.x - idx) < 0.5) { return 1.0; }
    if (abs(uniforms.highlighted.y - idx) < 0.5) { return 1.0; }
    if (abs(uniforms.highlighted.z - idx) < 0.5) { return 1.0; }
    if (abs(uniforms.highlighted.w - idx) < 0.5) { return 1.0; }
    if (abs(uniforms.highlighted2.x - idx) < 0.5) { return 1.0; }
    if (abs(uniforms.highlighted2.y - idx) < 0.5) { return 1.0; }
    if (abs(uniforms.highlighted2.z - idx) < 0.5) { return 1.0; }
    if (abs(uniforms.highlighted2.w - idx) < 0.5) { return 1.0; }
    return 0.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    var width = u32(uniforms.screenSize.x);
    var height = u32(uniforms.screenSize.y);
    
    if (id.x >= width || id.y >= height) { return; }
    
    var seed = vec2f(f32(id.x) + uniforms.screenSize.z * 0.1337, f32(id.y) + uniforms.screenSize.z * 0.42);
    var jitter = random3(seed) * 0.5 - 0.25;
    
    var uv = (vec2f(f32(id.x), f32(id.y)) + jitter.xy + vec2f(0.5)) / vec2f(f32(width), f32(height));
    uv = uv * 2.0 - 1.0;
    uv.x *= f32(width) / f32(height);
    uv += vec2f(uniforms.jitter.x, uniforms.jitter.y);
    
    var yaw = uniforms.extra.y;
    var pitch = uniforms.extra.z;
    var distance = uniforms.extra.w;
    
    var forward = vec3f(
        cos(pitch) * sin(yaw),
        sin(pitch),
        cos(pitch) * cos(yaw)
    );
    var right = normalize(cross(vec3f(0.0, 1.0, 0.0), forward));
    var up = cross(forward, right);
    
    var rayOrigin = uniforms.cameraPos.xyz;
    var rayDir = normalize(forward + uv.x * right + uv.y * up);
    
    var color = vec3f(0.0);
    var albedo = vec3f(0.0);
    var normal = vec3f(0.0);
    var depth = 0.0;
    
    var throughput = vec3f(1.0);
    var baseBounces = 4u;
    var extraBounces = u32(uniforms.lightParams.z);
    var maxBounces = baseBounces + extraBounces;
    
    var ray: Ray;
    ray.origin = rayOrigin;
    ray.dir = rayDir;
    ray.t = 1e9;
    ray.hit = false;
    ray.sphereIndex = -1;
    
    var firstHit = true;
    var firstNormal = vec3f(0.0);
    var firstAlbedo = vec3f(0.0);
    var firstDepth = 0.0;
    var firstPos = vec3f(0.0);
    var firstMatType = 0.0;
    
    for (var bounce = 0u; bounce < maxBounces; bounce++) {
        ray.t = 1e9;
        ray.hit = false;
        
        traceScene(&ray);
        
        if (!ray.hit) {
            color += throughput * getSkyColor(ray.dir);
            break;
        }
        
        if (firstHit) {
            firstNormal = ray.normal;
            firstAlbedo = ray.albedo;
            firstDepth = ray.t;
            firstPos = ray.hitPoint;
            firstMatType = ray.matType;
            firstHit = false;
        }
        
        if (length(ray.emissive) > 0.0) {
            color += throughput * ray.emissive;
        }
        
        if (ray.matType > 1.5) {
            color += throughput * ray.emissive;
            break;
        }
        
        var sphereCount = i32(uniforms.jitter.z);
        var particleCount = i32(uniforms.jitter.w);
        var rand = random3(seed + vec2f(f32(bounce)));
        
        var neeContribution = vec3f(0.0);
        
        if (particleCount > 0) {
            neeContribution += sampleParticleEmission(ray.hitPoint, ray.normal, rand.x, particleCount);
        }
        
        if (sphereCount > 0) {
            neeContribution += sampleSphereEmission(ray.hitPoint, ray.normal, rand.y, sphereCount);
        }
        
        color += throughput * ray.albedo * neeContribution * 0.5;
        
        if (ray.matType < 0.5) {
            var F = fresnel(max(dot(-ray.dir, ray.normal), 0.0), 1.5);
            if (rand.x < F) {
                ray.dir = reflect(ray.dir, ray.normal);
                ray.dir += rand.yzx * ray.roughness * 0.3;
                ray.dir = normalize(ray.dir);
                throughput *= mix(ray.albedo, vec3f(1.0), 0.8);
            } else {
                var eta = 1.0 / ray.ior;
                var cosi = dot(-ray.dir, ray.normal);
                var k = 1.0 - eta * eta * (1.0 - cosi * cosi);
                if (k > 0.0) {
                    ray.dir = eta * ray.dir + (eta * cosi - sqrt(k)) * ray.normal;
                } else {
                    ray.dir = reflect(ray.dir, ray.normal);
                }
                ray.dir = normalize(ray.dir);
                throughput *= 0.95;
            }
        } else if (ray.matType < 1.5) {
            var F = fresnel(max(dot(-ray.dir, ray.normal), 0.0), ray.ior);
            if (rand.x < F) {
                ray.dir = reflect(ray.dir, ray.normal);
                ray.dir += rand.yzx * ray.roughness * 0.1;
                ray.dir = normalize(ray.dir);
                throughput *= vec3f(0.95);
            } else {
                var eta = 1.0 / ray.ior;
                var cosi = dot(-ray.dir, ray.normal);
                var k = 1.0 - eta * eta * (1.0 - cosi * cosi);
                if (k > 0.0) {
                    ray.dir = eta * ray.dir + (eta * cosi - sqrt(k)) * ray.normal;
                } else {
                    ray.dir = reflect(ray.dir, ray.normal);
                }
                ray.dir = normalize(ray.dir);
                throughput *= 0.95;
            }
        }
        
        ray.origin = ray.hitPoint + ray.normal * 0.001;
        
        if (max(throughput.x, max(throughput.y, throughput.z)) < 0.01) {
            break;
        }
    }
    
    normal = firstNormal;
    albedo = firstAlbedo;
    depth = firstDepth;
    
    var hl = isHighlighted(ray.sphereIndex);
    if (hl > 0.5) {
        color += vec3f(0.3, 0.5, 1.0) * 0.5;
        albedo = mix(albedo, vec3f(0.5, 0.7, 1.0), 0.3);
    }
    
    if (abs(uniforms.extra.x - f32(ray.sphereIndex)) < 0.5 && ray.sphereIndex >= 0) {
        color += vec3f(1.0, 0.8, 0.0) * 0.8;
        var rim = pow(1.0 - max(dot(-rayDir, normal), 0.0), 3.0);
        color += vec3f(1.0, 0.8, 0.3) * rim * 2.0;
    }
    
    color = color / (color + vec3f(1.0));
    color = pow(color, vec3f(1.0 / 2.2));
    
    var prevClip = uniforms.prevViewProj * vec4(firstPos, 1.0);
    var prevUV = prevClip.xy / prevClip.w * 0.5 + 0.5;
    var currentClip = uniforms.viewProj * vec4(firstPos, 1.0);
    var currentUV = currentClip.xy / currentClip.w * 0.5 + 0.5;
    var motion = currentUV - prevUV;
    
    textureStore(imageColor, vec2i(id.x, id.y), vec4(color, 1.0));
    textureStore(imageAlbedo, vec2i(id.x, id.y), vec4(albedo, ray.matType));
    textureStore(imageNormal, vec2i(id.x, id.y), vec4(normal * 0.5 + 0.5, 1.0));
    textureStore(imageMotion, vec2i(id.x, id.y), vec2(motion.x, motion.y));
    textureStore(imageDepth, vec2i(id.x, id.y), vec4(depth, 0.0, 0.0, 0.0));
}
`;
    }
    
    getDenoiseShader() {
        return /* wgsl */ `
        
struct Uniforms {
    cameraPos: vec4f,
    screenSize: vec4f,
    viewProj: mat4x4f,
    prevViewProj: mat4x4f,
    jitter: vec4f,
    extra: vec4f,
    highlighted: vec4f,
    highlighted2: vec4f,
    lightDir: vec4f,
    lightColor: vec4f,
    lightTarget: vec4f,
    lightParams: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var colorTex: texture_storage_2d<rgba16float, read>;
@group(0) @binding(2) var albedoTex: texture_storage_2d<rgba16float, read>;
@group(0) @binding(3) var normalTex: texture_storage_2d<rgba16float, read>;
@group(0) @binding(4) var motionTex: texture_storage_2d<rg16float, read>;
@group(0) @binding(5) var depthTex: texture_storage_2d<r32float, read>;
@group(0) @binding(6) var prevColorTex: texture_storage_2d<rgba16float, read>;
@group(0) @binding(7) var prevDepthTex: texture_storage_2d<r32float, read>;
@group(0) @binding(8) var outputTex: texture_storage_2d<rgba16float, write>;

fn getColor(x: i32, y: i32) -> vec3f {
    return textureLoad(colorTex, vec2i(x, y)).rgb;
}

fn getAlbedo(x: i32, y: i32) -> vec3f {
    return textureLoad(albedoTex, vec2i(x, y)).rgb;
}

fn getNormal(x: i32, y: i32) -> vec3f {
    return textureLoad(normalTex, vec2i(x, y)).rgb * 2.0 - 1.0;
}

fn getDepth(x: i32, y: i32) -> f32 {
    return textureLoad(depthTex, vec2i(x, y)).r;
}

fn getMotion(x: i32, y: i32) -> vec2f {
    return textureLoad(motionTex, vec2i(x, y)).xy;
}

fn getPrevColor(uv: vec2f, width: f32, height: f32) -> vec3f {
    var px = uv.x * width;
    var py = uv.y * height;
    var x0 = i32(floor(px));
    var y0 = i32(floor(py));
    var x1 = x0 + 1;
    var y1 = y0 + 1;
    var fx = px - floor(px);
    var fy = py - floor(py);
    
    x0 = clamp(x0, 0, i32(width) - 1);
    y0 = clamp(y0, 0, i32(height) - 1);
    x1 = clamp(x1, 0, i32(width) - 1);
    y1 = clamp(y1, 0, i32(height) - 1);
    
    var c00 = textureLoad(prevColorTex, vec2i(x0, y0)).rgb;
    var c10 = textureLoad(prevColorTex, vec2i(x1, y0)).rgb;
    var c01 = textureLoad(prevColorTex, vec2i(x0, y1)).rgb;
    var c11 = textureLoad(prevColorTex, vec2i(x1, y1)).rgb;
    
    return mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
}

fn gaussianWeight(sigma: f32, dist: f32) -> f32 {
    return exp(-0.5 * dist * dist / (sigma * sigma));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    var width = u32(uniforms.screenSize.x);
    var height = u32(uniforms.screenSize.y);
    
    if (id.x >= width || id.y >= height) { return; }
    
    var x = i32(id.x);
    var y = i32(id.y);
    
    var centerColor = getColor(x, y);
    var centerNormal = getNormal(x, y);
    var centerDepth = getDepth(x, y);
    var centerAlbedo = getAlbedo(x, y);
    var motion = getMotion(x, y);
    
    var radius = 3;
    var sigmaSpace = 3.0;
    var sigmaColor = 0.3;
    var sigmaNormal = 0.2;
    var sigmaDepth = 0.1;
    
    var colorSum = vec3f(0.0);
    var weightSum = 0.0;
    
    for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
            var sx = x + dx;
            var sy = y + dy;
            
            sx = clamp(sx, 0, i32(width) - 1);
            sy = clamp(sy, 0, i32(height) - 1);
            
            var sColor = getColor(sx, sy);
            var sNormal = getNormal(sx, sy);
            var sDepth = getDepth(sx, sy);
            var sAlbedo = getAlbedo(sx, sy);
            
            var dist = sqrt(f32(dx * dx + dy * dy));
            var colorDist = length(sColor - centerColor);
            var normalDist = length(sNormal - centerNormal);
            var depthDist = abs(sDepth - centerDepth) / max(centerDepth, 0.1);
            var albedoDist = length(sAlbedo - centerAlbedo);
            
            var w = gaussianWeight(sigmaSpace, dist);
            w *= gaussianWeight(sigmaColor, colorDist);
            w *= gaussianWeight(sigmaNormal, normalDist);
            w *= gaussianWeight(sigmaDepth, depthDist);
            w *= gaussianWeight(0.3, albedoDist);
            
            colorSum += sColor * w;
            weightSum += w;
        }
    }
    
    var denoised = colorSum / max(weightSum, 0.001);
    
    var uv = vec2f(f32(x) / f32(width), f32(y) / f32(height));
    var prevUV = uv - motion;
    
    if (prevUV.x >= 0.0 && prevUV.x <= 1.0 && prevUV.y >= 0.0 && prevUV.y <= 1.0) {
        var prevColor = getPrevColor(prevUV, f32(width), f32(height));
        var temporalWeight = 0.75;
        
        var prevDepth = textureLoad(prevDepthTex, vec2i(
            clamp(i32(prevUV.x * f32(width)), 0, i32(width) - 1),
            clamp(i32(prevUV.y * f32(height)), 0, i32(height) - 1)
        )).r;
        
        var depthDiff = abs(prevDepth - centerDepth) / max(centerDepth, 0.1);
        if (depthDiff > 0.1) {
            temporalWeight = 0.0;
        }
        
        var colorDiff = length(prevColor - denoised);
        if (colorDiff > 0.5) {
            temporalWeight = max(temporalWeight - colorDiff * 0.5, 0.2);
        }
        
        denoised = mix(denoised, prevColor, temporalWeight);
    }
    
    var fireflyThreshold = 0.9;
    if (max(denoised.r, max(denoised.g, denoised.b)) > fireflyThreshold) {
        var localMax = denoised;
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dy == 0) { continue; }
                var sx = clamp(x + dx, 0, i32(width) - 1);
                var sy = clamp(y + dy, 0, i32(height) - 1);
                var c = getColor(sx, sy);
                localMax = max(localMax, c);
            }
        }
        var luminance = dot(denoised, vec3f(0.299, 0.587, 0.114));
        var localLum = dot(localMax, vec3f(0.299, 0.587, 0.114));
        if (luminance > localLum * 1.5) {
            denoised = mix(denoised, centerColor * 0.5, 0.5);
        }
    }
    
    denoised = denoised / (denoised + vec3f(1.0));
    
    textureStore(outputTex, vec2i(x, y), vec4(denoised, 1.0));
}
`;
    }
    
    getCompositeShader() {
        return /* wgsl */ `
        
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
    var positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    return vec4f(positions[vid], 0.0, 1.0);
}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var sam: sampler;

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    var uv = pos.xy / vec2f(textureDimensions(tex));
    var color = textureSample(tex, sam, uv).rgb;
    
    var vignette = 1.0 - length(uv - 0.5) * 0.8;
    color *= vignette;
    
    var noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) * 0.02;
    
    return vec4f(color, 1.0);
}
`;
    }
}
