using System.Collections.Generic;
using UnityEngine;
using VoxelWindDestruction.Core;
using VoxelWindDestruction.Voxelization;
using VoxelWindDestruction.WindField;

namespace VoxelWindDestruction.Particles
{
    public class DebrisParticleSystem : MonoBehaviour
    {
        [Header("Particle Settings")]
        public int MaxParticles = 10000;
        public float ParticleSize = 0.3f;
        public float ParticleLifetime = 5f;
        public float Drag = 0.98f;
        public float Gravity = 9.8f;
        public float WindInfluence = 0.8f;

        [Header("Rendering")]
        public Material ParticleMaterial;
        public Mesh ParticleMesh;

        [Header("References")]
        public VoxelGrid VoxelGrid;
        public WindFieldSimulator WindSimulator;

        private struct DebrisParticle
        {
            public Vector3 Position;
            public Vector3 Velocity;
            public Vector3 AngularVelocity;
            public float Lifetime;
            public float MaxLifetime;
            public float Size;
            public Color Color;
            public bool Active;
        }

        private DebrisParticle[] _particles;
        private Matrix4x4[] _matrices;
        private Vector4[] _colors;
        private MaterialPropertyBlock _propBlock;
        private Queue<int> _freeIndices;
        private int _activeCount;

        private void Awake()
        {
            InitializeParticles();
            GameEventManager.Instance.OnDebrisCreated += HandleDebrisCreated;
        }

        private void OnDestroy()
        {
            if (GameEventManager.Instance != null)
            {
                GameEventManager.Instance.OnDebrisCreated -= HandleDebrisCreated;
            }
        }

        private void InitializeParticles()
        {
            _particles = new DebrisParticle[MaxParticles];
            _matrices = new Matrix4x4[MaxParticles];
            _colors = new Vector4[MaxParticles];
            _propBlock = new MaterialPropertyBlock();
            _freeIndices = new Queue<int>();

            for (int i = 0; i < MaxParticles; i++)
            {
                _particles[i] = new DebrisParticle { Active = false };
                _freeIndices.Enqueue(i);
            }

            if (ParticleMesh == null)
            {
                ParticleMesh = CreateCubeMesh();
            }
        }

        private Mesh CreateCubeMesh()
        {
            Mesh mesh = new Mesh();
            float size = 0.5f;

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

        private void HandleDebrisCreated(int x, int y, int z, float3 velocity)
        {
            Vector3 worldPos = VoxelGrid.GetVoxelWorldPosition(x, y, z);
            SpawnDebris(worldPos, new Vector3(velocity.x, velocity.y, velocity.z));
        }

        public void SpawnDebris(Vector3 position, Vector3 velocity)
        {
            int debrisCount = Random.Range(3, 8);

            for (int i = 0; i < debrisCount; i++)
            {
                if (_freeIndices.Count == 0) break;

                int index = _freeIndices.Dequeue();

                Vector3 offset = Random.insideUnitSphere * ParticleSize * 0.5f;
                Vector3 randomVel = Random.insideUnitSphere * 5f;
                Vector3 angularVel = Random.insideUnitSphere * 10f;

                _particles[index] = new DebrisParticle
                {
                    Position = position + offset,
                    Velocity = velocity + randomVel,
                    AngularVelocity = angularVel,
                    Lifetime = ParticleLifetime,
                    MaxLifetime = ParticleLifetime,
                    Size = ParticleSize * Random.Range(0.5f, 1.5f),
                    Color = GetRandomDebrisColor(),
                    Active = true
                };

                _activeCount++;
            }
        }

        private Color GetRandomDebrisColor()
        {
            float gray = Random.Range(0.4f, 0.7f);
            return new Color(gray * 1.1f, gray * 0.9f, gray * 0.8f, 1f);
        }

        private void Update()
        {
            float dt = Time.deltaTime;
            Vector3 gravity = Vector3.down * Gravity;

            _activeCount = 0;

            for (int i = 0; i < _particles.Length; i++)
            {
                if (!_particles[i].Active) continue;

                ref DebrisParticle p = ref _particles[i];

                p.Lifetime -= dt;

                if (p.Lifetime <= 0)
                {
                    p.Active = false;
                    _freeIndices.Enqueue(i);
                    continue;
                }

                _activeCount++;

                if (WindSimulator != null)
                {
                    float3 windVel = WindSimulator.GetWindVelocity(p.Position);
                    Vector3 windForce = new Vector3(windVel.x, windVel.y, windVel.z) * WindInfluence * dt;
                    p.Velocity += windForce;
                }

                p.Velocity += gravity * dt;
                p.Velocity *= Mathf.Pow(Drag, dt * 60f);

                p.Position += p.Velocity * dt;

                float alpha = p.Lifetime / p.MaxLifetime;
                p.Color.a = alpha;

                Quaternion rotation = Quaternion.Euler(p.AngularVelocity * p.Lifetime);
                _matrices[i] = Matrix4x4.TRS(p.Position, rotation, Vector3.one * p.Size);
                _colors[i] = p.Color;
            }
        }

        private void LateUpdate()
        {
            if (_activeCount == 0 || ParticleMaterial == null || ParticleMesh == null) return;

            int batchSize = 1023;
            int batchCount = Mathf.CeilToInt((float)_activeCount / batchSize);

            int activeIndex = 0;
            for (int batch = 0; batch < batchCount; batch++)
            {
                int count = Mathf.Min(batchSize, _activeCount - activeIndex);

                Matrix4x4[] batchMatrices = new Matrix4x4[count];
                Vector4[] batchColors = new Vector4[count];

                int batchIndex = 0;
                for (int i = 0; i < _particles.Length && batchIndex < count; i++)
                {
                    if (_particles[i].Active)
                    {
                        batchMatrices[batchIndex] = _matrices[i];
                        batchColors[batchIndex] = _colors[i];
                        batchIndex++;
                    }
                }

                if (ParticleMaterial.HasProperty("_InstanceColor"))
                {
                    _propBlock.SetVectorArray("_InstanceColor", batchColors);
                }

                Graphics.DrawMeshInstanced(
                    ParticleMesh,
                    0,
                    ParticleMaterial,
                    batchMatrices,
                    count,
                    _propBlock,
                    UnityEngine.Rendering.ShadowCastingMode.On,
                    true
                );

                activeIndex += count;
            }
        }

        public int GetActiveParticleCount()
        {
            return _activeCount;
        }

        public void ClearAllParticles()
        {
            for (int i = 0; i < _particles.Length; i++)
            {
                if (_particles[i].Active)
                {
                    _particles[i].Active = false;
                    _freeIndices.Enqueue(i);
                }
            }
            _activeCount = 0;
        }
    }
}
