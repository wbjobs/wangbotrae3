import { System } from '../ecs/System.js';
import { World } from '../ecs/World.js';
import { componentRegistry } from '../components/ComponentRegistry.js';
import { UndoRedoSystem } from './UndoRedoSystem.js';

export interface SaveData {
    version: string;
    levelId: number;
    timestamp: number;
    world: any;
    undoRedo?: any;
}

export class SerializationSystem extends System {
    private version: string = '1.0.0';
    private currentLevelId: number = 1;

    constructor() {
        super(0);
    }

    update(deltaTime: number): void {
    }

    public serializeWorld(): SaveData {
        const undoRedoSystem = this.world.getSystem(UndoRedoSystem);
        
        return {
            version: this.version,
            levelId: this.currentLevelId,
            timestamp: Date.now(),
            world: this.world.toJSON(),
            undoRedo: undoRedoSystem?.toJSON()
        };
    }

    public serializeToJSON(): string {
        return JSON.stringify(this.serializeWorld(), null, 2);
    }

    public deserializeWorld(json: string): World | null {
        try {
            const data: SaveData = JSON.parse(json);
            
            if (data.version !== this.version) {
                console.warn(`版本不匹配：期望 ${this.version}，得到 ${data.version}`);
            }

            const world = World.fromJSON(data.world, componentRegistry);
            this.currentLevelId = data.levelId;

            return world;
        } catch (error) {
            console.error('反序列化失败:', error);
            return null;
        }
    }

    public saveToFile(filename: string): void {
        const json = this.serializeToJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    public async loadFromFile(file: File): Promise<World | null> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result as string;
                const world = this.deserializeWorld(content);
                resolve(world);
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    public async loadFromFilePicker(): Promise<World | null> {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                    const world = await this.loadFromFile(file);
                    resolve(world);
                } else {
                    resolve(null);
                }
            };
            input.click();
        });
    }

    public saveToLocalStorage(key: string): void {
        try {
            const json = this.serializeToJSON();
            localStorage.setItem(key, json);
        } catch (error) {
            console.error('保存到本地存储失败:', error);
        }
    }

    public loadFromLocalStorage(key: string): World | null {
        try {
            const json = localStorage.getItem(key);
            if (json) {
                return this.deserializeWorld(json);
            }
        } catch (error) {
            console.error('从本地存储加载失败:', error);
        }
        return null;
    }

    public setCurrentLevelId(levelId: number): void {
        this.currentLevelId = levelId;
    }

    public getCurrentLevelId(): number {
        return this.currentLevelId;
    }

    public getVersion(): string {
        return this.version;
    }
}
