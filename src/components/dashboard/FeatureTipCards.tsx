import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Sparkles,
  Keyboard,
  History,
  Brain,
  Volume2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface TipDef {
  id: string;
  icon: LucideIcon;
  titleKey: string;
  descriptionKey: string;
  navigateTo: string;
}

const ALL_TIPS: TipDef[] = [
  {
    id: "vocabulary",
    icon: BookOpen,
    titleKey: "dashboard.tips.vocabulary.title",
    descriptionKey: "dashboard.tips.vocabulary.description",
    navigateTo: "#/dictionary",
  },
  {
    id: "customPrompt",
    icon: Sparkles,
    titleKey: "dashboard.tips.customPrompt.title",
    descriptionKey: "dashboard.tips.customPrompt.description",
    navigateTo: "#/settings?tab=ai",
  },
  {
    id: "hotkeyModes",
    icon: Keyboard,
    titleKey: "dashboard.tips.hotkeyModes.title",
    descriptionKey: "dashboard.tips.hotkeyModes.description",
    navigateTo: "#/settings?tab=general",
  },
  {
    id: "historyPlayback",
    icon: History,
    titleKey: "dashboard.tips.historyPlayback.title",
    descriptionKey: "dashboard.tips.historyPlayback.description",
    navigateTo: "#/history",
  },
  {
    id: "smartDictionary",
    icon: Brain,
    titleKey: "dashboard.tips.smartDictionary.title",
    descriptionKey: "dashboard.tips.smartDictionary.description",
    navigateTo: "#/dictionary",
  },
  {
    id: "soundThemes",
    icon: Volume2,
    titleKey: "dashboard.tips.soundThemes.title",
    descriptionKey: "dashboard.tips.soundThemes.description",
    navigateTo: "#/settings?tab=general",
  },
];

const TIPS_PER_PAGE = 3;

function getVisibleTips(): TipDef[] {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const pageCount = Math.ceil(ALL_TIPS.length / TIPS_PER_PAGE);
  const startIndex = (dayOfYear % pageCount) * TIPS_PER_PAGE;

  const tips = ALL_TIPS.slice(startIndex, startIndex + TIPS_PER_PAGE);
  // Wrap around if needed
  if (tips.length < TIPS_PER_PAGE) {
    tips.push(...ALL_TIPS.slice(0, TIPS_PER_PAGE - tips.length));
  }
  return tips;
}

export default function FeatureTipCards() {
  const { t } = useTranslation();
  const visibleTips = useMemo(() => getVisibleTips(), []);

  function navigateTo(hash: string) {
    window.location.hash = hash;
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {visibleTips.map((tip) => (
        <Card
          key={tip.id}
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => navigateTo(tip.navigateTo)}
        >
          <CardContent className="flex flex-col items-center px-3 py-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <tip.icon className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {t(tip.titleKey)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t(tip.descriptionKey)}
            </p>
            <Button
              variant="link"
              size="sm"
              className="mt-2 h-auto p-0 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                navigateTo(tip.navigateTo);
              }}
            >
              {t("dashboard.tips.tryIt")} &rarr;
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
