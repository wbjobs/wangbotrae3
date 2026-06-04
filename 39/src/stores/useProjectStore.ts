import { create } from 'zustand';
import type { Project, Annotation, ReconstructionParams, ColorMapping } from '@/types';
import * as api from '@/api';

interface ClippingState {
  x: { enabled: boolean; value: number };
  y: { enabled: boolean; value: number };
  z: { enabled: boolean; value: number };
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  annotations: Annotation[];
  params: ReconstructionParams;
  pointSize: number;
  opacity: number;
  colorMapping: ColorMapping;
  visible: boolean;
  clipping: ClippingState;
  loading: boolean;
  uploading: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;

  fetchProjects: () => Promise<void>;
  uploadProject: (file: File) => Promise<Project | null>;
  pollProjectStatus: (id: string) => void;
  stopPolling: () => void;
  setCurrentProject: (project: Project | null) => void;
  fetchAnnotations: (projectId: string) => Promise<void>;
  addAnnotation: (
    projectId: string,
    data: { label: string; color: string; box_min: number[]; box_max: number[] }
  ) => Promise<void>;
  updateAnnotation: (
    projectId: string,
    annotationId: string,
    data: Partial<Pick<Annotation, 'label' | 'color'>>
  ) => Promise<void>;
  deleteAnnotation: (projectId: string, annotationId: string) => Promise<void>;
  updateParams: (params: Partial<ReconstructionParams>) => void;
  setClipping: (clipping: Partial<ClippingState>) => void;
}

const DEFAULT_CLIPPING: ClippingState = {
  x: { enabled: false, value: 0 },
  y: { enabled: false, value: 0 },
  z: { enabled: false, value: 0 },
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  annotations: [],
  params: {
    dielectric_constant: 6.0,
    filter_window_size: 5,
    fitting_threshold: 0.5,
    velocity: 0.12,
  },
  pointSize: 2,
  opacity: 1,
  colorMapping: 'depth' as ColorMapping,
  visible: true,
  clipping: DEFAULT_CLIPPING,
  loading: false,
  uploading: false,
  pollTimer: null,

  fetchProjects: async () => {
    set({ loading: true });
    try {
      const projects = await api.getProjects();
      api.setProjectsCache(projects);
      set({ projects });
    } finally {
      set({ loading: false });
    }
  },

  uploadProject: async (file) => {
    set({ uploading: true });
    try {
      const params = get().params;
      const project = await api.uploadProject(file, params);
      set((state) => {
        const newProjects = [project, ...state.projects];
        api.setProjectsCache(newProjects);
        return { projects: newProjects };
      });
      get().pollProjectStatus(project.id);
      return project;
    } catch {
      return null;
    } finally {
      set({ uploading: false });
    }
  },

  pollProjectStatus: (id) => {
    get().stopPolling();
    const timer = setInterval(async () => {
      try {
        const updated = await api.getProjectStatus(id);
        set((state) => {
          const newProjects = state.projects.map((p) => (p.id === id ? updated : p));
          api.setProjectsCache(newProjects);
          return {
            projects: newProjects,
            currentProject: state.currentProject?.id === id ? updated : state.currentProject,
          };
        });
        if (updated.status === 'completed' || updated.status === 'failed') {
          get().stopPolling();
        }
      } catch {
        get().stopPolling();
      }
    }, 2000);
    set({ pollTimer: timer });
  },

  stopPolling: () => {
    const { pollTimer } = get();
    if (pollTimer) {
      clearInterval(pollTimer);
      set({ pollTimer: null });
    }
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  fetchAnnotations: async (projectId) => {
    try {
      const annotations = await api.getAnnotations(projectId);
      set({ annotations });
    } catch {
      set({ annotations: [] });
    }
  },

  addAnnotation: async (projectId, data) => {
    const annotation = await api.createAnnotation(projectId, {
      label: data.label,
      color: data.color,
      box_min: data.box_min,
      box_max: data.box_max,
      points: [],
    });
    set((state) => ({ annotations: [...state.annotations, annotation] }));
  },

  updateAnnotation: async (projectId, annotationId, data) => {
    const updated = await api.updateAnnotation(projectId, annotationId, data);
    set((state) => ({
      annotations: state.annotations.map((a) =>
        a.id === annotationId ? updated : a
      ),
    }));
  },

  deleteAnnotation: async (projectId, annotationId) => {
    await api.deleteAnnotation(projectId, annotationId);
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== annotationId),
    }));
  },

  updateParams: (params) =>
    set((state) => ({ params: { ...state.params, ...params } })),

  setClipping: (clipping) =>
    set((state) => ({ clipping: { ...state.clipping, ...clipping } })),
}));
