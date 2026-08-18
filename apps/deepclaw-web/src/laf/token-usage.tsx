import { TokenUsage } from "@deepclaw/core";
import { useTranslation } from "react-i18next";
import { formatCount, formatPercent } from "@/lib/number-format";

function getTokenUsageTitle(tokenUsage: TokenUsage, t: ReturnType<typeof useTranslation>['t']) {
  const input = tokenUsage.cachedInputTokens + tokenUsage.noCachedInputTokens;
  const lines = [
    `${t('web.pages.tokenUsage.cachedInput')}: ${formatCount(tokenUsage.cachedInputTokens)}`,
    `${t('web.pages.tokenUsage.noCachedInput')}: ${formatCount(tokenUsage.noCachedInputTokens)}`,
  ];
  // Nothing read yet is not a miss, so the line is held back until there is a share to tell.
  if (input > 0) {
    lines.push(`${t('web.pages.tokenUsage.cacheHitRate')}: ${
      formatPercent(tokenUsage.cachedInputTokens / input)}`);
  }
  lines.push(`${t('web.pages.tokenUsage.output')}: ${formatCount(tokenUsage.outputTokens)}`);
  return lines.join('\n');
}

export function TokenUsageIcon({ tokenUsage }: { tokenUsage?: TokenUsage }) {
    const { t } = useTranslation();
    if (!tokenUsage) return null;
    return (
        <div className="cursor-pointer" title={getTokenUsageTitle(tokenUsage, t)}>🪙</div>
    );
}
