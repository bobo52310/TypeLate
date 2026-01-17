import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHistoryStore } from "@/stores/historyStore";
import { formatDurationFromMs } from "@/lib/formatUtils";
import { useQuotaInfo } from "@/hooks/useQuotaInfo";

export function CompactStatsBar() {
  const { t } = useTranslation();
  const dashboardStats = useHistoryStore((s) => s.dashboardStats);
  const dailyUsageTrendList = useHistoryStore((s) => s.dailyUsageTrendList);
  const quotaInfo = useQuotaInfo();

  const todayCount = useMemo(() => {
    if (dailyUsageTrendList.length === 0) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = dailyUsageTrendList.find((d) => d.date === today);
    return todayEntry?.count ?? 0;
  }, [dailyUsageTrendList]);

  return (
    <div className="flex items-center gap-6 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
      {/* Today count */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("home.statsBar.todayCount")}</span>
        <span className="text-sm font-semibold text-foreground">{todayCount}</span>
      </div>

      <div className="h-3 w-px bg-border" />

      {/* Time saved */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("home.statsBar.timeSaved")}</span>
        <span className="text-sm font-semibold text-foreground">
          {formatDurationFromMs(dashboardStats.estimatedTimeSavedMs)}
        </span>
      </div>

      <div className="h-3 w-px bg-border" />

      {/* Quota */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-default">
              <span className="text-xs text-muted-foreground">{t("home.statsBar.quotaRemaining")}</span>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-16 rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${quotaInfo.colorClass}`}
                    style={{ width: `${quotaInfo.percent}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-foreground">{quotaInfo.percent}%</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent
            className="w-64 border border-border bg-card p-3 text-card-foreground"
            side="bottom"
            sideOffset={6}
          >
            <p className="mb-2 text-xs font-medium">{t("dashboard.dailyQuotaDetail")}</p>
            <div className="space-y-1.5">
              {quotaInfo.dimensions.map((dim, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{dim.label}</span>
                  <span className="font-medium">{Math.round(Math.max(0, dim.remaining) * 100)}%</span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
