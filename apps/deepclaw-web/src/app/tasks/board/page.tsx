import { TaskBoard } from '@/components/tasks/TaskBoard';

export default function BoardPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">任务看板</h1>
          <p className="text-sm text-gray-500 mt-1">拖拽任务卡片以更新状态</p>
        </div>
        <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium">
          + 新建任务
        </button>
      </div>
      <div className="flex-1 p-6 overflow-hidden">
        <TaskBoard />
      </div>
    </div>
  );
}
