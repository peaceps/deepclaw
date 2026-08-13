import { Cron } from '@/components/cron/Cron';

type CronPageProps = {
  searchParams?: Promise<{
    task?: string | string[];
  }>;
};

export default async function CronPage({ searchParams }: CronPageProps) {
  const params = await searchParams;
  const taskParam = params?.task;
  const selectedTaskId = Array.isArray(taskParam) ? taskParam[0] : taskParam;

  return <Cron selectedTaskId={selectedTaskId}/>;
}
