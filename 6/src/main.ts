import { World } from './ecs/World.js';
import { Entity } from './ecs/Entity.js';
import { TopologySystem } from './systems/TopologySystem.js';
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { InputSystem } from './systems/InputSystem.js';
import { UndoRedoSystem } from './systems/UndoRedoSystem.js';
import { SerializationSystem } from './systems/SerializationSystem.js';
import { LevelManager } from './levels/LevelManager.js';
import { LevelEditor, EditorMode } from './systems/LevelEditor.js';
import { TopologyValidator, ValidationReport, ValidationIssue } from './systems/TopologyValidator.js';
import { Goal } from './components/Goal.js';
import { Node } from './components/Node.js';
import { Gear } from './components/Gear.js';
import { Position } from './components/Position.js';
import { RigidBody } from './components/RigidBody.js';

class Game {
    private world: World;
    private canvas: HTMLCanvasElement;
    private lastTime: number = 0;
    private isRunning: boolean = true;
    private isEditorMode: boolean = true;
    private levelManager: LevelManager;
    private topologySystem: TopologySystem;
    private physicsSystem: PhysicsSystem;
    private renderSystem: RenderSystem;
    private inputSystem: InputSystem;
    private undoRedoSystem: UndoRedoSystem;
    private serializationSystem: SerializationSystem;
    private levelEditor: LevelEditor;
    private topologyValidator: TopologyValidator;
    
    private statusElement: HTMLElement | null = null;
    private levelTitleElement: HTMLElement | null = null;
    private levelDescElement: HTMLElement | null = null;
    private modeIndicator: HTMLElement | null = null;
    private propertyPanel: HTMLElement | null = null;
    private validationResults: HTMLElement | null = null;

    constructor() {
        this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        if (!this.canvas) {
            throw new Error('找不到canvas元素');
        }

        this.world = new World();

        this.topologySystem = new TopologySystem();
        this.physicsSystem = new PhysicsSystem();
        this.renderSystem = new RenderSystem(this.canvas);
        this.inputSystem = new InputSystem(this.canvas);
        this.undoRedoSystem = new UndoRedoSystem();
        this.serializationSystem = new SerializationSystem();
        this.levelEditor = new LevelEditor(this.canvas);
        this.topologyValidator = new TopologyValidator();

        this.world.addSystem(this.undoRedoSystem);
        this.world.addSystem(this.inputSystem);
        this.world.addSystem(this.levelEditor);
        this.world.addSystem(this.topologyValidator);
        this.world.addSystem(this.topologySystem);
        this.world.addSystem(this.physicsSystem);
        this.world.addSystem(this.renderSystem);
        this.world.addSystem(this.serializationSystem);

        this.levelManager = new LevelManager(this.world);

        this.setupEditorUI();
        this.setupKeyboardShortcuts();
        
        this.enterEditorMode();
    }

    private setupEditorUI(): void {
        this.statusElement = document.getElementById('status');
        this.levelTitleElement = document.getElementById('levelTitle');
        this.levelDescElement = document.getElementById('levelDesc');
        this.modeIndicator = document.getElementById('modeIndicator');
        this.propertyPanel = document.getElementById('propertyPanel');
        this.validationResults = document.getElementById('validationResults');

        document.querySelectorAll('[data-mode]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = (e.target as HTMLElement).dataset.mode as EditorMode;
                this.setEditorMode(mode);
            });
        });

        document.getElementById('testModeBtn')?.addEventListener('click', () => {
            if (this.levelEditor.isInTestMode()) {
                this.levelEditor.exitTestMode();
                (document.getElementById('testModeBtn') as HTMLElement).textContent = '▶️ 进入测试模式';
                this.modeIndicator?.classList.remove('test-mode');
                this.modeIndicator!.textContent = '✏️ 编辑模式';
            } else {
                this.levelEditor.enterTestMode();
                (document.getElementById('testModeBtn') as HTMLElement).textContent = '⏹️ 退出测试模式';
                this.modeIndicator?.classList.add('test-mode');
                this.modeIndicator!.textContent = '▶️ 测试模式';
            }
        });

        document.getElementById('exportBtn')?.addEventListener('click', () => {
            const name = prompt('输入关卡名称:', '我的关卡');
            if (name) {
                this.levelEditor.downloadLevelJSON(name);
            }
        });

        document.getElementById('importBtn')?.addEventListener('click', () => {
            const fileInput = document.getElementById('fileInput') as HTMLInputElement;
            fileInput.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                    try {
                        await this.levelEditor.importLevel(file);
                        this.updateStatus('关卡已导入');
                    } catch (err) {
                        this.updateStatus('导入失败: ' + (err as Error).message);
                    }
                }
            };
            fileInput.click();
        });

        document.getElementById('clearBtn')?.addEventListener('click', () => {
            if (confirm('确定要清空场景吗？')) {
                this.levelEditor.clearLevel();
                this.updateStatus('场景已清空');
            }
        });

        document.getElementById('connectNodes')?.addEventListener('click', () => {
            const selected = this.levelEditor.getSelectedEntity();
            if (selected && selected.hasComponent('Node')) {
                this.updateStatus('选择另一个节点后再次点击连接');
            }
        });

        document.getElementById('deleteSelected')?.addEventListener('click', () => {
            const selected = this.levelEditor.getSelectedEntity();
            if (selected) {
                this.levelEditor['deleteEntity'](selected);
                this.updatePropertyPanel(null);
            }
        });

        document.getElementById('makePower')?.addEventListener('click', () => {
            const selected = this.levelEditor.getSelectedEntity();
            if (selected && selected.hasComponent('Node')) {
                this.levelEditor.togglePowerSource(selected.id);
                this.updatePropertyPanel(selected);
            }
        });

        document.getElementById('makeFixed')?.addEventListener('click', () => {
            const selected = this.levelEditor.getSelectedEntity();
            if (selected && selected.hasComponent('Node')) {
                this.levelEditor.toggleFixed(selected.id);
                this.updatePropertyPanel(selected);
            }
        });

        document.querySelectorAll('#levelSelector .level-btn[data-level]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const levelId = parseInt((e.target as HTMLElement).dataset.level || '1');
                this.loadGameLevel(levelId);
            });
        });

        document.getElementById('editorModeBtn')?.addEventListener('click', () => {
            this.enterEditorMode();
        });

        this.levelEditor.setOnModeChange((mode) => {
            document.querySelectorAll('[data-mode]').forEach(btn => {
                btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
            });
        });

        this.levelEditor.setOnSelectionChange((entity) => {
            this.updatePropertyPanel(entity);
        });

        this.levelEditor.setOnValidation((report) => {
            this.updateValidationResults(report);
            this.updateStats(report);
        });
    }

    private setEditorMode(mode: EditorMode): void {
        this.levelEditor.setMode(mode);
        const modeNames: Record<EditorMode, string> = {
            select: '选择/移动',
            addNode: '添加节点',
            addGear: '添加齿轮',
            addSpring: '添加弹簧',
            addConveyor: '添加传送带',
            addGoal: '添加目标',
            addBall: '添加小球',
            addEdge: '添加连接线',
            test: '测试'
        };
        this.updateStatus(`模式: ${modeNames[mode]}`);
    }

    private updatePropertyPanel(entity: Entity | null): void {
        if (!this.propertyPanel) return;

        if (!entity) {
            this.propertyPanel.innerHTML = '<div class="no-selection">选择一个元素来编辑属性</div>';
            return;
        }

        let html = `<div style="margin-bottom:10px;font-weight:bold;color:#e94560;">实体 #${entity.id}</div>`;

        const pos = entity.getComponent<Position>('Position');
        const node = entity.getComponent<Node>('Node');
        const gear = entity.getComponent<Gear>('Gear');
        const rb = entity.getComponent<RigidBody>('RigidBody');
        const goal = entity.getComponent<Goal>('Goal');

        if (pos) {
            html += `
                <div class="property-item">
                    <label>X坐标</label>
                    <input type="number" value="${Math.round(pos.x)}" 
                        onchange="window.game.setEntityPosition(${entity.id}, 'x', parseFloat(this.value))">
                </div>
                <div class="property-item">
                    <label>Y坐标</label>
                    <input type="number" value="${Math.round(pos.y)}"
                        onchange="window.game.setEntityPosition(${entity.id}, 'y', parseFloat(this.value))">
                </div>
            `;
        }

        if (node) {
            html += `
                <div class="property-checkbox">
                    <input type="checkbox" ${node.isPowerSource ? 'checked' : ''}
                        onchange="window.game.toggleNodeProperty(${entity.id}, 'isPowerSource')">
                    <label>动力源</label>
                </div>
                <div class="property-checkbox">
                    <input type="checkbox" ${node.isFixed ? 'checked' : ''}
                        onchange="window.game.toggleNodeProperty(${entity.id}, 'isFixed')">
                    <label>固定位置</label>
                </div>
            `;
        }

        if (gear) {
            html += `
                <div class="property-item">
                    <label>半径</label>
                    <input type="number" value="${gear.radius}" min="20" max="80"
                        onchange="window.game.setGearProperty(${entity.id}, 'radius', parseFloat(this.value))">
                </div>
                <div class="property-item">
                    <label>转速</label>
                    <input type="number" value="${gear.motorSpeed}" step="0.5"
                        onchange="window.game.setGearProperty(${entity.id}, 'motorSpeed', parseFloat(this.value))">
                </div>
                <div class="property-checkbox">
                    <input type="checkbox" ${gear.isMotor ? 'checked' : ''}
                        onchange="window.game.toggleGearProperty(${entity.id}, 'isMotor')">
                    <label>电机</label>
                </div>
            `;
        }

        if (rb && !node) {
            html += `
                <div class="property-item">
                    <label>质量</label>
                    <input type="number" value="${rb.mass}" step="0.1" min="0.1"
                        onchange="window.game.setRigidBodyProperty(${entity.id}, 'mass', parseFloat(this.value))">
                </div>
                <div class="property-item">
                    <label>半径</label>
                    <input type="number" value="${rb.radius}" min="5" max="50"
                        onchange="window.game.setRigidBodyProperty(${entity.id}, 'radius', parseFloat(this.value))">
                </div>
            `;
        }

        if (goal) {
            html += `
                <div class="property-item">
                    <label>触发类型</label>
                    <select onchange="window.game.setGoalProperty(${entity.id}, 'triggerType', this.value)">
                        <option value="ball" ${goal.triggerType === 'ball' ? 'selected' : ''}>小球</option>
                        <option value="position" ${goal.triggerType === 'position' ? 'selected' : ''}>位置</option>
                        <option value="rotation" ${goal.triggerType === 'rotation' ? 'selected' : ''}>旋转</option>
                    </select>
                </div>
            `;
        }

        this.propertyPanel.innerHTML = html;
    }

    private updateValidationResults(report: ValidationReport): void {
        if (!this.validationResults) return;

        if (report.issues.length === 0) {
            this.validationResults.innerHTML = `
                <div style="background:rgba(34,197,94,0.2);padding:10px;border-radius:6px;text-align:center;color:#4ade80;">
                    ✅ 校验通过！关卡看起来没问题
                </div>
            `;
            return;
        }

        const html = report.issues.map(issue => `
            <div class="validation-item ${issue.type}">
                <strong>${this.getIssueIcon(issue.type)}</strong>
                ${issue.message}
            </div>
        `).join('');

        this.validationResults.innerHTML = html;
    }

    private getIssueIcon(type: string): string {
        switch (type) {
            case 'error': return '❌';
            case 'warning': return '⚠️';
            case 'info': return 'ℹ️';
            default: return '•';
        }
    }

    private updateStats(report: ValidationReport): void {
        const stats = report.stats;
        const statNodes = document.getElementById('statNodes');
        const statGears = document.getElementById('statGears');
        const statGoals = document.getElementById('statGoals');
        const statBalls = document.getElementById('statBalls');

        if (statNodes) statNodes.textContent = stats.totalNodes.toString();
        if (statGears) statGears.textContent = stats.gears.toString();
        if (statGoals) statGoals.textContent = stats.goals.toString();
        if (statBalls) statBalls.textContent = stats.balls.toString();
    }

    public setEntityPosition(entityId: number, axis: 'x' | 'y', value: number): void {
        const entity = this.world.getEntity(entityId);
        if (entity) {
            const pos = entity.getComponent<Position>('Position');
            if (pos) {
                pos[axis] = value;
                const rb = entity.getComponent<RigidBody>('RigidBody');
                if (rb) {
                    rb.prevX = pos.x;
                    rb.prevY = pos.y;
                }
            }
        }
    }

    public toggleNodeProperty(entityId: number, property: 'isPowerSource' | 'isFixed'): void {
        const entity = this.world.getEntity(entityId);
        if (entity) {
            this.levelEditor.setEntityProperty(entityId, 'Node', property, 
                !entity.getComponent<Node>('Node')?.[property]);
            this.topologySystem.invalidate();
        }
    }

    public setGearProperty(entityId: number, property: 'radius' | 'motorSpeed', value: number): void {
        this.levelEditor.setEntityProperty(entityId, 'Gear', property, value);
    }

    public toggleGearProperty(entityId: number, property: 'isMotor'): void {
        const entity = this.world.getEntity(entityId);
        if (entity) {
            this.levelEditor.setEntityProperty(entityId, 'Gear', property,
                !entity.getComponent<Gear>('Gear')?.[property]);
        }
    }

    public setRigidBodyProperty(entityId: number, property: 'mass' | 'radius', value: number): void {
        this.levelEditor.setEntityProperty(entityId, 'RigidBody', property, value);
    }

    public setGoalProperty(entityId: number, property: 'triggerType', value: string): void {
        this.levelEditor.setEntityProperty(entityId, 'Goal', property, value);
    }

    private enterEditorMode(): void {
        this.isEditorMode = true;
        this.physicsSystem.enabled = true;
        this.topologyValidator.setEnabled(true);
        this.levelEditor.clearLevel();
        
        document.getElementById('editorModeBtn')?.classList.add('active');
        document.querySelectorAll('#levelSelector .level-btn[data-level]').forEach(b => b.classList.remove('active'));
        
        if (this.modeIndicator) {
            this.modeIndicator.textContent = '✏️ 编辑模式';
            this.modeIndicator.classList.remove('test-mode');
        }
        
        document.getElementById('editorSidebar')?.removeAttribute('style');
        (document.querySelector('.right-sidebar') as HTMLElement)?.removeAttribute('style');
        
        this.updateStatus('编辑器模式 - 点击画布添加元素');
    }

    private loadGameLevel(levelId: number): void {
        this.isEditorMode = false;
        this.topologyValidator.setEnabled(false);
        
        document.getElementById('editorModeBtn')?.classList.remove('active');
        document.querySelectorAll('#levelSelector .level-btn[data-level]').forEach(b => {
            b.classList.toggle('active', parseInt((b as HTMLElement).dataset.level || '0') === levelId);
        });
        
        (document.getElementById('editorSidebar') as HTMLElement).style.display = 'none';
        (document.querySelector('.right-sidebar') as HTMLElement).style.display = 'none';
        
        if (this.modeIndicator) {
            this.modeIndicator.textContent = '🎮 游戏模式';
            this.modeIndicator.classList.remove('test-mode');
        }

        const level = this.levelManager.loadLevel(levelId);
        if (level) {
            if (this.levelTitleElement) {
                this.levelTitleElement.textContent = `关卡 ${level.id}: ${level.name}`;
            }
            if (this.levelDescElement) {
                this.levelDescElement.textContent = level.description;
            }
            this.updateStatus(level.hint);
        }
    }

    private setupKeyboardShortcuts(): void {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                this.redo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (this.isEditorMode) {
                    this.levelEditor.downloadLevelJSON('my-level');
                } else {
                    this.saveGame();
                }
            }
            if (e.key === 'Escape') {
                if (this.isEditorMode) {
                    this.setEditorMode('select');
                }
            }
        });
    }

    private undo(): void {
        if (this.undoRedoSystem.undo()) {
            this.topologySystem.invalidate();
            this.updateStatus('已撤销');
        }
    }

    private redo(): void {
        if (this.undoRedoSystem.redo()) {
            this.topologySystem.invalidate();
            this.updateStatus('已重做');
        }
    }

    private saveGame(): void {
        const level = this.levelManager.getCurrentLevel();
        const filename = level ? `topology_level${level.id}_save.json` : 'topology_save.json';
        this.serializationSystem.saveToFile(filename);
        this.updateStatus('游戏已保存');
    }

    private updateStatus(text: string): void {
        if (this.statusElement) {
            this.statusElement.textContent = `状态：${text}`;
        }
    }

    private checkWinCondition(): boolean {
        if (this.isEditorMode) return false;
        
        const goals = this.world.query(['Goal']);
        if (goals.length === 0) return false;

        const allReached = goals.every(entity => {
            const goal = entity.getComponent<Goal>('Goal');
            return goal?.isReached ?? false;
        });

        return allReached;
    }

    private update(deltaTime: number): void {
        this.world.update(deltaTime);

        if (this.isEditorMode) {
            this.renderSystem.mouseX = this.levelEditor.getMousePosition().x;
            this.renderSystem.mouseY = this.levelEditor.getMousePosition().y;

            if (this.levelEditor.isEdgeCreationActive()) {
                const edgeState = this.levelEditor.getEdgeCreationState();
                this.renderSystem.edgeCreationActive = true;
                this.renderSystem.edgeCreationStart = { x: edgeState.startX, y: edgeState.startY };
            } else {
                this.renderSystem.edgeCreationActive = false;
                this.renderSystem.edgeCreationStart = null;
            }

            const selected = this.levelEditor.getSelectedEntity();
            this.renderSystem.selectedNodeId = selected?.hasComponent('Node') ? selected.id : null;
        }

        if (!this.isEditorMode && this.checkWinCondition()) {
            this.updateStatus('🎉 恭喜过关！');
        }
    }

    private gameLoop = (timestamp: number): void => {
        if (!this.isRunning) return;

        const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 1 / 30);
        this.lastTime = timestamp;

        this.update(deltaTime);

        requestAnimationFrame(this.gameLoop);
    };

    public start(): void {
        this.lastTime = performance.now();
        requestAnimationFrame(this.gameLoop);
        console.log('🎮 拓扑物理解谜游戏已启动！');
    }

    public stop(): void {
        this.isRunning = false;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    try {
        const game = new Game();
        (window as any).game = game;
        game.start();
    } catch (error) {
        console.error('游戏启动失败:', error);
    }
});
