export class GameLogic {
    constructor(sphereManager, particleSystem, game) {
        this.sphereManager = sphereManager;
        this.particles = particleSystem;
        this.game = game;
        
        this.selectedSphere = null;
        this.highlightedSpheres = [];
        this.isProcessing = false;
        this.movesLeft = 30;
        this.score = 0;
        
        this.state = 'idle';
        this.stateTimer = 0;
        
        this.swapAnimationTime = 0.3;
        this.matchAnimationTime = 0.5;
        this.fallAnimationTime = 0.4;
        
        this.pendingMatches = [];
        this.cascadeLevel = 0;
        this.maxCascadeLevel = 5;
    }
    
    initBoard() {
        this.sphereManager.initBoard();
        this.selectedSphere = null;
        this.highlightedSpheres = [];
        this.isProcessing = false;
        this.movesLeft = 30;
        this.cascadeLevel = 0;
        this.state = 'idle';
    }
    
    selectSphere(sphere) {
        if (this.isProcessing || !sphere || !sphere.active) return;
        
        if (!this.selectedSphere) {
            this.selectedSphere = sphere;
            sphere.animatePop(0.2);
        } else if (this.selectedSphere === sphere) {
            this.selectedSphere = null;
        } else {
            if (this.sphereManager.areAdjacent(this.selectedSphere, sphere)) {
                this.trySwap(this.selectedSphere, sphere);
            } else {
                this.selectedSphere.animatePop(0.2);
                this.selectedSphere = sphere;
                sphere.animatePop(0.2);
            }
        }
    }
    
    async trySwap(sphere1, sphere2) {
        this.isProcessing = true;
        this.movesLeft--;
        
        this.sphereManager.swapSpheres(sphere1, sphere2);
        
        await this.waitForAnimation(this.swapAnimationTime);
        
        const matches = this.sphereManager.getAllMatches();
        
        if (matches.length > 0) {
            this.pendingMatches = matches;
            this.cascadeLevel = 0;
            this.state = 'matching';
            this.processMatches();
        } else {
            this.sphereManager.swapSpheres(sphere1, sphere2);
            this.game.resetCombo();
            await this.waitForAnimation(this.swapAnimationTime);
            this.isProcessing = false;
            this.selectedSphere = null;
            
            if (!this.sphereManager.hasValidMoves() || this.movesLeft <= 0) {
                this.game.gameOver();
            }
        }
    }
    
    async processMatches() {
        if (this.cascadeLevel >= this.maxCascadeLevel) {
            this.finishProcessing();
            return;
        }
        
        const allMatchedSpheres = new Set();
        
        for (const match of this.pendingMatches) {
            for (const sphere of match.spheres) {
                allMatchedSpheres.add(sphere);
            }
        }
        
        this.highlightedSpheres = Array.from(allMatchedSpheres);
        
        await this.waitForAnimation(0.2);
        
        for (const match of this.pendingMatches) {
            const basePoints = match.spheres.length * 10;
            const typeMultiplier = match.type === 'sequence' ? 3 : match.type === 'material' ? 2 : 1;
            const cascadeMultiplier = 1 + this.cascadeLevel * 0.5;
            const points = Math.floor(basePoints * typeMultiplier * cascadeMultiplier);
            
            this.game.addScore(points);
            
            for (const sphere of match.spheres) {
                this.particles.createExplosion(
                    sphere.position,
                    sphere.color,
                    match.type === 'sequence' ? 50 : match.type === 'material' ? 40 : 30
                );
            }
        }
        
        await this.waitForAnimation(0.1);
        
        for (const sphere of allMatchedSpheres) {
            this.sphereManager.removeSphere(sphere);
        }
        
        this.highlightedSpheres = [];
        
        await this.waitForAnimation(0.3);
        
        this.sphereManager.fillEmptySpaces();
        
        await this.waitForAnimation(this.fallAnimationTime);
        
        const newMatches = this.sphereManager.getAllMatches();
        
        if (newMatches.length > 0) {
            this.pendingMatches = newMatches;
            this.cascadeLevel++;
            this.processMatches();
        } else {
            this.finishProcessing();
        }
    }
    
    finishProcessing() {
        this.isProcessing = false;
        this.selectedSphere = null;
        this.cascadeLevel = 0;
        this.highlightedSpheres = [];
        this.game.resetCombo();
        
        if (!this.sphereManager.hasValidMoves() || this.movesLeft <= 0) {
            this.game.gameOver();
        }
    }
    
    waitForAnimation(duration) {
        return new Promise(resolve => {
            setTimeout(resolve, duration * 1000);
        });
    }
    
    update(deltaTime) {
        this.sphereManager.update(deltaTime, performance.now() / 1000);
    }
    
    getMatchHints() {
        const hints = [];
        const spheres = this.sphereManager.spheres.filter(s => s.active);
        
        for (let i = 0; i < spheres.length; i++) {
            for (let j = i + 1; j < spheres.length; j++) {
                if (this.sphereManager.areAdjacent(spheres[i], spheres[j])) {
                    if (this.sphereManager.wouldCreateMatch(spheres[i], spheres[j])) {
                        hints.push([spheres[i], spheres[j]]);
                        if (hints.length >= 3) return hints;
                    }
                }
            }
        }
        
        return hints;
    }
    
    shuffleBoard() {
        if (this.isProcessing) return;
        
        const activeSpheres = this.sphereManager.spheres.filter(s => s.active);
        const positions = activeSpheres.map(s => ({ x: s.targetGridX, y: s.targetGridY, pos: [...s.targetPosition] }));
        
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        
        for (let i = 0; i < activeSpheres.length; i++) {
            activeSpheres[i].setGridPosition(positions[i].x, positions[i].y);
            activeSpheres[i].setTargetPosition(...positions[i].pos);
        }
        
        this.movesLeft = Math.max(0, this.movesLeft - 5);
    }
}
