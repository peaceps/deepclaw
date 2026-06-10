import { MessageCenter } from '@/components/message/MessageCenter';

export default function ChatPage() {
  return (
    <div className="h-full flex items-center justify-center text-gray-400">
      <div className="text-center">
        <MessageCenter />
      </div>
    </div>
  );
}
