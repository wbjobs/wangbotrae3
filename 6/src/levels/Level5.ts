import { World } from '../ecs/World.js';
import { LevelData, createNode, createGear, createSpring, createBall, createGoal, createEdge, createConveyor } from './Level.js';

export const Level5: LevelData = {
    id: 5,
    name: '综合挑战',
    description: '运用所有学到的知识，通过齿轮、弹簧和传送带的组合，将小球送到终点！',
    hint: '先激活齿轮，再通过传送带运送，最后用弹簧弹到终点。',
    build: (world: World) => {
        const powerNode = createNode(world, 100, 200, true, true);
        
        const gear1 = createGear(world, 250, 200, 40, true);
        const gear2 = createGear(world, 360, 200, 30);
        
        createEdge(world, powerNode, gear1, false);

        const conveyor = createConveyor(world, 450, 350, 200, 20, true);
        const conveyorNode = createNode(world, 360, 350, true);

        createNode(world, 250, 350, true);

        const springBase = createNode(world, 700, 450, true);
        const springTop = createNode(world, 700, 300, true);
        createSpring(world, springBase, springTop, 120, 0.5);

        createNode(world, 600, 300, true);
        createNode(world, 800, 300, true);
        createNode(world, 700, 150, true);

        createBall(world, 250, 50, 16, 1.2);
        createGoal(world, 800, 100, 40, 'ball');
    }
};
