'use client';

import { useAppStore } from '@/lib/store';

export function StoreDemo() {
  const { projects, selectedProjectId } = useAppStore();

  return (
    <div className="p-4 border rounded">
      <h3 className="font-bold">Store 数据</h3>
      <p className="mt-2">选中项目: {selectedProjectId}</p>
      <p className="mt-1">项目数量: {projects.length}</p>
      <ul className="mt-2 space-y-1">
        {projects.map(p => (
          <li key={p.id} className="text-sm text-gray-600">
            {p.name} ({p.tasks.length} 任务)
          </li>
        ))}
      </ul>
    </div>
  );
}
