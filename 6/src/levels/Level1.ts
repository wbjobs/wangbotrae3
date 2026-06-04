import { World } from '../ecs/World.js';
import { LevelData, createNode, createGear, createBall, createGoal, createEdge, createConveyor } from './Level.js';

export const Level1: LevelData = {
    id: 1,
    name: '入门 - 电力连接',
    description: '连接电源节点到齿轮，激活电机让小球滚入终点！',
    hint: '点击黄色电源节点，再点击橙色齿轮节点创建连接。',
    build: (world: World) => {
        const powerNode = createNode(world, 150, 300, true, true);
        const gearNode = createGear(world, 400, 300, 50, true);
        createEdge(world, powerNode, gearNode, false);

        createNode(world, 600, 200, true);
        createNode(world, 750, 200, true);
        createNode(world, 750, 400, true);

        createBall(world, 600, 100, 18, 1);
        createGoal(world, 750, 520, 35, 'ball');
    }
};
