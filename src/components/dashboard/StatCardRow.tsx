import { useTranslation } from "react-i18next";
import { Type, Mic, Gauge, BarChart3, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/formatUtils";
import type { QuotaDimension } from "@/hooks/useQuotaInfo";

interface StatCardRowProps {
  totalCharacters: number;
  totalTranscriptions: number;
  charsPerMinute: number;
  avgCharacters: number;
  quotaPercent: number;
  quotaColorClass: string;
  quotaDimensionList: QuotaDimension[];
  vocabularyAnalysisRequestCount: number;
  vocabularyAnalysisTotalTokens: number;
}

const DELAY_STEP_MS = 60;

export default function StatCardRow({
  totalCharacters,
  totalTranscriptions,
  charsPerMinute,
  avgCharacters,
  quotaPercent,
  quotaColorClass,
  quotaDimensionList,
  vocabularyAnalysisRequestCount,
  vocabularyAnalysisTotalTokens,
}: StatCardRowProps) {
  const { t } = useTranslation();

  const stats = [
    {
      icon: Type,
      value: formatNumber(totalCharacters),
      unit: t("dashboard.characterUnit"),
      label: t("dashboard.totalCharacters"),
    },
    {
      icon: Mic,
      value: formatNumber(totalTranscriptions),
      unit: t("dashboard.transcriptionUnit"),
      label: t("dashboard.totalTranscriptions"),
    },
    {
      icon: Gauge,
      value: formatNumber(charsPerMinute),
      unit: t("dashboard.charsPerMinuteUnit"),
      label: t("dashboard.charsPerMinute"),
    },
    {
      icon: BarChart3,
      value: formatNumber(avgCharacters),
      unit: t("dashboard.characterUnit"),
      label: t("dashboard.avgCharacters"),
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {stats.map((stat, i) => (
        <Card
          key={stat.label}
          className="animate-in fade-in-0 slide-in-from-bottom-2"
          style={{ animationDelay: `${i * DELAY_STEP_MS}ms`, animationFillMode: "both" }}
        >
          <CardContent className="flex flex-col items-center px-2 py-4 text-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <stat.icon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
              {stat.value}
            </p>
            <p className="text-[11px] text-muted-foreground">{stat.label}</p>
          </CardContent>
        </Card>
      ))}

      {/* Quota card with tooltip */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Card
              className="animate-in fade-in-0 slide-in-from-bottom-2 cursor-default"
              style={{
                animationDelay: `${4 * DELAY_STEP_MS}ms`,
                animationFillMode: "both",
              }}
            >
              <CardContent className="flex flex-col items-center px-2 py-4 text-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
                  {quotaPercent}%
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("dashboard.dailyQuota")}
                </p>
                <div className="mt-1.5 h-1 w-full rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${quotaColorClass}`}
                    style={{ width: `${quotaPercent}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent
            className="w-72 border border-border bg-card p-3 text-card-foreground"
            side="bottom"
            sideOffset={6}
          >
            <p className="mb-2 text-xs font-medium">{t("dashboard.dailyQuotaDetail")}</p>
            <div className="space-y-2">
              {quotaDimensionList.map((dim, idx) => (
                <div key={idx}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{dim.label}</span>
                    <span className="font-medium">
                      {Math.round(Math.max(0, dim.remaining) * 100)}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 w-full rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${quotaColorClass}`}
                      style={{
                        width: `${Math.round(Math.max(0, dim.remaining) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {vocabularyAnalysisRequestCount > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <span className="text-xs text-muted-foreground">
                  {t("dashboard.vocabularyAnalysisUsage", {
                    requests: vocabularyAnalysisRequestCount,
                    tokens: formatNumber(vocabularyAnalysisTotalTokens),
                  })}
                </span>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
