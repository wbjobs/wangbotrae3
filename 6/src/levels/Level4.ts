import { World } from '../ecs/World.js';
import { LevelData, createNode, createSpring, createBall, createGoal, createEdge } from './Level.js';

export const Level4: LevelData = {
    id: 4,
    name: '弹簧机关',
    description: '利用弹簧和拓扑连接，将小球弹到高处的终点！',
    hint: '连接节点激活弹簧，让弹簧把小球弹起来。',
    build: (world: World) => {
        const powerNode = createNode(world, 150, 500, true, true);
        const springBase = createNode(world, 350, 500, true);
        const springTop = createNode(world, 350, 350, true);
        
        createEdge(world, powerNode, springBase, false);
        createSpring(world, springBase, springTop, 100, 0.6);

        createNode(world, 250, 350, true);
        createNode(world, 450, 350, true);
        
        const platform1 = createNode(world, 550, 350, true);
        const platform2 = createNode(world, 650, 250, true);
        const platform3 = createNode(world, 750, 150, true);

        createNode(world, 500, 250, true);
        createNode(world, 600, 150, true);

        createBall(world, 350, 200, 18, 1.5);
        createGoal(world, 780, 100, 35, 'ball');
    }
};
