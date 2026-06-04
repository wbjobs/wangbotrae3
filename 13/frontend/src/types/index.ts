export interface DeviceData {
  device_id: string;
  timestamp: string;
  temperature?: number;
  humidity?: number;
  voltage?: number;
  current?: number;
  pressure?: number;
  metadata?: Record<string, any>;
}

export interface DeviceSimulatorConfig {
  device_id: string;
  metrics: string[];
  interval: number;
  temperature_base: number;
  temperature_variance: number;
  humidity_base: number;
  humidity_variance: number;
  voltage_base: number;
  voltage_variance: number;
  current_base: number;
  current_variance: number;
  pressure_base: number;
  pressure_variance: number;
}

export interface AnomalyType {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface AnomalyConfig {
  anomaly_type: string;
  parameters: Record<string, any>;
  duration?: number;
  probability: number;
  start_time?: string;
  end_time?: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, any>;
  anomaly_config?: AnomalyConfig;
  execution_order?: number;
  delay_seconds?: number;
  condition_expression?: string;
  parallel_group?: string;
  branch_nodes?: string[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  delay_seconds?: number;
}

export interface Workflow {
  id?: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  device_ids: string[];
  template_id?: string;
  execution_mode?: 'sequential' | 'parallel' | 'mixed';
  created_at?: string;
}

export interface AnomalyTemplate {
  id?: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  workflow_data: Workflow;
  default_parameters?: Record<string, any>;
  is_builtin?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TemplateCategory {
  id: string;
  name: string;
  icon: string;
}

export interface NodeType {
  type: string;
  name: string;
  description: string;
  icon: string;
  has_input: boolean;
  has_output: boolean;
  parameters?: Record<string, any>;
}

export interface TimeTravelRequest {
  device_id: string;
  start_time: string;
  end_time: string;
  playback_speed: number;
  target_start_time?: string;
}

export interface AnomalyEvent {
  id: string;
  device_id: string;
  anomaly_type: string;
  timestamp: string;
  parameters: Record<string, any>;
  original_value?: any;
  injected_value?: any;
}

export interface DataPoint {
  timestamp: string;
  value: number;
  metric: string;
  device_id: string;
  is_injected: boolean;
  anomaly_type?: string;
}

export interface DeviceStatus {
  device_id: string;
  is_running: boolean;
  stats: {
    processed: number;
    injected: number;
    monotonicity_corrections: number;
  };
}

export interface TestCase {
  id: number;
  name: string;
  description: string;
  workflow_id: string;
  workflow_data: Workflow;
  device_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface InjectionRecord {
  id: number;
  workflow_id?: string;
  device_id: string;
  anomaly_type: string;
  parameters: Record<string, any>;
  start_time: string;
  end_time?: string;
  original_data_count: number;
  affected_data_count: number;
  created_at: string;
}

export interface PlaybackStatus {
  id: string;
  device_id: string;
  is_running: boolean;
  current_index: number;
  total_points: number;
  progress: number;
  playback_speed: number;
  original_start: string;
  original_end: string;
  created_at: string;
}

export interface WebSocketMessage {
  type: 'device_data' | 'anomaly_event' | 'stats' | 'workflow_update' | 'time_travel_update';
  device_id?: string;
  timestamp?: string;
  is_injected?: boolean;
  data?: Partial<DeviceData>;
  [key: string]: any;
}
