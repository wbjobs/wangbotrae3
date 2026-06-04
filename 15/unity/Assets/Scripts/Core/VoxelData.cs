using UnityEngine;

namespace VoxelWindDestruction.Core
{
    public struct VoxelData
    {
        public byte Active;
        public float Strength;
        public float3 Velocity;
        public float Pressure;
        public float Stress;
    }

    public struct WindParams
    {
        public float3 Direction;
        public float Speed;
        public float Turbulence;
        public float DeltaTime;
    }

    public struct VoxelDestructionRecord
    {
        public int3 Position;
        public float Force;
        public float Strength;
        public float3 Velocity;
        public long Timestamp;
    }

    public class GameStats
    {
        public int TotalVoxels;
        public int DestroyedVoxels;
        public float DestructionPercent;
        public float AverageForce;
        public float PeakForce;
        public float CurrentWindSpeed;
    }

    public static class VoxelConstants
    {
        public const int MAX_GRID_SIZE = 256;
        public const float DEFAULT_STRENGTH = 100f;
        public const float STRENGTH_DECAY = 0.1f;
        public const float FORCE_THRESHOLD = 0.5f;
    }
}
