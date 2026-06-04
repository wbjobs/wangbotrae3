using System.Collections.Generic;
using UnityEngine;
using VoxelWindDestruction.Core;
using VoxelWindDestruction.Voxelization;

namespace VoxelWindDestruction.WindField
{
    public struct SparseUpdateRegion
    {
        public int CenterX;
        public int CenterY;
        public int CenterZ;
        public int Radius;
        public float UpdateTime;
    }

    public class WindFieldSimulator : MonoBehaviour
    {
        [Header("Wind Settings")]
        public Vector3 WindDirection = new Vector3(1, 0, 0);
        [Range(0f, 200f)] public float WindSpeed = 50f;
        [Range(0f, 1f)] public float Turbulence = 0.3f;
        [Range(0f, 1f)] public float EddyStrength = 0.5f;

        [Header("Perlin Noise Settings")]
        public float NoiseScale = 0.1f;
        public float NoiseSpeed = 1.0f;
        public long NoiseSeed = 42;

        [Header("Simulation")]
        public ComputeShader FluidShader;
        public int GridSize = 64;
        public float VoxelSize = 0.5f;

        [Header("Sparse Update")]
        public int SparseUpdateRadius = 5;
        public int MaxSparseRegions = 50;
        public int RandomUpdateCount = 100;

        [Header("Visualization")]
        public bool ShowWindGizmos = false;
        public int GizmoStep = 8;
        public float GizmoScale = 0.5f;
        public bool ShowStreamlines = true;
        public int StreamlineParticleCount = 200;

        [Header("Gust Settings")]
        public bool GustActive = false;
        public float GustStrength = 100f;
        public Vector3 GustDirection = new Vector3(1, 0, 0);
        public float GustDuration = 3f;
        private float gustTimer = 0f;
        private float originalSpeed;

        private ComputeBuffer _velocityBuffer;
        private ComputeBuffer _densityBuffer;
        private ComputeBuffer _obstacleBuffer;
        private ComputeBuffer _sparseRegionBuffer;
        private float3[] _velocityData;
        private int[] _obstacleData;

        private PerlinWindFieldGenerator perlinGenerator;
        private WindObstacleManager obstacleManager;
        private StreamlineSystem streamlineSystem;

        private int _advectKernel;
        private int _divergenceKernel;
        private int _pressureKernel;
        private int _gradientKernel;
        private int _sparseAdvectKernel;

        private float simulationTime = 0f;
        private VoxelGrid voxelGrid;

        private List<SparseUpdateRegion> sparseRegions = new List<SparseUpdateRegion>();
        private HashSet<int> updatedThisFrame = new HashSet<int>();
        private Queue<SparseUpdateRegion> pendingRegions = new Queue<SparseUpdateRegion>();

        private void Start()
        {
            perlinGenerator = new PerlinWindFieldGenerator(NoiseSeed);
            obstacleManager = GetComponent<WindObstacleManager>();
            if (obstacleManager == null)
            {
                obstacleManager = gameObject.AddComponent<WindObstacleManager>();
            }

            voxelGrid = FindObjectOfType<VoxelGrid>();
            if (voxelGrid != null)
            {
                GridSize = voxelGrid.GridSize;
                VoxelSize = voxelGrid.VoxelSize;
            }

            InitializeBuffers();

            streamlineSystem = new StreamlineSystem(
                this,
                obstacleManager,
                StreamlineParticleCount,
                GridSize,
                VoxelSize
            );

            GameEventManager.Instance.OnVoxelDestroyed += HandleVoxelDestroyed;
            GameEventManager.Instance.OnGustTriggered += HandleGustTriggered;

            originalSpeed = WindSpeed;
        }

        private void InitializeBuffers()
        {
            int totalCells = GridSize * GridSize * GridSize;
            _velocityData = new float3[totalCells];
            _obstacleData = new int[totalCells];

            _velocityBuffer = new ComputeBuffer(totalCells, sizeof(float) * 3);
            _densityBuffer = new ComputeBuffer(totalCells, sizeof(float));
            _obstacleBuffer = new ComputeBuffer(totalCells, sizeof(int));
            _sparseRegionBuffer = new ComputeBuffer(MaxSparseRegions, sizeof(int) * 4 + sizeof(float));

            if (FluidShader != null)
            {
                _advectKernel = FluidShader.FindKernel("Advect");
                _divergenceKernel = FluidShader.FindKernel("Divergence");
                _pressureKernel = FluidShader.FindKernel("Pressure");
                _gradientKernel = FluidShader.FindKernel("Gradient");

                int sparseKernel;
                try { sparseKernel = FluidShader.FindKernel("SparseAdvect"); }
                catch { sparseKernel = -1; }
                _sparseAdvectKernel = sparseKernel;
            }

            InitializeWindField();
            UpdateObstacleBuffer();
        }

        private void InitializeWindField()
        {
            for (int x = 0; x < GridSize; x++)
            {
                for (int y = 0; y < GridSize; y++)
                {
                    for (int z = 0; z < GridSize; z++)
                    {
                        int index = x + y * GridSize + z * GridSize * GridSize;
                        _velocityData[index] = CalculatePerlinVelocity(x, y, z);
                    }
                }
            }

            _velocityBuffer.SetData(_velocityData);
        }

        private void UpdateObstacleBuffer()
        {
            for (int x = 0; x < GridSize; x++)
            {
                for (int y = 0; y < GridSize; y++)
                {
                    for (int z = 0; z < GridSize; z++)
                    {
                        int index = x + y * GridSize + z * GridSize * GridSize;
                        _obstacleData[index] = obstacleManager.IsObstacle(x, y, z) ? 1 : 0;
                    }
                }
            }
            _obstacleBuffer.SetData(_obstacleData);
        }

        private void HandleVoxelDestroyed(int x, int y, int z, float force, float strength)
        {
            obstacleManager.SetObstacle(x, y, z, false);
            UpdateObstacleBuffer();

            AddSparseRegion(x, y, z, SparseUpdateRadius);

            if (voxelGrid != null)
            {
                Vector3 worldPos = voxelGrid.GetVoxelWorldPosition(x, y, z);
                streamlineSystem.SpawnParticlesAt(worldPos, 20);
            }
        }

        private void HandleGustTriggered(float strength, float duration, Vector3 direction)
        {
            TriggerGust(strength, duration, direction);
        }

        public void AddSparseRegion(int cx, int cy, int cz, int radius)
        {
            SparseUpdateRegion region = new SparseUpdateRegion
            {
                CenterX = cx,
                CenterY = cy,
                CenterZ = cz,
                Radius = radius,
                UpdateTime = simulationTime
            };

            pendingRegions.Enqueue(region);

            if (sparseRegions.Count >= MaxSparseRegions)
            {
                sparseRegions.RemoveAt(0);
            }
            sparseRegions.Add(region);
        }

        public void TriggerGust(float strength, float duration, Vector3 direction)
        {
            GustActive = true;
            GustStrength = strength;
            GustDuration = duration;
            GustDirection = direction.normalized;
            gustTimer = duration;
            originalSpeed = WindSpeed;

            for (int x = 0; x < GridSize; x += 16)
            {
                for (int y = 0; y < GridSize; y += 16)
                {
                    for (int z = 0; z < GridSize; z += 16)
                    {
                        AddSparseRegion(x, y, z, 20);
                    }
                }
            }
        }

        private void FixedUpdate()
        {
            simulationTime += Time.fixedDeltaTime;

            if (GustActive)
            {
                gustTimer -= Time.fixedDeltaTime;
                if (gustTimer <= 0)
                {
                    GustActive = false;
                    WindSpeed = originalSpeed;
                }
                else
                {
                    float progress = 1f - gustTimer / GustDuration;
                    float strengthFactor = Mathf.Sin(Mathf.PI * progress);
                    WindSpeed = originalSpeed + GustStrength * strengthFactor;
                }
            }

            ProcessPendingSparseRegions();
            UpdateWindSimulationSparse();
            streamlineSystem.Update(Time.fixedDeltaTime);

            if (simulationTime % 10f < Time.fixedDeltaTime)
            {
                PruneOldSparseRegions();
            }
        }

        private void ProcessPendingSparseRegions()
        {
            while (pendingRegions.Count > 0)
            {
                SparseUpdateRegion region = pendingRegions.Dequeue();

                for (int dx = -region.Radius; dx <= region.Radius; dx++)
                {
                    for (int dy = -region.Radius; dy <= region.Radius; dy++)
                    {
                        for (int dz = -region.Radius; dz <= region.Radius; dz++)
                        {
                            int nx = region.CenterX + dx;
                            int ny = region.CenterY + dy;
                            int nz = region.CenterZ + dz;

                            if (nx < 0 || nx >= GridSize || ny < 0 || ny >= GridSize || nz < 0 || nz >= GridSize)
                                continue;

                            float dist = Mathf.Sqrt(dx * dx + dy * dy + dz * dz);
                            if (dist > region.Radius) continue;

                            int index = nx + ny * GridSize + nz * GridSize * GridSize;
                            if (updatedThisFrame.Contains(index)) continue;
                            updatedThisFrame.Add(index);

                            _velocityData[index] = CalculatePerlinVelocity(nx, ny, nz);
                        }
                    }
                }
            }

            updatedThisFrame.Clear();
        }

        private void UpdateWindSimulationSparse()
        {
            if (FluidShader == null) return;

            float dt = Time.fixedDeltaTime;
            float3 dir = math.normalize(new float3(WindDirection.x, WindDirection.y, WindDirection.z));

            FluidShader.SetFloat("DeltaTime", dt);
            FluidShader.SetFloat("WindSpeed", WindSpeed);
            FluidShader.SetFloat("Turbulence", Turbulence);
            FluidShader.SetFloat("NoiseScale", NoiseScale);
            FluidShader.SetFloat("NoiseSpeed", NoiseSpeed);
            FluidShader.SetFloat("Time", simulationTime);
            FluidShader.SetFloat("EddyStrength", EddyStrength);
            FluidShader.SetVector("WindDirection", new Vector4(dir.x, dir.y, dir.z, 0));
            FluidShader.SetInt("GridSize", GridSize);

            if (GustActive)
            {
                float progress = 1f - gustTimer / GustDuration;
                float strengthFactor = Mathf.Sin(Mathf.PI * progress);
                FluidShader.SetFloat("GustStrength", GustStrength * strengthFactor);
                FluidShader.SetVector("GustDirection", new Vector4(GustDirection.x, GustDirection.y, GustDirection.z, 0));
            }
            else
            {
                FluidShader.SetFloat("GustStrength", 0);
            }

            _velocityBuffer.SetData(_velocityData);

            if (sparseRegions.Count > 0 && _sparseAdvectKernel >= 0)
            {
                DispatchSparseAdvect();
            }
            else
            {
                int threadGroups = Mathf.CeilToInt((float)GridSize / 8f);

                FluidShader.SetBuffer(_advectKernel, "Velocity", _velocityBuffer);
                FluidShader.SetBuffer(_advectKernel, "Obstacles", _obstacleBuffer);
                FluidShader.Dispatch(_advectKernel, threadGroups, threadGroups, threadGroups);
            }

            int tg = Mathf.CeilToInt((float)GridSize / 8f);

            FluidShader.SetBuffer(_divergenceKernel, "Velocity", _velocityBuffer);
            FluidShader.SetBuffer(_divergenceKernel, "Density", _densityBuffer);
            FluidShader.SetBuffer(_divergenceKernel, "Obstacles", _obstacleBuffer);
            FluidShader.Dispatch(_divergenceKernel, tg, tg, tg);

            for (int i = 0; i < 20; i++)
            {
                FluidShader.SetBuffer(_pressureKernel, "Density", _densityBuffer);
                FluidShader.SetBuffer(_pressureKernel, "ObstaclesBuffer", _obstacleBuffer);
                FluidShader.Dispatch(_pressureKernel, tg, tg, tg);
            }

            FluidShader.SetBuffer(_gradientKernel, "Velocity", _velocityBuffer);
            FluidShader.SetBuffer(_gradientKernel, "Density", _densityBuffer);
            FluidShader.SetBuffer(_gradientKernel, "Obstacles", _obstacleBuffer);
            FluidShader.Dispatch(_gradientKernel, tg, tg, tg);

            if (ShowWindGizmos || ShowStreamlines)
            {
                _velocityBuffer.GetData(_velocityData);
            }

            ApplyRandomSparseUpdates();
        }

        private void DispatchSparseAdvect()
        {
            int count = Mathf.Min(sparseRegions.Count, MaxSparseRegions);

            FluidShader.SetInt("SparseRegionCount", count);
            FluidShader.SetBuffer(_sparseAdvectKernel, "Velocity", _velocityBuffer);
            FluidShader.SetBuffer(_sparseAdvectKernel, "Obstacles", _obstacleBuffer);
            FluidShader.SetBuffer(_sparseAdvectKernel, "SparseRegions", _sparseRegionBuffer);

            int threadGroups = Mathf.CeilToInt((float)count / 8f);
            FluidShader.Dispatch(_sparseAdvectKernel, threadGroups, 1, 1);
        }

        private void ApplyRandomSparseUpdates()
        {
            for (int i = 0; i < RandomUpdateCount; i++)
            {
                int x = (int)((simulationTime * 100 + i * 137) % GridSize);
                int y = (int)((simulationTime * 73 + i * 251) % GridSize);
                int z = (int)((simulationTime * 41 + i * 313) % GridSize);

                x = Mathf.Clamp(x, 0, GridSize - 1);
                y = Mathf.Clamp(y, 0, GridSize - 1);
                z = Mathf.Clamp(z, 0, GridSize - 1);

                int index = x + y * GridSize + z * GridSize * GridSize;
                _velocityData[index] = CalculatePerlinVelocity(x, y, z);
            }

            _velocityBuffer.SetData(_velocityData);
        }

        private void PruneOldSparseRegions()
        {
            float cutoffTime = simulationTime - 10f;
            sparseRegions.RemoveAll(r => r.UpdateTime < cutoffTime);
        }

        public float3 GetWindVelocity(Vector3 worldPosition)
        {
            float halfSize = GridSize * VoxelSize * 0.5f;
            int x = Mathf.Clamp(Mathf.FloorToInt((worldPosition.x + halfSize) / VoxelSize), 0, GridSize - 1);
            int y = Mathf.Clamp(Mathf.FloorToInt((worldPosition.y + halfSize) / VoxelSize), 0, GridSize - 1);
            int z = Mathf.Clamp(Mathf.FloorToInt((worldPosition.z + halfSize) / VoxelSize), 0, GridSize - 1);

            if (obstacleManager.IsObstacle(x, y, z))
            {
                return float3.zero;
            }

            int index = x + y * GridSize + z * GridSize * GridSize;
            if (index >= 0 && index < _velocityData.Length)
            {
                return _velocityData[index];
            }

            float3 perlinVel = CalculatePerlinVelocity(x, y, z);
            return obstacleManager.ApplyObstacleAvoidance(x, y, z, perlinVel, 50f);
        }

        public float3 CalculatePerlinVelocity(int x, int y, int z)
        {
            if (obstacleManager.IsObstacle(x, y, z))
            {
                return float3.zero;
            }

            perlinGenerator.SampleDirection(x, y, z, simulationTime, NoiseScale, NoiseSpeed,
                out float dx, out float dy, out float dz);

            perlinGenerator.SampleCurl(x, y, z, simulationTime, NoiseScale * 1.5f, NoiseSpeed * 0.8f, EddyStrength,
                out float cx, out float cy, out float cz);

            float3 baseDir = math.normalize(new float3(WindDirection.x, WindDirection.y, WindDirection.z));

            float velocityX = baseDir.x + dx * Turbulence + cx;
            float velocityY = baseDir.y + dy * Turbulence + cy;
            float velocityZ = baseDir.z + dz * Turbulence + cz;

            if (GustActive)
            {
                float progress = 1f - gustTimer / GustDuration;
                float strengthFactor = Mathf.Sin(Mathf.PI * progress);
                float gustNorm = GustStrength * strengthFactor / Mathf.Max(WindSpeed, 1f);

                velocityX += GustDirection.x * gustNorm;
                velocityY += GustDirection.y * gustNorm;
                velocityZ += GustDirection.z * gustNorm;
            }

            float mag = Mathf.Sqrt(velocityX * velocityX + velocityY * velocityY + velocityZ * velocityZ);
            if (mag > 0)
            {
                velocityX /= mag;
                velocityY /= mag;
                velocityZ /= mag;
            }

            float speed = WindSpeed;
            if (GustActive)
            {
                float progress = 1f - gustTimer / GustDuration;
                float strengthFactor = Mathf.Sin(Mathf.PI * progress);
                speed += GustStrength * strengthFactor;
            }

            float3 rawVel = new float3(velocityX * speed, velocityY * speed, velocityZ * speed);
            return obstacleManager.ApplyObstacleAvoidance(x, y, z, rawVel, 50f);
        }

        public WindParams GetWindParams()
        {
            return new WindParams
            {
                Direction = math.normalize(new float3(WindDirection.x, WindDirection.y, WindDirection.z)),
                Speed = WindSpeed,
                Turbulence = Turbulence,
                DeltaTime = Time.fixedDeltaTime
            };
        }

        public void UpdateWindParams(WindParams windParams)
        {
            WindDirection = new Vector3(windParams.Direction.x, windParams.Direction.y, windParams.Direction.z);
            WindSpeed = windParams.Speed;
            Turbulence = windParams.Turbulence;

            for (int x = 0; x < GridSize; x += 8)
            {
                for (int y = 0; y < GridSize; y += 8)
                {
                    for (int z = 0; z < GridSize; z += 8)
                    {
                        AddSparseRegion(x, y, z, 10);
                    }
                }
            }

            GameEventManager.Instance?.TriggerWindParamsUpdated(windParams);
        }

        public ComputeBuffer GetVelocityBuffer()
        {
            return _velocityBuffer;
        }

        public float GetSimulationTime()
        {
            return simulationTime;
        }

        public List<StreamlineParticle> GetStreamlineParticles()
        {
            return streamlineSystem.GetParticles();
        }

        private void OnDrawGizmos()
        {
            if (!ShowWindGizmos || _velocityData == null) return;

            float halfSize = GridSize * VoxelSize * 0.5f;

            for (int x = 0; x < GridSize; x += GizmoStep)
            {
                for (int y = 0; y < GridSize; y += GizmoStep)
                {
                    for (int z = 0; z < GridSize; z += GizmoStep)
                    {
                        int index = x + y * GridSize + z * GridSize * GridSize;
                        Vector3 pos = new Vector3(
                            x * VoxelSize - halfSize + VoxelSize * 0.5f,
                            y * VoxelSize - halfSize + VoxelSize * 0.5f,
                            z * VoxelSize - halfSize + VoxelSize * 0.5f
                        );

                        if (obstacleManager != null && obstacleManager.IsObstacle(x, y, z))
                        {
                            Gizmos.color = new Color(1, 0, 0, 0.3f);
                            Gizmos.DrawCube(pos, Vector3.one * VoxelSize * 0.8f);
                            continue;
                        }

                        if (index >= _velocityData.Length) continue;

                        Vector3 vel = new Vector3(_velocityData[index].x, _velocityData[index].y, _velocityData[index].z);
                        float speed = vel.magnitude;

                        Gizmos.color = Color.Lerp(Color.blue, Color.red, Mathf.Clamp01(speed / 200f));
                        Gizmos.DrawRay(pos, vel.normalized * GizmoScale);
                    }
                }
            }

            if (GustActive)
            {
                Gizmos.color = Color.yellow;
                Vector3 gustCenter = Vector3.zero;
                Gizmos.DrawWireSphere(gustCenter, GridSize * VoxelSize * 0.6f);
                Gizmos.DrawRay(gustCenter, GustDirection * GizmoScale * 5f);
            }
        }

        private void OnRenderObject()
        {
            if (ShowStreamlines)
            {
                streamlineSystem.Render();
            }
        }

        private void OnDestroy()
        {
            _velocityBuffer?.Dispose();
            _densityBuffer?.Dispose();
            _obstacleBuffer?.Dispose();
            _sparseRegionBuffer?.Dispose();

            if (GameEventManager.Instance != null)
            {
                GameEventManager.Instance.OnVoxelDestroyed -= HandleVoxelDestroyed;
                GameEventManager.Instance.OnGustTriggered -= HandleGustTriggered;
            }
        }
    }
}
