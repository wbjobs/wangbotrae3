import { create } from 'zustand';
import type { Device, DiagnosisResult, BatchTask, DeviceStatus } from '../../shared/types';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface Alert {
  id: string;
  deviceId: string;
  deviceName: string;
  status: DeviceStatus;
  confidence: number;
  timestamp: number;
  message: string;
}

interface DiagnosisState {
  currentDevice: Device | null;
  devices: Device[];
  diagnosisHistory: DiagnosisResult[];
  latestDiagnosis: DiagnosisResult | null;
  alerts: Alert[];
  batchTasks: BatchTask[];
  connectionStatus: ConnectionStatus;
  waveformData: number[];
  signalBuffer: number[];
  
  setCurrentDevice: (device: Device | null) => void;
  setDevices: (devices: Device[]) => void;
  addDiagnosisResult: (result: DiagnosisResult) => void;
  setDiagnosisHistory: (history: DiagnosisResult[]) => void;
  setLatestDiagnosis: (diagnosis: DiagnosisResult | null) => void;
  addAlert: (alert: Alert) => void;
  clearAlerts: () => void;
  removeAlert: (id: string) => void;
  addBatchTask: (task: BatchTask) => void;
  updateBatchTask: (id: string, updates: Partial<BatchTask>) => void;
  setBatchTasks: (tasks: BatchTask[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  addWaveformData: (data: number[]) => void;
  clearWaveformData: () => void;
  setSignalBuffer: (data: number[]) => void;
}

const MAX_SIGNAL_POINTS = 100000;
const MAX_HISTORY_ITEMS = 1000;
const MAX_ALERTS = 100;

export const useDiagnosisStore = create<DiagnosisState>((set) => ({
  currentDevice: null,
  devices: [],
  diagnosisHistory: [],
  latestDiagnosis: null,
  alerts: [],
  batchTasks: [],
  connectionStatus: 'disconnected',
  waveformData: [],
  signalBuffer: [],

  setCurrentDevice: (device) => set({ currentDevice: device }),
  
  setDevices: (devices) => set({ devices }),
  
  addDiagnosisResult: (result) => set((state) => {
    const newHistory = [result, ...state.diagnosisHistory].slice(0, MAX_HISTORY_ITEMS);
    return {
      diagnosisHistory: newHistory,
      latestDiagnosis: result,
    };
  }),
  
  setDiagnosisHistory: (history) => set({ diagnosisHistory: history }),
  
  setLatestDiagnosis: (diagnosis) => set({ latestDiagnosis: diagnosis }),
  
  addAlert: (alert) => set((state) => {
    if (state.alerts.some(a => a.id === alert.id)) return state;
    const newAlerts = [alert, ...state.alerts].slice(0, MAX_ALERTS);
    return { alerts: newAlerts };
  }),
  
  clearAlerts: () => set({ alerts: [] }),
  
  removeAlert: (id) => set((state) => ({
    alerts: state.alerts.filter(a => a.id !== id),
  })),
  
  addBatchTask: (task) => set((state) => ({
    batchTasks: [task, ...state.batchTasks],
  })),
  
  updateBatchTask: (id, updates) => set((state) => ({
    batchTasks: state.batchTasks.map(task =>
      task.id === id ? { ...task, ...updates } : task
    ),
  })),
  
  setBatchTasks: (tasks) => set({ batchTasks: tasks }),
  
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  
  addWaveformData: (data) => set((state) => {
    const newData = [...state.waveformData, ...data];
    const trimmed = newData.slice(-MAX_SIGNAL_POINTS);
    return { waveformData: trimmed };
  }),
  
  clearWaveformData: () => set({ waveformData: [], signalBuffer: [] }),
  
  setSignalBuffer: (data) => set({ signalBuffer: data }),
}));
