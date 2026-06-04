using UnityEngine;
using VoxelWindDestruction.Core;

namespace VoxelWindDestruction.Voxelization
{
    [RequireComponent(typeof(VoxelGrid))]
    public class VoxelRenderer : MonoBehaviour
    {
        [Header("Rendering")]
        public Material VoxelMaterial;
        public bool ShowDebug = false;
        public Color ActiveColor = new Color(0.6f, 0.8f, 1.0f);
        public Color StressColor = new Color(1.0f, 0.3f, 0.2f);

        [Header("Instancing")]
        public int BatchSize = 1023;

        private VoxelGrid _grid;
        private Mesh _cubeMesh;
        private Matrix4x4[] _matrices;
        private Vector4[] _colors;
        private MaterialPropertyBlock _propBlock;
        private ComputeBuffer _argsBuffer;

        private void Awake()
        {
            _grid = GetComponent<VoxelGrid>();
            _cubeMesh = CreateCubeMesh();
            _propBlock = new MaterialPropertyBlock();

            _argsBuffer = new ComputeBuffer(5, sizeof(uint), ComputeBufferType.IndirectArguments);
            uint[] args = { 0, 0, 0, 0, 0 };
            _argsBuffer.SetData(args);
        }

        private Mesh CreateCubeMesh()
        {
            Mesh mesh = new Mesh();
            float size = 1f;

            Vector3[] vertices = new Vector3[]
            {
                new Vector3(-size, -size, -size),
                new Vector3( size, -size, -size),
                new Vector3( size,  size, -size),
                new Vector3(-size,  size, -size),
                new Vector3(-size, -size,  size),
                new Vector3( size, -size,  size),
                new Vector3( size,  size,  size),
                new Vector3(-size,  size,  size),
            };

            int[] triangles = new int[]
            {
                0, 2, 1, 0, 3, 2,
                1, 6, 5, 1, 2, 6,
                2, 7, 6, 2, 3, 7,
                3, 4, 7, 3, 0, 4,
                4, 5, 6, 4, 6, 7,
                0, 1, 5, 0, 5, 4
            };

            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            return mesh;
        }

        private void LateUpdate()
        {
            RenderVoxels();
        }

        private void RenderVoxels()
        {
            if (_grid == null || VoxelMaterial == null) return;

            VoxelData[] voxelData = _grid.GetVoxelData();
            if (voxelData == null) return;

            int gridSize = _grid.GridSize;
            float voxelSize = _grid.VoxelSize;

            int activeCount = 0;
            for (int i = 0; i < voxelData.Length; i++)
            {
                if (voxelData[i].Active == 1) activeCount++;
            }

            if (activeCount == 0) return;

            if (_matrices == null || _matrices.Length < activeCount)
            {
                _matrices = new Matrix4x4[Mathf.Max(BatchSize, activeCount)];
                _colors = new Vector4[Mathf.Max(BatchSize, activeCount)];
            }

            int batchIndex = 0;
            for (int x = 0; x < gridSize; x++)
            {
                for (int y = 0; y < gridSize; y++)
                {
                    for (int z = 0; z < gridSize; z++)
                    {
                        int index = x + y * gridSize + z * gridSize * gridSize;
                        if (voxelData[index].Active == 1)
                        {
                            Vector3 worldPos = _grid.GetVoxelWorldPosition(x, y, z);
                            _matrices[batchIndex] = Matrix4x4.TRS(worldPos, Quaternion.identity, Vector3.one * voxelSize * 0.45f);

                            float stressRatio = Mathf.Clamp01(voxelData[index].Stress / voxelData[index].Strength);
                            _colors[batchIndex] = Color.Lerp(ActiveColor, StressColor, stressRatio);

                            batchIndex++;

                            if (batchIndex >= BatchSize)
                            {
                                DrawBatch(batchIndex);
                                batchIndex = 0;
                            }
                        }
                    }
                }
            }

            if (batchIndex > 0)
            {
                DrawBatch(batchIndex);
            }
        }

        private void DrawBatch(int count)
        {
            if (VoxelMaterial.HasProperty("_InstanceColor"))
            {
                _propBlock.SetVectorArray("_InstanceColor", _colors);
            }

            Graphics.DrawMeshInstanced(
                _cubeMesh,
                0,
                VoxelMaterial,
                _matrices,
                count,
                _propBlock,
                UnityEngine.Rendering.ShadowCastingMode.On,
                true,
                gameObject.layer
            );
        }

        private void OnDrawGizmos()
        {
            if (!ShowDebug || _grid == null) return;

            Gizmos.color = Color.yellow;
            Gizmos.DrawWireCube(_grid.GridCenter, Vector3.one * _grid.GridSize * _grid.VoxelSize);

            VoxelData[] voxelData = _grid.GetVoxelData();
            if (voxelData == null) return;

            int gridSize = _grid.GridSize;
            for (int x = 0; x < gridSize; x += 4)
            {
                for (int y = 0; y < gridSize; y += 4)
                {
                    for (int z = 0; z < gridSize; z += 4)
                    {
                        int index = x + y * gridSize + z * gridSize * gridSize;
                        if (voxelData[index].Active == 1)
                        {
                            Vector3 pos = _grid.GetVoxelWorldPosition(x, y, z);
                            Gizmos.color = new Color(0, 1, 0, 0.3f);
                            Gizmos.DrawSphere(pos, 0.1f);
                        }
                    }
                }
            }
        }

        private void OnDestroy()
        {
            _argsBuffer?.Dispose();
        }
    }
}
