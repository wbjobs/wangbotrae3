import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Sphere, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { Card, Typography, Row, Col, Select, Space } from 'antd';

const { Title, Text } = Typography;

function MaterialSphere({ baseColorUrl, roughnessUrl, metallicUrl, normalUrl }) {
  const meshRef = useRef();

  const textures = {};
  try {
    if (baseColorUrl) textures.baseColor = useTexture(baseColorUrl);
    if (roughnessUrl) textures.roughness = useTexture(roughnessUrl);
    if (metallicUrl) textures.metallic = useTexture(metallicUrl);
    if (normalUrl) textures.normal = useTexture(normalUrl);
  } catch (e) {
    // textures may not be available yet
  }

  const material = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.0,
    });

    if (textures.baseColor) {
      mat.map = textures.baseColor;
      textures.baseColor.colorSpace = THREE.SRGBColorSpace;
    }
    if (textures.roughness) {
      mat.roughnessMap = textures.roughness;
    }
    if (textures.metallic) {
      mat.metalnessMap = textures.metallic;
    }
    if (textures.normal) {
      mat.normalMap = textures.normal;
      mat.normalScale = new THREE.Vector2(1, 1);
    }

    mat.needsUpdate = true;
    return mat;
  }, [textures.baseColor, textures.roughness, textures.metallic, textures.normal]);

  return (
    <Sphere ref={meshRef} args={[1, 64, 64]} material={material} />
  );
}

function Scene({ taskId, textureUrls }) {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={1.0} />
      <directionalLight position={[-5, 3, -5]} intensity={0.5} />
      <pointLight position={[0, 5, 0]} intensity={0.5} />

      {textureUrls && (
        <MaterialSphere
          baseColorUrl={textureUrls.baseColor}
          roughnessUrl={textureUrls.roughness}
          metallicUrl={textureUrls.metallic}
          normalUrl={textureUrls.normal}
        />
      )}

      {!textureUrls && (
        <Sphere args={[1, 64, 64]}>
          <meshStandardMaterial color="#888888" roughness={0.5} />
        </Sphere>
      )}

      <Environment preset="studio" />
      <OrbitControls enableDamping dampingFactor={0.05} />
    </>
  );
}

export default function MaterialPreview({ taskId, textureUrls }) {
  return (
    <Card
      title={<Title level={4}>🎨 3D材质预览</Title>}
      style={{ marginBottom: 24 }}
    >
      <div style={{ height: 500, borderRadius: 8, overflow: 'hidden', background: '#1a1a2e' }}>
        <Canvas camera={{ position: [0, 0, 3], fov: 45 }}>
          <Scene taskId={taskId} textureUrls={textureUrls} />
        </Canvas>
      </div>
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Text type="secondary">鼠标左键旋转 · 右键平移 · 滚轮缩放</Text>
      </div>
    </Card>
  );
}
