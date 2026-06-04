import { useCallback, useEffect } from 'react';
import { useDiagnosisStore } from '../store/diagnosisStore';
import { diagnosisApi } from '../api';
import type { Device, HistoryFilter } from '../../shared/types';
import { generateId } from '../utils/format';

export function useDiagnosis() {
  const {
    currentDevice,
    devices,
    diagnosisHistory,
    latestDiagnosis,
    alerts,
    batchTasks,
    connectionStatus,
    waveformData,
    setCurrentDevice,
    setDevices,
    addDiagnosisResult,
    setDiagnosisHistory,
    setLatestDiagnosis,
    addAlert,
    clearAlerts,
    removeAlert,
    addBatchTask,
    updateBatchTask,
    setBatchTasks,
    clearWaveformData,
  } = useDiagnosisStore();

  const fetchDevices = useCallback(async () => {
    try {
      const response = await diagnosisApi.getDevices();
      if (response.code === 200) {
        setDevices(response.data);
        if (response.data.length > 0 && !currentDevice) {
          setCurrentDevice(response.data[0]);
        }
      }
    } catch (error) {
      console.error('Failed to fetch devices:', error);
      const mockDevices: Device[] = [
        {
          id: 'dev-001',
          name: '电机组A-01',
          type: '异步电动机',
          location: '1号车间-A区',
          sampleRate: 10000,
          sensorCount: 3,
          status: 'online',
          createdAt: Date.now() - 86400000 * 30,
          updatedAt: Date.now(),
        },
        {
          id: 'dev-002',
          name: '齿轮箱B-02',
          type: '行星齿轮箱',
          location: '2号车间-B区',
          sampleRate: 10000,
          sensorCount: 4,
          status: 'online',
          createdAt: Date.now() - 86400000 * 20,
          updatedAt: Date.now(),
        },
        {
          id: 'dev-003',
          name: '泵站C-03',
          type: '离心泵',
          location: '3号车间-C区',
          sampleRate: 5000,
          sensorCount: 2,
          status: 'maintenance',
          createdAt: Date.now() - 86400000 * 15,
          updatedAt: Date.now(),
        },
      ];
      setDevices(mockDevices);
      if (!currentDevice) {
        setCurrentDevice(mockDevices[0]);
      }
    }
  }, [currentDevice, setCurrentDevice, setDevices]);

  const fetchDiagnosisHistory = useCallback(async (filter: HistoryFilter) => {
    try {
      const response = await diagnosisApi.getDiagnosisHistory(filter);
      if (response.code === 200) {
        setDiagnosisHistory(response.data.items);
      }
    } catch (error) {
      console.error('Failed to fetch diagnosis history:', error);
    }
  }, [setDiagnosisHistory]);

  const fetchBatchTasks = useCallback(async () => {
    try {
      const response = await diagnosisApi.getBatchTasks();
      if (response.code === 200) {
        setBatchTasks(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch batch tasks:', error);
    }
  }, [setBatchTasks]);

  const uploadAndDiagnose = useCallback(async (file: File, deviceId: string) => {
    const taskId = generateId();
    const mockTask = {
      id: taskId,
      deviceId,
      fileName: file.name,
      fileSize: file.size,
      status: 'pending' as const,
      progress: 0,
      totalCount: 1,
      completedCount: 0,
      createdAt: Date.now(),
    };
    addBatchTask(mockTask);

    try {
      updateBatchTask(taskId, { status: 'processing', progress: 20 });

      await new Promise(resolve => setTimeout(resolve, 500));
      updateBatchTask(taskId, { progress: 50 });

      await new Promise(resolve => setTimeout(resolve, 500));
      updateBatchTask(taskId, { progress: 80 });

      await new Promise(resolve => setTimeout(resolve, 500));
      const mockResult = {
        ...mockTask,
        status: 'completed' as const,
        progress: 100,
        completedCount: 1,
        completedAt: Date.now(),
        resultPath: `/results/${taskId}`,
      };
      updateBatchTask(taskId, mockResult);

      return mockResult;
    } catch (error) {
      updateBatchTask(taskId, {
        status: 'failed',
        progress: 0,
        errorMessage: error instanceof Error ? error.message : '上传失败',
      });
      throw error;
    }
  }, [addBatchTask, updateBatchTask]);

  const selectDevice = useCallback((device: Device | null) => {
    setCurrentDevice(device);
    clearWaveformData();
    setLatestDiagnosis(null);
  }, [setCurrentDevice, clearWaveformData, setLatestDiagnosis]);

  const simulateWaveform = useCallback(() => {
    const sampleRate = currentDevice?.sampleRate || 10000;
    const chunkSize = Math.floor(sampleRate / 50);
    const data: number[] = [];
    const time = Date.now() / 1000;

    for (let i = 0; i < chunkSize; i++) {
      const t = time + i / sampleRate;
      const noise = (Math.random() - 0.5) * 0.2;
      const freq1 = Math.sin(2 * Math.PI * 50 * t) * 0.5;
      const freq2 = Math.sin(2 * Math.PI * 120 * t) * 0.3;
      data.push(freq1 + freq2 + noise);
    }

    return data;
  }, [currentDevice]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  return {
    currentDevice,
    devices,
    diagnosisHistory,
    latestDiagnosis,
    alerts,
    batchTasks,
    connectionStatus,
    waveformData,
    fetchDevices,
    fetchDiagnosisHistory,
    fetchBatchTasks,
    uploadAndDiagnose,
    selectDevice,
    addDiagnosisResult,
    addAlert,
    clearAlerts,
    removeAlert,
    clearWaveformData,
    simulateWaveform,
  };
}

export default useDiagnosis;
