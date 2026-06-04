export class Spring {
    public currentLength: number = 0;
    public isActive: boolean = false;

    constructor(
        public entityIdA: number,
        public entityIdB: number,
        public restLength: number = 100,
        public stiffness: number = 0.5,
        public damping: number = 0.1,
        public color: string = '#27ae60'
    ) {}

    clone(): Spring {
        const clone = new Spring(this.entityIdA, this.entityIdB, this.restLength, this.stiffness, this.damping, this.color);
        clone.currentLength = this.currentLength;
        clone.isActive = this.isActive;
        return clone;
    }

    toJSON(): any {
        return {
            entityIdA: this.entityIdA,
            entityIdB: this.entityIdB,
            restLength: this.restLength,
            stiffness: this.stiffness,
            damping: this.damping,
            color: this.color,
            currentLength: this.currentLength,
            isActive: this.isActive
        };
    }

    static fromJSON(data: any): Spring {
        const spring = new Spring(data.entityIdA, data.entityIdB, data.restLength, data.stiffness, data.damping, data.color);
        spring.currentLength = data.currentLength ?? 0;
        spring.isActive = data.isActive ?? false;
        return spring;
    }
}
