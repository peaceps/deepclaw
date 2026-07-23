import { TokenUsage } from "@deepclaw/core";
import { useTranslation } from "react-i18next";

function getTokenUsageTitle(tokenUsage: TokenUsage, t: ReturnType<typeof useTranslation>['t']) {
  return `${t('web.pages.tokenUsage.cachedInput')}: ${tokenUsage.cachedInputTokens}
${t('web.pages.tokenUsage.noCachedInput')}: ${tokenUsage.noCachedInputTokens}
${t('web.pages.tokenUsage.output')}: ${tokenUsage.outputTokens}`;
}

export function TokenUsageIcon({ tokenUsage }: { tokenUsage?: TokenUsage }) {
    const { t } = useTranslation();
    if (!tokenUsage) return null;
    return (
        <div className="cursor-pointer" title={getTokenUsageTitle(tokenUsage, t)}>🪙</div>
    );
}
