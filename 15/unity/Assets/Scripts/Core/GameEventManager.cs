using System;
using System.Collections.Generic;
using UnityEngine;

namespace VoxelWindDestruction.Core
{
    public class GameEventManager : MonoBehaviour
    {
        private static GameEventManager _instance;
        public static GameEventManager Instance => _instance;

        public event Action<int, int, int, float, float> OnVoxelDestroyed;
        public event Action<int, int, int, float3> OnDebrisCreated;
        public event Action<GameStats> OnStatsUpdated;
        public event Action<WindParams> OnWindParamsUpdated;
        public event Action<float, float, Vector3> OnGustTriggered;

        private Queue<Action> _eventQueue = new Queue<Action>();
        private object _lock = new object();

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }
            _instance = this;
        }

        public void TriggerVoxelDestroyed(int x, int y, int z, float force, float strength)
        {
            lock (_lock)
            {
                _eventQueue.Enqueue(() => OnVoxelDestroyed?.Invoke(x, y, z, force, strength));
            }
        }

        public void TriggerDebrisCreated(int x, int y, int z, float3 velocity)
        {
            lock (_lock)
            {
                _eventQueue.Enqueue(() => OnDebrisCreated?.Invoke(x, y, z, velocity));
            }
        }

        public void TriggerStatsUpdated(GameStats stats)
        {
            lock (_lock)
            {
                _eventQueue.Enqueue(() => OnStatsUpdated?.Invoke(stats));
            }
        }

        public void TriggerWindParamsUpdated(WindParams windParams)
        {
            lock (_lock)
            {
                _eventQueue.Enqueue(() => OnWindParamsUpdated?.Invoke(windParams));
            }
        }

        public void TriggerGustTriggered(float strength, float duration, Vector3 direction)
        {
            lock (_lock)
            {
                _eventQueue.Enqueue(() => OnGustTriggered?.Invoke(strength, duration, direction));
            }
        }

        private void Update()
        {
            lock (_lock)
            {
                while (_eventQueue.Count > 0)
                {
                    _eventQueue.Dequeue()?.Invoke();
                }
            }
        }
    }
}
