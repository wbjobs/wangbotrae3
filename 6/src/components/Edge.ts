export class Edge {
    public isActive: boolean = false;

    constructor(
        public fromEntityId: number,
        public toEntityId: number,
        public isPlayerCreated: boolean = true,
        public color: string = '#533483',
        public thickness: number = 4
    ) {}

    clone(): Edge {
        const clone = new Edge(this.fromEntityId, this.toEntityId, this.isPlayerCreated, this.color, this.thickness);
        clone.isActive = this.isActive;
        return clone;
    }

    toJSON(): any {
        return {
            fromEntityId: this.fromEntityId,
            toEntityId: this.toEntityId,
            isPlayerCreated: this.isPlayerCreated,
            color: this.color,
            thickness: this.thickness,
            isActive: this.isActive
        };
    }

    static fromJSON(data: any): Edge {
        const edge = new Edge(data.fromEntityId, data.toEntityId, data.isPlayerCreated, data.color, data.thickness);
        edge.isActive = data.isActive ?? false;
        return edge;
    }
}
