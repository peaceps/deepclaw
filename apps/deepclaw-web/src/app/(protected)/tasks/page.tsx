import { TaskBoard } from '@/components/tasks/TaskBoard';

export default function BoardPage() {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 p-6 overflow-hidden">
          <TaskBoard />
        </div>
      </div>
    );
}
