import { TaskBoard } from '@/components/tasks/TaskBoard';
import { LoopGateway } from '@deepclaw/loop-gateway';

export default function BoardPage() {
    const projects = LoopGateway.getProjects();
    const agents = LoopGateway.getAgents();
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 p-6 overflow-hidden">
          <TaskBoard projects={projects} agents={agents} />
        </div>
      </div>
    );
}
