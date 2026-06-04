import { System } from '../ecs/System.js';
import { Entity } from '../ecs/Entity.js';
import { Node } from '../components/Node.js';
import { Edge } from '../components/Edge.js';
import { Gear } from '../components/Gear.js';
import { Spring } from '../components/Spring.js';
import { Conveyor } from '../components/Conveyor.js';

interface GraphNode {
    entityId: number;
    neighbors: number[];
}

export class TopologySystem extends System {
    private adjacencyList: Map<number, GraphNode> = new Map();
    private connectedComponents: Map<number, number> = new Map();
    private componentPowered: Map<number, boolean> = new Map();
    public componentCount: number = 0;
    private lastEdgeCount: number = 0;
    private lastNodeCount: number = 0;

    constructor() {
        super(10);
    }

    update(deltaTime: number): void {
        const nodes = this.query(['Node']);
        const edges = this.query(['Edge']);

        if (edges.length !== this.lastEdgeCount || nodes.length !== this.lastNodeCount) {
            this.rebuildGraph(nodes, edges);
            this.lastEdgeCount = edges.length;
            this.lastNodeCount = nodes.length;
        }

        this.detectConnectedComponents(nodes);
        this.propagatePower(nodes);
        this.updateMechanisms();
    }

    private rebuildGraph(nodes: Entity[], edges: Entity[]): void {
        this.adjacencyList.clear();

        for (const nodeEntity of nodes) {
            this.adjacencyList.set(nodeEntity.id, {
                entityId: nodeEntity.id,
                neighbors: []
            });
        }

        for (const edgeEntity of edges) {
            const edge = edgeEntity.getComponent<Edge>('Edge')!;
            const fromNode = this.getEntity(edge.fromEntityId);
            const toNode = this.getEntity(edge.toEntityId);

            if (fromNode && toNode &&
                fromNode.hasComponent('Node') &&
                toNode.hasComponent('Node')) {
                
                const fromGraph = this.adjacencyList.get(edge.fromEntityId);
                const toGraph = this.adjacencyList.get(edge.toEntityId);

                if (fromGraph && toGraph) {
                    if (!fromGraph.neighbors.includes(edge.toEntityId)) {
                        fromGraph.neighbors.push(edge.toEntityId);
                    }
                    if (!toGraph.neighbors.includes(edge.fromEntityId)) {
                        toGraph.neighbors.push(edge.fromEntityId);
                    }
                }
            }
        }
    }

    private detectConnectedComponents(nodes: Entity[]): void {
        this.connectedComponents.clear();
        this.componentPowered.clear();
        this.componentCount = 0;

        const visited = new Set<number>();

        for (const nodeEntity of nodes) {
            if (!visited.has(nodeEntity.id)) {
                const componentId = this.componentCount++;
                const componentNodes: number[] = [];
                
                this.bfs(nodeEntity.id, visited, componentId, componentNodes);

                const hasPowerSource = componentNodes.some(id => {
                    const entity = this.getEntity(id);
                    if (entity) {
                        const node = entity.getComponent<Node>('Node');
                        return node?.isPowerSource ?? false;
                    }
                    return false;
                });

                this.componentPowered.set(componentId, hasPowerSource);
            }
        }
    }

    private bfs(startId: number, visited: Set<number>, componentId: number, componentNodes: number[]): void {
        const queue: number[] = [startId];
        visited.add(startId);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            this.connectedComponents.set(currentId, componentId);
            componentNodes.push(currentId);

            const currentNode = this.adjacencyList.get(currentId);
            if (currentNode) {
                for (const neighborId of currentNode.neighbors) {
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        queue.push(neighborId);
                    }
                }
            }
        }
    }

    private propagatePower(nodes: Entity[]): void {
        for (const nodeEntity of nodes) {
            const node = nodeEntity.getComponent<Node>('Node')!;
            const componentId = this.connectedComponents.get(nodeEntity.id);
            
            if (componentId !== undefined) {
                node.connectedComponentId = componentId;
                node.isPowered = this.componentPowered.get(componentId) ?? false;
            } else {
                node.connectedComponentId = -1;
                node.isPowered = node.isPowerSource;
            }
        }

        const edges = this.query(['Edge']);
        for (const edgeEntity of edges) {
            const edge = edgeEntity.getComponent<Edge>('Edge')!;
            const fromEntity = this.getEntity(edge.fromEntityId);
            const toEntity = this.getEntity(edge.toEntityId);

            if (fromEntity && toEntity) {
                const fromNode = fromEntity.getComponent<Node>('Node');
                const toNode = toEntity.getComponent<Node>('Node');
                edge.isActive = (fromNode?.isPowered ?? false) && (toNode?.isPowered ?? false);
            }
        }
    }

    private updateMechanisms(): void {
        const gears = this.query(['Gear', 'Node']);
        for (const gearEntity of gears) {
            const gear = gearEntity.getComponent<Gear>('Gear')!;
            const node = gearEntity.getComponent<Node>('Node')!;
            if (node.isPowered) {
                if (!gear.isMotor) {
                    gear.angularVelocity = gear.motorSpeed * gear.rotationRatio;
                }
            } else {
                if (!gear.isMotor) {
                    gear.angularVelocity *= 0.95;
                }
            }
        }

        const springs = this.query(['Spring']);
        for (const springEntity of springs) {
            const spring = springEntity.getComponent<Spring>('Spring')!;
            const entityA = this.getEntity(spring.entityIdA);
            const entityB = this.getEntity(spring.entityIdB);
            
            if (entityA && entityB) {
                const nodeA = entityA.getComponent<Node>('Node');
                const nodeB = entityB.getComponent<Node>('Node');
                spring.isActive = (nodeA?.isPowered ?? false) || (nodeB?.isPowered ?? false);
            }
        }

        const conveyors = this.query(['Conveyor', 'Node']);
        for (const conveyorEntity of conveyors) {
            const conveyor = conveyorEntity.getComponent<Conveyor>('Conveyor')!;
            const node = conveyorEntity.getComponent<Node>('Node')!;
            conveyor.isActive = node.isPowered;
            conveyor.speed = node.isPowered ? conveyor.maxSpeed : conveyor.speed * 0.9;
        }
    }

    public getConnectedComponent(nodeId: number): number {
        return this.connectedComponents.get(nodeId) ?? -1;
    }

    public areConnected(nodeId1: number, nodeId2: number): boolean {
        const comp1 = this.connectedComponents.get(nodeId1);
        const comp2 = this.connectedComponents.get(nodeId2);
        return comp1 !== undefined && comp2 !== undefined && comp1 === comp2;
    }

    public isComponentPowered(componentId: number): boolean {
        return this.componentPowered.get(componentId) ?? false;
    }

    public invalidate(): void {
        this.lastEdgeCount = -1;
        this.lastNodeCount = -1;
    }
}
