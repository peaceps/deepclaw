import { Cron } from '@/components/cron/Cron';
import { getCronTasks } from '@/server/data';

export default async function CronPage() {
  const cronTasks = await getCronTasks();
  return <Cron cronTasks={cronTasks}/>;
}
