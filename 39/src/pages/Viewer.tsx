import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BoxSelect, Loader2 } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import Scene from '@/components/Scene';
import ClippingPanel from '@/components/ClippingPanel';
import LayerPanel from '@/components/LayerPanel';
import AnnotationTool from '@/components/AnnotationTool';
import InfoPanel from '@/components/InfoPanel';

export default function Viewer() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, fetchAnnotations, projects, fetchProjects } =
    useProjectStore();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [annotationMode, setAnnotationMode] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    const load = async () => {
      if (projects.length === 0) await fetchProjects();
      const proj = useProjectStore.getState().projects.find((p) => p.id === projectId);
      if (proj) {
        setCurrentProject(proj);
        await fetchAnnotations(projectId);
      }
    };
    load();
    return () => setCurrentProject(null);
  }, [projectId, projects.length, fetchProjects, fetchAnnotations, setCurrentProject]);

  if (!currentProject) {
    return (
      <div className="flex h-screen items-center justify-center bg-gpr-bg">
        <Loader2 className="h-8 w-8 animate-spin text-gpr-cyan" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gpr-bg">
      <header className="flex items-center justify-between border-b border-gpr-border bg-gpr-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gpr-dim transition-colors hover:bg-gpr-border/50 hover:text-gpr-text"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
          <span className="text-sm font-medium text-gpr-text">{currentProject.name}</span>
        </div>
        <button
          onClick={() => setAnnotationMode(!annotationMode)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
            annotationMode
              ? 'bg-gpr-orange/20 text-gpr-orange glow-active'
              : 'bg-gpr-border/30 text-gpr-dim hover:bg-gpr-border/50 hover:text-gpr-text'
          }`}
        >
          <BoxSelect className="h-4 w-4" />
          {annotationMode ? '标注模式' : '开启标注'}
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div
          className={`flex-shrink-0 overflow-y-auto border-r border-gpr-border bg-gpr-surface transition-all duration-200 ${
            leftOpen ? 'w-[280px]' : 'w-0'
          }`}
        >
          {leftOpen && (
            <div className="space-y-3 p-3">
              <ClippingPanel />
              <LayerPanel />
              <AnnotationTool
                projectId={projectId!}
                annotationMode={annotationMode}
                onToggleMode={() => setAnnotationMode(!annotationMode)}
              />
            </div>
          )}
        </div>

        <div className="relative flex-1">
          <Scene projectId={projectId!} annotationMode={annotationMode} />
          <button
            onClick={() => setLeftOpen(!leftOpen)}
            className="absolute left-2 top-2 z-10 rounded bg-gpr-surface/80 px-2 py-1 text-xs text-gpr-dim hover:text-gpr-text"
          >
            {leftOpen ? '◀' : '▶'}
          </button>
          <button
            onClick={() => setRightOpen(!rightOpen)}
            className="absolute right-2 top-2 z-10 rounded bg-gpr-surface/80 px-2 py-1 text-xs text-gpr-dim hover:text-gpr-text"
          >
            {rightOpen ? '▶' : '◀'}
          </button>
        </div>

        <div
          className={`flex-shrink-0 overflow-y-auto border-l border-gpr-border bg-gpr-surface transition-all duration-200 ${
            rightOpen ? 'w-[300px]' : 'w-0'
          }`}
        >
          {rightOpen && (
            <div className="p-3">
              <InfoPanel projectId={projectId!} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
