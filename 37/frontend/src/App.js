import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { Layout, Menu, theme } from 'antd';
import {
  DashboardOutlined,
  UploadOutlined,
  BarChartOutlined,
  FileTextOutlined,
  SwapOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import BOMUpload from './pages/BOMUpload';
import BOMList from './pages/BOMList';
import BOMDetail from './pages/BOMDetail';
import SupplierManage from './pages/SupplierManage';
import HypothesisAnalysis from './pages/HypothesisAnalysis';
import './App.css';

const { Header, Content, Sider } = Layout;

function App() {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const menuItems = [
    {
      key: '1',
      icon: <DashboardOutlined />,
      label: <Link to="/">数据看板</Link>,
    },
    {
      key: '2',
      icon: <UploadOutlined />,
      label: <Link to="/bom/upload">上传BOM</Link>,
    },
    {
      key: '3',
      icon: <BarChartOutlined />,
      label: <Link to="/bom/list">BOM管理</Link>,
    },
    {
      key: '4',
      icon: <TeamOutlined />,
      label: <Link to="/suppliers">供应商管理</Link>,
    },
    {
      key: '5',
      icon: <SwapOutlined />,
      label: <Link to="/analysis">假设分析</Link>,
    },
    {
      key: '6',
      icon: <FileTextOutlined />,
      label: <Link to="/reports">报告管理</Link>,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} style={{ background: colorBgContainer }}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#001529' }}>
          <h2 style={{ color: '#fff', margin: 0, fontSize: 16 }}>碳排分析系统</h2>
        </div>
        <Menu
          mode="inline"
          defaultSelectedKeys={['1']}
          defaultOpenKeys={['sub1']}
          style={{ height: '100%', borderRight: 0 }}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: 0, background: colorBgContainer }} />
        <Content style={{ margin: '24px 16px', padding: 24, background: colorBgContainer, borderRadius: borderRadiusLG }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bom/upload" element={<BOMUpload />} />
            <Route path="/bom/list" element={<BOMList />} />
            <Route path="/bom/:id" element={<BOMDetail />} />
            <Route path="/suppliers" element={<SupplierManage />} />
            <Route path="/analysis" element={<HypothesisAnalysis />} />
            <Route path="/reports" element={<BOMList />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
