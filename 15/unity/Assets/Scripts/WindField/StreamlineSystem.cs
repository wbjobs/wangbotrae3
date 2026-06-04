using System.Collections.Generic;
using UnityEngine;
using VoxelWindDestruction.Core;

namespace VoxelWindDestruction.WindField
{
    public struct StreamlineParticle
    {
        public string ID;
        public Vector3 Position;
        public Vector3 Velocity;
        public float Life;
        public float MaxLife;
        public List<Vector3> Trail;
        public int MaxTrail;
    }

    public class StreamlineSystem
    {
        private List<StreamlineParticle> particles;
        private WindFieldSimulator windField;
        private WindObstacleManager obstacleManager;
        private int maxParticles;
        private int gridSize;
        private float voxelSize;

        private Mesh streamlineMesh;
        private Material streamlineMaterial;

        public StreamlineSystem(WindFieldSimulator windSim, WindObstacleManager obsManager,
            int maxCount, int grid, float voxel)
        {
            windField = windSim;
            obstacleManager = obsManager;
            maxParticles = maxCount;
            gridSize = grid;
            voxelSize = voxel;

            particles = new List<StreamlineParticle>(maxParticles);

            Shader shader = Shader.Find("Hidden/VoxelWindDestruction/Streamline");
            if (shader != null)
            {
                streamlineMaterial = new Material(shader);
            }
            else
            {
                streamlineMaterial = new Material(Shader.Find("Particles/Standard Unlit"));
            }

            InitializeParticles();
        }

        private void InitializeParticles()
        {
            float halfSize = gridSize * voxelSize * 0.5f;
            for (int i = 0; i < maxParticles; i++)
            {
                SpawnParticle(null);
            }
        }

        private void SpawnParticle(Vector3? nearPos)
        {
            float halfSize = gridSize * voxelSize * 0.5f;
            Vector3 pos;

            if (nearPos.HasValue)
            {
                pos = nearPos.Value + new Vector3(
                    (Random.value - 0.5f) * 2f,
                    (Random.value - 0.5f) * 2f,
                    (Random.value - 0.5f) * 2f
                );
            }
            else
            {
                pos = new Vector3(
                    (Random.value - 0.5f) * halfSize * 2,
                    (Random.value - 0.5f) * halfSize * 2,
                    (Random.value - 0.5f) * halfSize * 2
                );
            }

            float maxLife = 3f + Random.value * 5f;

            StreamlineParticle p = new StreamlineParticle
            {
                ID = System.Guid.NewGuid().ToString("N").Substring(0, 8),
                Position = pos,
                Velocity = Vector3.zero,
                Life = maxLife,
                MaxLife = maxLife,
                Trail = new List<Vector3>(20),
                MaxTrail = 20
            };

            particles.Add(p);
        }

        public void Update(float dt)
        {
            float halfSize = gridSize * voxelSize * 0.5f * 1.2f;
            List<StreamlineParticle> active = new List<StreamlineParticle>(maxParticles);

            for (int i = 0; i < particles.Count; i++)
            {
                StreamlineParticle p = particles[i];

                float3 windVel = windField.GetWindVelocity(p.Position);
                p.Velocity = new Vector3(windVel.x, windVel.y, windVel.z);

                int gx = Mathf.Clamp(Mathf.FloorToInt((p.Position.x + halfSize) / voxelSize), 0, gridSize - 1);
                int gy = Mathf.Clamp(Mathf.FloorToInt((p.Position.y + halfSize) / voxelSize), 0, gridSize - 1);
                int gz = Mathf.Clamp(Mathf.FloorToInt((p.Position.z + halfSize) / voxelSize), 0, gridSize - 1);

                if (obstacleManager != null && obstacleManager.IsObstacle(gx, gy, gz))
                {
                    p.Life -= dt * 3f;
                }

                p.Trail.Add(p.Position);
                if (p.Trail.Count > p.MaxTrail)
                {
                    p.Trail.RemoveAt(0);
                }

                p.Position += p.Velocity * dt;
                p.Life -= dt;

                bool outOfBounds = Mathf.Abs(p.Position.x) > halfSize ||
                                   Mathf.Abs(p.Position.y) > halfSize ||
                                   Mathf.Abs(p.Position.z) > halfSize;

                if (p.Life > 0 && !outOfBounds)
                {
                    active.Add(p);
                }
            }

            particles = active;

            while (particles.Count < maxParticles)
            {
                SpawnParticle(null);
            }
        }

        public void SpawnParticlesAt(Vector3 position, int count)
        {
            for (int i = 0; i < count; i++)
            {
                SpawnParticle(position);
            }

            if (particles.Count > maxParticles * 2)
            {
                particles.RemoveRange(0, particles.Count - maxParticles);
            }
        }

        public List<StreamlineParticle> GetParticles()
        {
            return new List<StreamlineParticle>(particles);
        }

        public void Render()
        {
            if (streamlineMaterial == null || particles.Count == 0) return;

            GL.PushMatrix();
            streamlineMaterial.SetPass(0);

            GL.Begin(GL.LINES);

            for (int i = 0; i < particles.Count; i++)
            {
                StreamlineParticle p = particles[i];
                if (p.Trail.Count < 2) continue;

                float lifeRatio = p.Life / p.MaxLife;
                float speed = p.Velocity.magnitude;

                for (int j = 1; j < p.Trail.Count; j++)
                {
                    float trailFade = (float)j / p.Trail.Count;
                    float alpha = lifeRatio * trailFade;

                    float t = Mathf.Clamp01(speed / 200f);
                    Color color = Color.Lerp(Color.cyan, Color.yellow, t);
                    color.a = alpha;

                    GL.Color(color);
                    GL.Vertex(p.Trail[j - 1]);
                    GL.Vertex(p.Trail[j]);
                }

                if (p.Trail.Count > 0)
                {
                    float headAlpha = lifeRatio;
                    float ht = Mathf.Clamp01(speed / 200f);
                    Color headColor = Color.Lerp(Color.cyan, Color.red, ht);
                    headColor.a = headAlpha;

                    GL.Color(headColor);
                    GL.Vertex(p.Trail[p.Trail.Count - 1]);
                    GL.Vertex(p.Position);
                }
            }

            GL.End();
            GL.PopMatrix();
        }
    }
}
