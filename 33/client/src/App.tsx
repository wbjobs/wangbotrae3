import React from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Header } from './components/Header';
import { SampleList } from './pages/SampleList';
import { CreateSample } from './pages/CreateSample';
import { SampleDetail } from './pages/SampleDetail';
import { ExportPage } from './pages/ExportPage';
import { MapPage } from './pages/MapPage';
import { MapDownloadPage } from './pages/MapDownloadPage';

function NavTabs() {
  const navigate = useNavigate();
  const location = useLocation();

  const getActiveTab = () => {
    if (location.pathname.startsWith('/map')) return 'map';
    if (location.pathname === '/export') return 'export';
    return 'list';
  };

  const showTabs = ['/', '/export', '/map', '/map-download'].includes(location.pathname);

  if (!showTabs) {
    return null;
  }

  return (
    <nav className="nav-tabs">
      <button
        className={`nav-tab ${getActiveTab() === 'list' ? 'active' : ''}`}
        onClick={() => navigate('/')}
      >
        采样列表
      </button>
      <button
        className={`nav-tab ${getActiveTab() === 'map' ? 'active' : ''}`}
        onClick={() => navigate('/map')}
      >
        地图
      </button>
      <button
        className={`nav-tab ${getActiveTab() === 'export' ? 'active' : ''}`}
        onClick={() => navigate('/export')}
      >
        数据导出
      </button>
    </nav>
  );
}

function FloatingActionButton() {
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname !== '/') {
    return null;
  }

  return (
    <button className="fab" onClick={() => navigate('/create')}>
      +
    </button>
  );
}

function AppContent() {
  return (
    <div className="app-container">
      <Header />
      <NavTabs />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<SampleList />} />
          <Route path="/create" element={<CreateSample />} />
          <Route path="/sample/:id" element={<SampleDetail />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/map-download" element={<MapDownloadPage />} />
        </Routes>
      </main>
      <FloatingActionButton />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </BrowserRouter>
  );
}
