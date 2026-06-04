import React from 'react';
import { Grid, Paper, Box, Typography, LinearProgress } from '@mui/material';
import {
  ViewModule as CubeIcon,
  HeartBroken as BrokenIcon,
  TrendingUp as TrendIcon,
  Wind as WindIcon,
  FlashOn as ForceIcon
} from '@mui/icons-material';

function StatsOverview({ stats }) {
  if (!stats) return null;

  const statCards = [
    {
      title: '总体素数',
      value: stats.totalVoxels?.toLocaleString() || '0',
      icon: <CubeIcon sx={{ fontSize: 32 }} />,
      color: 'primary',
      subValue: `${stats.gridSize || 64}³ 网格`
    },
    {
      title: '已破坏',
      value: stats.destroyedVoxels?.toLocaleString() || '0',
      icon: <BrokenIcon sx={{ fontSize: 32 }} />,
      color: 'error',
      progress: stats.destructionPercent || 0,
      subValue: `${(stats.destructionPercent || 0).toFixed(2)}%`
    },
    {
      title: '当前风速',
      value: `${(stats.currentWindSpeed || 0).toFixed(1)} m/s`,
      icon: <WindIcon sx={{ fontSize: 32 }} />,
      color: 'info',
      subValue: getWindLevel(stats.currentWindSpeed || 0)
    },
    {
      title: '平均受力',
      value: `${(stats.averageForce || 0).toFixed(2)}`,
      icon: <TrendIcon sx={{ fontSize: 32 }} />,
      color: 'success',
      subValue: `峰值: ${(stats.peakForce || 0).toFixed(2)}`
    }
  ];

  return (
    <Grid container spacing={3}>
      {statCards.map((card, index) => (
        <Grid item xs={12} sm={6} lg={3} key={index}>
          <Paper sx={{ p: 3, position: 'relative', overflow: 'hidden' }}>
            <Box sx={{
              position: 'absolute',
              top: -10,
              right: -10,
              opacity: 0.1,
              color: `${card.color}.main`
            }}>
              {React.cloneElement(card.icon, { sx: { fontSize: 100 } })}
            </Box>

            <Box display="flex" alignItems="flex-start" gap={2}>
              <Box color={`${card.color}.main`}>
                {card.icon}
              </Box>
              <Box flex={1}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {card.title}
                </Typography>
                <Typography variant="h4" fontWeight="bold" gutterBottom>
                  {card.value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {card.subValue}
                </Typography>
                {card.progress !== undefined && (
                  <Box mt={1}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(card.progress, 100)}
                      color={card.color}
                      sx={{ borderRadius: 4, height: 6 }}
                    />
                  </Box>
                )}
              </Box>
            </Box>
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}

function getWindLevel(speed) {
  if (speed < 20) return '微风';
  if (speed < 40) return '轻风';
  if (speed < 60) return '和风';
  if (speed < 80) return '劲风';
  if (speed < 100) return '大风';
  if (speed < 150) return '狂风';
  return '飓风';
}

export default StatsOverview;
