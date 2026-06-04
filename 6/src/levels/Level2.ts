import { World } from '../ecs/World.js';
import { LevelData, createNode, createGear, createBall, createGoal, createEdge, createConveyor } from './Level.js';

export const Level2: LevelData = {
    id: 2,
    name: '桥梁 - 拓扑通路',
    description: '通过连接节点构建桥梁，让小球从左侧滚到右侧终点！',
    hint: '连接中间的节点形成一条通路，激活它们。',
    build: (world: World) => {
        const powerNode = createNode(world, 100, 400, true, true);
        const node1 = createNode(world, 250, 400, true);
        const node2 = createNode(world, 400, 400, true);
        const node3 = createNode(world, 550, 400, true);
        const node4 = createNode(world, 700, 400, true);

        createEdge(world, powerNode, node1, false);

        createNode(world, 325, 300, true);
        createNode(world, 475, 300, true);
        createNode(world, 625, 300, true);

        createBall(world, 100, 100, 15, 1);
        createGoal(world, 800, 400, 35, 'ball');
    }
};
