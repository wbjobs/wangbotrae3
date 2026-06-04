using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
using VoxelWindDestruction.Core;
using VoxelWindDestruction.Destruction;

namespace VoxelWindDestruction.Network
{
    public class BackendClient : MonoBehaviour
    {
        [Header("Server Settings")]
        public string ServerUrl = "http://localhost:8080";
        public string PlayerId = "player-001";
        public float SyncInterval = 0.5f;
        public float WindUpdateInterval = 1f;

        [Header("Retry Settings")]
        public int MaxRetryAttempts = 3;
        public float RetryDelay = 0.1f;

        [Header("References")]
        public DestructionManager DestructionManager;
        public WindField.WindFieldSimulator WindSimulator;

        private bool _isConnected;
        private float _syncTimer;
        private float _windUpdateTimer;

        private Queue<PendingRecord> _retryQueue = new Queue<PendingRecord>();
        private object _retryLock = new object();

        public event Action<WindParams> OnWindParamsReceived;
        public event Action<GameStats> OnStatsReceived;
        public event Action<bool> OnConnectionStatusChanged;

        private class PendingRecord
        {
            public VoxelDestructionRecord Record;
            public int RetryCount;
            public string RecordId;
        }

        private void Start()
        {
            StartCoroutine(InitializeConnection());
        }

        private IEnumerator InitializeConnection()
        {
            yield return GetWindParams();
            yield return GetStats();

            _isConnected = true;
            OnConnectionStatusChanged?.Invoke(true);

            if (DestructionManager != null)
            {
                yield return SetTotalVoxels(DestructionManager.TotalVoxels);
            }
        }

        private void Update()
        {
            if (!_isConnected) return;

            _syncTimer += Time.deltaTime;
            _windUpdateTimer += Time.deltaTime;

            if (_syncTimer >= SyncInterval)
            {
                _syncTimer = 0f;
                StartCoroutine(SyncDestructionRecords());
            }

            if (_windUpdateTimer >= WindUpdateInterval)
            {
                _windUpdateTimer = 0f;
                StartCoroutine(GetWindParams());
            }
        }

        private IEnumerator SyncDestructionRecords()
        {
            if (DestructionManager == null) yield break;

            var records = DestructionManager.GetPendingRecords(100);
            if (records.Count > 0)
            {
                lock (_retryLock)
                {
                    foreach (var record in records)
                    {
                        _retryQueue.Enqueue(new PendingRecord
                        {
                            Record = record,
                            RetryCount = 0,
                            RecordId = Guid.NewGuid().ToString()
                        });
                    }
                }
            }

            while (true)
            {
                PendingRecord pendingRecord = null;
                lock (_retryLock)
                {
                    if (_retryQueue.Count > 0)
                    {
                        pendingRecord = _retryQueue.Dequeue();
                    }
                }

                if (pendingRecord == null) break;

                yield return StartCoroutine(TrySyncRecord(pendingRecord));
            }
        }

        private IEnumerator TrySyncRecord(PendingRecord pendingRecord)
        {
            if (pendingRecord.RetryCount >= MaxRetryAttempts)
            {
                Debug.LogWarning($"Max retries reached for record at ({pendingRecord.Record.Position.x}, {pendingRecord.Record.Position.y}, {pendingRecord.Record.Position.z}), dropping");
                yield break;
            }

            pendingRecord.RetryCount++;

            var batch = new
            {
                batchId = Guid.NewGuid().ToString(),
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                records = new[]
                {
                    new
                    {
                        id = pendingRecord.RecordId,
                        voxelX = pendingRecord.Record.Position.x,
                        voxelY = pendingRecord.Record.Position.y,
                        voxelZ = pendingRecord.Record.Position.z,
                        force = pendingRecord.Record.Force,
                        strength = pendingRecord.Record.Strength,
                        destroyedAt = DateTimeOffset.FromUnixTimeMilliseconds(pendingRecord.Record.Timestamp).UtcDateTime,
                        playerId = PlayerId
                    }
                }
            };

            string json = JsonUtility.ToJson(new DestructionBatchWrapper { batch = batch });
            byte[] bodyRaw = Encoding.UTF8.GetBytes(json);

            using (var request = new UnityWebRequest($"{ServerUrl}/api/v1/destruction", "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(bodyRaw);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");

                yield return request.SendWebRequest();

                if (request.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogWarning($"Failed to sync record (attempt {pendingRecord.RetryCount}/{MaxRetryAttempts}): {request.error}");
                    if (pendingRecord.RetryCount < MaxRetryAttempts)
                    {
                        yield return new WaitForSeconds(RetryDelay * pendingRecord.RetryCount);
                        lock (_retryLock)
                        {
                            _retryQueue.Enqueue(pendingRecord);
                        }
                    }
                }
                else
                {
                    string responseJson = request.downloadHandler.text;
                    var response = JsonUtility.FromJson<SyncResponse>(responseJson);

                    if (response.hasConflicts && response.failed != null && response.failed.Length > 0)
                    {
                        Debug.LogWarning($"Conflict detected for record at ({pendingRecord.Record.Position.x}, {pendingRecord.Record.Position.y}, {pendingRecord.Record.Position.z}), voxel already destroyed");
                    }
                    else
                    {
                        if (pendingRecord.RetryCount > 1)
                        {
                            Debug.Log($"Record synced successfully after {pendingRecord.RetryCount} attempts");
                        }
                    }
                }
            }
        }

        private List<object> ConvertRecords(List<VoxelDestructionRecord> records)
        {
            var result = new List<object>();
            foreach (var record in records)
            {
                result.Add(new
                {
                    id = Guid.NewGuid().ToString(),
                    voxelX = record.Position.x,
                    voxelY = record.Position.y,
                    voxelZ = record.Position.z,
                    force = record.Force,
                    strength = record.Strength,
                    destroyedAt = DateTimeOffset.FromUnixTimeMilliseconds(record.Timestamp).UtcDateTime,
                    playerId = PlayerId
                });
            }
            return result;
        }

        public IEnumerator GetWindParams()
        {
            using (var request = UnityWebRequest.Get($"{ServerUrl}/api/v1/wind"))
            {
                yield return request.SendWebRequest();

                if (request.result == UnityWebRequest.Result.Success)
                {
                    string json = request.downloadHandler.text;
                    var windData = JsonUtility.FromJson<WindParamsData>(json);

                    var windParams = new WindParams
                    {
                        Direction = new float3(windData.directionX, windData.directionY, windData.directionZ),
                        Speed = windData.speed,
                        Turbulence = windData.turbulence,
                        DeltaTime = Time.fixedDeltaTime
                    };

                    OnWindParamsReceived?.Invoke(windParams);

                    if (WindSimulator != null)
                    {
                        WindSimulator.UpdateWindParams(windParams);
                    }
                }
                else
                {
                    Debug.LogWarning($"Failed to get wind params: {request.error}");
                }
            }
        }

        public IEnumerator GetStats()
        {
            using (var request = UnityWebRequest.Get($"{ServerUrl}/api/v1/stats"))
            {
                yield return request.SendWebRequest();

                if (request.result == UnityWebRequest.Result.Success)
                {
                    string json = request.downloadHandler.text;
                    var statsData = JsonUtility.FromJson<StatsData>(json);

                    var stats = new GameStats
                    {
                        TotalVoxels = statsData.totalVoxels,
                        DestroyedVoxels = statsData.destroyedVoxels,
                        DestructionPercent = statsData.destructionPercent,
                        AverageForce = statsData.averageForce,
                        PeakForce = statsData.peakForce,
                        CurrentWindSpeed = statsData.currentWindSpeed
                    };

                    OnStatsReceived?.Invoke(stats);
                    GameEventManager.Instance?.TriggerStatsUpdated(stats);
                }
            }
        }

        public IEnumerator SetTotalVoxels(int total)
        {
            using (var request = UnityWebRequest.Put($"{ServerUrl}/api/v1/stats/total/{total}", ""))
            {
                yield return request.SendWebRequest();
            }
        }

        public IEnumerator SetWindSpeed(float speed)
        {
            using (var request = UnityWebRequest.Put($"{ServerUrl}/api/v1/wind/speed/{speed}", ""))
            {
                yield return request.SendWebRequest();
                yield return GetWindParams();
            }
        }

        public IEnumerator SetWindDirection(float x, float y, float z)
        {
            using (var request = UnityWebRequest.Put($"{ServerUrl}/api/v1/wind/direction/{x}/{y}/{z}", ""))
            {
                yield return request.SendWebRequest();
                yield return GetWindParams();
            }
        }

        public IEnumerator SetTurbulence(float turbulence)
        {
            using (var request = UnityWebRequest.Put($"{ServerUrl}/api/v1/wind/turbulence/{turbulence}", ""))
            {
                yield return request.SendWebRequest();
                yield return GetWindParams();
            }
        }

        public IEnumerator StartAutoWind()
        {
            using (var request = UnityWebRequest.Post($"{ServerUrl}/api/v1/wind/auto/start", ""))
            {
                yield return request.SendWebRequest();
            }
        }

        public IEnumerator StopAutoWind()
        {
            using (var request = UnityWebRequest.Post($"{ServerUrl}/api/v1/wind/auto/stop", ""))
            {
                yield return request.SendWebRequest();
            }
        }

        [Serializable]
        private class WindParamsData
        {
            public float directionX;
            public float directionY;
            public float directionZ;
            public float speed;
            public float turbulence;
            public long updatedAt;
        }

        [Serializable]
        private class StatsData
        {
            public int totalVoxels;
            public int destroyedVoxels;
            public float destructionPercent;
            public float averageForce;
            public float peakForce;
            public float currentWindSpeed;
        }

        [Serializable]
        private class DestructionBatchWrapper
        {
            public object batch;
        }

        [Serializable]
        private class SyncResponse
        {
            public string batchId;
            public int recorded;
            public VoxelDestructionRecord[] successful;
            public VoxelDestructionRecord[] failed;
            public bool hasConflicts;
        }

        public bool IsConnected => _isConnected;
    }
}
