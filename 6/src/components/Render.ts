export class Render {
    constructor(
        public visible: boolean = true,
        public layer: number = 0,
        public glow: boolean = false,
        public glowColor: string = '#e94560',
        public glowIntensity: number = 15
    ) {}

    clone(): Render {
        return new Render(this.visible, this.layer, this.glow, this.glowColor, this.glowIntensity);
    }

    toJSON(): any {
        return {
            visible: this.visible,
            layer: this.layer,
            glow: this.glow,
            glowColor: this.glowColor,
            glowIntensity: this.glowIntensity
        };
    }

    static fromJSON(data: any): Render {
        return new Render(data.visible, data.layer, data.glow, data.glowColor, data.glowIntensity);
    }
}
