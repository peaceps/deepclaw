'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, MessageSquare, ClipboardList, Settings, Sun } from 'lucide-react';

const navItems = [
  { href: '/', label: '工作台', icon: LayoutDashboard },
  { href: '/tasks/board', label: '任务看板', icon: ClipboardList },
  { href: '/chat', label: '消息中心', icon: MessageSquare },
  { href: '/demo', label: '演示', icon: Sun },
  { href: '/org', label: '组织架构', icon: Users },
  { href: '/settings', label: '设置', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-100">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-white text-xl font-bold">
            D
          </div>
          <div>
            <h1 className="font-bold text-gray-900">DeepClaw</h1>
            <p className="text-xs text-gray-500">AI Agent 管理系统</p>
          </div>
        </Link>
      </div>
      
      {/* Nav */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                    ${isActive 
                      ? 'bg-blue-50 text-blue-600' 
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon size={20} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      
      {/* Footer */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm">
            👤
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">灵长目院士</p>
            <p className="text-xs text-gray-500">管理员</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
