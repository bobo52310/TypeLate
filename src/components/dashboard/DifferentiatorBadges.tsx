import { useTranslation } from "react-i18next";
import { ShieldCheck, Infinity as InfinityIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function DifferentiatorBadges() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center gap-3">
      <Badge variant="outline" className="gap-1.5 px-3 py-1">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t("dashboard.badgeLocalFirst")}
      </Badge>
      <Badge variant="outline" className="gap-1.5 px-3 py-1">
        <InfinityIcon className="h-3.5 w-3.5" />
        {t("dashboard.badgeNoSessionLimit")}
      </Badge>
    </div>
  );
}
