using System.Collections.Generic;
using UnityEngine;
using VoxelWindDestruction.Core;
using VoxelWindDestruction.Voxelization;

namespace VoxelWindDestruction.WindField
{
    public class WindObstacleManager : MonoBehaviour
    {
        private Dictionary<int, Dictionary<int, Dictionary<int, bool>>> obstacleGrid;
        private VoxelGrid voxelGrid;

        public int GridSize = 64;

        private void Awake()
        {
            obstacleGrid = new Dictionary<int, Dictionary<int, Dictionary<int, bool>>>();
            voxelGrid = FindObjectOfType<VoxelGrid>();
        }

        public void InitializeFromVoxelGrid()
        {
            if (voxelGrid == null) return;

            VoxelData[] data = voxelGrid.GetVoxelData();
            for (int x = 0; x < voxelGrid.GridSize; x++)
            {
                for (int y = 0; y < voxelGrid.GridSize; y++)
                {
                    for (int z = 0; z < voxelGrid.GridSize; z++)
                    {
                        int index = x + y * voxelGrid.GridSize + z * voxelGrid.GridSize * voxelGrid.GridSize;
                        if (index < data.Length && data[index].Active == 1)
                        {
                            SetObstacle(x, y, z, true);
                        }
                    }
                }
            }
        }

        public void SetObstacle(int x, int y, int z, bool active)
        {
            if (!obstacleGrid.ContainsKey(x))
            {
                obstacleGrid[x] = new Dictionary<int, Dictionary<int, bool>>();
            }
            if (!obstacleGrid[x].ContainsKey(y))
            {
                obstacleGrid[x][y] = new Dictionary<int, bool>();
            }
            obstacleGrid[x][y][z] = active;
        }

        public bool IsObstacle(int x, int y, int z)
        {
            if (obstacleGrid.TryGetValue(x, out var yz))
            {
                if (yz.TryGetValue(y, out var zMap))
                {
                    if (zMap.TryGetValue(z, out bool active))
                    {
                        return active;
                    }
                }
            }
            return false;
        }

        public float3 ApplyObstacleAvoidance(int x, int y, int z, float3 velocity, float strength)
        {
            float avoidX = 0, avoidY = 0, avoidZ = 0;
            int avoidCount = 0;

            for (int dx = -2; dx <= 2; dx++)
            {
                for (int dy = -2; dy <= 2; dy++)
                {
                    for (int dz = -2; dz <= 2; dz++)
                    {
                        if (dx == 0 && dy == 0 && dz == 0) continue;

                        int nx = x + dx;
                        int ny = y + dy;
                        int nz = z + dz;

                        if (IsObstacle(nx, ny, nz))
                        {
                            float dist = Mathf.Sqrt(dx * dx + dy * dy + dz * dz);
                            float avoidFactor = 1f / (dist * dist);

                            avoidX -= dx * avoidFactor;
                            avoidY -= dy * avoidFactor;
                            avoidZ -= dz * avoidFactor;
                            avoidCount++;
                        }
                    }
                }
            }

            if (avoidCount > 0)
            {
                float avoidMag = Mathf.Sqrt(avoidX * avoidX + avoidY * avoidY + avoidZ * avoidZ);
                if (avoidMag > 0)
                {
                    avoidX /= avoidMag;
                    avoidY /= avoidMag;
                    avoidZ /= avoidMag;

                    float blend = Mathf.Min(1f, (float)avoidCount / 12f);
                    float newX = velocity.x * (1 - blend) + avoidX * blend * strength;
                    float newY = velocity.y * (1 - blend) + avoidY * blend * strength;
                    float newZ = velocity.z * (1 - blend) + avoidZ * blend * strength;

                    return new float3(newX, newY, newZ);
                }
            }

            return velocity;
        }

        public List<int3> GetDestroyedVoxelsNear(int x, int y, int z, int radius)
        {
            List<int3> result = new List<int3>();
            for (int dx = -radius; dx <= radius; dx++)
            {
                for (int dy = -radius; dy <= radius; dy++)
                {
                    for (int dz = -radius; dz <= radius; dz++)
                    {
                        int nx = x + dx;
                        int ny = y + dy;
                        int nz = z + dz;
                        if (!IsObstacle(nx, ny, nz))
                        {
                            float dist = Mathf.Sqrt(dx * dx + dy * dy + dz * dz);
                            if (dist <= radius)
                            {
                                result.Add(new int3(nx, ny, nz));
                            }
                        }
                    }
                }
            }
            return result;
        }
    }
}
