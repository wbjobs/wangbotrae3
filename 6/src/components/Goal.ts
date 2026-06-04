export class Goal {
    public isReached: boolean = false;
    public triggerType: 'ball' | 'rotation' | 'position' = 'ball';
    public targetEntityId?: number;
    public targetAngle?: number;
    public tolerance: number = 30;

    constructor(
        public radius: number = 25,
        public color: string = '#4ade80',
        triggerType: 'ball' | 'rotation' | 'position' = 'ball',
        targetEntityId?: number
    ) {
        this.triggerType = triggerType;
        this.targetEntityId = targetEntityId;
    }

    clone(): Goal {
        const clone = new Goal(this.radius, this.color, this.triggerType, this.targetEntityId);
        clone.isReached = this.isReached;
        clone.targetAngle = this.targetAngle;
        clone.tolerance = this.tolerance;
        return clone;
    }

    toJSON(): any {
        return {
            radius: this.radius,
            color: this.color,
            triggerType: this.triggerType,
            targetEntityId: this.targetEntityId,
            targetAngle: this.targetAngle,
            tolerance: this.tolerance,
            isReached: this.isReached
        };
    }

    static fromJSON(data: any): Goal {
        const goal = new Goal(data.radius, data.color, data.triggerType, data.targetEntityId);
        goal.isReached = data.isReached ?? false;
        goal.targetAngle = data.targetAngle;
        goal.tolerance = data.tolerance ?? 30;
        return goal;
    }
}
