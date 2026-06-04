import { Position } from './Position.js';
import { Node } from './Node.js';
import { Edge } from './Edge.js';
import { Gear } from './Gear.js';
import { Spring } from './Spring.js';
import { Conveyor } from './Conveyor.js';
import { RigidBody } from './RigidBody.js';
import { Goal } from './Goal.js';
import { Render } from './Render.js';

export const componentRegistry = new Map<string, new (...args: any[]) => any>();

componentRegistry.set('Position', Position);
componentRegistry.set('Node', Node);
componentRegistry.set('Edge', Edge);
componentRegistry.set('Gear', Gear);
componentRegistry.set('Spring', Spring);
componentRegistry.set('Conveyor', Conveyor);
componentRegistry.set('RigidBody', RigidBody);
componentRegistry.set('Goal', Goal);
componentRegistry.set('Render', Render);
