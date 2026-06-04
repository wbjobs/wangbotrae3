export class Conveyor {
    public speed: number = 0;
    public isActive: boolean = false;

    constructor(
        public width: number = 150,
        public height: number = 20,
        public maxSpeed: number = 3,
        public color: string = '#3498db'
    ) {}

    clone(): Conveyor {
        const clone = new Conveyor(this.width, this.height, this.maxSpeed, this.color);
        clone.speed = this.speed;
        clone.isActive = this.isActive;
        return clone;
    }

    toJSON(): any {
        return {
            width: this.width,
            height: this.height,
            maxSpeed: this.maxSpeed,
            color: this.color,
            speed: this.speed,
            isActive: this.isActive
        };
    }

    static fromJSON(data: any): Conveyor {
        const conveyor = new Conveyor(data.width, data.height, data.maxSpeed, data.color);
        conveyor.speed = data.speed ?? 0;
        conveyor.isActive = data.isActive ?? false;
        return conveyor;
    }
}
