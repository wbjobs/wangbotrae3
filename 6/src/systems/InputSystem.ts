import { System } from '../ecs/System.js';
import { Entity } from '../ecs/Entity.js';
import { Position } from '../components/Position.js';
import { Node } from '../components/Node.js';
import { Edge } from '../components/Edge.js';
import { RenderSystem } from './RenderSystem.js';
import { TopologySystem } from './TopologySystem.js';

export interface GameAction {
    type: 'addEdge' | 'removeEdge';
    data: any;
}

export interface ActionHandler {
    onAction: (action: GameAction) => void;
}

export class InputSystem extends System {
    private canvas: HTMLCanvasElement;
    private renderSystem: RenderSystem | null = null;
    private topologySystem: TopologySystem | null = null;
    private actionHandler: ActionHandler | null = null;
    private statusCallback: ((text: string) => void) | null = null;

    constructor(canvas: HTMLCanvasElement) {
        super(5);
        this.canvas = canvas;
        this.setupEventListeners();
    }

    update(deltaTime: number): void {
        if (!this.renderSystem) {
            this.renderSystem = this.world.getSystem(RenderSystem) ?? null;
        }
        if (!this.topologySystem) {
            this.topologySystem = this.world.getSystem(TopologySystem) ?? null;
        }
    }

    private setupEventListeners(): void {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        document.addEventListener('keydown', this.onKeyDown.bind(this));
    }

    private getMousePos(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
            y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
        };
    }

    private getNodeAtPosition(x: number, y: number): Entity | null {
        const nodes = this.query(['Position', 'Node']);
        
        let closest: Entity | null = null;
        let closestDist = Infinity;

        for (const nodeEntity of nodes) {
            const pos = nodeEntity.getComponent<Position>('Position')!;
            const node = nodeEntity.getComponent<Node>('Node')!;
            
            const dx = pos.x - x;
            const dy = pos.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < node.radius + 10 && dist < closestDist) {
                closestDist = dist;
                closest = nodeEntity;
            }
        }

        return closest;
    }

    private getEdgeAtPosition(x: number, y: number): Entity | null {
        const edges = this.query(['Edge']);
        const clickTolerance = 8;

        for (const edgeEntity of edges) {
            const edge = edgeEntity.getComponent<Edge>('Edge')!;
            
            if (!edge.isPlayerCreated) continue;

            const fromEntity = this.getEntity(edge.fromEntityId);
            const toEntity = this.getEntity(edge.toEntityId);

            if (!fromEntity || !toEntity) continue;

            const fromPos = fromEntity.getComponent<Position>('Position');
            const toPos = toEntity.getComponent<Position>('Position');

            if (!fromPos || !toPos) continue;

            const dist = this.pointToLineDistance(x, y, fromPos.x, fromPos.y, toPos.x, toPos.y);
            if (dist < clickTolerance) {
                return edgeEntity;
            }
        }

        return null;
    }

    private pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;

        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private onMouseDown(e: MouseEvent): void {
        if (!this.renderSystem) return;

        const pos = this.getMousePos(e);
        this.renderSystem.mouseX = pos.x;
        this.renderSystem.mouseY = pos.y;

        if (e.button === 2) {
            const edgeEntity = this.getEdgeAtPosition(pos.x, pos.y);
            if (edgeEntity) {
                this.removeEdge(edgeEntity);
            } else {
                this.renderSystem.selectedNodeId = null;
                this.updateStatus('模式：选择节点');
            }
            return;
        }

        if (e.button === 0) {
            const nodeEntity = this.getNodeAtPosition(pos.x, pos.y);
            
            if (nodeEntity) {
                if (this.renderSystem.selectedNodeId === null) {
                    this.renderSystem.selectedNodeId = nodeEntity.id;
                    this.updateStatus(`已选择节点 ${nodeEntity.id}，点击另一个节点创建连接`);
                } else if (this.renderSystem.selectedNodeId === nodeEntity.id) {
                    this.renderSystem.selectedNodeId = null;
                    this.updateStatus('模式：选择节点');
                } else {
                    this.createEdge(this.renderSystem.selectedNodeId, nodeEntity.id);
                    this.renderSystem.selectedNodeId = null;
                    this.updateStatus('模式：选择节点');
                }
            } else {
                this.renderSystem.selectedNodeId = null;
                this.updateStatus('模式：选择节点');
            }
        }
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.renderSystem) return;

        const pos = this.getMousePos(e);
        this.renderSystem.mouseX = pos.x;
        this.renderSystem.mouseY = pos.y;

        const hoveredNode = this.getNodeAtPosition(pos.x, pos.y);
        this.renderSystem.hoverNodeId = hoveredNode ? hoveredNode.id : null;
    }

    private onMouseUp(e: MouseEvent): void {
    }

    private onKeyDown(e: KeyboardEvent): void {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.updateStatus('撤销操作');
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            this.updateStatus('重做操作');
        }
        if (e.key === 'Escape') {
            if (this.renderSystem) {
                this.renderSystem.selectedNodeId = null;
                this.updateStatus('模式：选择节点');
            }
        }
    }

    private createEdge(fromId: number, toId: number): void {
        if (fromId === toId) return;

        const existingEdges = this.query(['Edge']);
        for (const edgeEntity of existingEdges) {
            const edge = edgeEntity.getComponent<Edge>('Edge')!;
            if ((edge.fromEntityId === fromId && edge.toEntityId === toId) ||
                (edge.fromEntityId === toId && edge.toEntityId === fromId)) {
                this.updateStatus('连接已存在');
                return;
            }
        }

        const edgeEntity = this.world.createEntity();
        const edge = new Edge(fromId, toId, true);
        edgeEntity.addComponent(edge);

        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }

        if (this.actionHandler) {
            this.actionHandler.onAction({
                type: 'addEdge',
                data: { fromId, toId, entityId: edgeEntity.id }
            });
        }

        this.updateStatus(`创建连接：${fromId} → ${toId}`);
    }

    private removeEdge(edgeEntity: Entity): void {
        const edge = edgeEntity.getComponent<Edge>('Edge')!;
        const { fromEntityId, toEntityId } = edge;

        if (this.actionHandler) {
            this.actionHandler.onAction({
                type: 'removeEdge',
                data: { fromId: fromEntityId, toId: toEntityId, entityId: edgeEntity.id }
            });
        }

        this.world.removeEntity(edgeEntity.id);

        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }

        this.updateStatus(`删除连接：${fromEntityId} → ${toEntityId}`);
    }

    public removeEdgeById(edgeId: number): void {
        const edgeEntity = this.getEntity(edgeId);
        if (edgeEntity && edgeEntity.hasComponent('Edge')) {
            this.world.removeEntity(edgeId);
            if (this.topologySystem) {
                this.topologySystem.invalidate();
            }
        }
    }

    public addEdgeFromData(data: { fromId: number; toId: number }): number {
        const edgeEntity = this.world.createEntity();
        edgeEntity.addComponent(new Edge(data.fromId, data.toId, true));
        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }
        return edgeEntity.id;
    }

    public setActionHandler(handler: ActionHandler): void {
        this.actionHandler = handler;
    }

    public setStatusCallback(callback: (text: string) => void): void {
        this.statusCallback = callback;
    }

    private updateStatus(text: string): void {
        if (this.statusCallback) {
            this.statusCallback(text);
        }
    }

    public clearSelection(): void {
        if (this.renderSystem) {
            this.renderSystem.selectedNodeId = null;
        }
    }
}
