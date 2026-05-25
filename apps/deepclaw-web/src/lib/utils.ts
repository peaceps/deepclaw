export const statusColors: Record<string, string> = {
  online: 'bg-green-500',
  busy: 'bg-yellow-500',
  idle: 'bg-blue-400',
  offline: 'bg-gray-400',
};

export const statusLabels: Record<string, string> = {
  online: '在线',
  busy: '忙碌',
  idle: '空闲',
  offline: '离线',
};

export const moodEmojis: Record<string, string> = {
  happy: '😊',
  focused: '🤔',
  tired: '😓',
  confused: '😵',
};

export const taskStatusColors: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-600 border-gray-300',
  todo: 'bg-blue-50 text-blue-600 border-blue-300',
  in_progress: 'bg-yellow-50 text-yellow-600 border-yellow-300',
  review: 'bg-purple-50 text-purple-600 border-purple-300',
  done: 'bg-green-50 text-green-600 border-green-300',
};

export const taskStatusLabels: Record<string, string> = {
  backlog: '待规划',
  todo: '待办',
  in_progress: '进行中',
  review: '审核中',
  done: '已完成',
};

export const priorityColors: Record<string, string> = {
  low: 'bg-gray-200 text-gray-600',
  medium: 'bg-blue-200 text-blue-600',
  high: 'bg-orange-200 text-orange-600',
  urgent: 'bg-red-200 text-red-600',
};

export const priorityLabels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)}分钟`;
  }
  return `${hours}小时`;
}
