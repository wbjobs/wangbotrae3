export interface Project {
  id: string;
  name: string;
  filename: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  point_count: number;
  dielectric_constant: number;
  filter_window: number;
  fitting_threshold: number;
  created_at: string;
}

export interface Annotation {
  id: string;
  project_id: string;
  label: string;
  color: string;
  points: number[][];
  box_min: number[];
  box_max: number[];
  created_at: string;
  updated_at: string;
}

export interface PointCloudSlice {
  slice_index: number;
  total_slices: number;
  points: Float32Array;
  colors: Float32Array;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export interface ReconstructionParams {
  dielectric_constant: number;
  filter_window_size: number;
  fitting_threshold: number;
  velocity: number;
}

export interface BScanPreview {
  traces: number;
  samples_per_trace: number;
  time_range: [number, number];
  amplitude_range: [number, number];
  image_base64: string;
}

export type ColorMapping = 'depth' | 'amplitude' | 'flat';
