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
import { PhysicsSystem } from './PhysicsSystem.js';
import { TopologySystem } from './TopologySystem.js';
import { TopologyValidator, ValidationReport } from './TopologyValidator.js';

export type EditorMode = 'select' | 'addNode' | 'addGear' | 'addSpring' | 'addConveyor' | 'addGoal' | 'addBall' | 'addEdge' | 'test';

export interface EdgeCreationState {
    active: boolean;
    fromEntityId: number | null;
    startX: number;
    startY: number;
}
export type NodeType = 'normal' | 'powerSource' | 'fixed';

export interface EditorState {
    mode: EditorMode;
    selectedEntityId: number | null;
    isDragging: boolean;
    dragStartX: number;
    dragStartY: number;
    ghostEntityId: number | null;
    edgeCreation: EdgeCreationState;
}

export interface LevelData {
    id: number;
    name: string;
    description: string;
    hint: string;
    entities: any[];
}

export class LevelEditor extends System {
    private canvas: HTMLCanvasElement;
    private state: EditorState = {
        mode: 'select',
        selectedEntityId: null,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        ghostEntityId: null,
        edgeCreation: {
            active: false,
            fromEntityId: null,
            startX: 0,
            startY: 0
        }
    };
    private isTestMode: boolean = false;
    private savedWorldState: any = null;
    private mouseX: number = 0;
    private mouseY: number = 0;
    private onModeChange?: (mode: EditorMode) => void;
    private onSelectionChange?: (entity: Entity | null) => void;
    private onValidation?: (report: ValidationReport) => void;
    private physicsSystem: PhysicsSystem | null = null;
    private topologySystem: TopologySystem | null = null;
    private validator: TopologyValidator | null = null;

    constructor(canvas: HTMLCanvasElement) {
        super(8);
        this.canvas = canvas;
        this.setupEventListeners();
    }

    update(deltaTime: number): void {
        if (!this.physicsSystem) {
            this.physicsSystem = this.world.getSystem(PhysicsSystem) ?? null;
        }
        if (!this.topologySystem) {
            this.topologySystem = this.world.getSystem(TopologySystem) ?? null;
        }
        if (!this.validator) {
            this.validator = this.world.getSystem(TopologyValidator) ?? null;
        }

        this.updateGhostEntity();

        if (this.validator && !this.isTestMode) {
            const report = this.validator.validate();
            if (this.onValidation) {
                this.onValidation(report);
            }
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

    private getEntityAtPosition(x: number, y: number): Entity | null {
        const allEntities = this.world.getAllEntities().filter(e => e.active);
        let closest: Entity | null = null;
        let closestDist = Infinity;

        for (const entity of allEntities) {
            const pos = entity.getComponent<Position>('Position');
            if (!pos) continue;

            const node = entity.getComponent<Node>('Node');
            const gear = entity.getComponent<Gear>('Gear');
            const goal = entity.getComponent<Goal>('Goal');
            const rb = entity.getComponent<RigidBody>('RigidBody');

            let radius = 0;
            if (node) radius = node.radius + 10;
            else if (gear) radius = gear.radius + 10;
            else if (goal) radius = goal.radius + 10;
            else if (rb) radius = rb.radius + 5;

            if (radius > 0) {
                const dx = pos.x - x;
                const dy = pos.y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < radius && dist < closestDist) {
                    closestDist = dist;
                    closest = entity;
                }
            }
        }

        return closest;
    }

    private onMouseDown(e: MouseEvent): void {
        if (this.isTestMode) return;

        const pos = this.getMousePos(e);
        this.mouseX = pos.x;
        this.mouseY = pos.y;

        if (e.button === 0) {
            this.handleLeftClick(pos.x, pos.y);
        } else if (e.button === 2) {
            this.handleRightClick(pos.x, pos.y);
        }
    }

    private handleLeftClick(x: number, y: number): void {
        switch (this.state.mode) {
            case 'select':
                const entity = this.getEntityAtPosition(x, y);
                this.selectEntity(entity);
                if (entity) {
                    this.state.isDragging = true;
                    this.state.dragStartX = x;
                    this.state.dragStartY = y;
                }
                break;
            case 'addNode':
                this.createNode(x, y, 'normal');
                break;
            case 'addGear':
                this.createGear(x, y);
                break;
            case 'addGoal':
                this.createGoal(x, y);
                break;
            case 'addBall':
                this.createBall(x, y);
                break;
            case 'addEdge':
                this.handleEdgeCreation(x, y);
                break;
        }
    }

    private handleEdgeCreation(x: number, y: number): void {
        const targetEntity = this.getEntityAtPosition(x, y);
        
        if (!this.state.edgeCreation.active) {
            if (targetEntity && targetEntity.hasComponent('Node')) {
                const pos = targetEntity.getComponent<Position>('Position')!;
                this.state.edgeCreation = {
                    active: true,
                    fromEntityId: targetEntity.id,
                    startX: pos.x,
                    startY: pos.y
                };
            }
        } else {
            if (targetEntity && targetEntity.hasComponent('Node')) {
                const fromId = this.state.edgeCreation.fromEntityId!;
                const toId = targetEntity.id;
                this.createEdge(fromId, toId);
            }
            this.cancelEdgeCreation();
        }
    }

    private cancelEdgeCreation(): void {
        this.state.edgeCreation = {
            active: false,
            fromEntityId: null,
            startX: 0,
            startY: 0
        };
    }

    private handleRightClick(x: number, y: number): void {
        if (this.state.mode === 'addEdge' && this.state.edgeCreation.active) {
            this.cancelEdgeCreation();
        } else if (this.state.mode === 'select') {
            const entity = this.getEntityAtPosition(x, y);
            if (entity) {
                this.deleteEntity(entity);
            }
        } else {
            this.setMode('select');
        }
    }

    public getEdgeCreationState(): EdgeCreationState {
        return this.state.edgeCreation;
    }

    public isEdgeCreationActive(): boolean {
        return this.state.edgeCreation.active;
    }

    private onMouseMove(e: MouseEvent): void {
        const pos = this.getMousePos(e);
        this.mouseX = pos.x;
        this.mouseY = pos.y;

        if (this.state.isDragging && this.state.selectedEntityId) {
            const entity = this.getEntity(this.state.selectedEntityId);
            if (entity) {
                const posComp = entity.getComponent<Position>('Position');
                if (posComp) {
                    posComp.x = pos.x;
                    posComp.y = pos.y;
                    
                    const rb = entity.getComponent<RigidBody>('RigidBody');
                    if (rb) {
                        rb.prevX = pos.x;
                        rb.prevY = pos.y;
                    }
                }
            }
        }
    }

    private onMouseUp(e: MouseEvent): void {
        this.state.isDragging = false;
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (this.isTestMode) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.state.selectedEntityId) {
                const entity = this.getEntity(this.state.selectedEntityId);
                if (entity) {
                    this.deleteEntity(entity);
                }
            }
        }
        if (e.key === 'Escape') {
            this.setMode('select');
            this.selectEntity(null);
        }
    }

    private updateGhostEntity(): void {
    }

    public setMode(mode: EditorMode): void {
        this.state.mode = mode;
        if (mode === 'select') {
            this.state.ghostEntityId = null;
        }
        if (this.onModeChange) {
            this.onModeChange(mode);
        }
    }

    public getMode(): EditorMode {
        return this.state.mode;
    }

    private selectEntity(entity: Entity | null): void {
        this.state.selectedEntityId = entity?.id ?? null;
        if (this.onSelectionChange) {
            this.onSelectionChange(entity);
        }
    }

    public getSelectedEntity(): Entity | null {
        if (this.state.selectedEntityId) {
            return this.getEntity(this.state.selectedEntityId) ?? null;
        }
        return null;
    }

    private createNode(x: number, y: number, type: NodeType): Entity {
        const entity = this.world.createEntity();
        entity.addComponent(new Position(x, y));
        entity.addComponent(new Node(
            20,
            '#e94560',
            type === 'fixed' || type === 'powerSource',
            type === 'powerSource'
        ));
        const rb = new RigidBody(1, type !== 'normal', 1, 20);
        rb.prevX = x;
        rb.prevY = y;
        entity.addComponent(rb);
        entity.addComponent(new Render());
        
        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }
        
        return entity;
    }

    private createGear(x: number, y: number): Entity {
        const entity = this.world.createEntity();
        entity.addComponent(new Position(x, y));
        entity.addComponent(new Node(40, '#f39c12', true, false));
        entity.addComponent(new Gear(40, 12, false, 3));
        const rb = new RigidBody(1, true, 1, 40);
        rb.prevX = x;
        rb.prevY = y;
        entity.addComponent(rb);
        entity.addComponent(new Render());
        
        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }
        
        return entity;
    }

    private createGoal(x: number, y: number): Entity {
        const entity = this.world.createEntity();
        entity.addComponent(new Position(x, y));
        entity.addComponent(new Goal(30, '#4ade80', 'ball'));
        entity.addComponent(new Render());
        return entity;
    }

    private createBall(x: number, y: number): Entity {
        const entity = this.world.createEntity();
        entity.addComponent(new Position(x, y));
        const rb = new RigidBody(1, false, 1, 15);
        rb.prevX = x;
        rb.prevY = y;
        entity.addComponent(rb);
        entity.addComponent(new Render());
        return entity;
    }

    public createEdge(fromId: number, toId: number): Entity | null {
        if (fromId === toId) return null;

        const existingEdges = this.query(['Edge']);
        for (const edgeEntity of existingEdges) {
            const edge = edgeEntity.getComponent<Edge>('Edge')!;
            if ((edge.fromEntityId === fromId && edge.toEntityId === toId) ||
                (edge.fromEntityId === toId && edge.toEntityId === fromId)) {
                return null;
            }
        }

        const entity = this.world.createEntity();
        entity.addComponent(new Edge(fromId, toId, true));
        entity.addComponent(new Render());

        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }

        return entity;
    }

    private deleteEntity(entity: Entity): void {
        const entityId = entity.id;
        const edges = this.query(['Edge']);
        for (const edge of edges) {
            const edgeComp = edge.getComponent<Edge>('Edge')!;
            if (edgeComp.fromEntityId === entityId || edgeComp.toEntityId === entityId) {
                this.world.removeEntity(edge.id);
            }
        }

        const springs = this.query(['Spring']);
        for (const spring of springs) {
            const springComp = spring.getComponent<Spring>('Spring')!;
            if (springComp.entityIdA === entityId || springComp.entityIdB === entityId) {
                this.world.removeEntity(spring.id);
            }
        }

        if (this.state.selectedEntityId === entityId) {
            this.selectEntity(null);
        }

        this.world.removeEntity(entityId);

        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }
    }

    public setEntityProperty(entityId: number, componentName: string, property: string, value: any): void {
        const entity = this.getEntity(entityId);
        if (!entity) return;

        const comp = entity.getComponent<any>(componentName);
        if (comp && property in comp) {
            comp[property] = value;
        }
    }

    public togglePowerSource(entityId: number): void {
        const entity = this.getEntity(entityId);
        if (!entity) return;
        const node = entity.getComponent<Node>('Node');
        if (node) {
            node.isPowerSource = !node.isPowerSource;
            if (this.topologySystem) {
                this.topologySystem.invalidate();
            }
        }
    }

    public toggleFixed(entityId: number): void {
        const entity = this.getEntity(entityId);
        if (!entity) return;
        const node = entity.getComponent<Node>('Node');
        const rb = entity.getComponent<RigidBody>('RigidBody');
        if (node && rb) {
            node.isFixed = !node.isFixed;
            rb.isStatic = node.isFixed;
        }
    }

    public toggleMotor(entityId: number): void {
        const entity = this.getEntity(entityId);
        if (!entity) return;
        const gear = entity.getComponent<Gear>('Gear');
        if (gear) {
            gear.isMotor = !gear.isMotor;
        }
    }

    public enterTestMode(): void {
        if (this.isTestMode) return;
        
        this.savedWorldState = this.captureWorldState();
        this.isTestMode = true;
        
        if (this.physicsSystem) {
            this.physicsSystem.enabled = true;
        }
        
        if (this.validator) {
            this.validator.setEnabled(false);
        }
    }

    public exitTestMode(): void {
        if (!this.isTestMode) return;
        
        this.restoreWorldState(this.savedWorldState);
        this.isTestMode = false;
        this.savedWorldState = null;
        
        if (this.physicsSystem) {
            this.physicsSystem.enabled = true;
        }
        
        if (this.validator) {
            this.validator.setEnabled(true);
        }
        
        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }
    }

    public isInTestMode(): boolean {
        return this.isTestMode;
    }

    private captureWorldState(): any {
        const entities = this.world.getAllEntities();
        const state: any = {};
        
        for (const entity of entities) {
            state[entity.id] = entity.captureState();
        }
        
        return state;
    }

    private restoreWorldState(state: any): void {
        for (const [entityId, entityState] of Object.entries(state)) {
            const entity = this.getEntity(parseInt(entityId));
            if (entity) {
                entity.restoreState(entityState as any);
            }
        }
    }

    public exportLevel(name: string = '自定义关卡', description: string = ''): LevelData {
        const entities = this.world.getAllEntities().filter(e => e.active);
        const entityData = entities.map(e => e.toJSON());

        return {
            id: Date.now(),
            name,
            description,
            hint: '这是一个自定义关卡',
            entities: entityData
        };
    }

    public exportToJSON(name?: string, description?: string): string {
        return JSON.stringify(this.exportLevel(name, description), null, 2);
    }

    public downloadLevelJSON(name: string = 'my-level'): void {
        const json = this.exportToJSON(name);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    public async importLevel(file: File): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target?.result as string;
                    const data = JSON.parse(content);
                    this.loadLevelData(data);
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    public loadLevelData(data: LevelData): void {
        const allEntities = this.world.getAllEntities();
        for (const entity of allEntities) {
            this.world.removeEntity(entity.id);
        }

        for (const entityData of data.entities) {
            const entity = Entity.fromJSON(entityData);
            
            for (const [name, compData] of Object.entries(entityData.components)) {
                const CompClass = this.getComponentClass(name);
                if (CompClass) {
                    const comp = typeof (CompClass as any).fromJSON === 'function'
                        ? (CompClass as any).fromJSON(compData)
                        : Object.assign(new CompClass(), compData);
                    entity.addComponent(comp);
                }
            }

            const existingEntity = this.world.getEntity(entity.id);
            if (existingEntity) {
                this.world.removeEntity(entity.id);
            }

            (this.world as any).entities.set(entity.id, entity);
            (this.world as any).entityIds.push(entity.id);
        }

        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }
    }

    private getComponentClass(name: string): any {
        const classes: Record<string, any> = {
            Position, Node, Edge, Gear, Spring, Conveyor, RigidBody, Goal, Render
        };
        return classes[name];
    }

    public clearLevel(): void {
        const allEntities = this.world.getAllEntities();
        for (const entity of allEntities) {
            this.world.removeEntity(entity.id);
        }
        
        if (this.topologySystem) {
            this.topologySystem.invalidate();
        }
        
        this.selectEntity(null);
    }

    public setOnModeChange(callback: (mode: EditorMode) => void): void {
        this.onModeChange = callback;
    }

    public setOnSelectionChange(callback: (entity: Entity | null) => void): void {
        this.onSelectionChange = callback;
    }

    public setOnValidation(callback: (report: ValidationReport) => void): void {
        this.onValidation = callback;
    }

    public getMousePosition(): { x: number; y: number } {
        return { x: this.mouseX, y: this.mouseY };
    }
}
