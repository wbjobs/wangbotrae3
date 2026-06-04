import React, { useEffect, useRef, useCallback } from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { WindPower as WindIcon, Warning as GustIcon } from '@mui/icons-material';

function PerlinNoise(seed) {
  const perm = new Array(512);
  const rng = (() => {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  })();

  const p = new Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 256; i++) {
    perm[i] = p[i];
    perm[256 + i] = p[i];
  }

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);

  const noise3D = (x, y, z) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const aaa = perm[perm[perm[xi] + yi] + zi];
    const aba = perm[perm[perm[xi] + yi + 1] + zi];
    const aab = perm[perm[perm[xi] + yi] + zi + 1];
    const abb = perm[perm[perm[xi] + yi + 1] + zi + 1];
    const baa = perm[perm[perm[xi + 1] + yi] + zi];
    const bba = perm[perm[perm[xi + 1] + yi + 1] + zi];
    const bab = perm[perm[perm[xi + 1] + yi] + zi + 1];
    const bbb = perm[perm[perm[xi + 1] + yi + 1] + zi + 1];

    const grad = (hash, gx, gy, gz) => {
      const h = hash & 15;
      const uVal = (h & 8) === 0 ? gx : gy;
      const vVal = (h & 4) === 0 ? gy : ((h & 12) === 12 ? gx : gz);
      return ((h & 1) === 0 ? uVal : -uVal) + ((h & 2) === 0 ? vVal : -vVal);
    };

    const x1 = lerp(grad(aaa, xf, yf, zf), grad(baa, xf - 1, yf, zf), u);
    const x2 = lerp(grad(aba, xf, yf - 1, zf), grad(bba, xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x1b = lerp(grad(aab, xf, yf, zf - 1), grad(bab, xf - 1, yf, zf - 1), u);
    const x2b = lerp(grad(abb, xf, yf - 1, zf - 1), grad(bbb, xf - 1, yf - 1, zf - 1), u);
    const y2 = lerp(x1b, x2b, v);

    return lerp(y1, y2, w);
  };

  const fractal3D = (x, y, z, octaves, persistence) => {
    let total = 0, frequency = 1, amplitude = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      total += noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / maxValue;
  };

  return { noise3D, fractal3D };
}

function WindVisualizer({ windParams, gustEvent, windFieldState, obstacles }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const obstaclesRef = useRef([]);
  const animationRef = useRef(null);
  const perlinRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(() => {
    perlinRef.current = {
      x: PerlinNoise(42),
      y: PerlinNoise(1042),
      z: PerlinNoise(2042),
    };
  }, []);

  useEffect(() => {
    if (obstacles) {
      obstaclesRef.current = obstacles;
    }
  }, [obstacles]);

  const samplePerlinWind = useCallback((x, y, time, scale, speed) => {
    const perlin = perlinRef.current;
    if (!perlin) return { vx: 0, vy: 0 };

    const offset = time * speed;
    const nx = perlin.x.fractal3D(x * scale + offset, y * scale, 0, 3, 0.5);
    const ny = perlin.y.fractal3D(x * scale, y * scale + offset, 0, 3, 0.5);

    const angleX = nx * Math.PI;
    const angleY = ny * Math.PI * 0.5;

    return {
      vx: Math.cos(angleX) * Math.cos(angleY),
      vy: Math.sin(angleY),
    };
  }, []);

  const isObstacleAt = useCallback((px, py, width, height) => {
    const obs = obstaclesRef.current;
    if (!obs || obs.length === 0) return false;

    const gridSize = 64;
    const gx = Math.floor((px / width) * gridSize);
    const gy = Math.floor((py / height) * gridSize);

    for (const obs_item of obs) {
      if (obs_item.voxelX === gx && obs_item.voxelY === gy && obs_item.active) {
        return true;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = 300;

    const particleCount = 200;
    particlesRef.current = [];

    for (let i = 0; i < particleCount; i++) {
      particlesRef.current.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 2 + 1,
        life: Math.random() * 200 + 100,
        maxLife: 300,
        trail: [],
        maxTrail: 15,
      });
    }

    const animate = () => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fillRect(0, 0, width, height);

      const windX = windParams?.directionX || 1;
      const windY = windParams?.directionY || 0;
      const windSpeed = (windParams?.speed || 50) / 50;
      const turbulence = windParams?.turbulence || 0.3;
      const noiseScale = 0.005;
      const noiseSpeed = 0.5;

      timeRef.current += 0.016;
      const time = timeRef.current;

      const gustActive = gustEvent?.active || false;
      const gustStrength = gustActive ? (gustEvent.strength || 0) / 100 : 0;
      const gustDirX = gustEvent?.directionX || 0;
      const gustDirY = gustEvent?.directionY || 0;

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];

        const perlin = samplePerlinWind(p.x, p.y, time, noiseScale, noiseSpeed);

        const baseVx = windX + perlin.vx * turbulence;
        const baseVy = windY + perlin.vy * turbulence;

        let vx = baseVx;
        let vy = baseVy;

        if (gustActive) {
          vx += gustDirX * gustStrength;
          vy += gustDirY * gustStrength;
        }

        if (isObstacleAt(p.x, p.y, width, height)) {
          const repelAngle = Math.atan2(p.y - height / 2, p.x - width / 2);
          vx += Math.cos(repelAngle) * 2;
          vy += Math.sin(repelAngle) * 2;
          p.life -= 2;
        }

        const totalSpeed = windSpeed + (gustActive ? gustStrength : 0);
        p.x += vx * p.speed * totalSpeed * 1.5;
        p.y += vy * p.speed * totalSpeed * 1.5;

        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > p.maxTrail) {
          p.trail.shift();
        }

        p.life -= 1;

        if (p.x > width + 20 || p.x < -20 || p.y > height + 20 || p.y < -20 || p.life <= 0) {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
          p.life = p.maxLife;
          p.trail = [];
        }

        const lifeRatio = p.life / p.maxLife;
        const speedMag = Math.sqrt(vx * vx + vy * vy);
        const hue = gustActive ? 30 + speedMag * 20 : 190 + speedMag * 30;
        const saturation = gustActive ? 100 : 80;
        const lightness = gustActive ? 60 + gustStrength * 20 : 55 + speedMag * 10;

        if (p.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let j = 1; j < p.trail.length; j++) {
            ctx.lineTo(p.trail[j].x, p.trail[j].y);
          }
          ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${lifeRatio * 0.4})`;
          ctx.lineWidth = p.size * lifeRatio;
          ctx.stroke();
        }

        ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${lifeRatio * 0.8})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * lifeRatio, 0, Math.PI * 2);
        ctx.fill();
      }

      const obs = obstaclesRef.current;
      if (obs && obs.length > 0) {
        const gridSize = 64;
        const cellW = width / gridSize;
        const cellH = height / gridSize;

        for (const o of obs) {
          if (o.active) {
            ctx.fillStyle = 'rgba(255, 80, 80, 0.15)';
            ctx.fillRect(o.voxelX * cellW, o.voxelY * cellH, cellW, cellH);
            ctx.strokeStyle = 'rgba(255, 80, 80, 0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(o.voxelX * cellW, o.voxelY * cellH, cellW, cellH);
          }
        }
      }

      const centerX = width * 0.88;
      const centerY = height * 0.2;
      const compassSize = 35;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, compassSize + 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, compassSize, 0, Math.PI * 2);
      ctx.stroke();

      const arrowLength = compassSize * 0.8;
      const endX = centerX + windX * arrowLength;
      const endY = centerY + windY * arrowLength;

      const arrowColor = gustActive ? '#ff9800' : `hsl(${190 + windSpeed * 20}, 80%, 60%)`;
      ctx.strokeStyle = arrowColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      const angle = Math.atan2(windY, windX);
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - 8 * Math.cos(angle - Math.PI / 6), endY - 8 * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - 8 * Math.cos(angle + Math.PI / 6), endY - 8 * Math.sin(angle + Math.PI / 6));
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '9px sans-serif';
      ctx.fillText('N', centerX - 2, centerY - compassSize - 5);
      ctx.fillText('S', centerX - 2, centerY + compassSize + 12);

      if (gustActive) {
        ctx.strokeStyle = 'rgba(255, 152, 0, 0.4)';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';
        ctx.fillRect(0, 0, width, height);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [windParams, gustEvent, samplePerlinWind, isObstacleAt]);

  return (
    <Box>
      <Box position="relative">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 300, borderRadius: 8 }}
        />
        {gustEvent?.active && (
          <Chip
            icon={<GustIcon />}
            label={`阵风 ${gustEvent.strength?.toFixed(0) || 0} m/s`}
            color="warning"
            size="small"
            sx={{ position: 'absolute', top: 8, left: 8 }}
          />
        )}
      </Box>
      <Box mt={2} display="flex" justifyContent="space-around" flexWrap="wrap" gap={1}>
        <Box textAlign="center">
          <Typography variant="caption" color="text.secondary">风向</Typography>
          <Typography variant="body2" fontWeight="bold">
            ({windParams?.directionX?.toFixed(2) || '0.00'},
            {windParams?.directionY?.toFixed(2) || '0.00'},
            {windParams?.directionZ?.toFixed(2) || '0.00'})
          </Typography>
        </Box>
        <Box textAlign="center">
          <Typography variant="caption" color="text.secondary">风速</Typography>
          <Typography variant="body2" fontWeight="bold" color={gustEvent?.active ? 'warning.main' : 'text.primary'}>
            <WindIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
            {(windParams?.speed || 0).toFixed(1)} m/s
          </Typography>
        </Box>
        <Box textAlign="center">
          <Typography variant="caption" color="text.secondary">湍流</Typography>
          <Typography variant="body2" fontWeight="bold">
            {((windParams?.turbulence || 0) * 100).toFixed(0)}%
          </Typography>
        </Box>
        <Box textAlign="center">
          <Typography variant="caption" color="text.secondary">障碍物</Typography>
          <Typography variant="body2" fontWeight="bold">
            {obstacles?.filter(o => o.active)?.length || 0}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default WindVisualizer;
