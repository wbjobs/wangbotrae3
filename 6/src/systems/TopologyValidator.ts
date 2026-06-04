import { System } from '../ecs/System.js';
import { Entity } from '../ecs/Entity.js';
import { Node } from '../components/Node.js';
import { Gear } from '../components/Gear.js';
import { Spring } from '../components/Spring.js';
import { Conveyor } from '../components/Conveyor.js';
import { Goal } from '../components/Goal.js';
import { RigidBody } from '../components/RigidBody.js';

export interface ValidationIssue {
    type: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    entityId?: number;
    entityType?: string;
}

export interface ValidationReport {
    isValid: boolean;
    issues: ValidationIssue[];
    stats: {
            totalNodes: number;
            powerSources: number;
            gears: number;
            springs: number;
            conveyors: number;
            goals: number;
            edges: number;
            connectedComponents: number;
            poweredComponents: number;
            balls: number;
        };
}

export class TopologyValidator extends System {
    private lastReport: ValidationReport | null = null;
    private autoValidate: boolean = true;

    constructor() {
        super(15);
    }

    update(deltaTime: number): void {
        if (this.autoValidate) {
            this.validate();
        }
    }

    public validate(): ValidationReport {
        const issues: ValidationIssue[] = [];
        const nodes = this.query(['Node']);
        const gears = this.query(['Gear']);
        const springs = this.query(['Spring']);
        const conveyors = this.query(['Conveyor']);
        const goals = this.query(['Goal']);
        const edges = this.query(['Edge']);
        const allBodies = this.query(['RigidBody']);
        const balls = allBodies.filter(e => 
            !e.hasComponent('Node') && 
            !e.getComponent<RigidBody>('RigidBody')?.isStatic
        );

        const powerSources = nodes.filter(e => e.getComponent<Node>('Node')?.isPowerSource);
        const poweredNodes = nodes.filter(e => e.getComponent<Node>('Node')?.isPowered);

        const componentMap = new Map<number, Entity[]>();
        for (const nodeEntity of nodes) {
            const node = nodeEntity.getComponent<Node>('Node')!;
            const compId = node.connectedComponentId;
            if (!componentMap.has(compId)) {
                componentMap.set(compId, []);
            }
            componentMap.get(compId)!.push(nodeEntity);
        }

        this.checkIsolatedPowerSources(powerSources, componentMap, issues);
        this.checkUnpoweredMechanisms(gears, springs, conveyors, issues);
        this.checkGearConnections(gears, issues);
        this.checkGoalReachability(goals, balls, issues);
        this.checkDanglingNodes(nodes, edges, issues);
        this.checkSpringConnections(springs, issues);

        const hasErrors = issues.some(i => i.type === 'error');

        this.lastReport = {
            isValid: !hasErrors,
            issues,
            stats: {
                totalNodes: nodes.length,
                powerSources: powerSources.length,
                gears: gears.length,
                springs: springs.length,
                conveyors: conveyors.length,
                goals: goals.length,
                edges: edges.length,
                connectedComponents: componentMap.size,
                poweredComponents: poweredNodes.length,
                balls: balls.length
            }
        };

        return this.lastReport;
    }

    private checkIsolatedPowerSources(
        powerSources: Entity[],
        componentMap: Map<number, Entity[]>,
        issues: ValidationIssue[]
    ): void {
        if (powerSources.length === 0) {
            issues.push({
                type: 'error',
                code: 'NO_POWER_SOURCE',
                message: '关卡没有任何动力源，机械装置无法被激活'
            });
            return;
        }

        for (const source of powerSources) {
            const node = source.getComponent<Node>('Node')!;
            const compId = node.connectedComponentId;
            const component = componentMap.get(compId) || [];

            if (component.length <= 1) {
                issues.push({
                    type: 'warning',
                    code: 'ISOLATED_POWER_SOURCE',
                    message: `动力源节点 #${source.id} 没有连接到任何其他节点`,
                    entityId: source.id,
                    entityType: 'PowerSource'
                });
            }
        }
    }

    private checkUnpoweredMechanisms(
        gears: Entity[],
        springs: Entity[],
        conveyors: Entity[],
        issues: ValidationIssue[]
    ): void {
        for (const gearEntity of gears) {
            const node = gearEntity.getComponent<Node>('Node');
            const gear = gearEntity.getComponent<Gear>('Gear');
            if (node && !node.isPowered && !gear?.isMotor) {
                issues.push({
                    type: 'warning',
                    code: 'UNPOWERED_GEAR',
                    message: `齿轮 #${gearEntity.id} 未连接到动力源，可能无法旋转`,
                    entityId: gearEntity.id,
                    entityType: 'Gear'
                });
            }
        }

        for (const springEntity of springs) {
            const spring = springEntity.getComponent<Spring>('Spring')!;
            const entityA = this.getEntity(spring.entityIdA);
            const entityB = this.getEntity(spring.entityIdB);
            const nodeA = entityA?.getComponent<Node>('Node');
            const nodeB = entityB?.getComponent<Node>('Node');

            if (!nodeA?.isPowered && !nodeB?.isPowered) {
                issues.push({
                    type: 'warning',
                    code: 'UNPOWERED_SPRING',
                    message: `弹簧 #${springEntity.id} 两端都未连接到动力源`,
                    entityId: springEntity.id,
                    entityType: 'Spring'
                });
            }
        }

        for (const conveyorEntity of conveyors) {
            const node = conveyorEntity.getComponent<Node>('Node');
            if (node && !node.isPowered) {
                issues.push({
                    type: 'warning',
                    code: 'UNPOWERED_CONVEYOR',
                    message: `传送带 #${conveyorEntity.id} 未连接到动力源`,
                    entityId: conveyorEntity.id,
                    entityType: 'Conveyor'
                });
            }
        }
    }

    private checkGearConnections(gears: Entity[], issues: ValidationIssue[]): void {
        for (let i = 0; i < gears.length; i++) {
            const gearA = gears[i].getComponent<Gear>('Gear')!;
            const posA = gears[i].getComponent('Position') as any;
            let hasContact = false;

            for (let j = 0; j < gears.length; j++) {
                if (i === j) continue;
                const gearB = gears[j].getComponent<Gear>('Gear')!;
                const posB = gears[j].getComponent('Position') as any;

                if (posA && posB) {
                    const dx = posB.x - posA.x;
                    const dy = posB.y - posA.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const touchDist = gearA.radius + gearB.radius;

                    if (Math.abs(distance - touchDist) < 15) {
                        hasContact = true;
                        break;
                    }
                }
            }

            if (!hasContact && gears.length > 1 && !gearA.isMotor) {
                issues.push({
                    type: 'info',
                    code: 'GEAR_NO_CONTACT',
                    message: `齿轮 #${gears[i].id} 没有与其他齿轮啮合`,
                    entityId: gears[i].id,
                    entityType: 'Gear'
                });
            }
        }
    }

    private checkGoalReachability(goals: Entity[], balls: Entity[], issues: ValidationIssue[]): void {
        if (goals.length === 0) {
            issues.push({
                type: 'error',
                code: 'NO_GOAL',
                message: '关卡没有设置目标点，玩家无法通关'
            });
        }

        for (const goal of goals) {
            const goalComp = goal.getComponent<Goal>('Goal')!;
            if (goalComp.triggerType === 'ball') {
                if (balls.length === 0) {
                    issues.push({
                        type: 'warning',
                        code: 'GOAL_NO_BALL',
                        message: `目标 #${goal.id} 需要小球触发，但场景中没有可移动的小球`,
                        entityId: goal.id,
                        entityType: 'Goal'
                    });
                }
            }
        }
    }

    private checkDanglingNodes(
        nodes: Entity[],
        edges: Entity[],
        issues: ValidationIssue[]
    ): void {
        const nodeConnectionCount = new Map<number, number>();
        
        for (const node of nodes) {
            nodeConnectionCount.set(node.id, 0);
        }

        for (const edge of edges) {
            const edgeComp = edge.getComponent('Edge') as any;
            if (edgeComp) {
                const count1 = nodeConnectionCount.get(edgeComp.fromEntityId) || 0;
                const count2 = nodeConnectionCount.get(edgeComp.toEntityId) || 0;
                nodeConnectionCount.set(edgeComp.fromEntityId, count1 + 1);
                nodeConnectionCount.set(edgeComp.toEntityId, count2 + 1);
            }
        }

        for (const node of nodes) {
            const nodeComp = node.getComponent<Node>('Node')!;
            const connections = nodeConnectionCount.get(node.id) || 0;

            if (connections === 0 && !nodeComp.isPowerSource) {
                issues.push({
                    type: 'info',
                    code: 'DANGLING_NODE',
                    message: `节点 #${node.id} 没有任何连接`,
                    entityId: node.id,
                    entityType: 'Node'
                });
            }
        }
    }

    private checkSpringConnections(springs: Entity[], issues: ValidationIssue[]): void {
        for (const spring of springs) {
            const springComp = spring.getComponent<Spring>('Spring')!;
            const entityA = this.getEntity(springComp.entityIdA);
            const entityB = this.getEntity(springComp.entityIdB);

            if (!entityA || !entityB) {
                issues.push({
                    type: 'error',
                    code: 'SPRING_BROKEN_LINK',
                    message: `弹簧 #${spring.id} 引用了不存在的节点`,
                    entityId: spring.id,
                    entityType: 'Spring'
                });
            }
        }
    }

    public getLastReport(): ValidationReport | null {
        return this.lastReport;
    }

    public setAutoValidate(enabled: boolean): void {
        this.autoValidate = enabled;
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }
}
