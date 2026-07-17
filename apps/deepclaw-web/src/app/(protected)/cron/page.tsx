import { Cron } from '@/components/cron/Cron';

export default function CronPage() {
  return (
    <div className="h-full flex items-center justify-center text-gray-400">
      <div className="text-center">
        <Cron />
      </div>
    </div>
  );
}
