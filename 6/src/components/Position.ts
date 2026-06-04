export class Position {
    constructor(
        public x: number = 0,
        public y: number = 0
    ) {}

    clone(): Position {
        return new Position(this.x, this.y);
    }

    toJSON(): any {
        return { x: this.x, y: this.y };
    }

    static fromJSON(data: any): Position {
        return new Position(data.x, data.y);
    }
}
