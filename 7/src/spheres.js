export const MATERIAL_TYPE = {
    METAL: 0,
    GLASS: 1,
    EMISSIVE: 2
};

export const COLORS = [
    { name: 'red', rgb: [1.0, 0.2, 0.2] },
    { name: 'blue', rgb: [0.2, 0.4, 1.0] },
    { name: 'green', rgb: [0.2, 1.0, 0.4] },
    { name: 'yellow', rgb: [1.0, 0.9, 0.2] },
    { name: 'purple', rgb: [0.8, 0.3, 1.0] },
    { name: 'cyan', rgb: [0.2, 0.9, 1.0] },
    { name: 'orange', rgb: [1.0, 0.5, 0.1] },
    { name: 'pink', rgb: [1.0, 0.4, 0.7] }
];

export const MATERIALS = [
    {
        type: MATERIAL_TYPE.METAL,
        name: 'metal',
        metalness: 1.0,
        roughness: 0.1,
        emissiveIntensity: 0.0,
        ior: 1.5
    },
    {
        type: MATERIAL_TYPE.GLASS,
        name: 'glass',
        metalness: 0.0,
        roughness: 0.02,
        emissiveIntensity: 0.0,
        ior: 1.52
    },
    {
        type: MATERIAL_TYPE.EMISSIVE,
        name: 'emissive',
        metalness: 0.0,
        roughness: 0.8,
        emissiveIntensity: 2.5,
        ior: 1.0
    }
];

export class Sphere {
    constructor(x, y, z, radius, color, material, gridX, gridY) {
        this.position = [x, y, z];
        this.targetPosition = [x, y, z];
        this.radius = radius;
        this.baseRadius = radius;
        this.color = color;
        this.material = material;
        this.materialType = material.type;
        this.metalness = material.metalness;
        this.roughness = material.roughness;
        this.emissiveIntensity = material.emissiveIntensity;
        this.ior = material.ior;
        
        this.gridX = gridX;
        this.gridY = gridY;
        this.targetGridX = gridX;
        this.targetGridY = gridY;
        
        this.active = true;
        this.scale = 1.0;
        this.targetScale = 1.0;
        this.rotation = [0, 0, 0];
        this.velocity = [0, 0, 0];
        
        this.animating = false;
        this.animTime = 0;
        this.animDuration = 0;
        this.animType = null;
        this.bobOffset = Math.random() * Math.PI * 2;
        
        this.selected = false;
        this.highlighted = false;
    }
    
    setTargetPosition(x, y, z) {
        this.targetPosition = [x, y, z];
    }
    
    setGridPosition(gx, gy) {
        this.targetGridX = gx;
        this.targetGridY = gy;
    }
    
    animateScale(target, duration) {
        this.targetScale = target;
        this.animating = true;
        this.animType = 'scale';
        this.animTime = 0;
        this.animDuration = duration;
    }
    
    animatePop(duration) {
        this.animating = true;
        this.animType = 'pop';
        this.animTime = 0;
        this.animDuration = duration;
    }
    
    animateSpawn(duration) {
        this.animating = true;
        this.animType = 'spawn';
        this.animTime = 0;
        this.animDuration = duration;
        this.scale = 0;
        this.targetScale = 1.0;
    }
    
    update(deltaTime, time) {
        const bobAmplitude = 0.15;
        const bobFrequency = 1.5;
        const bob = Math.sin(time * bobFrequency + this.bobOffset) * bobAmplitude;
        
        for (let i = 0; i < 3; i++) {
            const diff = this.targetPosition[i] - this.position[i];
            if (i === 1) {
                this.position[i] += (diff + bob - (this.position[i] - this.targetPosition[i])) * deltaTime * 8.0;
            } else {
                this.position[i] += diff * deltaTime * 8.0;
            }
        }
        
        const scaleDiff = this.targetScale - this.scale;
        this.scale += scaleDiff * deltaTime * 10.0;
        
        if (this.animating) {
            this.animTime += deltaTime;
            const t = Math.min(this.animTime / this.animDuration, 1.0);
            
            if (this.animType === 'pop') {
                const pop = Math.sin(t * Math.PI) * 0.3;
                this.scale = 1.0 + pop;
            } else if (this.animType === 'spawn') {
                const ease = t * t * (3 - 2 * t);
                this.scale = ease;
            }
            
            if (t >= 1.0) {
                this.animating = false;
                this.animType = null;
                this.scale = this.targetScale;
            }
        }
        
        this.gridX += (this.targetGridX - this.gridX) * deltaTime * 8.0;
        this.gridY += (this.targetGridY - this.gridY) * deltaTime * 8.0;
        
        this.rotation[0] += deltaTime * 0.3;
        this.rotation[1] += deltaTime * 0.5;
    }
    
    getEffectiveRadius() {
        return this.radius * this.scale;
    }
}

export class SphereManager {
    constructor() {
        this.spheres = [];
        this.gridSizeX = 8;
        this.gridSizeY = 6;
        this.sphereRadius = 0.5;
        this.spacing = 1.3;
        this.centerOffset = [
            -(this.gridSizeX - 1) * this.spacing / 2,
            -(this.gridSizeY - 1) * this.spacing / 2,
            0
        ];
    }
    
    createRandomSphere(gridX, gridY) {
        const color = COLORS[Math.floor(Math.random() * COLORS.length)].rgb;
        const material = MATERIALS[Math.floor(Math.random() * MATERIALS.length)];
        
        const worldX = gridX * this.spacing + this.centerOffset[0];
        const worldY = gridY * this.spacing + this.centerOffset[1];
        const worldZ = 0;
        
        const sphere = new Sphere(
            worldX + (Math.random() - 0.5) * 0.1,
            worldY + (Math.random() - 0.5) * 0.1,
            worldZ,
            this.sphereRadius,
            [...color],
            material,
            gridX,
            gridY
        );
        
        return sphere;
    }
    
    initBoard() {
        this.spheres = [];
        
        for (let y = 0; y < this.gridSizeY; y++) {
            for (let x = 0; x < this.gridSizeX; x++) {
                let sphere = this.createRandomSphere(x, y);
                
                while (this.createsInitialMatch(sphere, x, y)) {
                    sphere = this.createRandomSphere(x, y);
                }
                
                sphere.animateSpawn(0.5 + Math.random() * 0.3);
                this.spheres.push(sphere);
            }
        }
        
        return this.spheres;
    }
    
    createsInitialMatch(sphere, gridX, gridY) {
        const sameColorCountX = this.countSameColorInDirection(sphere, gridX, gridY, 1, 0) +
                                 this.countSameColorInDirection(sphere, gridX, gridY, -1, 0);
        const sameColorCountY = this.countSameColorInDirection(sphere, gridX, gridY, 0, 1) +
                                 this.countSameColorInDirection(sphere, gridX, gridY, 0, -1);
        
        const sameMatCountX = this.countSameMaterialInDirection(sphere, gridX, gridY, 1, 0) +
                               this.countSameMaterialInDirection(sphere, gridX, gridY, -1, 0);
        const sameMatCountY = this.countSameMaterialInDirection(sphere, gridX, gridY, 0, 1) +
                               this.countSameMaterialInDirection(sphere, gridX, gridY, 0, -1);
        
        return sameColorCountX >= 2 || sameColorCountY >= 2 ||
               sameMatCountX >= 2 || sameMatCountY >= 2;
    }
    
    countSameColorInDirection(sphere, startX, startY, dx, dy) {
        let count = 0;
        let x = startX + dx;
        let y = startY + dy;
        
        while (x >= 0 && x < this.gridSizeX && y >= 0 && y < this.gridSizeY) {
            const existing = this.getSphereAtGrid(x, y);
            if (existing && this.colorsMatch(sphere.color, existing.color)) {
                count++;
                x += dx;
                y += dy;
            } else {
                break;
            }
        }
        
        return count;
    }
    
    countSameMaterialInDirection(sphere, startX, startY, dx, dy) {
        let count = 0;
        let x = startX + dx;
        let y = startY + dy;
        
        while (x >= 0 && x < this.gridSizeX && y >= 0 && y < this.gridSizeY) {
            const existing = this.getSphereAtGrid(x, y);
            if (existing && existing.materialType === sphere.materialType) {
                count++;
                x += dx;
                y += dy;
            } else {
                break;
            }
        }
        
        return count;
    }
    
    colorsMatch(c1, c2) {
        const tolerance = 0.01;
        return Math.abs(c1[0] - c2[0]) < tolerance &&
               Math.abs(c1[1] - c2[1]) < tolerance &&
               Math.abs(c1[2] - c2[2]) < tolerance;
    }
    
    getSphereAtGrid(gridX, gridY) {
        return this.spheres.find(s => 
            Math.abs(s.targetGridX - gridX) < 0.1 && 
            Math.abs(s.targetGridY - gridY) < 0.1 && 
            s.active
        );
    }
    
    getIndexAtGrid(gridX, gridY) {
        return this.spheres.findIndex(s => 
            Math.abs(s.targetGridX - gridX) < 0.1 && 
            Math.abs(s.targetGridY - gridY) < 0.1 && 
            s.active
        );
    }
    
    swapSpheres(sphere1, sphere2) {
        const tempX = sphere1.targetGridX;
        const tempY = sphere1.targetGridY;
        const tempPos = [...sphere1.targetPosition];
        
        sphere1.setGridPosition(sphere2.targetGridX, sphere2.targetGridY);
        sphere1.setTargetPosition(...sphere2.targetPosition);
        
        sphere2.setGridPosition(tempX, tempY);
        sphere2.setTargetPosition(...tempPos);
    }
    
    removeSphere(sphere) {
        sphere.active = false;
        sphere.animateScale(0, 0.3);
        
        setTimeout(() => {
            const index = this.spheres.indexOf(sphere);
            if (index > -1) {
                this.spheres.splice(index, 1);
            }
        }, 300);
    }
    
    getWorldPosition(gridX, gridY) {
        return [
            gridX * this.spacing + this.centerOffset[0],
            gridY * this.spacing + this.centerOffset[1],
            0
        ];
    }
    
    update(deltaTime, time) {
        for (const sphere of this.spheres) {
            sphere.update(deltaTime, time);
        }
    }
    
    isPositionOccupied(gridX, gridY) {
        return this.spheres.some(s => 
            Math.abs(s.targetGridX - gridX) < 0.1 && 
            Math.abs(s.targetGridY - gridY) < 0.1 && 
            s.active
        );
    }
    
    getAllMatches() {
        const matches = [];
        const visited = new Set();
        
        for (let y = 0; y < this.gridSizeY; y++) {
            for (let x = 0; x < this.gridSizeX; x++) {
                const sphere = this.getSphereAtGrid(x, y);
                if (!sphere) continue;
                
                const key = `${x},${y}`;
                if (visited.has(key)) continue;
                
                const colorMatch = this.findColorMatch(sphere, x, y);
                if (colorMatch.length >= 3) {
                    matches.push({
                        type: 'color',
                        spheres: colorMatch,
                        color: sphere.color
                    });
                    colorMatch.forEach(s => visited.add(`${s.targetGridX},${s.targetGridY}`));
                    continue;
                }
                
                const materialMatch = this.findMaterialMatch(sphere, x, y);
                if (materialMatch.length >= 3) {
                    matches.push({
                        type: 'material',
                        spheres: materialMatch,
                        material: sphere.materialType
                    });
                    materialMatch.forEach(s => visited.add(`${s.targetGridX},${s.targetGridY}`));
                    continue;
                }
                
                const sequenceMatch = this.findSequenceMatch(x, y);
                if (sequenceMatch.length >= 3) {
                    matches.push({
                        type: 'sequence',
                        spheres: sequenceMatch
                    });
                    sequenceMatch.forEach(s => visited.add(`${s.targetGridX},${s.targetGridY}`));
                }
            }
        }
        
        return matches;
    }
    
    findColorMatch(startSphere, startX, startY) {
        const match = [startSphere];
        
        let x = startX + 1;
        while (x < this.gridSizeX) {
            const s = this.getSphereAtGrid(x, startY);
            if (s && this.colorsMatch(s.color, startSphere.color)) {
                match.push(s);
                x++;
            } else {
                break;
            }
        }
        
        if (match.length < 3) {
            match.length = 1;
            let y = startY + 1;
            while (y < this.gridSizeY) {
                const s = this.getSphereAtGrid(startX, y);
                if (s && this.colorsMatch(s.color, startSphere.color)) {
                    match.push(s);
                    y++;
                } else {
                    break;
                }
            }
        }
        
        return match.length >= 3 ? match : [];
    }
    
    findMaterialMatch(startSphere, startX, startY) {
        const match = [startSphere];
        
        let x = startX + 1;
        while (x < this.gridSizeX) {
            const s = this.getSphereAtGrid(x, startY);
            if (s && s.materialType === startSphere.materialType) {
                match.push(s);
                x++;
            } else {
                break;
            }
        }
        
        if (match.length < 3) {
            match.length = 1;
            let y = startY + 1;
            while (y < this.gridSizeY) {
                const s = this.getSphereAtGrid(startX, y);
                if (s && s.materialType === startSphere.materialType) {
                    match.push(s);
                    y++;
                } else {
                    break;
                }
            }
        }
        
        return match.length >= 3 ? match : [];
    }
    
    findSequenceMatch(startX, startY) {
        const sequence = [MATERIAL_TYPE.METAL, MATERIAL_TYPE.GLASS, MATERIAL_TYPE.EMISSIVE];
        
        const checkDirection = (dx, dy) => {
            const match = [];
            let seqIndex = 0;
            let x = startX;
            let y = startY;
            
            while (x >= 0 && x < this.gridSizeX && y >= 0 && y < this.gridSizeY && seqIndex < sequence.length) {
                const s = this.getSphereAtGrid(x, y);
                if (s && s.materialType === sequence[seqIndex]) {
                    match.push(s);
                    seqIndex++;
                    x += dx;
                    y += dy;
                } else {
                    break;
                }
            }
            
            return match.length >= 3 ? match : [];
        };
        
        let match = checkDirection(1, 0);
        if (match.length >= 3) return match;
        
        match = checkDirection(0, 1);
        if (match.length >= 3) return match;
        
        match = checkDirection(-1, 0);
        if (match.length >= 3) return match;
        
        match = checkDirection(0, -1);
        return match;
    }
    
    fillEmptySpaces() {
        const newSpheres = [];
        
        for (let x = 0; x < this.gridSizeX; x++) {
            let emptyCount = 0;
            
            for (let y = this.gridSizeY - 1; y >= 0; y--) {
                const sphere = this.getSphereAtGrid(x, y);
                if (!sphere) {
                    emptyCount++;
                } else if (emptyCount > 0) {
                    const newY = y + emptyCount;
                    const newPos = this.getWorldPosition(x, newY);
                    sphere.setGridPosition(x, newY);
                    sphere.setTargetPosition(...newPos);
                }
            }
            
            for (let i = 0; i < emptyCount; i++) {
                const newY = i;
                const spawnY = -1 - i * 0.5;
                const worldPos = this.getWorldPosition(x, newY);
                const spawnPos = [worldPos[0], spawnY * this.spacing + this.centerOffset[1], worldPos[2]];
                
                const newSphere = this.createRandomSphere(x, newY);
                newSphere.position = [...spawnPos];
                newSphere.targetPosition = [...worldPos];
                newSphere.animateSpawn(0.5 + Math.random() * 0.3);
                
                newSpheres.push(newSphere);
            }
        }
        
        this.spheres.push(...newSpheres);
        return newSpheres;
    }
    
    hasValidMoves() {
        for (let y = 0; y < this.gridSizeY; y++) {
            for (let x = 0; x < this.gridSizeX; x++) {
                const sphere = this.getSphereAtGrid(x, y);
                if (!sphere) continue;
                
                if (x < this.gridSizeX - 1) {
                    const neighbor = this.getSphereAtGrid(x + 1, y);
                    if (neighbor && this.wouldCreateMatch(sphere, neighbor)) {
                        return true;
                    }
                }
                
                if (y < this.gridSizeY - 1) {
                    const neighbor = this.getSphereAtGrid(x, y + 1);
                    if (neighbor && this.wouldCreateMatch(sphere, neighbor)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
    wouldCreateMatch(sphere1, sphere2) {
        const pos1 = { x: sphere1.targetGridX, y: sphere1.targetGridY };
        const pos2 = { x: sphere2.targetGridX, y: sphere2.targetGridY };
        
        const savedPos1 = { x: sphere1.targetGridX, y: sphere1.targetGridY, pos: [...sphere1.targetPosition] };
        const savedPos2 = { x: sphere2.targetGridX, y: sphere2.targetGridY, pos: [...sphere2.targetPosition] };
        
        sphere1.setGridPosition(pos2.x, pos2.y);
        sphere1.setTargetPosition(...this.getWorldPosition(pos2.x, pos2.y));
        sphere2.setGridPosition(pos1.x, pos1.y);
        sphere2.setTargetPosition(...this.getWorldPosition(pos1.x, pos1.y));
        
        const matches = this.getAllMatches();
        
        sphere1.setGridPosition(savedPos1.x, savedPos1.y);
        sphere1.setTargetPosition(...savedPos1.pos);
        sphere2.setGridPosition(savedPos2.x, savedPos2.y);
        sphere2.setTargetPosition(...savedPos2.pos);
        
        return matches.length > 0;
    }
    
    getAdjacentSpheres(sphere) {
        const adjacent = [];
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        
        for (const [dx, dy] of directions) {
            const nx = sphere.targetGridX + dx;
            const ny = sphere.targetGridY + dy;
            
            if (nx >= 0 && nx < this.gridSizeX && ny >= 0 && ny < this.gridSizeY) {
                const neighbor = this.getSphereAtGrid(nx, ny);
                if (neighbor && neighbor.active) {
                    adjacent.push(neighbor);
                }
            }
        }
        
        return adjacent;
    }
    
    areAdjacent(sphere1, sphere2) {
        const dx = Math.abs(sphere1.targetGridX - sphere2.targetGridX);
        const dy = Math.abs(sphere1.targetGridY - sphere2.targetGridY);
        return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
    }
}
