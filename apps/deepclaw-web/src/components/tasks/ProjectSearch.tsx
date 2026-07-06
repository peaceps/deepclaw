import { Search, X, CheckCircle2, Clock, AlarmClock } from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import type { MissionStatus, Project } from '@deepclaw/core';
import { useTranslation } from 'react-i18next';
import { getProjectStatus } from '@deepclaw/core';

const statusIcon: Record<MissionStatus, {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    color: string
}> = {
    'todo': {icon: AlarmClock, color: 'text-gray-500'},
    'ongoing': {icon: Clock, color: 'text-yellow-500'},
    'done': {icon: CheckCircle2, color: 'text-green-500'},
}

export type ProjectFilters = {
    query: string;
    status: 'all' | MissionStatus;
    owner: string;
};

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
    query: '',
    status: 'ongoing',
    owner: 'all',
};

function textSearchProjects(projects: Project[], query: string): Project[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter(project => [project.title, project.description, ...(project.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalized));
}

export function filterProjects(projects: Project[], filters: ProjectFilters): Project[] {
    let result = textSearchProjects(projects, filters.query);
    if (filters.owner !== 'all') {
        result = result.filter(project => project.creator === filters.owner);
    }
    if (filters.status !== 'all') {
        result = result.filter(project => getProjectStatus(project) === filters.status);
    }
    return result;
}

export function ProjectSearch({filters, onChange}: {
    filters: ProjectFilters;
    onChange: (filters: ProjectFilters) => void;
}) {

    const agents = useAppStore(s => s.agents);
    const projects = useAppStore(s => s.projects);
    const {t} = useTranslation();

    const searchedProjects = useMemo(
        () => textSearchProjects(projects, filters.query),
        [projects, filters.query]
    );

    const ownerScopedProjects = useMemo(
        () => filters.owner === 'all'
            ? searchedProjects
            : searchedProjects.filter(project => project.creator === filters.owner),
        [searchedProjects, filters.owner]
    );

    const statusCounts = useMemo(() => {
        const count = {
            todo: 0,
            ongoing: 0,
            done: 0,
        };
        ownerScopedProjects.forEach(project => {
            count[getProjectStatus(project)]++;
        });
        return {
            ...count,
            all: ownerScopedProjects.length,
        }
    }, [ownerScopedProjects]);

    const ownerOptions = useMemo(
        () => Array.from(new Set(searchedProjects.map(project => project.creator)))
            .filter(Boolean)
            .map(ownerId => ({
                id: ownerId,
                name: agents.find(agent => agent.id === ownerId)?.name ?? ownerId,
                count: searchedProjects.filter(project => project.creator === ownerId).length,
            })),
        [agents, searchedProjects]
    );

    const statusOptions: readonly ('all' | MissionStatus)[] = ['all', 'todo', 'ongoing', 'done'];

    function handleSearchQueryChange(event: React.ChangeEvent<HTMLInputElement>) {
        onChange({...filters, query: event.target.value});
    }
    function handleSearchQueryRemove() {
        onChange({...filters, query: ''});
    }
    function handleOwnerFilterChange(event: React.ChangeEvent<HTMLSelectElement>) {
        onChange({...filters, owner: event.target.value});
    }
    function handleStatusFilterChange(status: MissionStatus | 'all') {
        onChange({...filters, status});
    }

    return (
        <div className="mt-2 lg:mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={filters.query}
              onChange={handleSearchQueryChange}
              placeholder={t('web.pages.projects.search.placeholder')}
              className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-8 text-sm text-gray-900
              outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            {filters.query && (
              <button
                type="button"
                onClick={handleSearchQueryRemove}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400
                transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label={t('web.pages.projects.search.clear')}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {statusOptions.map(status => (
              <button
                key={status}
                type="button"
                onClick={() => handleStatusFilterChange(status)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs
                    font-medium transition-colors cursor-pointer ${
                  filters.status === status
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {status !== 'all' && statusIcon[status] && <StatusIcon
                    Icon={statusIcon[status].icon}
                    color={statusIcon[status].color}
                    selected={filters.status === status}
                />}
                {t(status === 'all' ? 'web.common.all' : `web.pages.projects.status.${status}`)} {statusCounts[status]}
              </button>
            ))}
          </div>
          <select
            value={filters.owner}
            name="owner"
            onChange={handleOwnerFilterChange}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700
             outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:w-auto sm:max-w-48"
            aria-label={t('web.pages.projects.ownerFilter')}
          >
            <option value="all">{t('web.pages.projects.ownerFilter')}: {t('web.common.all')}</option>
            {ownerOptions.map(owner => (
              <option key={owner.id} value={owner.id}>{owner.name} ({owner.count})</option>
            ))}
          </select>
        </div>
    );
}

function StatusIcon({Icon, color, selected}: {
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    color: string;
    selected: boolean;
}) {
    return (
        <Icon size={16} className={`${!selected ? color : 'text-white'} inline pr-1 pb-1`} />
    );
}
