import { NavLink } from 'react-router-dom';
import { Activity, FileSearch, History, Settings, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/monitor', label: '实时监测', icon: Activity },
  { path: '/analysis', label: '离线分析', icon: FileSearch },
  { path: '/history', label: '历史记录', icon: History },
  { path: '/devices', label: '设备管理', icon: Settings },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  return (
    <aside
      className={cn(
        'h-screen bg-slate-900/80 border-r border-slate-700/50 flex flex-col transition-all duration-300',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <div className="h-16 flex items-center justify-center border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#165DFF] to-[#00B42A] flex items-center justify-center">
            <Cpu className="w-6 h-6 text-white" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-white font-bold text-lg">智诊断</div>
              <div className="text-slate-400 text-xs">工业故障诊断系统</div>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group',
                isActive
                  ? 'bg-[#165DFF]/20 text-[#165DFF] border border-[#165DFF]/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              )
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700/50">
        <div className={cn(
          'text-xs text-slate-500',
          collapsed && 'text-center'
        )}>
          {!collapsed ? 'v1.0.0' : 'v1'}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
