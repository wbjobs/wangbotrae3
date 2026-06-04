import { useAppContext } from '../context/AppContext';
import { SampleCard } from '../components/SampleCard';
import { useNavigate } from 'react-router-dom';

export function SampleList() {
  const { samples } = useAppContext();
  const navigate = useNavigate();

  const sortedSamples = [...samples].sort((a, b) => b.createdAt - a.createdAt);

  if (samples.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🗺️</div>
        <div className="empty-title">暂无采样数据</div>
        <div className="empty-text">点击右下角 + 按钮添加第一个采样点</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          共 {samples.length} 条记录
        </span>
      </div>
      
      {sortedSamples.map((sample) => (
        <SampleCard
          key={sample.id}
          sample={sample}
          onClick={() => navigate(`/sample/${sample.id}`)}
        />
      ))}
    </div>
  );
}
