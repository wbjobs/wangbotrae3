import { WebGPURenderer } from './renderer.js';
import { GameLogic } from './gameLogic.js';
import { CameraController } from './camera.js';
import { ParticleSystem } from './particles.js';
import { SphereManager } from './spheres.js';

class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.renderer = null;
        this.gameLogic = null;
        this.camera = null;
        this.particles = null;
        this.spheres = null;
        
        this.score = 0;
        this.combo = 1;
        this.maxCombo = 1;
        this.isRunning = false;
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.lastFrameTime = performance.now();
        this.fpsAccumulator = 0;
        this.webgpuReady = false;
        this.initError = null;
        
        this.bindUIEvents();
        this.init();
    }
    
    bindUIEvents() {
        const startBtn = document.getElementById('start-btn');
        const restartBtn = document.getElementById('restart-btn');
        
        if (startBtn) {
            startBtn.addEventListener('click', () => this.handleStartClick());
        }
        if (restartBtn) {
            restartBtn.addEventListener('click', () => this.handleRestartClick());
        }
    }
    
    handleStartClick() {
        if (this.initError) {
            alert('WebGPU 初始化失败: ' + this.initError.message + '\n\n请确保您使用的是支持 WebGPU 的浏览器 (Chrome 113+)');
            return;
        }
        if (!this.webgpuReady) {
            alert('WebGPU 正在初始化，请稍候...');
            return;
        }
        this.startGame();
    }
    
    handleRestartClick() {
        if (this.initError) {
            alert('WebGPU 初始化失败，无法重新开始游戏');
            return;
        }
        this.restartGame();
    }
    
    async init() {
        try {
            this.renderer = new WebGPURenderer(this.canvas);
            await this.renderer.init();
            
            this.spheres = new SphereManager();
            this.camera = new CameraController(this.canvas);
            this.particles = new ParticleSystem();
            this.gameLogic = new GameLogic(this.spheres, this.particles, this);
            
            this.setupEventListeners();
            this.resize();
            window.addEventListener('resize', () => this.resize());
            
            this.webgpuReady = true;
            console.log('✅ WebGPU 初始化成功！');
            
        } catch (error) {
            console.error('❌ WebGPU 初始化失败:', error);
            this.initError = error;
            
            const hint = document.querySelector('#start-screen .hint');
            if (hint) {
                hint.innerHTML = '❌ WebGPU 初始化失败<br>请使用 Chrome 113+ 浏览器，并确保启用 WebGPU';
                hint.style.color = '#ff6b6b';
            }
        }
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
    }
    
    onMouseDown(e) {
        if (!this.isRunning) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (e.button === 0) {
            if (!this.camera.isDragging) {
                const hit = this.raycast(x, y);
                if (hit) {
                    this.gameLogic.selectSphere(hit);
                    return;
                }
            }
            this.camera.startDrag(x, y);
        }
    }
    
    onMouseUp(e) {
        this.camera.endDrag();
    }
    
    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.camera.onDrag(x, y);
    }
    
    onWheel(e) {
        e.preventDefault();
        this.camera.zoom(e.deltaY * 0.01);
    }
    
    onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const hit = this.raycast(x, y);
            if (hit) {
                this.gameLogic.selectSphere(hit);
            } else {
                this.camera.startDrag(x, y);
            }
        }
    }
    
    onTouchEnd(e) {
        this.camera.endDrag();
    }
    
    onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            this.camera.onDrag(x, y);
        }
    }
    
    raycast(x, y) {
        const ndcX = (x / this.canvas.width) * 2 - 1;
        const ndcY = -((y / this.canvas.height) * 2 - 1);
        
        const rayDir = this.camera.getRayDirection(ndcX, ndcY);
        const rayOrigin = this.camera.position;
        
        let closestHit = null;
        let closestDist = Infinity;
        
        for (const sphere of this.spheres.spheres) {
            if (!sphere.active) continue;
            
            const oc = [
                rayOrigin[0] - sphere.position[0],
                rayOrigin[1] - sphere.position[1],
                rayOrigin[2] - sphere.position[2]
            ];
            
            const b = oc[0] * rayDir[0] + oc[1] * rayDir[1] + oc[2] * rayDir[2];
            const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - sphere.radius * sphere.radius;
            const discriminant = b * b - c;
            
            if (discriminant > 0) {
                const t = -b - Math.sqrt(discriminant);
                if (t > 0 && t < closestDist) {
                    closestDist = t;
                    closestHit = sphere;
                }
            }
        }
        
        return closestHit;
    }
    
    startGame() {
        document.getElementById('start-screen').classList.add('hidden');
        this.isRunning = true;
        this.gameLogic.initBoard();
        this.animate();
    }
    
    restartGame() {
        document.getElementById('game-over-screen').classList.add('hidden');
        this.score = 0;
        this.combo = 1;
        this.maxCombo = 1;
        this.updateUI();
        this.isRunning = true;
        this.gameLogic.initBoard();
    }
    
    gameOver() {
        this.isRunning = false;
        document.getElementById('final-score').textContent = this.score;
        document.getElementById('max-combo').textContent = 'x' + this.maxCombo;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }
    
    addScore(points) {
        this.score += points * this.combo;
        this.combo = Math.min(this.combo + 1, 10);
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        
        if (this.renderer) {
            this.renderer.setCombo(this.combo);
        }
        
        this.updateUI();
    }
    
    resetCombo() {
        this.combo = 1;
        
        if (this.renderer) {
            this.renderer.setCombo(this.combo);
        }
        
        this.updateUI();
    }
    
    updateUI() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('combo').textContent = 'x' + this.combo;
    }
    
    resize() {
        const dpr = Math.min(window.devicePixelRatio, 2);
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        
        if (this.renderer) {
            this.renderer.resize(this.canvas.width, this.canvas.height);
        }
        if (this.camera) {
            this.camera.aspect = this.canvas.width / this.canvas.height;
        }
    }
    
    animate() {
        if (!this.isRunning) return;
        
        const now = performance.now();
        const deltaTime = Math.min((now - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = now;
        
        this.frameCount++;
        this.fpsAccumulator += deltaTime;
        
        if (this.fpsAccumulator >= 0.5) {
            const currentFPS = Math.round(this.frameCount / this.fpsAccumulator);
            document.getElementById('fps').textContent = currentFPS;
            
            this.renderer.updateRenderScale(currentFPS, deltaTime);
            
            this.frameCount = 0;
            this.fpsAccumulator = 0;
        }
        
        this.camera.update(deltaTime);
        this.gameLogic.update(deltaTime);
        this.particles.update(deltaTime);
        
        if (this.renderer) {
            this.renderer.updateLight(deltaTime);
        }
        
        this.renderer.render(
            this.camera,
            this.spheres.spheres,
            this.particles.particles,
            this.gameLogic.selectedSphere,
            this.gameLogic.highlightedSpheres
        );
        
        requestAnimationFrame(() => this.animate());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new Game();
});
