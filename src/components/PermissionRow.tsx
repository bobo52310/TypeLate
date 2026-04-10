import type { LucideIcon } from "lucide-react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PermissionStatus } from "@/hooks/usePermissions";

interface PermissionRowProps {
  icon: LucideIcon;
  /** Tailwind class for the icon tile background tint */
  iconTint?: string;
  title: string;
  description: string;
  status: PermissionStatus;
  /** Secondary info (e.g. the configured hotkey key name) */
  trailingText?: string;
  actionLabel?: string;
  onAction?: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function PermissionRow({
  icon: Icon,
  iconTint,
  title,
  description,
  status,
  trailingText,
  actionLabel,
  onAction,
  onRefresh,
  isLoading,
}: PermissionRowProps) {
  const { t } = useTranslation();
  const granted = status === "granted";

  return (
    <div className="flex items-center gap-4 px-4 py-4">
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          iconTint ?? "bg-muted",
        )}
      >
        <Icon className="h-5 w-5 text-foreground/80" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {trailingText && (
            <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {trailingText}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>

      <div className="flex items-center gap-2">
        {actionLabel && !granted && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            disabled={isLoading}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}

        {onRefresh && (
          <button
            type="button"
            aria-label={t("settings.permissions.refresh")}
            title={t("settings.permissions.refresh")}
            onClick={onRefresh}
            disabled={isLoading}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground disabled:opacity-50",
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        )}

        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full",
            granted ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive",
          )}
          role="img"
          aria-label={t(`settings.permissions.status.${status}`)}
        >
          {granted ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </div>
      </div>
    </div>
  );
}
