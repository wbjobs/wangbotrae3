export class Particle {
    constructor(position, velocity, color, size, life) {
        this.position = [...position];
        this.velocity = [...velocity];
        this.color = [...color];
        this.size = size;
        this.baseSize = size;
        this.life = life;
        this.maxLife = life;
        this.alpha = 1;
        
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 5;
        
        this.active = true;
        this.gravity = -2;
        this.drag = 0.98;
        this.emissive = false;
        this.emissiveFactor = 0.0;
    }
    
    update(deltaTime) {
        this.velocity[0] *= this.drag;
        this.velocity[1] *= this.drag;
        this.velocity[2] *= this.drag;
        
        this.velocity[1] += this.gravity * deltaTime;
        
        this.position[0] += this.velocity[0] * deltaTime;
        this.position[1] += this.velocity[1] * deltaTime;
        this.position[2] += this.velocity[2] * deltaTime;
        
        this.rotation += this.rotationSpeed * deltaTime;
        
        this.life -= deltaTime;
        
        if (this.life <= 0) {
            this.active = false;
            this.alpha = 0;
            return;
        }
        
        const lifeRatio = this.life / this.maxLife;
        this.alpha = lifeRatio * lifeRatio;
        
        this.size = this.baseSize * (0.5 + lifeRatio * 0.5);
        
        if (this.emissive) {
            this.emissiveFactor = lifeRatio * 5.0;
        } else {
            this.emissiveFactor = 0.0;
        }
    }
}

export class ParticleSystem {
    constructor() {
        this.particles = [];
        this.maxParticles = 2048;
    }
    
    createExplosion(position, color, count = 30) {
        const baseCount = Math.min(count, this.maxParticles - this.particles.length);
        if (baseCount <= 0) return;
        
        for (let i = 0; i < baseCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const speed = 3 + Math.random() * 5;
            
            const velocity = [
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed,
                Math.cos(phi) * speed
            ];
            
            const size = 0.08 + Math.random() * 0.12;
            const life = 0.8 + Math.random() * 0.8;
            
            const colorVariation = [
                color[0] + (Math.random() - 0.5) * 0.3,
                color[1] + (Math.random() - 0.5) * 0.3,
                color[2] + (Math.random() - 0.5) * 0.3
            ];
            
            const offsetPos = [
                position[0] + (Math.random() - 0.5) * 0.3,
                position[1] + (Math.random() - 0.5) * 0.3,
                position[2] + (Math.random() - 0.5) * 0.3
            ];
            
            const particle = new Particle(offsetPos, velocity, colorVariation, size, life);
            particle.emissive = true;
            particle.emissiveFactor = 5.0;
            this.particles.push(particle);
        }
        
        for (let i = 0; i < baseCount / 2; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const speed = 1 + Math.random() * 2;
            
            const velocity = [
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed,
                Math.cos(phi) * speed
            ];
            
            const size = 0.15 + Math.random() * 0.2;
            const life = 0.5 + Math.random() * 0.5;
            
            const shockwaveColor = [
                Math.min(color[0] * 1.5, 1),
                Math.min(color[1] * 1.5, 1),
                Math.min(color[2] * 1.5, 1)
            ];
            
            const particle = new Particle([...position], velocity, shockwaveColor, size, life);
            particle.emissive = true;
            particle.emissiveFactor = 5.0;
            particle.gravity = 0;
            particle.drag = 0.95;
            this.particles.push(particle);
        }
    }
    
    createSparkle(position, color) {
        if (this.particles.length >= this.maxParticles) return;
        
        const velocity = [
            (Math.random() - 0.5) * 0.5,
            1 + Math.random() * 1.5,
            (Math.random() - 0.5) * 0.5
        ];
        
        const particle = new Particle(
            position,
            velocity,
            color,
            0.05 + Math.random() * 0.05,
            0.5 + Math.random() * 0.5
        );
        particle.emissive = true;
        particle.emissiveFactor = 5.0;
        particle.gravity = -0.5;
        
        this.particles.push(particle);
    }
    
    createTrail(position, color, direction) {
        if (this.particles.length >= this.maxParticles) return;
        
        const velocity = [
            direction[0] * 0.5 + (Math.random() - 0.5) * 0.3,
            direction[1] * 0.5 + (Math.random() - 0.5) * 0.3,
            direction[2] * 0.5 + (Math.random() - 0.5) * 0.3
        ];
        
        const particle = new Particle(
            [...position],
            velocity,
            color,
            0.04 + Math.random() * 0.04,
            0.3 + Math.random() * 0.3
        );
        particle.emissive = true;
        particle.emissiveFactor = 5.0;
        particle.gravity = 0;
        
        this.particles.push(particle);
    }
    
    update(deltaTime) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.update(deltaTime);
            
            if (!particle.active) {
                this.particles.splice(i, 1);
            }
        }
        
        if (this.particles.length > this.maxParticles) {
            this.particles.splice(0, this.particles.length - this.maxParticles);
        }
    }
    
    clear() {
        this.particles = [];
    }
}
