using UnityEngine;
using UnityEditor;
using VoxelWindDestruction.Voxelization;
using VoxelWindDestruction.WindField;
using VoxelWindDestruction.Destruction;

namespace VoxelWindDestruction.Editor
{
    public class VoxelEditor : EditorWindow
    {
        private GameObject _targetObject;
        private int _gridSize = 64;
        private float _voxelSize = 0.5f;
        private float _defaultStrength = 100f;

        [MenuItem("Voxel Destruction/Voxel Setup")]
        public static void ShowWindow()
        {
            GetWindow<VoxelEditor>("体素化设置");
        }

        private void OnGUI()
        {
            GUILayout.Label("体素风场破坏模拟 - 设置工具", EditorStyles.boldLabel);
            EditorGUILayout.Space();

            _targetObject = (GameObject)EditorGUILayout.ObjectField(
                "目标模型",
                _targetObject,
                typeof(GameObject),
                true
            );

            _gridSize = EditorGUILayout.IntSlider("网格大小", _gridSize, 16, 256);
            _voxelSize = EditorGUILayout.FloatField("体素大小", _voxelSize);
            _defaultStrength = EditorGUILayout.FloatField("默认强度", _defaultStrength);

            EditorGUILayout.Space();

            if (GUILayout.Button("创建体素场景") && _targetObject != null)
            {
                CreateVoxelScene();
            }

            if (GUILayout.Button("创建风场系统"))
            {
                CreateWindSystem();
            }

            if (GUILayout.Button("创建完整系统"))
            {
                CreateCompleteSystem();
            }

            EditorGUILayout.HelpBox(
                "网格大小建议使用8的倍数以优化ComputeShader性能\n" +
                "最大支持256x256x256的体素网格",
                MessageType.Info
            );
        }

        private void CreateVoxelScene()
        {
            GameObject voxelRoot = new GameObject("VoxelScene");
            var grid = voxelRoot.AddComponent<VoxelGrid>();
            var renderer = voxelRoot.AddComponent<VoxelRenderer>();
            var destruction = voxelRoot.AddComponent<DestructionManager>();

            grid.GridSize = _gridSize;
            grid.VoxelSize = _voxelSize;
            grid.DefaultStrength = _defaultStrength;

            voxelRoot.transform.position = _targetObject.transform.position;
            grid.GridCenter = _targetObject.transform.position;

            var computeShaders = AssetDatabase.FindAssets("t:ComputeShader");
            foreach (var guid in computeShaders)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var shader = AssetDatabase.LoadAssetAtPath<ComputeShader>(path);

                if (shader.name.Contains("Voxelize"))
                    grid.VoxelizeShader = shader;
                if (shader.name.Contains("Force"))
                    grid.ForceShader = shader;
                if (shader.name.Contains("Destruction"))
                    grid.DestructionShader = shader;
            }

            var materials = AssetDatabase.FindAssets("t:Material");
            foreach (var guid in materials)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (mat.name.Contains("VoxelInstanced"))
                    renderer.VoxelMaterial = mat;
            }

            Selection.activeGameObject = voxelRoot;
            EditorUtility.DisplayDialog("成功", "体素场景已创建", "确定");
        }

        private void CreateWindSystem()
        {
            GameObject windRoot = new GameObject("WindSystem");
            var windSim = windRoot.AddComponent<WindFieldSimulator>();

            windSim.GridSize = _gridSize;

            var computeShaders = AssetDatabase.FindAssets("t:ComputeShader");
            foreach (var guid in computeShaders)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var shader = AssetDatabase.LoadAssetAtPath<ComputeShader>(path);
                if (shader.name.Contains("Fluid"))
                    windSim.FluidShader = shader;
            }

            Selection.activeGameObject = windRoot;
            EditorUtility.DisplayDialog("成功", "风场系统已创建", "确定");
        }

        private void CreateCompleteSystem()
        {
            GameObject root = new GameObject("VoxelWindSystem");

            GameObject eventManager = new GameObject("EventManager");
            eventManager.transform.parent = root.transform;
            eventManager.AddComponent<Core.GameEventManager>();

            GameObject voxelScene = new GameObject("VoxelScene");
            voxelScene.transform.parent = root.transform;
            var grid = voxelScene.AddComponent<VoxelGrid>();
            var renderer = voxelScene.AddComponent<VoxelRenderer>();
            var destruction = voxelScene.AddComponent<DestructionManager>();

            grid.GridSize = _gridSize;
            grid.VoxelSize = _voxelSize;
            grid.DefaultStrength = _defaultStrength;

            GameObject windSystem = new GameObject("WindSystem");
            windSystem.transform.parent = root.transform;
            var windSim = windSystem.AddComponent<WindFieldSimulator>();
            windSim.GridSize = _gridSize;

            GameObject particles = new GameObject("DebrisParticles");
            particles.transform.parent = root.transform;
            var debris = particles.AddComponent<Particles.DebrisParticleSystem>();
            debris.VoxelGrid = grid;
            debris.WindSimulator = windSim;

            GameObject network = new GameObject("NetworkClient");
            network.transform.parent = root.transform;
            var client = network.AddComponent<Network.BackendClient>();
            client.DestructionManager = destruction;
            client.WindSimulator = windSim;

            var computeShaders = AssetDatabase.FindAssets("t:ComputeShader");
            foreach (var guid in computeShaders)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var shader = AssetDatabase.LoadAssetAtPath<ComputeShader>(path);

                if (shader.name.Contains("Voxelize"))
                    grid.VoxelizeShader = shader;
                if (shader.name.Contains("Force"))
                    grid.ForceShader = shader;
                if (shader.name.Contains("Destruction"))
                    grid.DestructionShader = shader;
                if (shader.name.Contains("Fluid"))
                    windSim.FluidShader = shader;
            }

            var materials = AssetDatabase.FindAssets("t:Material");
            foreach (var guid in materials)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (mat.name.Contains("VoxelInstanced"))
                {
                    renderer.VoxelMaterial = mat;
                    debris.ParticleMaterial = mat;
                }
            }

            Selection.activeGameObject = root;
            EditorUtility.DisplayDialog("成功", "完整系统已创建", "确定");
        }
    }
}
