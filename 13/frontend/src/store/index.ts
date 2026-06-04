import { create } from 'zustand';
import type {
  DeviceSimulatorConfig,
  DeviceData,
  AnomalyEvent,
  Workflow,
  DeviceStatus,
} from '@/types';

interface AppState {
  devices: DeviceSimulatorConfig[];
  deviceStatuses: Record<string, DeviceStatus>;
  deviceData: Record<string, DeviceData[]>;
  anomalyEvents: AnomalyEvent[];
  workflows: Workflow[];
  activeWorkflowId: string | null;
  selectedDeviceId: string | null;
  isConnected: boolean;
  
  setDevices: (devices: DeviceSimulatorConfig[]) => void;
  addDevice: (device: DeviceSimulatorConfig) => void;
  removeDevice: (deviceId: string) => void;
  updateDeviceStatus: (deviceId: string, status: DeviceStatus) => void;
  
  addDeviceData: (deviceId: string, data: DeviceData & { is_injected: boolean }) => void;
  clearDeviceData: (deviceId: string) => void;
  
  addAnomalyEvent: (event: AnomalyEvent) => void;
  clearAnomalyEvents: () => void;
  
  setWorkflows: (workflows: Workflow[]) => void;
  addWorkflow: (workflow: Workflow) => void;
  removeWorkflow: (workflowId: string) => void;
  setActiveWorkflow: (workflowId: string | null) => void;
  
  setSelectedDevice: (deviceId: string | null) => void;
  setConnected: (connected: boolean) => void;
}

const MAX_DATA_POINTS = 500;

export const useAppStore = create<AppState>((set) => ({
  devices: [],
  deviceStatuses: {},
  deviceData: {},
  anomalyEvents: [],
  workflows: [],
  activeWorkflowId: null,
  selectedDeviceId: null,
  isConnected: false,

  setDevices: (devices) => set({ devices }),
  addDevice: (device) => set((state) => ({
    devices: [...state.devices, device],
  })),
  removeDevice: (deviceId) => set((state) => ({
    devices: state.devices.filter((d) => d.device_id !== deviceId),
    deviceStatuses: Object.fromEntries(
      Object.entries(state.deviceStatuses).filter(([id]) => id !== deviceId)
    ),
    deviceData: Object.fromEntries(
      Object.entries(state.deviceData).filter(([id]) => id !== deviceId)
    ),
  })),
  updateDeviceStatus: (deviceId, status) => set((state) => ({
    deviceStatuses: { ...state.deviceStatuses, [deviceId]: status },
  })),

  addDeviceData: (deviceId, data) => set((state) => {
    const existingData = state.deviceData[deviceId] || [];
    const newData = [...existingData, data].slice(-MAX_DATA_POINTS);
    return {
      deviceData: { ...state.deviceData, [deviceId]: newData },
    };
  }),
  clearDeviceData: (deviceId) => set((state) => ({
    deviceData: { ...state.deviceData, [deviceId]: [] },
  })),

  addAnomalyEvent: (event) => set((state) => ({
    anomalyEvents: [event, ...state.anomalyEvents].slice(0, 200),
  })),
  clearAnomalyEvents: () => set({ anomalyEvents: [] }),

  setWorkflows: (workflows) => set({ workflows }),
  addWorkflow: (workflow) => set((state) => ({
    workflows: [...state.workflows, workflow],
  })),
  removeWorkflow: (workflowId) => set((state) => ({
    workflows: state.workflows.filter((w) => w.id !== workflowId),
    activeWorkflowId: state.activeWorkflowId === workflowId ? null : state.activeWorkflowId,
  })),
  setActiveWorkflow: (workflowId) => set({ activeWorkflowId: workflowId }),

  setSelectedDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  setConnected: (connected) => set({ isConnected: connected }),
}));
