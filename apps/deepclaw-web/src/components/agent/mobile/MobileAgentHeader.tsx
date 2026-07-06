'use client';

import { Dispatch, SetStateAction } from "react";
import { ArrowLeft, MessageSquare} from "lucide-react";
import { useTranslation } from "react-i18next";
import { MobileView } from "@/component-types";

export function MobileAgentHeader({mobileView, setMobileView}: {
  mobileView: MobileView;
  setMobileView: Dispatch<SetStateAction<MobileView>>;
}) {
  const {t} = useTranslation();

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
      {mobileView === 'detail' && (
        <button
          onClick={() => setMobileView('list')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} />
          <span>{t('web.pages.agents.mobile.returnToList')}</span>
        </button>
      )}
      {mobileView === 'chat' && (
        <button
          onClick={() => setMobileView('detail')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} />
          <span>{t('web.pages.agents.mobile.returnToDetail')}</span>
        </button>
      )}
      
      {mobileView === 'detail' && (
        <button
          onClick={() => setMobileView('chat')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"
        >
          <MessageSquare size={16} />
          <span>{t('web.pages.chat.type.agent.title')}</span>
        </button>
      )}
    </div>
  );
}
