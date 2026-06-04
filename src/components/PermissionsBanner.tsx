import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PermissionsSnapshot, PermissionStatus } from "@/hooks/usePermissions";

type MissingState = "none" | "mic" | "accessibility" | "both";

function isMissing(status: PermissionStatus): boolean {
  return status !== "granted";
}

function deriveMissingState(snapshot: PermissionsSnapshot): MissingState {
  const micMissing = isMissing(snapshot.microphone);
  const accMissing = isMissing(snapshot.accessibility);
  if (micMissing && accMissing) return "both";
  if (micMissing) return "mic";
  if (accMissing) return "accessibility";
  return "none";
}

interface Props {
  snapshot: PermissionsSnapshot;
  /** Current hash route — banner self-hides on `/settings/permissions`. */
  currentRoute: string;
  /** Navigate handler invoked by the action button. */
  onOpenPermissions: () => void;
}

/**
 * Persistent destructive banner shown above main-window content whenever the
 * user is missing a required OS permission. Mirrors `databaseError` styling
 * (sits inside SidebarInset, full-width, non-dismissible).
 *
 * Hidden on `/settings/permissions` to avoid duplicating the dedicated UI.
 */
export function PermissionsBanner({ snapshot, currentRoute, onOpenPermissions }: Props) {
  const { t } = useTranslation();
  const state = deriveMissingState(snapshot);

  if (state === "none") return null;
  if (currentRoute.startsWith("/settings/permissions")) return null;

  const titleKey =
    state === "both"
      ? "dashboard.permissionsMissing.titleBoth"
      : state === "mic"
        ? "dashboard.permissionsMissing.titleMic"
        : "dashboard.permissionsMissing.titleAccessibility";

  const descKey =
    state === "both"
      ? "dashboard.permissionsMissing.descriptionBoth"
      : state === "mic"
        ? "dashboard.permissionsMissing.descriptionMic"
        : "dashboard.permissionsMissing.descriptionAccessibility";

  return (
    <div className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15">
        <ShieldAlert className="h-5 w-5 text-destructive" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive">{t(titleKey)}</p>
        <p className="mt-0.5 text-xs text-destructive/80">{t(descKey)}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onOpenPermissions}
      >
        {t("dashboard.permissionsMissing.action")}
      </Button>
    </div>
  );
}
