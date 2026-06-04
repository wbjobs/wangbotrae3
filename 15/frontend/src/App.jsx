import React, { useState, useEffect } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  Chip,
  CircularProgress
} from '@mui/material';
import {
  Speed as SpeedIcon,
  Timeline as TimelineIcon,
  BrokenImage as BrokenIcon,
  Wind as WindIcon
} from '@mui/icons-material';
import StatsOverview from './components/StatsOverview.jsx';
import WindControls from './components/WindControls.jsx';
import DestructionChart from './components/DestructionChart.jsx';
import DestructionHistory from './components/DestructionHistory.jsx';
import WindVisualizer from './components/WindVisualizer.jsx';
import { windApi, statsApi } from './services/api.js';
import websocket from './services/websocket.js';

function App() {
  const [stats, setStats] = useState(null);
  const [windParams, setWindParams] = useState(null);
  const [destructionHistory, setDestructionHistory] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInitialData();
    websocket.connect('dashboard');

    websocket.on('connected', setIsConnected);
    websocket.on('wind', handleWindUpdate);
    websocket.on('destruction', handleDestructionUpdate);

    return () => {
      websocket.disconnect();
    };
  }, []);

  const loadInitialData = async () => {
    try {
      const [windRes, statsRes] = await Promise.all([
        windApi.getParams(),
        statsApi.getStats()
      ]);

      setWindParams(windRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error('Failed to load initial data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleWindUpdate = (data) => {
    setWindParams(data);
    if (stats) {
      setStats(prev => ({ ...prev, currentWindSpeed: data.speed }));
    }
  };

  const handleDestructionUpdate = (data) => {
    if (Array.isArray(data)) {
      setDestructionHistory(prev => [...data.slice(0, 50), ...prev].slice(0, 100));
    }
    statsApi.getStats().then(res => setStats(res.data));
  };

  const handleWindParamsChange = async (newParams) => {
    try {
      await windApi.updateParams(newParams);
      const res = await windApi.getParams();
      setWindParams(res.data);
    } catch (error) {
      console.error('Failed to update wind params:', error);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box mb={4}>
        <Box display="flex" alignItems="center" gap={2} mb={1}>
          <Typography variant="h4" component="h1" fontWeight="bold">
            体素风场破坏模拟
          </Typography>
          <Chip
            icon={isConnected ? <WindIcon /> : <WindIcon />}
            label={isConnected ? '已连接' : '连接中断'}
            color={isConnected ? 'success' : 'error'}
            size="small"
          />
        </Box>
        <Typography variant="body2" color="text.secondary">
          实时监控风场参数与破坏数据统计
        </Typography>
      </Box>

      <StatsOverview stats={stats} />

      <Grid container spacing={3} sx={{ mt: 2 }}>
        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <SpeedIcon color="primary" />
              <Typography variant="h6" fontWeight="bold">风场参数控制</Typography>
            </Box>
            <WindControls
              windParams={windParams}
              onChange={handleWindParamsChange}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} lg={6}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <TimelineIcon color="primary" />
              <Typography variant="h6" fontWeight="bold">风场可视化</Typography>
            </Box>
            <WindVisualizer windParams={windParams} />
          </Paper>
        </Grid>

        <Grid item xs={12} lg={7}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <TimelineIcon color="secondary" />
              <Typography variant="h6" fontWeight="bold">破坏趋势图表</Typography>
            </Box>
            <DestructionChart stats={stats} destructionHistory={destructionHistory} />
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              <BrokenIcon color="error" />
              <Typography variant="h6" fontWeight="bold">破坏记录</Typography>
            </Box>
            <DestructionHistory records={destructionHistory} />
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}

export default App;
