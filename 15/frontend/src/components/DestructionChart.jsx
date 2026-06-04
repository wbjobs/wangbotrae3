import React, { useEffect, useState, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Box, Typography } from '@mui/material';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

function DestructionChart({ stats, destructionHistory }) {
  const [chartData, setChartData] = useState({
    labels: [],
    datasets: [
      {
        label: '累计破坏数',
        data: [],
        borderColor: 'rgb(239, 68, 68)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.4,
        yAxisID: 'y'
      },
      {
        label: '瞬时受力',
        data: [],
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: false,
        tension: 0.4,
        yAxisID: 'y1'
      }
    ]
  });

  const historyRef = useRef([]);

  useEffect(() => {
    if (destructionHistory && destructionHistory.length > 0) {
      const newRecords = destructionHistory.filter(
        r => !historyRef.current.some(h => h.id === r.id)
      );

      if (newRecords.length > 0 || historyRef.current.length === 0) {
        historyRef.current = destructionHistory.slice(0, 100);

        const labels = [];
        const destroyedData = [];
        const forceData = [];

        let cumulative = stats?.destroyedVoxels - destructionHistory.length || 0;

        destructionHistory.slice(0, 30).reverse().forEach((record, idx) => {
          const time = new Date(record.destroyedAt || record.timestamp);
          labels.push(time.toLocaleTimeString());
          cumulative += 1;
          destroyedData.push(cumulative);
          forceData.push(record.force || 0);
        });

        setChartData(prev => ({
          ...prev,
          labels,
          datasets: [
            { ...prev.datasets[0], data: destroyedData },
            { ...prev.datasets[1], data: forceData }
          ]
        }));
      }
    }
  }, [destructionHistory, stats]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: 'rgba(255, 255, 255, 0.7)',
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8
      }
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(255, 255, 255, 0.05)'
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          maxTicksLimit: 8
        }
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: '累计破坏数',
          color: 'rgba(239, 68, 68, 0.8)'
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.05)'
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)'
        }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: '受力大小',
          color: 'rgba(59, 130, 246, 0.8)'
        },
        grid: {
          drawOnChartArea: false
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)'
        }
      }
    }
  };

  return (
    <Box>
      <Box height={300}>
        <Line data={chartData} options={options} />
      </Box>
      <Box mt={2} display="flex" justifyContent="space-around">
        <Box textAlign="center">
          <Typography variant="caption" color="text.secondary">破坏率</Typography>
          <Typography variant="h6" color="error" fontWeight="bold">
            {(stats?.destructionPercent || 0).toFixed(2)}%
          </Typography>
        </Box>
        <Box textAlign="center">
          <Typography variant="caption" color="text.secondary">峰值受力</Typography>
          <Typography variant="h6" color="primary" fontWeight="bold">
            {(stats?.peakForce || 0).toFixed(2)}
          </Typography>
        </Box>
        <Box textAlign="center">
          <Typography variant="caption" color="text.secondary">平均受力</Typography>
          <Typography variant="h6" color="success.main" fontWeight="bold">
            {(stats?.averageForce || 0).toFixed(2)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default DestructionChart;
