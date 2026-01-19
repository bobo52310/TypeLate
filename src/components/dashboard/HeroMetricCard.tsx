import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Keyboard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationFromMs } from "@/lib/formatUtils";

interface HeroMetricCardProps {
  speedMultiplier: number;
  timeSavedMs: number;
  speakingTimeMs: number;
  typingTimeMs: number;
  hasData: boolean;
}

const CIRCUMFERENCE = 2 * Math.PI * 52;
const MAX_MULTIPLIER = 10;

export default function HeroMetricCard({
  speedMultiplier,
  timeSavedMs,
  speakingTimeMs,
  typingTimeMs,
  hasData,
}: HeroMetricCardProps) {
  const { t } = useTranslation();
  const [animatedProgress, setAnimatedProgress] = useState(0);

  const progress = Math.min(1, speedMultiplier / MAX_MULTIPLIER);

  useEffect(() => {
    if (!hasData) return;
    // Trigger ring animation after mount
    const timer = setTimeout(() => setAnimatedProgress(progress), 50);
    return () => clearTimeout(timer);
  }, [progress, hasData]);

  if (!hasData) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Mic className="h-7 w-7 text-primary" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            {t("dashboard.heroEmptyTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("dashboard.heroEmptyDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const dashOffset = CIRCUMFERENCE * (1 - animatedProgress);

  return (
    <Card>
      <CardContent className="flex items-center gap-6 py-6">
        {/* SVG circular ring */}
        <div className="shrink-0">
          <svg viewBox="0 0 120 120" className="h-28 w-28">
            {/* Background ring */}
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              strokeWidth="8"
              className="stroke-muted"
            />
            {/* Progress ring */}
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              strokeWidth="8"
              className="stroke-primary"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 800ms ease-out" }}
              transform="rotate(-90 60 60)"
            />
            {/* Center text */}
            <text
              x="60"
              y="54"
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground text-2xl font-bold"
              style={{ fontSize: "24px", fontWeight: 700 }}
            >
              {speedMultiplier.toFixed(1)}x
            </text>
            <text
              x="60"
              y="76"
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted-foreground"
              style={{ fontSize: "10px" }}
            >
              {t("dashboard.heroMultiplierLabel")}
            </text>
          </svg>
        </div>

        {/* Right side: tagline + time saved + breakdown */}
        <div className="flex-1 space-y-3">
          <p className="text-base text-muted-foreground">
            {t("dashboard.heroPrefix")}{" "}
            <span className="text-xl font-bold text-primary">
              {t("dashboard.heroMultiplier", { value: speedMultiplier.toFixed(1) })}
            </span>{" "}
            {t("dashboard.heroSuffix")}
          </p>

          <div>
            <p className="text-xs text-muted-foreground">{t("dashboard.timeSaved")}</p>
            <p className="text-2xl font-bold text-primary">
              {formatDurationFromMs(timeSavedMs)}
            </p>
          </div>

          <div className="flex gap-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mic className="h-3.5 w-3.5" />
              <span>{formatDurationFromMs(speakingTimeMs)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Keyboard className="h-3.5 w-3.5" />
              <span>{formatDurationFromMs(typingTimeMs)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
