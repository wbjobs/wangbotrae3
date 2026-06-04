import { World } from '../ecs/World.js';
import { LevelData, createNode, createGear, createBall, createGoal, createEdge } from './Level.js';

export const Level3: LevelData = {
    id: 3,
    name: '齿轮传动',
    description: '构建齿轮传动链，让最后的齿轮旋转到正确位置！',
    hint: '连接节点使所有齿轮获得动力，注意观察齿轮旋转方向。',
    build: (world: World) => {
        const powerNode = createNode(world, 100, 300, true, true);
        
        const gear1 = createGear(world, 250, 300, 45, true, false);
        const gear2 = createGear(world, 375, 300, 35);
        const gear3 = createGear(world, 480, 300, 50);
        const gear4 = createGear(world, 610, 300, 30);

        createEdge(world, powerNode, gear1, false);

        createNode(world, 250, 150, true);
        createNode(world, 375, 150, true);
        createNode(world, 480, 150, true);
        createNode(world, 610, 150, true);

        createNode(world, 250, 450, true);
        createNode(world, 375, 450, true);
        createNode(world, 480, 450, true);
        createNode(world, 610, 450, true);

        const goal = createGoal(world, 780, 300, 40, 'rotation', gear4);
        const goalEntity = world.getEntity(goal)!;
        const goalComp = goalEntity.getComponent('Goal') as any;
        goalComp.targetAngle = Math.PI / 2;
        goalComp.tolerance = 0.3;
    }
};
