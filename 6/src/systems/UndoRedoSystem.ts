import { System } from '../ecs/System.js';
import { Entity } from '../ecs/Entity.js';
import { GameAction } from './InputSystem.js';
import { InputSystem } from './InputSystem.js';
import { PhysicsSystem } from './PhysicsSystem.js';
import { Gear } from '../components/Gear.js';
import { RigidBody } from '../components/RigidBody.js';
import { Node } from '../components/Node.js';
import { Spring } from '../components/Spring.js';
import { Conveyor } from '../components/Conveyor.js';

interface EntityState {
    entityId: number;
    state: any;
}

interface HistoryEntry {
    action: GameAction;
    timestamp: number;
    entityStates: EntityState[];
}

export class UndoRedoSystem extends System {
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    private maxHistory: number = 50;
    private inputSystem: InputSystem | null = null;
    private physicsSystem: PhysicsSystem | null = null;
    private isUndoingOrRedoing: boolean = false;

    constructor() {
        super(1);
    }

    update(deltaTime: number): void {
        if (!this.inputSystem) {
            this.inputSystem = this.world.getSystem(InputSystem) ?? null;
            if (this.inputSystem) {
                this.inputSystem.setActionHandler({
                    onAction: this.onAction.bind(this)
                });
            }
        }
        if (!this.physicsSystem) {
            this.physicsSystem = this.world.getSystem(PhysicsSystem) ?? null;
        }
    }

    private captureRelevantEntityStates(action: GameAction): EntityState[] {
        const states: EntityState[] = [];
        const relevantEntityIds = new Set<number>();

        if (action.type === 'addEdge' || action.type === 'removeEdge') {
            relevantEntityIds.add(action.data.fromId);
            relevantEntityIds.add(action.data.toId);
        }

        const allEntities = this.world.getAllEntities();
        for (const entity of allEntities) {
            if (!entity.active) continue;

            const isRelevant = 
                entity.hasComponent('Gear') ||
                entity.hasComponent('Spring') ||
                entity.hasComponent('Conveyor') ||
                relevantEntityIds.has(entity.id);

            const isDynamicRigidBody = 
                entity.hasComponent('RigidBody') && 
                !entity.getComponent<RigidBody>('RigidBody')?.isStatic &&
                !entity.getComponent<Node>('Node')?.isFixed;

            if (isRelevant || isDynamicRigidBody) {
                states.push({
                    entityId: entity.id,
                    state: entity.captureState()
                });
            }
        }

        return states;
    }

    private restoreEntityStates(states: EntityState[]): void {
        for (const entityState of states) {
            const entity = this.world.getEntity(entityState.entityId);
            if (entity && entity.active) {
                entity.restoreState(entityState.state);
            }
        }
    }

    private onAction(action: GameAction): void {
        if (this.isUndoingOrRedoing) return;

        const entityStates = this.captureRelevantEntityStates(action);

        this.undoStack.push({
            action,
            timestamp: Date.now(),
            entityStates
        });

        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }

        this.redoStack = [];
    }

    public undo(): boolean {
        if (this.undoStack.length === 0) return false;

        this.isUndoingOrRedoing = true;

        const entry = this.undoStack.pop()!;
        this.redoStack.push(entry);

        const currentStates = this.captureRelevantEntityStates(entry.action);
        this.redoStack[this.redoStack.length - 1].entityStates = currentStates;

        this.restoreEntityStates(entry.entityStates);
        this.executeInverseAction(entry.action);

        this.synchronizeVerletCache();

        if (this.physicsSystem) {
            this.physicsSystem.requestPause(2, true);
        }

        this.isUndoingOrRedoing = false;
        return true;
    }

    public redo(): boolean {
        if (this.redoStack.length === 0) return false;

        this.isUndoingOrRedoing = true;

        const entry = this.redoStack.pop()!;
        this.undoStack.push(entry);

        const currentStates = this.captureRelevantEntityStates(entry.action);
        this.undoStack[this.undoStack.length - 1].entityStates = currentStates;

        this.restoreEntityStates(entry.entityStates);
        this.executeAction(entry.action);

        this.synchronizeVerletCache();

        if (this.physicsSystem) {
            this.physicsSystem.requestPause(2, true);
        }

        this.isUndoingOrRedoing = false;
        return true;
    }

    private synchronizeVerletCache(): void {
        const bodies = this.world.query(['Position', 'RigidBody']);

        for (const entity of bodies) {
            const pos = entity.getComponent('Position') as any;
            const rb = entity.getComponent<RigidBody>('RigidBody')!;
            const node = entity.getComponent<Node>('Node');

            if (rb && pos) {
                if (rb.isStatic || (node?.isFixed ?? false)) {
                    rb.prevX = pos.x;
                    rb.prevY = pos.y;
                } else {
                    const velX = rb.velX || 0;
                    const velY = rb.velY || 0;
                    const dt = 1 / 60;
                    rb.prevX = pos.x - velX * dt;
                    rb.prevY = pos.y - velY * dt;
                }
            }
        }
    }

    private executeAction(action: GameAction): void {
        if (!this.inputSystem) return;

        switch (action.type) {
            case 'addEdge':
                this.inputSystem.addEdgeFromData({
                    fromId: action.data.fromId,
                    toId: action.data.toId
                });
                break;
            case 'removeEdge':
                this.inputSystem.removeEdgeById(action.data.entityId);
                break;
        }
    }

    private executeInverseAction(action: GameAction): void {
        if (!this.inputSystem) return;

        switch (action.type) {
            case 'addEdge':
                this.inputSystem.removeEdgeById(action.data.entityId);
                break;
            case 'removeEdge':
                this.inputSystem.addEdgeFromData({
                    fromId: action.data.fromId,
                    toId: action.data.toId
                });
                break;
        }
    }

    public canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    public canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    public clearHistory(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    public getHistory(): { undo: number; redo: number } {
        return {
            undo: this.undoStack.length,
            redo: this.redoStack.length
        };
    }

    public toJSON(): any {
        return {
            undoStack: this.undoStack.map(entry => ({
                action: entry.action,
                timestamp: entry.timestamp,
                entityStates: entry.entityStates
            })),
            redoStack: this.redoStack.map(entry => ({
                action: entry.action,
                timestamp: entry.timestamp,
                entityStates: entry.entityStates
            }))
        };
    }

    public fromJSON(data: any): void {
        this.undoStack = data.undoStack || [];
        this.redoStack = data.redoStack || [];
    }
}
