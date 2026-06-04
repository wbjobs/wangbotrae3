import React, { useState, useEffect } from 'react';
import {
  Box,
  Slider,
  Typography,
  Grid,
  Button,
  Stack,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Alert
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  Storm as StormIcon,
  Air as AirIcon
} from '@mui/icons-material';
import { windApi } from '../services/api.js';

function WindControls({ windParams, onChange }) {
  const [speed, setSpeed] = useState(50);
  const [direction, setDirection] = useState({ x: 1, y: 0, z: 0.5 });
  const [turbulence, setTurbulence] = useState(0.3);
  const [autoWind, setAutoWind] = useState(true);
  const [eddyStrength, setEddyStrength] = useState(0.5);
  const [noiseScale, setNoiseScale] = useState(0.1);
  const [noiseSpeed, setNoiseSpeed] = useState(1.0);
  const [gustStrength, setGustStrength] = useState(100);
  const [gustDuration, setGustDuration] = useState(3);
  const [gustDirection, setGustDirection] = useState({ x: 1, y: 0, z: 0 });
  const [gustActive, setGustActive] = useState(false);
  const [gustError, setGustError] = useState('');

  useEffect(() => {
    if (windParams) {
      setSpeed(windParams.speed || 50);
      setDirection({
        x: windParams.directionX || 1,
        y: windParams.directionY || 0,
        z: windParams.directionZ || 0
      });
      setTurbulence(windParams.turbulence || 0.3);
    }
  }, [windParams]);

  const handleSpeedCommit = async () => {
    try {
      await windApi.setSpeed(speed);
      if (onChange) onChange({ ...windParams, speed });
    } catch (e) { console.error('Failed to set speed:', e); }
  };

  const handleDirectionCommit = async () => {
    try {
      await windApi.setDirection(direction.x, direction.y, direction.z);
      if (onChange) onChange({ ...windParams, directionX: direction.x, directionY: direction.y, directionZ: direction.z });
    } catch (e) { console.error('Failed to set direction:', e); }
  };

  const handleTurbulenceCommit = async () => {
    try {
      await windApi.setTurbulence(turbulence);
      if (onChange) onChange({ ...windParams, turbulence });
    } catch (e) { console.error('Failed to set turbulence:', e); }
  };

  const toggleAutoWind = async () => {
    try {
      if (autoWind) {
        await windApi.stopAuto();
      } else {
        await windApi.startAuto();
      }
      setAutoWind(!autoWind);
    } catch (e) { console.error('Failed to toggle auto wind:', e); }
  };

  const handleTriggerGust = async () => {
    setGustError('');
    try {
      await windApi.triggerGust(gustStrength, gustDuration, gustDirection.x, gustDirection.y, gustDirection.z);
      setGustActive(true);
      setTimeout(() => setGustActive(false), gustDuration * 1000);
    } catch (e) {
      setGustError(e.response?.data?.error || '阵风触发失败');
    }
  };

  const handleTriggerGust3s = async () => {
    setGustError('');
    try {
      await windApi.triggerGust3s(gustStrength, gustDirection.x, gustDirection.y, gustDirection.z);
      setGustActive(true);
      setTimeout(() => setGustActive(false), 3000);
    } catch (e) {
      setGustError(e.response?.data?.error || '阵风触发失败');
    }
  };

  const handleCancelGust = async () => {
    try {
      await windApi.cancelGust();
      setGustActive(false);
    } catch (e) { console.error('Failed to cancel gust:', e); }
  };

  const presetDirections = [
    { label: '东', value: { x: 1, y: 0, z: 0 } },
    { label: '南', value: { x: 0, y: 0, z: 1 } },
    { label: '西', value: { x: -1, y: 0, z: 0 } },
    { label: '北', value: { x: 0, y: 0, z: -1 } },
    { label: '上升', value: { x: 0, y: 1, z: 0 } },
    { label: '下降', value: { x: 0, y: -1, z: 0 } },
  ];

  const speedPresets = [
    { label: '微风', value: 20 },
    { label: '和风', value: 50 },
    { label: '劲风', value: 80 },
    { label: '狂风', value: 120 },
    { label: '飓风', value: 180 },
  ];

  return (
    <Stack spacing={3}>
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="subtitle2">自动风场模拟</Typography>
          <Button
            variant={autoWind ? 'contained' : 'outlined'}
            color={autoWind ? 'success' : 'secondary'}
            size="small"
            startIcon={autoWind ? <StopIcon /> : <PlayIcon />}
            onClick={toggleAutoWind}
          >
            {autoWind ? '停止' : '开始'}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {autoWind ? '风场参数将自动动态变化' : '可手动调节风场参数'}
        </Typography>
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          风速: {speed.toFixed(1)} m/s
        </Typography>
        <Slider
          value={speed}
          onChange={(_, v) => setSpeed(v)}
          onChangeCommitted={handleSpeedCommit}
          min={0} max={200} step={1}
          marks={speedPresets.map(p => ({ value: p.value, label: p.label }))}
          disabled={autoWind}
        />
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>风向</Typography>
        <Stack direction="row" spacing={1} mb={2}>
          {presetDirections.map((preset) => (
            <Button
              key={preset.label}
              size="small"
              variant="outlined"
              onClick={() => {
                setDirection(preset.value);
                windApi.setDirection(preset.value.x, preset.value.y, preset.value.z);
              }}
              disabled={autoWind}
            >
              {preset.label}
            </Button>
          ))}
        </Stack>
        <Grid container spacing={2}>
          {['x', 'y', 'z'].map(axis => (
            <Grid item xs={4} key={axis}>
              <TextField
                label={axis.toUpperCase()}
                type="number"
                size="small"
                value={direction[axis].toFixed(2)}
                onChange={(e) => setDirection(prev => ({ ...prev, [axis]: parseFloat(e.target.value) }))}
                onBlur={handleDirectionCommit}
                disabled={autoWind}
                inputProps={{ step: 0.1, min: -1, max: 1 }}
                fullWidth
              />
            </Grid>
          ))}
        </Grid>
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          湍流强度: {(turbulence * 100).toFixed(0)}%
        </Typography>
        <Slider
          value={turbulence}
          onChange={(_, v) => setTurbulence(v)}
          onChangeCommitted={handleTurbulenceCommit}
          min={0} max={1} step={0.01}
          marks={[
            { value: 0, label: '平静' },
            { value: 0.5, label: '中等' },
            { value: 1, label: '剧烈' }
          ]}
          disabled={autoWind}
        />
      </Box>

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">
            <AirIcon sx={{ fontSize: 16, mr: 1, verticalAlign: 'middle' }} />
            高级风场参数
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">涡流强度: {eddyStrength.toFixed(2)}</Typography>
              <Slider
                value={eddyStrength}
                onChange={(_, v) => setEddyStrength(v)}
                min={0} max={1} step={0.01}
              />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">噪声尺度: {noiseScale.toFixed(3)}</Typography>
              <Slider
                value={noiseScale}
                onChange={(_, v) => setNoiseScale(v)}
                min={0.01} max={0.5} step={0.005}
              />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">噪声速度: {noiseSpeed.toFixed(2)}</Typography>
              <Slider
                value={noiseSpeed}
                onChange={(_, v) => setNoiseSpeed(v)}
                min={0.1} max={5} step={0.1}
              />
            </Box>
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="subtitle2">
            <StormIcon sx={{ fontSize: 16, mr: 1, verticalAlign: 'middle', color: 'warning.main' }} />
            阵风事件
          </Typography>
          {gustActive && <Chip label="阵风进行中" color="warning" size="small" />}
        </Box>

        {gustError && <Alert severity="error" sx={{ mb: 1 }}>{gustError}</Alert>}

        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">阵风强度: {gustStrength} m/s</Typography>
            <Slider
              value={gustStrength}
              onChange={(_, v) => setGustStrength(v)}
              min={10} max={300} step={5}
              disabled={gustActive}
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">持续时间: {gustDuration}s</Typography>
            <Slider
              value={gustDuration}
              onChange={(_, v) => setGustDuration(v)}
              min={1} max={10} step={0.5}
              disabled={gustActive}
            />
          </Box>
          <Grid container spacing={1}>
            {['x', 'y', 'z'].map(axis => (
              <Grid item xs={4} key={axis}>
                <TextField
                  label={`风向${axis.toUpperCase()}`}
                  type="number"
                  size="small"
                  value={gustDirection[axis].toFixed(1)}
                  onChange={(e) => setGustDirection(prev => ({ ...prev, [axis]: parseFloat(e.target.value) }))}
                  disabled={gustActive}
                  inputProps={{ step: 0.1, min: -1, max: 1 }}
                  fullWidth
                />
              </Grid>
            ))}
          </Grid>
          <Stack direction="row" spacing={1}>
            <Button
              fullWidth
              variant="contained"
              color="warning"
              startIcon={<StormIcon />}
              onClick={handleTriggerGust}
              disabled={gustActive}
            >
              触发阵风
            </Button>
            <Button
              fullWidth
              variant="outlined"
              color="warning"
              onClick={handleTriggerGust3s}
              disabled={gustActive}
            >
              快速3秒阵风
            </Button>
          </Stack>
          {gustActive && (
            <Button
              fullWidth
              variant="outlined"
              color="error"
              onClick={handleCancelGust}
            >
              取消阵风
            </Button>
          )}
        </Stack>
      </Box>

      <Box>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => {
            setSpeed(50);
            setDirection({ x: 1, y: 0, z: 0.5 });
            setTurbulence(0.3);
            setEddyStrength(0.5);
            setNoiseScale(0.1);
            setNoiseSpeed(1.0);
            setGustStrength(100);
            setGustDuration(3);
            onChange && onChange({
              speed: 50, directionX: 1, directionY: 0, directionZ: 0.5, turbulence: 0.3
            });
          }}
        >
          重置参数
        </Button>
      </Box>
    </Stack>
  );
}

export default WindControls;
