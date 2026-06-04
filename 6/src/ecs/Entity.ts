export type EntityId = number;

export class Entity {
    private static nextId: EntityId = 1;
    public readonly id: EntityId;
    private components: Map<string, any> = new Map();
    public active: boolean = true;

    constructor() {
        this.id = Entity.nextId++;
    }

    addComponent<T>(component: T): Entity {
        const name = (component as any).constructor.name;
        this.components.set(name, component);
        return this;
    }

    removeComponent(componentName: string): Entity {
        this.components.delete(componentName);
        return this;
    }

    getComponent<T>(componentName: string): T | undefined {
        return this.components.get(componentName);
    }

    hasComponent(componentName: string): boolean {
        return this.components.has(componentName);
    }

    hasAllComponents(componentNames: string[]): boolean {
        return componentNames.every(name => this.components.has(name));
    }

    getComponentNames(): string[] {
        return Array.from(this.components.keys());
    }

    clone(): Entity {
        const clone = new Entity();
        this.components.forEach((comp, name) => {
            if (typeof comp.clone === 'function') {
                clone.addComponent(comp.clone());
            } else {
                clone.addComponent({ ...comp });
            }
        });
        clone.active = this.active;
        return clone;
    }

    toJSON(): any {
        const data: any = { id: this.id, active: this.active, components: {} };
        this.components.forEach((comp, name) => {
            data.components[name] = typeof comp.toJSON === 'function' ? comp.toJSON() : { ...comp };
        });
        return data;
    }

    static fromJSON(data: any): Entity {
        const entity = new Entity();
        (Entity as any).nextId = Math.max((Entity as any).nextId, data.id + 1);
        (entity as any).id = data.id;
        entity.active = data.active;
        return entity;
    }

    public captureState(): any {
        const state: any = {};
        this.components.forEach((comp, name) => {
            state[name] = typeof comp.toJSON === 'function' ? comp.toJSON() : { ...comp };
        });
        return {
            id: this.id,
            active: this.active,
            components: state
        };
    }

    public restoreState(state: any): void {
        if (state.id !== this.id) {
            console.warn(`尝试恢复不匹配的实体状态: 期望 ${this.id}, 得到 ${state.id}`);
            return;
        }
        this.active = state.active ?? this.active;
        
        for (const [name, compState] of Object.entries(state.components)) {
            const existingComp = this.components.get(name);
            if (existingComp) {
                if (typeof (existingComp.constructor as any).fromJSON === 'function') {
                    const restored = (existingComp.constructor as any).fromJSON(compState);
                    Object.assign(existingComp, restored);
                } else {
                    Object.assign(existingComp, compState);
                }
            }
        }
    }
}
