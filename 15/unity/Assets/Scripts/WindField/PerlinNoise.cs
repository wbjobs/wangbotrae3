using System;
using UnityEngine;

namespace VoxelWindDestruction.WindField
{
    public class PerlinNoise
    {
        private int[] permutation;

        public PerlinNoise(long seed)
        {
            permutation = new int[512];
            Random rng = new Random((int)seed);

            for (int i = 0; i < 256; i++)
            {
                permutation[i] = i;
            }

            for (int i = 255; i > 0; i--)
            {
                int j = rng.Next(i + 1);
                (permutation[i], permutation[j]) = (permutation[j], permutation[i]);
            }

            for (int i = 0; i < 256; i++)
            {
                permutation[256 + i] = permutation[i];
            }
        }

        private static float Fade(float t)
        {
            return t * t * t * (t * (t * 6 - 15) + 10);
        }

        private static float Lerp(float a, float b, float t)
        {
            return a + t * (b - a);
        }

        private static float Grad(int hash, float x, float y, float z)
        {
            int h = hash & 15;
            float u = (h & 8) == 0 ? x : y;
            float v = (h & 4) == 0 ? y : ((h & 12) == 12 ? x : z);

            float result = (h & 1) == 0 ? u : -u;
            result += (h & 2) == 0 ? v : -v;

            return result;
        }

        public float Noise3D(float x, float y, float z)
        {
            int xi = Mathf.FloorToInt(x) & 255;
            int yi = Mathf.FloorToInt(y) & 255;
            int zi = Mathf.FloorToInt(z) & 255;

            float xf = x - Mathf.Floor(x);
            float yf = y - Mathf.Floor(y);
            float zf = z - Mathf.Floor(z);

            float u = Fade(xf);
            float v = Fade(yf);
            float w = Fade(zf);

            int aaa = permutation[permutation[permutation[xi] + yi] + zi];
            int aba = permutation[permutation[permutation[xi] + yi + 1] + zi];
            int aab = permutation[permutation[permutation[xi] + yi] + zi + 1];
            int abb = permutation[permutation[permutation[xi] + yi + 1] + zi + 1];
            int baa = permutation[permutation[permutation[xi + 1] + yi] + zi];
            int bba = permutation[permutation[permutation[xi + 1] + yi + 1] + zi];
            int bab = permutation[permutation[permutation[xi + 1] + yi] + zi + 1];
            int bbb = permutation[permutation[permutation[xi + 1] + yi + 1] + zi + 1];

            float x1 = Lerp(Grad(aaa, xf, yf, zf), Grad(baa, xf - 1, yf, zf), u);
            float x2 = Lerp(Grad(aba, xf, yf - 1, zf), Grad(bba, xf - 1, yf - 1, zf), u);
            float y1 = Lerp(x1, x2, v);

            x1 = Lerp(Grad(aab, xf, yf, zf - 1), Grad(bab, xf - 1, yf, zf - 1), u);
            x2 = Lerp(Grad(abb, xf, yf - 1, zf - 1), Grad(bbb, xf - 1, yf - 1, zf - 1), u);
            float y2 = Lerp(x1, x2, v);

            return Lerp(y1, y2, w);
        }

        public float FractalNoise3D(float x, float y, float z, int octaves, float persistence)
        {
            float total = 0f;
            float frequency = 1f;
            float amplitude = 1f;
            float maxValue = 0f;

            for (int i = 0; i < octaves; i++)
            {
                total += Noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
                maxValue += amplitude;
                amplitude *= persistence;
                frequency *= 2;
            }

            return total / maxValue;
        }
    }

    public class PerlinWindFieldGenerator
    {
        private PerlinNoise noiseX;
        private PerlinNoise noiseY;
        private PerlinNoise noiseZ;

        public PerlinWindFieldGenerator(long seed)
        {
            noiseX = new PerlinNoise(seed);
            noiseY = new PerlinNoise(seed + 1000);
            noiseZ = new PerlinNoise(seed + 2000);
        }

        public void Sample(float x, float y, float z, float time, float scale, float speed,
            out float nx, out float ny, out float nz)
        {
            float offset = time * speed;

            nx = noiseX.FractalNoise3D(x * scale + offset, y * scale, z * scale, 3, 0.5f);
            ny = noiseY.FractalNoise3D(x * scale, y * scale + offset, z * scale, 3, 0.5f);
            nz = noiseZ.FractalNoise3D(x * scale, y * scale, z * scale + offset, 3, 0.5f);
        }

        public void SampleDirection(float x, float y, float z, float time, float scale, float speed,
            out float dx, out float dy, out float dz)
        {
            Sample(x, y, z, time, scale, speed, out float nx, out float ny, out float nz);

            float angleX = nx * Mathf.PI;
            float angleY = ny * Mathf.PI * 0.5f;

            dx = Mathf.Cos(angleX) * Mathf.Cos(angleY);
            dy = Mathf.Sin(angleY);
            dz = Mathf.Sin(angleX) * Mathf.Cos(angleY);
        }

        public void SampleCurl(float x, float y, float z, float time, float scale, float speed, float strength,
            out float cx, out float cy, out float cz)
        {
            float eps = 0.0001f;

            Sample(x, y + eps, z, time, scale, speed, out _, out float dy1, out _);
            Sample(x, y - eps, z, time, scale, speed, out _, out float dy2, out _);
            Sample(x, y, z + eps, time, scale, speed, out _, out _, out float dz1);
            Sample(x, y, z - eps, time, scale, speed, out _, out _, out float dz2);
            Sample(x + eps, y, z, time, scale, speed, out float dx1, out _, out _);
            Sample(x - eps, y, z, time, scale, speed, out float dx2, out _, out _);

            cx = (dz1 - dz2) / (2 * eps) - (dy1 - dy2) / (2 * eps);
            cy = (dx1 - dx2) / (2 * eps) - (dz1 - dz2) / (2 * eps);
            cz = (dy1 - dy2) / (2 * eps) - (dx1 - dx2) / (2 * eps);

            float mag = Mathf.Sqrt(cx * cx + cy * cy + cz * cz);
            if (mag > 0)
            {
                cx /= mag;
                cy /= mag;
                cz /= mag;
            }

            cx *= strength;
            cy *= strength;
            cz *= strength;
        }
    }
}
