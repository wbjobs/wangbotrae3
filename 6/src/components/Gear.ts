export class Gear {
    public angularVelocity: number = 0;
    public angle: number = 0;
    public rotationRatio: number = 1;

    constructor(
        public radius: number = 40,
        public teeth: number = 12,
        public isMotor: boolean = false,
        public motorSpeed: number = 2,
        public color: string = '#f39c12'
    ) {}

    clone(): Gear {
        const clone = new Gear(this.radius, this.teeth, this.isMotor, this.motorSpeed, this.color);
        clone.angularVelocity = this.angularVelocity;
        clone.angle = this.angle;
        clone.rotationRatio = this.rotationRatio;
        return clone;
    }

    toJSON(): any {
        return {
            radius: this.radius,
            teeth: this.teeth,
            isMotor: this.isMotor,
            motorSpeed: this.motorSpeed,
            color: this.color,
            angularVelocity: this.angularVelocity,
            angle: this.angle,
            rotationRatio: this.rotationRatio
        };
    }

    static fromJSON(data: any): Gear {
        const gear = new Gear(data.radius, data.teeth, data.isMotor, data.motorSpeed, data.color);
        gear.angularVelocity = data.angularVelocity ?? 0;
        gear.angle = data.angle ?? 0;
        gear.rotationRatio = data.rotationRatio ?? 1;
        return gear;
    }
}
