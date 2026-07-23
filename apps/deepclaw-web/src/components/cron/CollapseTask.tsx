import type { CronTask } from '@deepclaw/loop-gateway';
import { Task } from './Task';
import { Detail } from './Detail';
import { Histories } from './Histories';
import { useAppStore } from '@/lib/store';

type CollapseTaskProps = {
    task: CronTask;
    isExpanded: boolean;
    onToggle: () => void;
    onToggleStatus: () => void;
    onDelete: () => void;
};

export function CollapseTask({ task, isExpanded, onToggle, onToggleStatus, onDelete }: CollapseTaskProps) {
    const getAgentById = useAppStore(s => s.getAgentById);
    const creator = getAgentById(task.creator)?.name || '';
    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div
                onClick={onToggle}
                className="px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
            >
                <Task task={task} creator={creator} isExpanded={isExpanded} />
            </div>
            {isExpanded && (
                <div className="flex flex-col lg:flex-row border-t border-gray-200">
                    <Detail task={task} creator={creator} onToggleStatus={onToggleStatus} onDelete={onDelete} />
                    <Histories task={task} creator={creator} />
                </div>
            )}
        </div>
    );
}
