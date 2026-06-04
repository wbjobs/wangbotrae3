import { System } from '../ecs/System.js';
import { Entity } from '../ecs/Entity.js';
import { Position } from '../components/Position.js';
import { RigidBody } from '../components/RigidBody.js';
import { Gear } from '../components/Gear.js';
import { Spring } from '../components/Spring.js';
import { Conveyor } from '../components/Conveyor.js';
import { Node } from '../components/Node.js';
import { Goal } from '../components/Goal.js';

export class PhysicsSystem extends System {
    private gravity: number = 800;
    private subSteps: number = 4;
    private constraintIterations: number = 5;
    private bounds = { x: 0, y: 0, width: 900, height: 600 };
    private pauseFrames: number = 0;
    private suppressGearRotation: boolean = false;

    constructor() {
        super(20);
    }

    update(deltaTime: number): void {
        if (this.pauseFrames > 0) {
            this.pauseFrames--;
            this.checkGoals();
            return;
        }

        const dt = Math.min(deltaTime, 1 / 30) / this.subSteps;

        for (let step = 0; step < this.subSteps; step++) {
            this.integrate(dt);
            this.applyConstraints();
            this.handleCollisions();
        }

        this.updateGears(deltaTime);
        this.updateSprings(deltaTime);
        this.updateConveyors(deltaTime);
        this.checkGoals();
    }

    public requestPause(frames: number = 1, suppressGearRotation: boolean = true): void {
        this.pauseFrames = Math.max(this.pauseFrames, frames);
        this.suppressGearRotation = suppressGearRotation;
    }

    public isPaused(): boolean {
        return this.pauseFrames > 0;
    }

    private integrate(dt: number): void {
        const bodies = this.query(['Position', 'RigidBody']);

        for (const entity of bodies) {
            const pos = entity.getComponent<Position>('Position')!;
            const rb = entity.getComponent<RigidBody>('RigidBody')!;
            const node = entity.getComponent<Node>('Node');

            if (rb.isStatic || (node?.isFixed ?? false)) {
                rb.prevX = pos.x;
                rb.prevY = pos.y;
                continue;
            }

            const velX = pos.x - rb.prevX;
            const velY = pos.y - rb.prevY;

            rb.prevX = pos.x;
            rb.prevY = pos.y;

            const gravity = this.gravity * rb.gravityScale;

            pos.x += velX * 0.998;
            pos.y += velY * 0.998 + gravity * dt * dt;

            rb.velX = velX / dt;
            rb.velY = (velY + gravity * dt * dt) / dt;
        }
    }

    private applyConstraints(): void {
        for (let i = 0; i < this.constraintIterations; i++) {
            this.applySpringConstraints();
            this.applyBoundaryConstraints();
        }
    }

    private applySpringConstraints(): void {
        const springs = this.query(['Spring']);

        for (const springEntity of springs) {
            const spring = springEntity.getComponent<Spring>('Spring')!;
            
            if (!spring.isActive) continue;

            const entityA = this.getEntity(spring.entityIdA);
            const entityB = this.getEntity(spring.entityIdB);

            if (!entityA || !entityB) continue;

            const posA = entityA.getComponent<Position>('Position');
            const posB = entityB.getComponent<Position>('Position');
            const rbA = entityA.getComponent<RigidBody>('RigidBody');
            const rbB = entityB.getComponent<RigidBody>('RigidBody');

            if (!posA || !posB) continue;

            const dx = posB.x - posA.x;
            const dy = posB.y - posA.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            spring.currentLength = distance;

            if (distance === 0) continue;

            const diff = (distance - spring.restLength) / distance;
            const stiffness = spring.stiffness * 0.1;

            const massA = rbA?.isStatic || entityA.getComponent<Node>('Node')?.isFixed ? 0 : (rbA?.mass ?? 1);
            const massB = rbB?.isStatic || entityB.getComponent<Node>('Node')?.isFixed ? 0 : (rbB?.mass ?? 1);
            const totalMass = massA + massB;

            if (totalMass === 0) continue;

            const ratioA = massB / totalMass;
            const ratioB = massA / totalMass;

            const offsetX = dx * diff * stiffness;
            const offsetY = dy * diff * stiffness;

            if (massA > 0) {
                posA.x += offsetX * ratioA;
                posA.y += offsetY * ratioA;
            }
            if (massB > 0) {
                posB.x -= offsetX * ratioB;
                posB.y -= offsetY * ratioB;
            }
        }
    }

    private applyBoundaryConstraints(): void {
        const bodies = this.query(['Position', 'RigidBody']);

        for (const entity of bodies) {
            const pos = entity.getComponent<Position>('Position')!;
            const rb = entity.getComponent<RigidBody>('RigidBody')!;

            if (rb.isStatic) continue;

            const radius = rb.radius;
            const bounciness = 0.3;

            if (pos.x - radius < this.bounds.x) {
                pos.x = this.bounds.x + radius;
                const vel = pos.x - rb.prevX;
                rb.prevX = pos.x + vel * bounciness;
            }
            if (pos.x + radius > this.bounds.x + this.bounds.width) {
                pos.x = this.bounds.x + this.bounds.width - radius;
                const vel = pos.x - rb.prevX;
                rb.prevX = pos.x + vel * bounciness;
            }
            if (pos.y - radius < this.bounds.y) {
                pos.y = this.bounds.y + radius;
                const vel = pos.y - rb.prevY;
                rb.prevY = pos.y + vel * bounciness;
            }
            if (pos.y + radius > this.bounds.y + this.bounds.height) {
                pos.y = this.bounds.y + this.bounds.height - radius;
                const vel = pos.y - rb.prevY;
                rb.prevY = pos.y + vel * bounciness;
            }
        }
    }

    private handleCollisions(): void {
        const bodies = this.query(['Position', 'RigidBody']);

        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                this.resolveCollision(bodies[i], bodies[j]);
            }
        }
    }

    private resolveCollision(entityA: Entity, entityB: Entity): void {
        const posA = entityA.getComponent<Position>('Position')!;
        const posB = entityB.getComponent<Position>('Position')!;
        const rbA = entityA.getComponent<RigidBody>('RigidBody')!;
        const rbB = entityB.getComponent<RigidBody>('RigidBody')!;

        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = rbA.radius + rbB.radius;

        if (distance < minDist && distance > 0) {
            const overlap = (minDist - distance) / 2;
            const nx = dx / distance;
            const ny = dy / distance;

            const massA = rbA.isStatic ? 0 : rbA.mass;
            const massB = rbB.isStatic ? 0 : rbB.mass;
            const totalMass = massA + massB;

            if (totalMass > 0) {
                const ratioA = massB / totalMass;
                const ratioB = massA / totalMass;

                if (!rbA.isStatic) {
                    posA.x -= nx * overlap * ratioA;
                    posA.y -= ny * overlap * ratioA;
                }
                if (!rbB.isStatic) {
                    posB.x += nx * overlap * ratioB;
                    posB.y += ny * overlap * ratioB;
                }
            }

            const relVelX = (posB.x - rbB.prevX) - (posA.x - rbA.prevX);
            const relVelY = (posB.y - rbB.prevY) - (posA.y - rbA.prevY);
            const velAlongNormal = relVelX * nx + relVelY * ny;

            if (velAlongNormal > 0) return;

            const restitution = 0.3;
            const impulse = -(1 + restitution) * velAlongNormal / totalMass;

            if (!rbA.isStatic) {
                rbA.prevX -= impulse * massA * nx;
                rbA.prevY -= impulse * massA * ny;
            }
            if (!rbB.isStatic) {
                rbB.prevX += impulse * massB * nx;
                rbB.prevY += impulse * massB * ny;
            }
        }
    }

    private updateGears(deltaTime: number): void {
        const gears = this.query(['Position', 'Gear']);

        for (const gearEntity of gears) {
            const gear = gearEntity.getComponent<Gear>('Gear')!;
            const pos = gearEntity.getComponent<Position>('Position')!;
            const node = gearEntity.getComponent<Node>('Node');

            if (gear.isMotor && (node?.isPowered ?? true)) {
                gear.angularVelocity = gear.motorSpeed;
            }

            gear.angle += gear.angularVelocity * deltaTime;

            if (gear.isMotor) continue;

            for (const otherGearEntity of gears) {
                if (otherGearEntity.id === gearEntity.id) continue;

                const otherGear = otherGearEntity.getComponent<Gear>('Gear')!;
                const otherPos = otherGearEntity.getComponent<Position>('Position')!;
                const otherNode = otherGearEntity.getComponent<Node>('Node');

                if (!otherNode?.isPowered) continue;

                const dx = otherPos.x - pos.x;
                const dy = otherPos.y - pos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const touchDist = gear.radius + otherGear.radius;

                if (Math.abs(distance - touchDist) < 10) {
                    const ratio = gear.radius / otherGear.radius;
                    gear.angularVelocity = -otherGear.angularVelocity / ratio;
                    gear.rotationRatio = -1 / ratio;
                }
            }
        }
    }

    private updateSprings(deltaTime: number): void {
    }

    private updateConveyors(deltaTime: number): void {
        const conveyors = this.query(['Position', 'Conveyor']);
        const bodies = this.query(['Position', 'RigidBody']);

        for (const conveyorEntity of conveyors) {
            const conveyor = conveyorEntity.getComponent<Conveyor>('Conveyor')!;
            const convPos = conveyorEntity.getComponent<Position>('Position')!;

            if (!conveyor.isActive) continue;

            const convLeft = convPos.x - conveyor.width / 2;
            const convRight = convPos.x + conveyor.width / 2;
            const convTop = convPos.y - conveyor.height / 2;
            const convBottom = convPos.y + conveyor.height / 2;

            for (const bodyEntity of bodies) {
                const bodyPos = bodyEntity.getComponent<Position>('Position')!;
                const rb = bodyEntity.getComponent<RigidBody>('RigidBody')!;

                if (rb.isStatic) continue;

                const bodyBottom = bodyPos.y + rb.radius;

                if (bodyPos.x >= convLeft && bodyPos.x <= convRight &&
                    bodyBottom >= convTop - 5 && bodyBottom <= convBottom + 10) {
                    
                    bodyPos.x += conveyor.speed * deltaTime * 60;
                    rb.prevX += conveyor.speed * deltaTime * 60;
                }
            }
        }
    }

    private checkGoals(): void {
        const goals = this.query(['Position', 'Goal']);
        const balls = this.query(['Position', 'RigidBody']);

        for (const goalEntity of goals) {
            const goal = goalEntity.getComponent<Goal>('Goal')!;
            const goalPos = goalEntity.getComponent<Position>('Position')!;

            if (goal.isReached) continue;

            if (goal.triggerType === 'ball') {
                for (const ballEntity of balls) {
                    if (goal.targetEntityId && ballEntity.id !== goal.targetEntityId) continue;

                    const ballPos = ballEntity.getComponent<Position>('Position')!;
                    const rb = ballEntity.getComponent<RigidBody>('RigidBody')!;

                    const dx = ballPos.x - goalPos.x;
                    const dy = ballPos.y - goalPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < goal.radius + rb.radius) {
                        goal.isReached = true;
                        break;
                    }
                }
            } else if (goal.triggerType === 'rotation' && goal.targetEntityId) {
                const targetEntity = this.getEntity(goal.targetEntityId);
                if (targetEntity) {
                    const gear = targetEntity.getComponent<Gear>('Gear');
                    if (gear && goal.targetAngle !== undefined) {
                        const normalizedAngle = ((gear.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                        const normalizedTarget = ((goal.targetAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                        const diff = Math.abs(normalizedAngle - normalizedTarget);
                        if (diff < 0.2 || diff > Math.PI * 2 - 0.2) {
                            goal.isReached = true;
                        }
                    }
                }
            } else if (goal.triggerType === 'position' && goal.targetEntityId) {
                const targetEntity = this.getEntity(goal.targetEntityId);
                if (targetEntity) {
                    const targetPos = targetEntity.getComponent<Position>('Position');
                    if (targetPos) {
                        const dx = targetPos.x - goalPos.x;
                        const dy = targetPos.y - goalPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (distance < goal.tolerance) {
                            goal.isReached = true;
                        }
                    }
                }
            }
        }
    }

    public setBounds(width: number, height: number): void {
        this.bounds.width = width;
        this.bounds.height = height;
    }

    public getGravity(): number {
        return this.gravity;
    }

    public setGravity(gravity: number): void {
        this.gravity = gravity;
    }
}
