import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { type ChangelogSection, parseReleaseNotes } from "@/lib/releaseNotes";

import logoTypeLate from "@/assets/logo-typelate.png";

interface UpdateAvailableDialogProps {
  open: boolean;
  newVersion: string;
  currentVersion: string;
  releaseBody?: string;
  isDownloading: boolean;
  onSkipVersion: () => void;
  onRemindLater: () => void;
  onInstallUpdate: () => void;
}

export function UpdateAvailableDialog({
  open,
  newVersion,
  currentVersion,
  releaseBody,
  isDownloading,
  onSkipVersion,
  onRemindLater,
  onInstallUpdate,
}: UpdateAvailableDialogProps) {
  const { t } = useTranslation();

  const sections = useMemo(() => parseReleaseNotes(releaseBody), [releaseBody]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onRemindLater(); }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[480px] gap-0 p-0"
        onInteractOutside={(e) => { if (isDownloading) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (isDownloading) e.preventDefault(); }}
      >
        {/* Header: icon + title + version comparison */}
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-4">
            <img
              src={logoTypeLate}
              alt="TypeLate"
              className="h-12 w-12 shrink-0 rounded-xl"
            />
            <div className="flex flex-col gap-1.5">
              <DialogTitle className="text-base">
                {t("mainApp.updateDialog.title")}
              </DialogTitle>
              <DialogDescription>
                {t("mainApp.updateDialog.versionComparison", {
                  newVersion,
                  currentVersion,
                })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        {/* Changelog */}
        <div className="px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {t("mainApp.updateDialog.whatsNew", { version: newVersion })}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => openUrl(`https://github.com/bobo52310/TypeLate/releases/tag/v${newVersion}`)}
            >
              <ExternalLink className="h-3 w-3" />
              {t("mainApp.updateDialog.learnMore")}
            </Button>
          </div>
          <div className="max-h-[240px] overflow-y-auto pr-3">
            <ChangelogContent sections={sections} />
          </div>
        </div>

        <Separator />

        {/* Footer: 3 buttons */}
        <DialogFooter className="px-6 py-4 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={isDownloading}
            onClick={onSkipVersion}
          >
            {t("mainApp.updateDialog.skipVersion")}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isDownloading}
              onClick={onRemindLater}
            >
              {t("mainApp.updateDialog.remindLater")}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={isDownloading}
              onClick={onInstallUpdate}
            >
              {isDownloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isDownloading
                ? t("mainApp.update.downloading")
                : t("mainApp.updateDialog.installUpdate")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangelogContent({ sections }: { sections: ChangelogSection[] }) {
  return (
    <div className="space-y-3">
      {sections.map((section, i) => (
        <div key={i}>
          {sections.length > 1 && (
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {section.emoji && `${section.emoji} `}
              {section.heading}
            </p>
          )}
          <ul className="space-y-1">
            {section.items.map((item, j) => (
              <li key={j} className="flex gap-2 text-sm text-foreground/90">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
