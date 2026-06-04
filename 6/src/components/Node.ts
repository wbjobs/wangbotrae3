export class Node {
    public connectedComponentId: number = -1;
    public isFixed: boolean = false;
    public isPowerSource: boolean = false;
    public isPowered: boolean = false;

    constructor(
        public radius: number = 20,
        public color: string = '#e94560',
        isFixed: boolean = false,
        isPowerSource: boolean = false
    ) {
        this.isFixed = isFixed;
        this.isPowerSource = isPowerSource;
    }

    clone(): Node {
        const clone = new Node(this.radius, this.color, this.isFixed, this.isPowerSource);
        clone.connectedComponentId = this.connectedComponentId;
        clone.isPowered = this.isPowered;
        return clone;
    }

    toJSON(): any {
        return {
            radius: this.radius,
            color: this.color,
            isFixed: this.isFixed,
            isPowerSource: this.isPowerSource,
            connectedComponentId: this.connectedComponentId,
            isPowered: this.isPowered
        };
    }

    static fromJSON(data: any): Node {
        const node = new Node(data.radius, data.color, data.isFixed, data.isPowerSource);
        node.connectedComponentId = data.connectedComponentId ?? -1;
        node.isPowered = data.isPowered ?? false;
        return node;
    }
}
