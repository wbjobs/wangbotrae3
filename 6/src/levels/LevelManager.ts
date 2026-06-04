import { World } from '../ecs/World.js';
import { LevelData } from './Level.js';
import { Level1 } from './Level1.js';
import { Level2 } from './Level2.js';
import { Level3 } from './Level3.js';
import { Level4 } from './Level4.js';
import { Level5 } from './Level5.js';

export class LevelManager {
    private levels: LevelData[] = [];
    private currentLevelIndex: number = 0;
    private completedLevels: Set<number> = new Set();
    private world: World;

    constructor(world: World) {
        this.world = world;
        this.levels = [Level1, Level2, Level3, Level4, Level5];
        this.loadProgress();
    }

    public loadLevel(levelId: number): LevelData | null {
        const level = this.levels.find(l => l.id === levelId);
        if (!level) return null;

        this.clearWorld();
        level.build(this.world);
        this.currentLevelIndex = this.levels.indexOf(level);

        return level;
    }

    public loadNextLevel(): LevelData | null {
        if (this.currentLevelIndex < this.levels.length - 1) {
            return this.loadLevel(this.levels[this.currentLevelIndex + 1].id);
        }
        return null;
    }

    public reloadCurrentLevel(): LevelData | null {
        return this.loadLevel(this.getCurrentLevel()?.id ?? 1);
    }

    public getCurrentLevel(): LevelData | null {
        return this.levels[this.currentLevelIndex] ?? null;
    }

    public getAllLevels(): LevelData[] {
        return this.levels;
    }

    public completeLevel(levelId: number): void {
        this.completedLevels.add(levelId);
        this.saveProgress();
    }

    public isLevelCompleted(levelId: number): boolean {
        return this.completedLevels.has(levelId);
    }

    public getCurrentLevelIndex(): number {
        return this.currentLevelIndex;
    }

    public getTotalLevels(): number {
        return this.levels.length;
    }

    private clearWorld(): void {
        const entities = this.world.getAllEntities();
        for (const entity of entities) {
            this.world.removeEntity(entity.id);
        }
    }

    private saveProgress(): void {
        try {
            localStorage.setItem(
                'topology_puzzle_progress',
                JSON.stringify(Array.from(this.completedLevels))
            );
        } catch (e) {
            console.warn('无法保存进度:', e);
        }
    }

    private loadProgress(): void {
        try {
            const saved = localStorage.getItem('topology_puzzle_progress');
            if (saved) {
                const completed = JSON.parse(saved);
                this.completedLevels = new Set(completed);
            }
        } catch (e) {
            console.warn('无法加载进度:', e);
        }
    }

    public resetProgress(): void {
        this.completedLevels.clear();
        this.saveProgress();
    }
}
