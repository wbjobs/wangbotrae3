import { SamplePoint, ROCK_TYPE_LABELS } from '@shared/types';
import { formatDate, formatCoordinate } from '@shared/utils';

interface SampleCardProps {
  sample: SamplePoint;
  onClick: () => void;
}

export function SampleCard({ sample, onClick }: SampleCardProps) {
  const getSyncBadge = () => {
    switch (sample.syncStatus) {
      case 'synced':
        return <span className="badge badge-success">已同步</span>;
      case 'pending':
        return <span className="badge badge-warning">待同步</span>;
      case 'syncing':
        return <span className="badge badge-info">同步中</span>;
      case 'error':
        return <span className="badge badge-error">同步失败</span>;
      default:
        return <span className="badge badge-error">未同步</span>;
    }
  };

  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="card-header">
        <div>
          <div className="card-title">{sample.sampleNumber}</div>
          <div className="card-subtitle">{formatDate(sample.createdAt)}</div>
        </div>
        {getSyncBadge()}
      </div>
      
      <div className="location-info">
        <div className="location-row">
          <span className="location-icon">📍</span>
          <span>{formatCoordinate(sample.location.latitude, sample.location.longitude)}</span>
        </div>
        <div className="location-row">
          <span>🪨</span>
          <span>{ROCK_TYPE_LABELS[sample.rockType]}</span>
        </div>
        {sample.photos.length > 0 && (
          <div className="location-row">
            <span>📷</span>
            <span>{sample.photos.length} 张照片</span>
          </div>
        )}
      </div>
    </div>
  );
}
