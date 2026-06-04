import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function Layout() {
  const [sidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0F172A]">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Layout;
