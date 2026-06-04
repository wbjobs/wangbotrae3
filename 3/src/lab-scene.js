import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class LabScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.labObjects = {};
    this.liquidMeshes = {};
    this.particles = [];
    this.clock = new THREE.Clock();
    this.animationCallbacks = [];

    this._init();
  }

  _init() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    this.camera.position.set(0, 4, 6);
    this.camera.lookAt(0, 1, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 15;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.target.set(0, 1, 0);

    this._setupLighting();
    this._createLabTable();
    this._createBeaker();
    this._createTestTube();
    this._createAlcoholLamp();
    this._createStirringRod();
    this._createFloor();
    this._setupEnvironment();

    window.addEventListener('resize', () => this._onResize());
    this._animate();
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    const mainLight = new THREE.DirectionalLight(0xfff5e6, 1.5);
    mainLight.position.set(5, 8, 4);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 25;
    mainLight.shadow.camera.left = -6;
    mainLight.shadow.camera.right = 6;
    mainLight.shadow.camera.top = 6;
    mainLight.shadow.camera.bottom = -6;
    this.scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x4466aa, 0.4);
    fillLight.position.set(-3, 4, -2);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x6688ff, 0.5, 15);
    rimLight.position.set(-4, 3, 5);
    this.scene.add(rimLight);
  }

  _createFloor() {
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  _createLabTable() {
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3e,
      roughness: 0.3,
      metalness: 0.7,
    });

    const topGeo = new THREE.BoxGeometry(4, 0.1, 2.5);
    const top = new THREE.Mesh(topGeo, tableMat);
    top.position.y = 1.0;
    top.receiveShadow = true;
    top.castShadow = true;
    this.scene.add(top);

    const legMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4e,
      roughness: 0.5,
      metalness: 0.6,
    });

    const legPositions = [
      [-1.8, 0.5, -1.05], [1.8, 0.5, -1.05],
      [-1.8, 0.5, 1.05], [1.8, 0.5, 1.05],
    ];
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8);
    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(...pos);
      leg.castShadow = true;
      this.scene.add(leg);
    });

    const gridHelper = new THREE.GridHelper(3.5, 14, 0x3a3a5e, 0x2a2a3e);
    gridHelper.position.y = 1.06;
    this.scene.add(gridHelper);
  }

  _createBeaker() {
    const group = new THREE.Group();

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef4ff,
      transparent: true,
      opacity: 0.25,
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.9,
      thickness: 0.05,
      side: THREE.DoubleSide,
    });

    const outerGeo = new THREE.CylinderGeometry(0.55, 0.5, 1.2, 32, 1, true);
    const outer = new THREE.Mesh(outerGeo, glassMat);
    outer.position.y = 1.65;
    outer.castShadow = true;
    group.add(outer);

    const rimGeo = new THREE.TorusGeometry(0.55, 0.02, 8, 32);
    const rim = new THREE.Mesh(rimGeo, glassMat.clone());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 2.25;
    group.add(rim);

    const spoutGeo = new THREE.ConeGeometry(0.12, 0.2, 8, 1, true);
    const spout = new THREE.Mesh(spoutGeo, glassMat.clone());
    spout.position.set(0.55, 2.2, 0);
    spout.rotation.z = -Math.PI / 4;
    group.add(spout);

    const bottomGeo = new THREE.CircleGeometry(0.5, 32);
    const bottom = new THREE.Mesh(bottomGeo, glassMat.clone());
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 1.05;
    group.add(bottom);

    const liquidGeo = new THREE.CylinderGeometry(0.52, 0.48, 0.01, 32);
    const liquidMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef4ff,
      transparent: true,
      opacity: 0.6,
      roughness: 0.1,
      metalness: 0.0,
      transmission: 0.3,
      side: THREE.DoubleSide,
    });
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = 1.06;
    group.add(liquid);
    this.liquidMeshes.beaker = liquid;

    const graduationMat = new THREE.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.4 });
    for (let i = 1; i <= 5; i++) {
      const y = 1.05 + i * 0.2;
      const w = 0.5 + i * 0.008;
      const points = [new THREE.Vector3(-w, y, 0.5), new THREE.Vector3(-w + 0.08, y, 0.5)];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      group.add(new THREE.Line(lineGeo, graduationMat));
    }

    this.labObjects.beaker = group;
    this.scene.add(group);
  }

  _createTestTube() {
    const group = new THREE.Group();

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef4ff,
      transparent: true,
      opacity: 0.2,
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.92,
      thickness: 0.02,
      side: THREE.DoubleSide,
    });

    const tubeGeo = new THREE.CylinderGeometry(0.12, 0.1, 1.0, 16, 1, true);
    const tube = new THREE.Mesh(tubeGeo, glassMat);
    tube.position.y = 0.5;
    group.add(tube);

    const bottomGeo = new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bottom = new THREE.Mesh(bottomGeo, glassMat.clone());
    bottom.position.y = 0.0;
    group.add(bottom);

    const rimGeo = new THREE.TorusGeometry(0.12, 0.01, 6, 16);
    const rim = new THREE.Mesh(rimGeo, glassMat.clone());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.0;
    group.add(rim);

    const liquidGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.01, 16);
    const liquidMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef4ff,
      transparent: true,
      opacity: 0.5,
      roughness: 0.1,
      transmission: 0.3,
      side: THREE.DoubleSide,
    });
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = 0.02;
    group.add(liquid);
    this.liquidMeshes.testTube = liquid;

    group.position.set(1.2, 1.05, 0.3);
    group.rotation.z = Math.PI / 12;
    this.labObjects.testTube = group;
    this.scene.add(group);
  }

  _createAlcoholLamp() {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a,
      roughness: 0.4,
      metalness: 0.3,
    });

    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.35, 16);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.175;
    group.add(body);

    const capGeo = new THREE.CylinderGeometry(0.08, 0.15, 0.1, 16);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.4;
    group.add(cap);

    const wickGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4);
    const wickMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const wick = new THREE.Mesh(wickGeo, wickMat);
    wick.position.y = 0.5;
    group.add(wick);

    const flameMat = new THREE.MeshPhysicalMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.0,
      emissive: 0xff4400,
      emissiveIntensity: 0,
      roughness: 1,
    });
    const flameInnerGeo = new THREE.ConeGeometry(0.04, 0.25, 8);
    const flameInner = new THREE.Mesh(flameInnerGeo, flameMat);
    flameInner.position.y = 0.63;
    group.add(flameInner);
    this.labObjects.flameInner = flameInner;
    this.labObjects.flameInnerMat = flameMat;

    const flameOuterGeo = new THREE.ConeGeometry(0.06, 0.35, 8);
    const flameOuterMat = new THREE.MeshPhysicalMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.0,
      emissive: 0xff6600,
      emissiveIntensity: 0,
      roughness: 1,
    });
    const flameOuter = new THREE.Mesh(flameOuterGeo, flameOuterMat);
    flameOuter.position.y = 0.66;
    group.add(flameOuter);
    this.labObjects.flameOuter = flameOuter;
    this.labObjects.flameOuterMat = flameOuterMat;

    const flameLight = new THREE.PointLight(0xff6600, 0, 3);
    flameLight.position.y = 0.7;
    group.add(flameLight);
    this.labObjects.flameLight = flameLight;

    group.position.set(-0.5, 1.05, 0.8);
    this.labObjects.alcoholLamp = group;
    this.scene.add(group);
  }

  _createStirringRod() {
    const group = new THREE.Group();
    const rodGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.5, 6);
    const rodMat = new THREE.MeshPhysicalMaterial({
      color: 0xeeeeff,
      transparent: true,
      opacity: 0.6,
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.5,
    });
    const rod = new THREE.Mesh(rodGeo, rodMat);
    rod.position.y = 0.75;
    group.add(rod);

    group.position.set(0.3, 1.05, -0.3);
    group.rotation.z = Math.PI / 20;
    this.labObjects.stirringRod = group;
    this.scene.add(group);
  }

  _setupEnvironment() {
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.FogExp2(0x0a0a1a, 0.04);
  }

  updateLiquid(state) {
    const volume = state.volume_ml || 0;
    const color = state.color || [0.9, 0.95, 1.0];

    if (this.liquidMeshes.beaker) {
      const maxVolume = 300;
      const fillRatio = Math.min(volume / maxVolume, 1.0);
      const liquidHeight = Math.max(fillRatio * 1.1, 0.01);

      const geo = new THREE.CylinderGeometry(
        0.52 - (1 - fillRatio) * 0.02,
        0.48,
        liquidHeight,
        32
      );
      this.liquidMeshes.beaker.geometry.dispose();
      this.liquidMeshes.beaker.geometry = geo;
      this.liquidMeshes.beaker.position.y = 1.05 + liquidHeight / 2;

      this.liquidMeshes.beaker.material.color.setRGB(color[0], color[1], color[2]);
      this.liquidMeshes.beaker.material.opacity = fillRatio > 0.01 ? 0.6 : 0;
    }

    if (this.liquidMeshes.testTube) {
      const fillRatio = Math.min(volume / 150, 1.0);
      const liquidHeight = Math.max(fillRatio * 0.8, 0.01);
      const geo = new THREE.CylinderGeometry(0.1, 0.08, liquidHeight, 16);
      this.liquidMeshes.testTube.geometry.dispose();
      this.liquidMeshes.testTube.geometry = geo;
      this.liquidMeshes.testTube.position.y = 0.02 + liquidHeight / 2;
      this.liquidMeshes.testTube.material.color.setRGB(color[0], color[1], color[2]);
    }
  }

  updatePrecipitate(state) {
    const grams = state.precipitate_grams || 0;
    const color = state.precipitate_color || [1, 1, 1];

    if (this.labObjects.beaker) {
      let precipMesh = this.labObjects.beaker.getObjectByName('precipitate');
      if (grams > 0.1) {
        const height = Math.min(grams * 0.05, 0.3);
        if (!precipMesh) {
          const geo = new THREE.CylinderGeometry(0.47, 0.47, height, 32);
          const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(color[0], color[1], color[2]),
            roughness: 0.8,
            metalness: 0.0,
            transparent: true,
            opacity: 0.85,
          });
          precipMesh = new THREE.Mesh(geo, mat);
          precipMesh.name = 'precipitate';
          this.labObjects.beaker.add(precipMesh);
        } else {
          const geo = new THREE.CylinderGeometry(0.47, 0.47, height, 32);
          precipMesh.geometry.dispose();
          precipMesh.geometry = geo;
          precipMesh.material.color.setRGB(color[0], color[1], color[2]);
        }
        precipMesh.position.y = 1.05 + height / 2;
      } else if (precipMesh) {
        this.labObjects.beaker.remove(precipMesh);
        precipMesh.geometry.dispose();
        precipMesh.material.dispose();
      }
    }
  }

  setHeating(active) {
    const duration = 0.5;
    const targetOpacity = active ? 0.7 : 0.0;
    const targetEmissive = active ? 2.0 : 0.0;
    const targetLightIntensity = active ? 2.0 : 0.0;

    if (this.labObjects.flameInnerMat) {
      this.labObjects.flameInnerMat.opacity = targetOpacity;
      this.labObjects.flameInnerMat.emissiveIntensity = targetEmissive;
    }
    if (this.labObjects.flameOuterMat) {
      this.labObjects.flameOuterMat.opacity = targetOpacity * 0.5;
      this.labObjects.flameOuterMat.emissiveIntensity = targetEmissive * 0.8;
    }
    if (this.labObjects.flameLight) {
      this.labObjects.flameLight.intensity = targetLightIntensity;
    }
  }

  setStirring(active) {
    this._isStirring = active;
  }

  createReagentBottle(name, color, position) {
    const group = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef4ff,
      transparent: true,
      opacity: 0.3,
      roughness: 0.05,
      transmission: 0.8,
      side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.25;
    group.add(body);

    const liqGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.35, 8);
    const liqMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color[0], color[1], color[2]),
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
      transmission: 0.2,
    });
    const liq = new THREE.Mesh(liqGeo, liqMat);
    liq.position.y = 0.2;
    group.add(liq);

    const capGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.12, 8);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x666688, roughness: 0.3, metalness: 0.5 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.56;
    group.add(cap);

    group.position.copy(position);
    group.userData = { name, isReagentBottle: true };

    this.scene.add(group);
    return group;
  }

  createPourAnimation(fromPos, toPos, color) {
    const particleCount = 30;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = fromPos.x + (Math.random() - 0.5) * 0.05;
      positions[i * 3 + 1] = fromPos.y - (i / particleCount) * (fromPos.y - toPos.y);
      positions[i * 3 + 2] = fromPos.z + (Math.random() - 0.5) * 0.05;
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.002,
        -0.02 - Math.random() * 0.01,
        (Math.random() - 0.5) * 0.002
      ));
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: new THREE.Color(color[0], color[1], color[2]),
      size: 0.03,
      transparent: true,
      opacity: 0.8,
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData = { velocities, lifetime: 2.0, age: 0 };
    this.scene.add(particles);
    this.particles.push(particles);

    return particles;
  }

  createBubbles() {
    const bubbleCount = 20;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(bubbleCount * 3);
    const velocities = [];

    for (let i = 0; i < bubbleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.4;
      positions[i * 3 + 1] = 1.1 + Math.random() * 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.003,
        0.01 + Math.random() * 0.02,
        (Math.random() - 0.5) * 0.003
      ));
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.025,
      transparent: true,
      opacity: 0.5,
    });

    const bubbles = new THREE.Points(geometry, material);
    bubbles.userData = { velocities, lifetime: 3.0, age: 0 };
    this.scene.add(bubbles);
    this.particles.push(bubbles);

    return bubbles;
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.controls.update();

    if (this.labObjects.flameInner && this.labObjects.flameInnerMat.opacity > 0) {
      this.labObjects.flameInner.scale.x = 1 + Math.sin(elapsed * 10) * 0.15;
      this.labObjects.flameInner.scale.z = 1 + Math.cos(elapsed * 8) * 0.1;
      this.labObjects.flameInner.position.y = 0.63 + Math.sin(elapsed * 12) * 0.005;

      this.labObjects.flameOuter.scale.x = 1 + Math.sin(elapsed * 7 + 1) * 0.2;
      this.labObjects.flameOuter.scale.z = 1 + Math.cos(elapsed * 9 + 2) * 0.15;

      if (this.labObjects.flameLight) {
        this.labObjects.flameLight.intensity = 2.0 + Math.sin(elapsed * 15) * 0.3;
      }
    }

    if (this._isStirring && this.labObjects.stirringRod) {
      this.labObjects.stirringRod.rotation.y += delta * 3;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.userData.age += delta;

      if (p.userData.age >= p.userData.lifetime) {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      const positions = p.geometry.attributes.position.array;
      const vels = p.userData.velocities;
      for (let j = 0; j < vels.length; j++) {
        positions[j * 3] += vels[j].x;
        positions[j * 3 + 1] += vels[j].y;
        positions[j * 3 + 2] += vels[j].z;
      }
      p.geometry.attributes.position.needsUpdate = true;
      p.material.opacity = 0.8 * (1 - p.userData.age / p.userData.lifetime);
    }

    for (const cb of this.animationCallbacks) {
      cb(delta, elapsed);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  getRaycaster() {
    return new THREE.Raycaster();
  }

  getMouseNDC(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }
}
