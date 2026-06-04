import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Menu, theme, Badge } from 'antd';
import {
  DashboardOutlined,
  ApartmentOutlined,
  RocketOutlined,
  HistoryOutlined,
  AlertOutlined,
  PlayCircleOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import WorkflowEditor from './pages/WorkflowEditor';
import DeviceManager from './pages/DeviceManager';
import TimeTravel from './pages/TimeTravel';
import TestCases from './pages/TestCases';
import { wsService } from './services/websocket';
import { useAppStore } from './store';

const { Header, Sider, Content } = Layout;

const menuItems = [
  {
    key: '/',
    icon: <DashboardOutlined />,
    label: <Link to="/">实时监控</Link>,
  },
  {
    key: '/workflows',
    icon: <ExperimentOutlined />,
    label: <Link to="/workflows">异常编排</Link>,
  },
  {
    key: '/devices',
    icon: <ApartmentOutlined />,
    label: <Link to="/devices">设备管理</Link>,
  },
  {
    key: '/time-travel',
    icon: <HistoryOutlined />,
    label: <Link to="/time-travel">时间旅行</Link>,
  },
  {
    key: '/test-cases',
    icon: <AlertOutlined />,
    label: <Link to="/test-cases">测试用例</Link>,
  },
];

const App: React.FC = () => {
  const location = useLocation();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  
  const isConnected = useAppStore((state) => state.isConnected);
  const setConnected = useAppStore((state) => state.setConnected);
  const addDeviceData = useAppStore((state) => state.addDeviceData);
  const addAnomalyEvent = useAppStore((state) => state.addAnomalyEvent);

  useEffect(() => {
    wsService.connect();
    
    const unsubData = wsService.onDeviceData((data) => {
      addDeviceData(data.device_id, data);
    });
    
    const unsubEvent = wsService.onAnomalyEvent((event) => {
      addAnomalyEvent(event);
    });
    
    const checkConnection = setInterval(() => {
      setConnected(wsService['ws']?.readyState === WebSocket.OPEN);
    }, 1000);
    
    return () => {
      clearInterval(checkConnection);
      unsubData();
      unsubEvent();
      wsService.disconnect();
    };
  }, [addDeviceData, addAnomalyEvent, setConnected]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={240}
        style={{
          background: '#0f172a',
          borderRight: '1px solid #1e293b',
        }}
      >
        <div className="h-16 flex items-center px-6 border-b border-slate-700">
          <RocketOutlined className="text-blue-500 text-2xl mr-3" />
          <span className="text-lg font-bold text-white">混沌测试平台</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          style={{
            background: 'transparent',
            borderRight: 'none',
            marginTop: 12,
          }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #334155',
          }}
        >
          <h1 className="text-xl font-semibold m-0">
            {menuItems.find((item) => item.key === location.pathname)?.label || '混沌测试平台'}
          </h1>
          <div className="flex items-center gap-4">
            <Badge
              status={isConnected ? 'success' : 'error'}
              text={isConnected ? '已连接' : '未连接'}
            />
          </div>
        </Header>
        <Content
          style={{
            margin: '24px',
            padding: '24px',
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: 'calc(100vh - 184px)',
          }}
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/workflows" element={<WorkflowEditor />} />
            <Route path="/devices" element={<DeviceManager />} />
            <Route path="/time-travel" element={<TimeTravel />} />
            <Route path="/test-cases" element={<TestCases />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
};

export default App;
