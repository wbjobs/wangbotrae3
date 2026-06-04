import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import PointCloud from './PointCloud';
import { useProjectStore } from '@/stores/useProjectStore';
import * as THREE from 'three';

interface SceneProps {
  projectId: string;
  annotationMode: boolean;
}

export default function Scene({ projectId, annotationMode }: SceneProps) {
  const { clipping } = useProjectStore();

  const clippingPlanes = useMemo(() => {
    const planes: THREE.Plane[] = [];
    if (clipping.x.enabled) {
      planes.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), clipping.x.value));
    }
    if (clipping.y.enabled) {
      planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), clipping.y.value));
    }
    if (clipping.z.enabled) {
      planes.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), clipping.z.value));
    }
    if (planes.length === 0) {
      planes.push(new THREE.Plane(new THREE.Vector3(0, 0, 0), 10000));
    }
    return planes;
  }, [clipping.x.enabled, clipping.x.value, clipping.y.enabled, clipping.y.value, clipping.z.enabled, clipping.z.value]);

  return (
    <Canvas
      camera={{ position: [10, 10, 10], fov: 50, near: 0.1, far: 10000 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#0a0e17' }}
      onPointerMissed={() => {}}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <directionalLight position={[-10, -5, -10]} intensity={0.2} />

      <gridHelper
        args={[50, 50, '#1e2d42', '#131b2b']}
        rotation={[0, 0, 0]}
      />
      <axesHelper args={[5]} />

      <PointCloud projectId={projectId} clippingPlanes={clippingPlanes} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        enabled={!annotationMode}
      />

      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#FF4757', '#00E5CC', '#5B8DEF']} labelColor="#c8d6e5" />
      </GizmoHelper>
    </Canvas>
  );
}
