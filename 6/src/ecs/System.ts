import { World } from './World.js';
import { Entity } from './Entity.js';

export abstract class System {
    public world!: World;
    public enabled: boolean = true;
    public priority: number = 0;

    constructor(priority: number = 0) {
        this.priority = priority;
    }

    abstract update(deltaTime: number): void;

    onInit?(): void;
    onDestroy?(): void;

    protected query(componentNames: string[]): Entity[] {
        return this.world.query(componentNames);
    }

    protected queryOne(componentNames: string[]): Entity | undefined {
        return this.world.queryOne(componentNames);
    }

    protected getEntity(id: number): Entity | undefined {
        return this.world.getEntity(id);
    }
}
