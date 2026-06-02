'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, MessageSquare, ClipboardList, Settings, Sun, ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { href: '/tasks/board', label: '任务看板', icon: ClipboardList },
  { href: '/', label: '员工', icon: Users },
  { href: '/chat', label: '消息中心', icon: MessageSquare },
  { href: '/demo', label: '演示', icon: Sun },
  { href: '/org', label: '组织架构', icon: LayoutDashboard },
  { href: '/settings', label: '设置', icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={`
        bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out
        ${collapsed ? 'w-16' : 'w-64'}
      `}
    >
      {/* Logo */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-white text-xl font-bold">
              D
            </div>
            <div>
              <h1 className="font-bold text-gray-900">DeepClaw</h1>
              <p className="text-xs text-gray-500">AI Agent 管理系统</p>
            </div>
          </Link>
        )}
        {collapsed && (
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-white text-xl font-bold mx-auto">
            D
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="收起侧边栏"
          >
            <ChevronLeft size={18} />
          </button>
        )}
      </div>

      {/* Toggle button when collapsed */}
      {collapsed && (
        <div className="p-2 border-b border-gray-100 flex justify-center">
          <button
            onClick={onToggle}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="展开侧边栏"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 p-2">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-3 rounded-lg transition-colors
                    ${isActive
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }
                    ${collapsed ? 'justify-center' : ''}
                  `}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon size={20} />
                  {!collapsed && <span className="font-medium">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-100">
        {!collapsed ? (
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm">
              👤
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">灵长目院士</p>
              <p className="text-xs text-gray-500">管理员</p>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm">
              👤
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
