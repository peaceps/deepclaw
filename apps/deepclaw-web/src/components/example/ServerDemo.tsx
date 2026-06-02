import { fakeProjects } from '@/data/fakeData'

export async function ServerDemo() {
  // 使用本地假数据，避免循环引用
  const data = fakeProjects.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    taskCount: p.tasks.length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  return (
    <div className="p-4 border rounded">
      <h3 className="font-bold">项目数据</h3>
      <pre className="mt-2 bg-gray-100 p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
