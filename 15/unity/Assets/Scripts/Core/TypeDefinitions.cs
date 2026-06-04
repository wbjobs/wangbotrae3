using System.Runtime.InteropServices;
using Unity.Mathematics;

namespace VoxelWindDestruction.Core
{
    [StructLayout(LayoutKind.Sequential)]
    public struct int3
    {
        public int x;
        public int y;
        public int z;

        public int3(int x, int y, int z)
        {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        public static int3 zero => new int3(0, 0, 0);
        public static int3 one => new int3(1, 1, 1);

        public static implicit operator int3(Unity.Mathematics.int3 v)
        {
            return new int3(v.x, v.y, v.z);
        }

        public static implicit operator Unity.Mathematics.int3(int3 v)
        {
            return new Unity.Mathematics.int3(v.x, v.y, v.z);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct float3
    {
        public float x;
        public float y;
        public float z;

        public float3(float x, float y, float z)
        {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        public static float3 zero => new float3(0, 0, 0);
        public static float3 one => new float3(1, 1, 1);
        public static float3 forward => new float3(0, 0, 1);
        public static float3 back => new float3(0, 0, -1);
        public static float3 up => new float3(0, 1, 0);
        public static float3 down => new float3(0, -1, 0);
        public static float3 right => new float3(1, 0, 0);
        public static float3 left => new float3(-1, 0, 0);

        public float Length()
        {
            return math.sqrt(x * x + y * y + z * z);
        }

        public float3 Normalized()
        {
            float len = Length();
            if (len > 0)
            {
                return new float3(x / len, y / len, z / len);
            }
            return zero;
        }

        public static implicit operator float3(Unity.Mathematics.float3 v)
        {
            return new float3(v.x, v.y, v.z);
        }

        public static implicit operator Unity.Mathematics.float3(float3 v)
        {
            return new Unity.Mathematics.float3(v.x, v.y, v.z);
        }

        public static implicit operator float3(UnityEngine.Vector3 v)
        {
            return new float3(v.x, v.y, v.z);
        }

        public static implicit operator UnityEngine.Vector3(float3 v)
        {
            return new UnityEngine.Vector3(v.x, v.y, v.z);
        }

        public static float3 operator +(float3 a, float3 b)
        {
            return new float3(a.x + b.x, a.y + b.y, a.z + b.z);
        }

        public static float3 operator -(float3 a, float3 b)
        {
            return new float3(a.x - b.x, a.y - b.y, a.z - b.z);
        }

        public static float3 operator *(float3 a, float s)
        {
            return new float3(a.x * s, a.y * s, a.z * s);
        }

        public static float3 operator *(float s, float3 a)
        {
            return new float3(a.x * s, a.y * s, a.z * s);
        }

        public static float3 operator /(float3 a, float s)
        {
            return new float3(a.x / s, a.y / s, a.z / s);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct float4
    {
        public float x;
        public float y;
        public float z;
        public float w;

        public float4(float x, float y, float z, float w)
        {
            this.x = x;
            this.y = y;
            this.z = z;
            this.w = w;
        }

        public static implicit operator float4(Unity.Mathematics.float4 v)
        {
            return new float4(v.x, v.y, v.z, v.w);
        }

        public static implicit operator Unity.Mathematics.float4(float4 v)
        {
            return new Unity.Mathematics.float4(v.x, v.y, v.z, v.w);
        }
    }

    public static class math
    {
        public static float sqrt(float v) => Unity.Mathematics.math.sqrt(v);
        public static float abs(float v) => Unity.Mathematics.math.abs(v);
        public static float sin(float v) => Unity.Mathematics.math.sin(v);
        public static float cos(float v) => Unity.Mathematics.math.cos(v);
        public static float lerp(float a, float b, float t) => Unity.Mathematics.math.lerp(a, b, t);
        public static float3 normalize(float3 v)
        {
            float len = v.Length();
            if (len > 0)
            {
                return new float3(v.x / len, v.y / len, v.z / len);
            }
            return float3.zero;
        }
        public static float3 lerp(float3 a, float3 b, float t)
        {
            return new float3(
                a.x + (b.x - a.x) * t,
                a.y + (b.y - a.y) * t,
                a.z + (b.z - a.z) * t
            );
        }
        public static int clamp(int v, int min, int max)
        {
            return v < min ? min : v > max ? max : v;
        }
        public static float clamp(float v, float min, float max)
        {
            return v < min ? min : v > max ? max : v;
        }
        public static float3 clamp(float3 v, float min, float max)
        {
            return new float3(
                clamp(v.x, min, max),
                clamp(v.y, min, max),
                clamp(v.z, min, max)
            );
        }
    }
}
