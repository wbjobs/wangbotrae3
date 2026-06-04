import type { Project, Annotation, PointCloudSlice, BScanPreview, ReconstructionParams } from '@/types';

const API_BASE = 'http://localhost:8000';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, options);
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function uploadProject(
  file: File,
  params: ReconstructionParams
): Promise<Project> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', file.name.replace(/\.json$/i, ''));
  formData.append('dielectric_constant', String(params.dielectric_constant));
  formData.append('filter_window', String(params.filter_window_size));
  formData.append('fitting_threshold', String(params.fitting_threshold));
  return request<Project>('/api/projects', {
    method: 'POST',
    body: formData,
  });
}

export async function getProjects(): Promise<Project[]> {
  const data = await request<{ projects: Project[] }>('/api/projects');
  return data.projects ?? [];
}

export async function getProjectStatus(id: string): Promise<Project> {
  const data = await request<{ id: string; status: string; point_count: number }>(`/api/projects/${id}/status`);
  const projects = useProjectsCache();
  const existing = projects.find((p) => p.id === id);
  if (existing) {
    return { ...existing, status: data.status as Project['status'], point_count: data.point_count };
  }
  return data as unknown as Project;
}

let _projectsCache: Project[] = [];
function useProjectsCache(): Project[] {
  return _projectsCache;
}
export function setProjectsCache(projects: Project[]) {
  _projectsCache = projects;
}

export async function getPointCloudSlice(
  id: string,
  sliceIndex: number,
  sliceCount: number
): Promise<PointCloudSlice> {
  const data = await request<{
    points: number[];
    colors: number[];
    total: number;
  }>(`/api/projects/${id}/pointcloud?slice_index=${sliceIndex}&slice_count=${sliceCount}`);

  const pointCount = data.total || (data.points.length / 3);
  const pts = data.points;
  const cols = data.colors;

  let minArr = [Infinity, Infinity, Infinity];
  let maxArr = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      if (pts[i + j] < minArr[j]) minArr[j] = pts[i + j];
      if (pts[i + j] > maxArr[j]) maxArr[j] = pts[i + j];
    }
  }

  return {
    slice_index: sliceIndex,
    total_slices: sliceCount,
    points: new Float32Array(pts),
    colors: new Float32Array(cols),
    bounds: {
      min: minArr as [number, number, number],
      max: maxArr as [number, number, number],
    },
  };
}

export async function getBScanPreview(id: string): Promise<BScanPreview> {
  const data = await request<{ preview: string }>(`/api/projects/${id}/bscan-preview`);
  const base64 = data.preview.replace(/^data:image\/png;base64,/, '');
  return {
    traces: 0,
    samples_per_trace: 0,
    time_range: [0, 0],
    amplitude_range: [0, 0],
    image_base64: base64,
  };
}

export async function createAnnotation(
  id: string,
  data: Omit<Annotation, 'id' | 'project_id' | 'created_at' | 'updated_at'>
): Promise<Annotation> {
  return request<Annotation>(`/api/projects/${id}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function getAnnotations(id: string): Promise<Annotation[]> {
  const data = await request<{ annotations: Annotation[] }>(`/api/projects/${id}/annotations`);
  return data.annotations ?? [];
}

export async function updateAnnotation(
  projectId: string,
  annotationId: string,
  data: Partial<Pick<Annotation, 'label' | 'color'>>
): Promise<Annotation> {
  return request<Annotation>(
    `/api/projects/${projectId}/annotations/${annotationId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
}

export async function deleteAnnotation(
  projectId: string,
  annotationId: string
): Promise<void> {
  await fetch(
    `${API_BASE}/api/projects/${projectId}/annotations/${annotationId}`,
    { method: 'DELETE' }
  );
}
