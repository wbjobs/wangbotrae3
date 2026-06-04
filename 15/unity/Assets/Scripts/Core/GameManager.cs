using UnityEngine;
using VoxelWindDestruction.Voxelization;
using VoxelWindDestruction.WindField;
using VoxelWindDestruction.Destruction;
using VoxelWindDestruction.Particles;
using VoxelWindDestruction.Network;

namespace VoxelWindDestruction.Core
{
    public class GameManager : MonoBehaviour
    {
        [Header("场景设置")]
        public GameObject TargetModel;
        public bool AutoStart = true;

        [Header("组件引用")]
        public VoxelGrid VoxelGrid;
        public VoxelRenderer VoxelRenderer;
        public WindFieldSimulator WindSimulator;
        public DestructionManager DestructionManager;
        public DebrisParticleSystem DebrisParticles;
        public BackendClient BackendClient;

        [Header("调试")]
        public bool EnableDebug = true;

        private bool _isInitialized;

        private void Awake()
        {
            if (GameEventManager.Instance == null)
            {
                var eventObj = new GameObject("GameEventManager");
                eventObj.AddComponent<GameEventManager>();
            }

            FindComponents();
        }

        private void Start()
        {
            if (AutoStart)
            {
                InitializeSimulation();
            }

            GameEventManager.Instance.OnVoxelDestroyed += HandleVoxelDestroyed;
            GameEventManager.Instance.OnStatsUpdated += HandleStatsUpdated;
        }

        private void OnDestroy()
        {
            if (GameEventManager.Instance != null)
            {
                GameEventManager.Instance.OnVoxelDestroyed -= HandleVoxelDestroyed;
                GameEventManager.Instance.OnStatsUpdated -= HandleStatsUpdated;
            }
        }

        private void FindComponents()
        {
            if (VoxelGrid == null)
                VoxelGrid = FindObjectOfType<VoxelGrid>();
            if (VoxelRenderer == null)
                VoxelRenderer = FindObjectOfType<VoxelRenderer>();
            if (WindSimulator == null)
                WindSimulator = FindObjectOfType<WindFieldSimulator>();
            if (DestructionManager == null)
                DestructionManager = FindObjectOfType<DestructionManager>();
            if (DebrisParticles == null)
                DebrisParticles = FindObjectOfType<DebrisParticleSystem>();
            if (BackendClient == null)
                BackendClient = FindObjectOfType<BackendClient>();
        }

        public void InitializeSimulation()
        {
            if (_isInitialized) return;

            if (TargetModel != null && VoxelGrid != null)
            {
                MeshFilter[] meshFilters = TargetModel.GetComponentsInChildren<MeshFilter>();
                foreach (var meshFilter in meshFilters)
                {
                    if (meshFilter.sharedMesh != null)
                    {
                        VoxelGrid.VoxelizeMesh(meshFilter.sharedMesh, meshFilter.transform);
                    }
                }
            }

            if (WindSimulator != null)
            {
                VoxelGrid?.UpdateWindParams(WindSimulator.GetWindParams());
            }

            _isInitialized = true;

            if (EnableDebug)
            {
                Debug.Log($"[VoxelWind] 模拟初始化完成，体素数量: {VoxelGrid?.TotalVoxels ?? 0}");
            }
        }

        public void SetWindDirection(Vector3 direction)
        {
            if (WindSimulator != null)
            {
                var windParams = WindSimulator.GetWindParams();
                windParams.Direction = new float3(direction.x, direction.y, direction.z).Normalized();
                WindSimulator.UpdateWindParams(windParams);
                VoxelGrid?.UpdateWindParams(windParams);
            }
        }

        public void SetWindSpeed(float speed)
        {
            if (WindSimulator != null)
            {
                var windParams = WindSimulator.GetWindParams();
                windParams.Speed = speed;
                WindSimulator.UpdateWindParams(windParams);
                VoxelGrid?.UpdateWindParams(windParams);
            }
        }

        public void SetTurbulence(float turbulence)
        {
            if (WindSimulator != null)
            {
                var windParams = WindSimulator.GetWindParams();
                windParams.Turbulence = Mathf.Clamp01(turbulence);
                WindSimulator.UpdateWindParams(windParams);
                VoxelGrid?.UpdateWindParams(windParams);
            }
        }

        public void TriggerExplosion(Vector3 position, float radius, float force)
        {
            DestructionManager?.ApplyExplosion(position, radius, force);
        }

        public void ResetSimulation()
        {
            DestructionManager?.ResetStatistics();
            DebrisParticles?.ClearAllParticles();
            _isInitialized = false;
            InitializeSimulation();
        }

        private void HandleVoxelDestroyed(int x, int y, int z, float force, float strength)
        {
            if (EnableDebug && Random.value < 0.01f)
            {
                Debug.Log($"[VoxelWind] 体素破坏: ({x},{y},{z}) 受力: {force:F2} 强度: {strength:F2}");
            }
        }

        private void HandleStatsUpdated(GameStats stats)
        {
            if (EnableDebug)
            {
                Debug.Log($"[VoxelWind] 统计: 破坏 {stats.DestroyedVoxels}/{stats.TotalVoxels} ({stats.DestructionPercent:F2}%)");
            }
        }

        private void OnGUI()
        {
            if (!EnableDebug) return;

            GUILayout.BeginArea(new Rect(10, 10, 250, 200));
            GUILayout.BeginVertical("box");

            GUILayout.Label("体素风场破坏模拟", EditorStyleBold);
            GUILayout.Space(5);

            if (VoxelGrid != null)
            {
                GUILayout.Label($"总体素: {VoxelGrid.TotalVoxels:N0}", EditorStyle);
                GUILayout.Label($"已破坏: {VoxelGrid.DestroyedVoxels:N0}", EditorStyle);
                float percent = VoxelGrid.TotalVoxels > 0
                    ? (float)VoxelGrid.DestroyedVoxels / VoxelGrid.TotalVoxels * 100f
                    : 0;
                GUILayout.Label($"破坏率: {percent:F2}%", EditorStyle);
            }

            if (WindSimulator != null)
            {
                var wind = WindSimulator.GetWindParams();
                GUILayout.Label($"风速: {wind.Speed:F1} m/s", EditorStyle);
                GUILayout.Label($"湍流: {(wind.Turbulence * 100):F0}%", EditorStyle);
            }

            if (DebrisParticles != null)
            {
                GUILayout.Label($"粒子数: {DebrisParticles.GetActiveParticleCount()}", EditorStyle);
            }

            GUILayout.EndVertical();
            GUILayout.EndArea();
        }

        private static GUIStyle _editorStyle;
        private static GUIStyle _editorStyleBold;

        private static GUIStyle EditorStyle
        {
            get
            {
                if (_editorStyle == null)
                {
                    _editorStyle = new GUIStyle(GUI.skin.label);
                    _editorStyle.normal.textColor = Color.white;
                    _editorStyle.fontSize = 12;
                }
                return _editorStyle;
            }
        }

        private static GUIStyle EditorStyleBold
        {
            get
            {
                if (_editorStyleBold == null)
                {
                    _editorStyleBold = new GUIStyle(GUI.skin.label);
                    _editorStyleBold.normal.textColor = Color.white;
                    _editorStyleBold.fontSize = 14;
                    _editorStyleBold.fontStyle = FontStyle.Bold;
                }
                return _editorStyleBold;
            }
        }
    }
}
