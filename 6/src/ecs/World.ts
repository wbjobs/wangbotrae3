import { Entity, EntityId } from './Entity.js';
import { System } from './System.js';

export class World {
    private entities: Map<EntityId, Entity> = new Map();
    private systems: System[] = [];
    private entityIds: EntityId[] = [];

    createEntity(): Entity {
        const entity = new Entity();
        this.entities.set(entity.id, entity);
        this.entityIds.push(entity.id);
        return entity;
    }

    getEntity(id: EntityId): Entity | undefined {
        return this.entities.get(id);
    }

    removeEntity(id: EntityId): void {
        this.entities.delete(id);
        const index = this.entityIds.indexOf(id);
        if (index > -1) {
            this.entityIds.splice(index, 1);
        }
    }

    addSystem(system: System): World {
        system.world = this;
        this.systems.push(system);
        return this;
    }

    getSystems(): System[] {
        return this.systems;
    }

    getSystem<T extends System>(systemType: new (...args: any[]) => T): T | undefined {
        return this.systems.find(s => s instanceof systemType) as T | undefined;
    }

    query(componentNames: string[]): Entity[] {
        const result: Entity[] = [];
        for (const id of this.entityIds) {
            const entity = this.entities.get(id);
            if (entity && entity.active && entity.hasAllComponents(componentNames)) {
                result.push(entity);
            }
        }
        return result;
    }

    queryOne(componentNames: string[]): Entity | undefined {
        for (const id of this.entityIds) {
            const entity = this.entities.get(id);
            if (entity && entity.active && entity.hasAllComponents(componentNames)) {
                return entity;
            }
        }
        return undefined;
    }

    getAllEntities(): Entity[] {
        return this.entityIds.map(id => this.entities.get(id)!).filter(e => e !== undefined);
    }

    update(deltaTime: number): void {
        for (const system of this.systems) {
            if (system.enabled) {
                system.update(deltaTime);
            }
        }
    }

    clear(): void {
        this.entities.clear();
        this.entityIds = [];
        this.systems.forEach(s => s.onDestroy?.());
        this.systems = [];
    }

    clone(): World {
        const clone = new World();
        const idMap: Map<EntityId, EntityId> = new Map();
        
        for (const entity of this.getAllEntities()) {
            const clonedEntity = entity.clone();
            idMap.set(entity.id, clonedEntity.id);
            clone.entities.set(clonedEntity.id, clonedEntity);
            clone.entityIds.push(clonedEntity.id);
        }

        for (const system of this.systems) {
            const clonedSystem = Object.create(Object.getPrototypeOf(system));
            Object.assign(clonedSystem, system);
            clonedSystem.world = clone;
            clone.systems.push(clonedSystem);
        }

        return { world: clone, idMap } as any;
    }

    toJSON(): any {
        return {
            entities: this.entityIds.map(id => {
                const entity = this.entities.get(id);
                return entity ? entity.toJSON() : null;
            }).filter(Boolean)
        };
    }

    static fromJSON(data: any, componentRegistry: Map<string, new (...args: any[]) => any>): World {
        const world = new World();
        for (const entityData of data.entities) {
            const entity = Entity.fromJSON(entityData);
            for (const [name, compData] of Object.entries(entityData.components)) {
                const CompClass = componentRegistry.get(name);
                if (CompClass) {
                    const comp = typeof (CompClass as any).fromJSON === 'function'
                        ? (CompClass as any).fromJSON(compData)
                        : Object.assign(new CompClass(), compData);
                    entity.addComponent(comp);
                }
            }
            world.entities.set(entity.id, entity);
            world.entityIds.push(entity.id);
        }
        return world;
    }
}
