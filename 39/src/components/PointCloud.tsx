import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useProjectStore } from '@/stores/useProjectStore';
import * as api from '@/api';

interface PointCloudProps {
  projectId: string;
  clippingPlanes: THREE.Plane[];
}

export default function PointCloud({ projectId, clippingPlanes }: PointCloudProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const loadedSlices = useRef<Set<number>>(new Set());
  const currentSlice = useRef(0);
  const totalSlices = useRef(1);
  const loadedCount = useRef(0);
  const isLoading = useRef(false);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const maxPoints = 500000;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
    geo.setDrawRange(0, 0);
    return geo;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      sizeAttenuation: true,
      clippingPlanes: clippingPlanes.length > 0 ? clippingPlanes : undefined,
      clipShadows: true,
    });
    return mat;
  }, [clippingPlanes]);

  const { pointSize, opacity, colorMapping, visible } = useProjectStore();

  useFrame(() => {
    if (!pointsRef.current) return;
    pointsRef.current.visible = visible;
    material.size = pointSize;
    material.opacity = opacity;
    material.transparent = opacity < 1;
    material.clippingPlanes = clippingPlanes.length > 0 ? clippingPlanes : undefined;
    material.needsUpdate = true;

    if (isLoading.current) return;
    if (!projectId || loadedSlices.current.size >= totalSlices.current) return;

    const loadSlice = async () => {
      isLoading.current = true;
      const sliceIndex = currentSlice.current;
      if (loadedSlices.current.has(sliceIndex)) {
        isLoading.current = false;
        return;
      }

      try {
        const slice = await api.getPointCloudSlice(projectId, sliceIndex, 10);
        totalSlices.current = slice.total_slices;

        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
        const colAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
        const offset = loadedCount.current;
        const pointCount = slice.points.length / 3;

        if (offset + pointCount <= posAttr.count) {
          const posArray = posAttr.array as Float32Array;
          const colArray = colAttr.array as Float32Array;

          posArray.set(slice.points, offset * 3);

          for (let i = 0; i < pointCount; i++) {
            const src = i * 3;
            if (colorMapping === 'depth') {
              const y = slice.points[src + 1];
              const bounds = slice.bounds;
              const range = bounds.max[1] - bounds.min[1] || 1;
              const t = (y - bounds.min[1]) / range;
              colArray[(offset + i) * 3] = t * 0.2;
              colArray[(offset + i) * 3 + 1] = 0.9 - t * 0.5;
              colArray[(offset + i) * 3 + 2] = 0.8 + t * 0.2;
            } else if (colorMapping === 'amplitude') {
              colArray[(offset + i) * 3] = slice.colors[src];
              colArray[(offset + i) * 3 + 1] = slice.colors[src + 1];
              colArray[(offset + i) * 3 + 2] = slice.colors[src + 2];
            } else {
              colArray[(offset + i) * 3] = 0.0;
              colArray[(offset + i) * 3 + 1] = 0.9;
              colArray[(offset + i) * 3 + 2] = 0.8;
            }
          }

          posAttr.addUpdateRange(offset * 3, pointCount * 3);
          colAttr.addUpdateRange(offset * 3, pointCount * 3);
          posAttr.needsUpdate = true;
          colAttr.needsUpdate = true;
          loadedCount.current = offset + pointCount;
          geometry.setDrawRange(0, offset + pointCount);
        }

        loadedSlices.current.add(sliceIndex);
        currentSlice.current = sliceIndex + 1;
      } catch (_e) { void _e; }
      finally {
        isLoading.current = false;
      }
    };

    loadSlice();
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} />
  );
}
