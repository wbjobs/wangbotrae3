import { World } from '../ecs/World.js';
import { Position } from '../components/Position.js';
import { Node } from '../components/Node.js';
import { Edge } from '../components/Edge.js';
import { Gear } from '../components/Gear.js';
import { Spring } from '../components/Spring.js';
import { Conveyor } from '../components/Conveyor.js';
import { RigidBody } from '../components/RigidBody.js';
import { Goal } from '../components/Goal.js';
import { Render } from '../components/Render.js';

export interface LevelData {
    id: number;
    name: string;
    description: string;
    hint: string;
    build: (world: World) => void;
}

export const createNode = (
    world: World,
    x: number,
    y: number,
    isFixed: boolean = false,
    isPowerSource: boolean = false,
    radius: number = 20
): number => {
    const entity = world.createEntity();
    entity.addComponent(new Position(x, y));
    entity.addComponent(new Node(radius, '#e94560', isFixed, isPowerSource));
    if (isFixed) {
        const rb = new RigidBody(1, true, 1, radius);
        rb.prevX = x;
        rb.prevY = y;
        entity.addComponent(rb);
    }
    entity.addComponent(new Render());
    return entity.id;
};

export const createGear = (
    world: World,
    x: number,
    y: number,
    radius: number = 40,
    isMotor: boolean = false,
    isPowerSource: boolean = false
): number => {
    const entity = world.createEntity();
    entity.addComponent(new Position(x, y));
    entity.addComponent(new Node(radius, '#f39c12', true, isPowerSource));
    entity.addComponent(new Gear(radius, 12, isMotor, 3));
    const rb = new RigidBody(1, true, 1, radius);
    rb.prevX = x;
    rb.prevY = y;
    entity.addComponent(rb);
    entity.addComponent(new Render());
    return entity.id;
};

export const createEdge = (
    world: World,
    fromId: number,
    toId: number,
    isPlayerCreated: boolean = false
): number => {
    const entity = world.createEntity();
    entity.addComponent(new Edge(fromId, toId, isPlayerCreated));
    entity.addComponent(new Render());
    return entity.id;
};

export const createSpring = (
    world: World,
    entityIdA: number,
    entityIdB: number,
    restLength: number = 100,
    stiffness: number = 0.3
): number => {
    const entity = world.createEntity();
    entity.addComponent(new Spring(entityIdA, entityIdB, restLength, stiffness, 0.1));
    entity.addComponent(new Render());
    return entity.id;
};

export const createConveyor = (
    world: World,
    x: number,
    y: number,
    width: number = 150,
    height: number = 20,
    hasNode: boolean = true
): number => {
    const entity = world.createEntity();
    entity.addComponent(new Position(x, y));
    entity.addComponent(new Conveyor(width, height, 3));
    if (hasNode) {
        entity.addComponent(new Node(20, '#3498db', true, false));
    }
    const rb = new RigidBody(1, true, 1, height / 2);
    rb.prevX = x;
    rb.prevY = y;
    entity.addComponent(rb);
    entity.addComponent(new Render());
    return entity.id;
};

export const createBall = (
    world: World,
    x: number,
    y: number,
    radius: number = 15,
    mass: number = 1
): number => {
    const entity = world.createEntity();
    entity.addComponent(new Position(x, y));
    const rb = new RigidBody(mass, false, 1, radius);
    rb.prevX = x;
    rb.prevY = y;
    entity.addComponent(rb);
    entity.addComponent(new Render());
    return entity.id;
};

export const createGoal = (
    world: World,
    x: number,
    y: number,
    radius: number = 30,
    triggerType: 'ball' | 'rotation' | 'position' = 'ball',
    targetEntityId?: number
): number => {
    const entity = world.createEntity();
    entity.addComponent(new Position(x, y));
    entity.addComponent(new Goal(radius, '#4ade80', triggerType, targetEntityId));
    entity.addComponent(new Render());
    return entity.id;
};
