import {getTestTasks} from '@deepclaw/gateway'

export async function ServerDemo() {
  const data = getTestTasks();

  return (
    <div className="p-4 border rounded">
      <h3 className="font-bold">服务器数据</h3>
      <pre className="mt-2 bg-gray-100 p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}