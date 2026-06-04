import { System } from '../ecs/System.js';
import { Entity } from '../ecs/Entity.js';
import { Position } from '../components/Position.js';
import { Node } from '../components/Node.js';
import { Edge } from '../components/Edge.js';
import { Gear } from '../components/Gear.js';
import { Spring } from '../components/Spring.js';
import { Conveyor } from '../components/Conveyor.js';
import { RigidBody } from '../components/RigidBody.js';
import { Goal } from '../components/Goal.js';
import { Render } from '../components/Render.js';

export class RenderSystem extends System {
    private ctx: CanvasRenderingContext2D;
    private canvas: HTMLCanvasElement;
    private time: number = 0;
    public selectedNodeId: number | null = null;
    public hoverNodeId: number | null = null;
    public mouseX: number = 0;
    public mouseY: number = 0;
    public edgeCreationActive: boolean = false;
    public edgeCreationStart: { x: number; y: number } | null = null;

    constructor(canvas: HTMLCanvasElement) {
        super(100);
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法获取Canvas 2D上下文');
        this.ctx = ctx;
    }

    update(deltaTime: number): void {
        this.time += deltaTime;
        this.render();
    }

    private render(): void {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = '#0a0a15';
        ctx.fillRect(0, 0, w, h);

        this.drawGrid();
        this.drawEdges();
        this.drawSprings();
        this.drawConveyors();
        this.drawGears();
        this.drawNodes();
        this.drawBalls();
        this.drawGoals();
        this.drawSelectionPreview();
        this.drawEdgeCreationPreview();
    }

    private drawGrid(): void {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;

        const gridSize = 50;
        for (let x = 0; x < this.canvas.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y < this.canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
            ctx.stroke();
        }
    }

    private drawEdges(): void {
        const edges = this.query(['Edge']);
        const ctx = this.ctx;

        for (const edgeEntity of edges) {
            const edge = edgeEntity.getComponent<Edge>('Edge')!;
            const fromEntity = this.getEntity(edge.fromEntityId);
            const toEntity = this.getEntity(edge.toEntityId);

            if (!fromEntity || !toEntity) continue;

            const fromPos = fromEntity.getComponent<Position>('Position');
            const toPos = toEntity.getComponent<Position>('Position');

            if (!fromPos || !toPos) continue;

            if (edge.isActive) {
                const gradient = ctx.createLinearGradient(fromPos.x, fromPos.y, toPos.x, toPos.y);
                gradient.addColorStop(0, '#e94560');
                gradient.addColorStop(0.5, '#ff6b8a');
                gradient.addColorStop(1, '#e94560');
                ctx.strokeStyle = gradient;
                ctx.lineWidth = edge.thickness + 2;
                ctx.shadowColor = '#e94560';
                ctx.shadowBlur = 15;
            } else {
                ctx.strokeStyle = edge.color;
                ctx.lineWidth = edge.thickness;
                ctx.shadowBlur = 0;
            }

            ctx.beginPath();
            ctx.moveTo(fromPos.x, fromPos.y);
            ctx.lineTo(toPos.x, toPos.y);
            ctx.stroke();

            if (edge.isActive) {
                const pulse = Math.sin(this.time * 5) * 0.5 + 0.5;
                const midX = (fromPos.x + toPos.x) / 2;
                const midY = (fromPos.y + toPos.y) / 2;
                ctx.fillStyle = `rgba(233, 69, 96, ${0.5 + pulse * 0.5})`;
                ctx.beginPath();
                ctx.arc(midX, midY, 4 + pulse * 2, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.shadowBlur = 0;
        }
    }

    private drawSprings(): void {
        const springs = this.query(['Spring']);
        const ctx = this.ctx;

        for (const springEntity of springs) {
            const spring = springEntity.getComponent<Spring>('Spring')!;
            const entityA = this.getEntity(spring.entityIdA);
            const entityB = this.getEntity(spring.entityIdB);

            if (!entityA || !entityB) continue;

            const posA = entityA.getComponent<Position>('Position');
            const posB = entityB.getComponent<Position>('Position');

            if (!posA || !posB) continue;

            const dx = posB.x - posA.x;
            const dy = posB.y - posA.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const nx = -dy / length;
            const ny = dx / length;

            const coils = 8;
            const amplitude = spring.isActive ? 12 : 8;

            if (spring.isActive) {
                ctx.strokeStyle = '#27ae60';
                ctx.shadowColor = '#27ae60';
                ctx.shadowBlur = 15;
            } else {
                ctx.strokeStyle = spring.color;
                ctx.shadowBlur = 0;
            }
            ctx.lineWidth = 3;

            ctx.beginPath();
            ctx.moveTo(posA.x, posA.y);

            for (let i = 0; i <= coils; i++) {
                const t = i / coils;
                const x = posA.x + dx * t;
                const y = posA.y + dy * t;
                const offset = Math.sin(t * Math.PI * coils + this.time * 3) * amplitude;
                ctx.lineTo(x + nx * offset, y + ny * offset);
            }

            ctx.lineTo(posB.x, posB.y);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    private drawConveyors(): void {
        const conveyors = this.query(['Position', 'Conveyor']);
        const ctx = this.ctx;

        for (const conveyorEntity of conveyors) {
            const conveyor = conveyorEntity.getComponent<Conveyor>('Conveyor')!;
            const pos = conveyorEntity.getComponent<Position>('Position')!;

            const x = pos.x - conveyor.width / 2;
            const y = pos.y - conveyor.height / 2;

            if (conveyor.isActive) {
                ctx.shadowColor = '#3498db';
                ctx.shadowBlur = 15;
            }

            ctx.fillStyle = '#2c3e50';
            ctx.fillRect(x, y, conveyor.width, conveyor.height);

            ctx.strokeStyle = conveyor.isActive ? '#3498db' : '#34495e';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, conveyor.width, conveyor.height);

            if (conveyor.isActive) {
                const beltOffset = (this.time * conveyor.speed * 30) % 20;
                ctx.fillStyle = '#3498db';
                for (let bx = x + beltOffset; bx < x + conveyor.width; bx += 20) {
                    ctx.fillRect(bx, y + 3, 10, conveyor.height - 6);
                }

                const arrowDir = conveyor.speed >= 0 ? 1 : -1;
                const arrowX = pos.x + conveyor.width / 2 * arrowDir - 20 * arrowDir;
                this.drawArrow(arrowX, pos.y, arrowDir);
            }

            ctx.shadowBlur = 0;
        }
    }

    private drawArrow(x: number, y: number, dir: number): void {
        const ctx = this.ctx;
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 15 * dir, y);
        ctx.lineTo(x, y + 8);
        ctx.closePath();
        ctx.fill();
    }

    private drawGears(): void {
        const gears = this.query(['Position', 'Gear']);
        const ctx = this.ctx;

        for (const gearEntity of gears) {
            const gear = gearEntity.getComponent<Gear>('Gear')!;
            const pos = gearEntity.getComponent<Position>('Position')!;
            const node = gearEntity.getComponent<Node>('Node');

            const isPowered = node?.isPowered ?? false;

            if (isPowered) {
                ctx.shadowColor = gear.isMotor ? '#f39c12' : gear.color;
                ctx.shadowBlur = 20;
            }

            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(gear.angle);

            ctx.fillStyle = isPowered ? (gear.isMotor ? '#f39c12' : gear.color) : '#4a4a5a';
            ctx.strokeStyle = isPowered ? '#ffd700' : '#5a5a6a';
            ctx.lineWidth = 2;

            const innerRadius = gear.radius * 0.6;
            const toothDepth = gear.radius * 0.2;
            const toothWidth = (Math.PI * 2) / gear.teeth;

            ctx.beginPath();
            for (let i = 0; i < gear.teeth; i++) {
                const angle = i * toothWidth;
                const nextAngle = (i + 1) * toothWidth;

                ctx.arc(0, 0, innerRadius, angle, angle + toothWidth * 0.4);
                ctx.arc(0, 0, gear.radius + toothDepth, angle + toothWidth * 0.4, angle + toothWidth * 0.6);
                ctx.arc(0, 0, innerRadius, angle + toothWidth * 0.6, nextAngle);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath();
            ctx.arc(0, 0, innerRadius * 0.4, 0, Math.PI * 2);
            ctx.fill();

            if (gear.isMotor) {
                ctx.fillStyle = isPowered ? '#e74c3c' : '#666';
                ctx.beginPath();
                ctx.arc(0, 0, innerRadius * 0.25, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = isPowered ? '#ffd700' : '#888';
                ctx.lineWidth = 2;
                for (let i = 0; i < 4; i++) {
                    const a = i * Math.PI / 2;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a) * innerRadius * 0.15, Math.sin(a) * innerRadius * 0.15);
                    ctx.lineTo(Math.cos(a) * innerRadius * 0.35, Math.sin(a) * innerRadius * 0.35);
                    ctx.stroke();
                }
            }

            ctx.restore();
            ctx.shadowBlur = 0;
        }
    }

    private drawNodes(): void {
        const nodes = this.query(['Position', 'Node']);
        const ctx = this.ctx;

        for (const nodeEntity of nodes) {
            const node = nodeEntity.getComponent<Node>('Node')!;
            const pos = nodeEntity.getComponent<Position>('Position')!;
            const render = nodeEntity.getComponent<Render>('Render');

            const isSelected = this.selectedNodeId === nodeEntity.id;
            const isHovered = this.hoverNodeId === nodeEntity.id;
            const isPowered = node.isPowered;

            let color = node.color;
            if (node.isPowerSource) {
                color = '#f39c12';
            } else if (isPowered) {
                color = '#4ade80';
            }

            const glowIntensity = isPowered ? 25 : (isSelected || isHovered ? 15 : 0);
            if (glowIntensity > 0) {
                ctx.shadowColor = color;
                ctx.shadowBlur = glowIntensity;
            }

            const radius = node.radius + (isSelected ? 5 : 0) + (isHovered ? 3 : 0);

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = isSelected ? '#fff' : (isPowered ? '#fff' : 'rgba(255,255,255,0.3)');
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.stroke();

            if (node.isPowerSource) {
                const pulse = Math.sin(this.time * 4) * 0.5 + 0.5;
                ctx.strokeStyle = `rgba(243, 156, 18, ${0.5 + pulse * 0.5})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, radius + 5 + pulse * 5, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(nodeEntity.id.toString(), pos.x, pos.y);

            ctx.shadowBlur = 0;
        }
    }

    private drawBalls(): void {
        const balls = this.query(['Position', 'RigidBody']).filter(e => !e.hasComponent('Node') && !e.hasComponent('Gear'));
        const ctx = this.ctx;

        for (const ballEntity of balls) {
            const pos = ballEntity.getComponent<Position>('Position')!;
            const rb = ballEntity.getComponent<RigidBody>('RigidBody')!;
            const render = ballEntity.getComponent<Render>('Render');

            const gradient = ctx.createRadialGradient(
                pos.x - rb.radius * 0.3, pos.y - rb.radius * 0.3, 0,
                pos.x, pos.y, rb.radius
            );
            gradient.addColorStop(0, '#e74c3c');
            gradient.addColorStop(0.7, '#c0392b');
            gradient.addColorStop(1, '#922b21');

            ctx.fillStyle = gradient;
            ctx.shadowColor = '#e74c3c';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, rb.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.beginPath();
            ctx.arc(pos.x - rb.radius * 0.3, pos.y - rb.radius * 0.3, rb.radius * 0.4, 0, Math.PI * 2);
            ctx.fill();

            ctx.shadowBlur = 0;
        }
    }

    private drawGoals(): void {
        const goals = this.query(['Position', 'Goal']);
        const ctx = this.ctx;

        for (const goalEntity of goals) {
            const goal = goalEntity.getComponent<Goal>('Goal')!;
            const pos = goalEntity.getComponent<Position>('Position')!;

            const pulse = Math.sin(this.time * 3) * 0.5 + 0.5;

            if (goal.isReached) {
                ctx.shadowColor = '#4ade80';
                ctx.shadowBlur = 30;
            } else {
                ctx.shadowColor = goal.color;
                ctx.shadowBlur = 15 + pulse * 10;
            }

            ctx.strokeStyle = goal.isReached ? '#4ade80' : goal.color;
            ctx.lineWidth = 4;
            ctx.setLineDash([5, 5]);
            ctx.lineDashOffset = this.time * 20;

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, goal.radius + pulse * 5, 0, Math.PI * 2);
            ctx.stroke();

            ctx.setLineDash([]);

            ctx.fillStyle = goal.isReached ? 'rgba(74, 222, 128, 0.3)' : `rgba(74, 222, 128, ${0.1 + pulse * 0.2})`;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, goal.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = goal.isReached ? '#4ade80' : goal.color;
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(goal.isReached ? '✓' : '★', pos.x, pos.y);

            ctx.shadowBlur = 0;
        }
    }

    private drawSelectionPreview(): void {
        if (this.selectedNodeId === null) return;

        const selectedEntity = this.getEntity(this.selectedNodeId);
        if (!selectedEntity) return;

        const selectedPos = selectedEntity.getComponent<Position>('Position');
        if (!selectedPos) return;

        const ctx = this.ctx;

        ctx.strokeStyle = 'rgba(233, 69, 96, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        ctx.moveTo(selectedPos.x, selectedPos.y);
        ctx.lineTo(this.mouseX, this.mouseY);
        ctx.stroke();

        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(233, 69, 96, 0.3)';
        ctx.beginPath();
        ctx.arc(this.mouseX, this.mouseY, 15, 0, Math.PI * 2);
        ctx.fill();
    }

    private drawEdgeCreationPreview(): void {
        if (!this.edgeCreationActive || !this.edgeCreationStart) return;

        const ctx = this.ctx;

        ctx.strokeStyle = 'rgba(243, 156, 18, 0.8)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.shadowColor = '#f39c12';
        ctx.shadowBlur = 10;

        ctx.beginPath();
        ctx.moveTo(this.edgeCreationStart.x, this.edgeCreationStart.y);
        ctx.lineTo(this.mouseX, this.mouseY);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(243, 156, 18, 0.4)';
        ctx.beginPath();
        ctx.arc(this.mouseX, this.mouseY, 20, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#f39c12';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    public resize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public getContext(): CanvasRenderingContext2D {
        return this.ctx;
    }
}
