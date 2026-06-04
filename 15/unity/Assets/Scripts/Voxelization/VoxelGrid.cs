using UnityEngine;
using VoxelWindDestruction.Core;

namespace VoxelWindDestruction.Voxelization
{
    public class VoxelGrid : MonoBehaviour
    {
        [Header("Grid Settings")]
        public int GridSize = 64;
        public float VoxelSize = 0.5f;
        public Vector3 GridCenter = Vector3.zero;

        [Header("Voxel Settings")]
        public float DefaultStrength = 100f;

        [Header("Compute Shaders")]
        public ComputeShader VoxelizeShader;
        public ComputeShader ForceShader;
        public ComputeShader DestructionShader;

        private ComputeBuffer _voxelBuffer;
        private ComputeBuffer _windBuffer;
        private VoxelData[] _voxelData;
        private WindParams _currentWind;

        private int _voxelizeKernel;
        private int _forceKernel;
        private int _destructionKernel;

        public int TotalVoxels { get; private set; }
        public int DestroyedVoxels { get; private set; }

        private void Start()
        {
            InitializeBuffers();
            _currentWind = new WindParams
            {
                Direction = new float3(1, 0, 0),
                Speed = 50f,
                Turbulence = 0.3f,
                DeltaTime = Time.fixedDeltaTime
            };
        }

        private void InitializeBuffers()
        {
            int totalVoxels = GridSize * GridSize * GridSize;
            _voxelData = new VoxelData[totalVoxels];
            TotalVoxels = totalVoxels;

            _voxelBuffer = new ComputeBuffer(totalVoxels, System.Runtime.InteropServices.Marshal.SizeOf(typeof(VoxelData)));
            _windBuffer = new ComputeBuffer(1, System.Runtime.InteropServices.Marshal.SizeOf(typeof(WindParams)));

            _voxelizeKernel = VoxelizeShader != null ? VoxelizeShader.FindKernel("Voxelize") : -1;
            _forceKernel = ForceShader != null ? ForceShader.FindKernel("CalculateForces") : -1;
            _destructionKernel = DestructionShader != null ? DestructionShader.FindKernel("CheckDestruction") : -1;
        }

        public void VoxelizeMesh(Mesh mesh, Transform meshTransform)
        {
            if (VoxelizeShader == null || _voxelizeKernel < 0) return;

            Vector3[] vertices = mesh.vertices;
            int[] triangles = mesh.triangles;

            using (var vertexBuffer = new ComputeBuffer(vertices.Length, sizeof(float) * 3))
            using (var triangleBuffer = new ComputeBuffer(triangles.Length, sizeof(int)))
            {
                vertexBuffer.SetData(vertices);
                triangleBuffer.SetData(triangles);

                Matrix4x4 localToGrid = GetLocalToGridMatrix(meshTransform);

                VoxelizeShader.SetBuffer(_voxelizeKernel, "Voxels", _voxelBuffer);
                VoxelizeShader.SetBuffer(_voxelizeKernel, "Vertices", vertexBuffer);
                VoxelizeShader.SetBuffer(_voxelizeKernel, "Triangles", triangleBuffer);
                VoxelizeShader.SetInt("GridSize", GridSize);
                VoxelizeShader.SetFloat("VoxelSize", VoxelSize);
                VoxelizeShader.SetFloat("DefaultStrength", DefaultStrength);
                VoxelizeShader.SetMatrix("LocalToGrid", localToGrid);
                VoxelizeShader.SetInt("TriangleCount", triangles.Length / 3);

                int threadGroups = Mathf.CeilToInt((float)GridSize / 8f);
                VoxelizeShader.Dispatch(_voxelizeKernel, threadGroups, threadGroups, threadGroups);
            }

            _voxelBuffer.GetData(_voxelData);
            CountActiveVoxels();
        }

        public void CalculateForces()
        {
            if (ForceShader == null || _forceKernel < 0) return;

            _currentWind.DeltaTime = Time.fixedDeltaTime;
            _windBuffer.SetData(new[] { _currentWind });

            ForceShader.SetBuffer(_forceKernel, "Voxels", _voxelBuffer);
            ForceShader.SetBuffer(_forceKernel, "WindParams", _windBuffer);
            ForceShader.SetInt("GridSize", GridSize);
            ForceShader.SetFloat("VoxelSize", VoxelSize);

            int threadGroups = Mathf.CeilToInt((float)GridSize / 8f);
            ForceShader.Dispatch(_forceKernel, threadGroups, threadGroups, threadGroups);
        }

        public int CheckDestruction()
        {
            if (DestructionShader == null || _destructionKernel < 0) return 0;

            using (var destroyedBuffer = new ComputeBuffer(1, sizeof(int), ComputeBufferType.Raw))
            {
                int[] destroyedCount = { 0 };
                destroyedBuffer.SetData(destroyedCount);

                DestructionShader.SetBuffer(_destructionKernel, "Voxels", _voxelBuffer);
                DestructionShader.SetBuffer(_destructionKernel, "DestroyedCount", destroyedBuffer);
                DestructionShader.SetInt("GridSize", GridSize);
                DestructionShader.SetFloat("ForceThreshold", VoxelConstants.FORCE_THRESHOLD);

                int threadGroups = Mathf.CeilToInt((float)GridSize / 8f);
                DestructionShader.Dispatch(_destructionKernel, threadGroups, threadGroups, threadGroups);

                destroyedBuffer.GetData(destroyedCount);
                DestroyedVoxels += destroyedCount[0];

                if (destroyedCount[0] > 0)
                {
                    _voxelBuffer.GetData(_voxelData);
                    ProcessDestroyedVoxels();
                }

                return destroyedCount[0];
            }
        }

        private void ProcessDestroyedVoxels()
        {
            for (int x = 0; x < GridSize; x++)
            {
                for (int y = 0; y < GridSize; y++)
                {
                    for (int z = 0; z < GridSize; z++)
                    {
                        int index = x + y * GridSize + z * GridSize * GridSize;
                        if (_voxelData[index].Active == 0 && _voxelData[index].Strength > 0)
                        {
                            float force = _voxelData[index].Stress;
                            float strength = _voxelData[index].Strength;
                            float3 velocity = _voxelData[index].Velocity;

                            GameEventManager.Instance?.TriggerVoxelDestroyed(x, y, z, force, strength);
                            GameEventManager.Instance?.TriggerDebrisCreated(x, y, z, velocity);

                            _voxelData[index].Strength = 0;
                        }
                    }
                }
            }
            _voxelBuffer.SetData(_voxelData);
        }

        private void CountActiveVoxels()
        {
            TotalVoxels = 0;
            for (int i = 0; i < _voxelData.Length; i++)
            {
                if (_voxelData[i].Active == 1)
                {
                    TotalVoxels++;
                }
            }
        }

        public void UpdateWindParams(WindParams windParams)
        {
            _currentWind = windParams;
            GameEventManager.Instance?.TriggerWindParamsUpdated(windParams);
        }

        public WindParams GetCurrentWind()
        {
            return _currentWind;
        }

        public Vector3 GetVoxelWorldPosition(int x, int y, int z)
        {
            float halfSize = GridSize * VoxelSize * 0.5f;
            return new Vector3(
                GridCenter.x + x * VoxelSize - halfSize + VoxelSize * 0.5f,
                GridCenter.y + y * VoxelSize - halfSize + VoxelSize * 0.5f,
                GridCenter.z + z * VoxelSize - halfSize + VoxelSize * 0.5f
            );
        }

        public VoxelData[] GetVoxelData()
        {
            return _voxelData;
        }

        public ComputeBuffer GetVoxelBuffer()
        {
            return _voxelBuffer;
        }

        private Matrix4x4 GetLocalToGridMatrix(Transform meshTransform)
        {
            Vector3 gridMin = GridCenter - Vector3.one * GridSize * VoxelSize * 0.5f;
            Matrix4x4 worldToLocal = Matrix4x4.Translate(-gridMin) * Matrix4x4.Scale(Vector3.one / VoxelSize);
            Matrix4x4 localToWorld = meshTransform.localToWorldMatrix;
            return worldToLocal * localToWorld;
        }

        private void OnDestroy()
        {
            _voxelBuffer?.Dispose();
            _windBuffer?.Dispose();
        }
    }
}
