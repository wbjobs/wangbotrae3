using System.Collections.Generic;
using UnityEngine;
using VoxelWindDestruction.Core;
using VoxelWindDestruction.Voxelization;

namespace VoxelWindDestruction.Destruction
{
    [RequireComponent(typeof(VoxelGrid))]
    public class DestructionManager : MonoBehaviour
    {
        [Header("Destruction Settings")]
        public float ForceThreshold = 0.5f;
        public float StrengthDecay = 0.1f;
        public float StructuralStrength = 100f;
        public float ImpactMultiplier = 2.0f;

        [Header("Simulation")]
        public bool EnableDestruction = true;
        public float SimulationInterval = 0.02f;

        [Header("Statistics")]
        public int TotalVoxels;
        public int DestroyedVoxels;
        public float PeakForce;
        public float AverageForce;

        private VoxelGrid _grid;
        private float _simulationTimer;
        private List<VoxelDestructionRecord> _destructionRecords = new List<VoxelDestructionRecord>();
        private Queue<VoxelDestructionRecord> _pendingRecords = new Queue<VoxelDestructionRecord>();
        private readonly object _recordLock = new object();

        private void Awake()
        {
            _grid = GetComponent<VoxelGrid>();
            GameEventManager.Instance.OnVoxelDestroyed += HandleVoxelDestroyed;
        }

        private void OnDestroy()
        {
            if (GameEventManager.Instance != null)
            {
                GameEventManager.Instance.OnVoxelDestroyed -= HandleVoxelDestroyed;
            }
        }

        private void Update()
        {
            if (!EnableDestruction) return;

            _simulationTimer += Time.deltaTime;
            if (_simulationTimer >= SimulationInterval)
            {
                _simulationTimer = 0f;
                RunDestructionStep();
            }
        }

        private void RunDestructionStep()
        {
            if (_grid == null) return;

            _grid.CalculateForces();
            int destroyedCount = _grid.CheckDestruction();

            if (destroyedCount > 0)
            {
                TotalVoxels = _grid.TotalVoxels;
                DestroyedVoxels = _grid.DestroyedVoxels;

                UpdateStats();
            }
        }

        private void HandleVoxelDestroyed(int x, int y, int z, float force, float strength)
        {
            var record = new VoxelDestructionRecord
            {
                Position = new int3(x, y, z),
                Force = force,
                Strength = strength,
                Velocity = _grid.GetCurrentWind().Direction * _grid.GetCurrentWind().Speed * 0.5f,
                Timestamp = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            lock (_recordLock)
            {
                _destructionRecords.Add(record);
                _pendingRecords.Enqueue(record);
            }

            if (force > PeakForce)
            {
                PeakForce = force;
            }

            UpdateStats();
        }

        private void UpdateStats()
        {
            if (TotalVoxels == 0) return;

            float totalForce = 0f;
            int count = 0;

            lock (_recordLock)
            {
                foreach (var record in _destructionRecords)
                {
                    totalForce += record.Force;
                    count++;
                }
            }

            if (count > 0)
            {
                AverageForce = totalForce / count;
            }

            var stats = new GameStats
            {
                TotalVoxels = TotalVoxels,
                DestroyedVoxels = DestroyedVoxels,
                DestructionPercent = (float)DestroyedVoxels / TotalVoxels * 100f,
                AverageForce = AverageForce,
                PeakForce = PeakForce,
                CurrentWindSpeed = _grid.GetCurrentWind().Speed
            };

            GameEventManager.Instance?.TriggerStatsUpdated(stats);
        }

        public List<VoxelDestructionRecord> GetPendingRecords(int maxRecords = 100)
        {
            var records = new List<VoxelDestructionRecord>();
            lock (_recordLock)
            {
                int count = Mathf.Min(maxRecords, _pendingRecords.Count);
                for (int i = 0; i < count; i++)
                {
                    records.Add(_pendingRecords.Dequeue());
                }
            }
            return records;
        }

        public List<VoxelDestructionRecord> GetAllRecords()
        {
            lock (_recordLock)
            {
                return new List<VoxelDestructionRecord>(_destructionRecords);
            }
        }

        public void ResetStatistics()
        {
            lock (_recordLock)
            {
                _destructionRecords.Clear();
                _pendingRecords.Clear();
            }
            DestroyedVoxels = 0;
            PeakForce = 0;
            AverageForce = 0;
        }

        public void ApplyExplosion(Vector3 position, float radius, float force)
        {
            if (_grid == null) return;

            VoxelData[] voxelData = _grid.GetVoxelData();
            int gridSize = _grid.GridSize;

            for (int x = 0; x < gridSize; x++)
            {
                for (int y = 0; y < gridSize; y++)
                {
                    for (int z = 0; z < gridSize; z++)
                    {
                        int index = x + y * gridSize + z * gridSize * gridSize;
                        if (voxelData[index].Active == 1)
                        {
                            Vector3 voxelPos = _grid.GetVoxelWorldPosition(x, y, z);
                            float distance = Vector3.Distance(voxelPos, position);

                            if (distance < radius)
                            {
                                float falloff = 1f - (distance / radius);
                                voxelData[index].Stress += force * falloff * ImpactMultiplier;
                            }
                        }
                    }
                }
            }

            _grid.GetVoxelBuffer().SetData(voxelData);
        }
    }
}
