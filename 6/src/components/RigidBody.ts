export class RigidBody {
    public prevX: number = 0;
    public prevY: number = 0;
    public velX: number = 0;
    public velY: number = 0;

    constructor(
        public mass: number = 1,
        public isStatic: boolean = false,
        public gravityScale: number = 1,
        public radius: number = 15
    ) {}

    clone(): RigidBody {
        const clone = new RigidBody(this.mass, this.isStatic, this.gravityScale, this.radius);
        clone.prevX = this.prevX;
        clone.prevY = this.prevY;
        clone.velX = this.velX;
        clone.velY = this.velY;
        return clone;
    }

    toJSON(): any {
        return {
            mass: this.mass,
            isStatic: this.isStatic,
            gravityScale: this.gravityScale,
            radius: this.radius,
            prevX: this.prevX,
            prevY: this.prevY,
            velX: this.velX,
            velY: this.velY
        };
    }

    static fromJSON(data: any): RigidBody {
        const rb = new RigidBody(data.mass, data.isStatic, data.gravityScale, data.radius);
        rb.prevX = data.prevX ?? 0;
        rb.prevY = data.prevY ?? 0;
        rb.velX = data.velX ?? 0;
        rb.velY = data.velY ?? 0;
        return rb;
    }
}
