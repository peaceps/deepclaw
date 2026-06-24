import { ProjectBoard } from '@/components/tasks/ProjectBoard';

type BoardPageProps = {
    searchParams?: Promise<{
      project?: string | string[];
    }>;
  };

export default async function BoardPage({ searchParams }: BoardPageProps) {
    const params = await searchParams;
    const projectParam = params?.project;
    const selectedProjectId = Array.isArray(projectParam) ? projectParam[0] : projectParam;

    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 p-2 lg:p-6 overflow-hidden">
          <ProjectBoard selectedProjectId={selectedProjectId} />
        </div>
      </div>
    );
}
