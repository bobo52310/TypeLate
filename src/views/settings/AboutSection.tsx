import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CircleAlert, Download, Github, RefreshCw } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { getSlogans } from "@/lib/slogans";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

const EASTER_EGG_CLICKS = 7;

type UpdateCheckState = "idle" | "checking" | "downloading" | "ready";

export default function AboutSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();
  const [clickCount, setClickCount] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateCheckState>("idle");
  const [availableVersion, setAvailableVersion] = useState("");

  const handleVersionClick = useCallback(() => {
    const next = clickCount + 1;
    setClickCount(next);
    if (next >= EASTER_EGG_CLICKS && !showEasterEgg) {
      setShowEasterEgg(true);
    }
  }, [clickCount, showEasterEgg]);

  async function handleCheckForUpdate() {
    if (updateState === "checking" || updateState === "downloading") return;
    setUpdateState("checking");
    try {
      const { checkForAppUpdate } = await import("@/lib/autoUpdater");
      const result = await checkForAppUpdate();
      if (result.status === "update-available" && result.version) {
        setAvailableVersion(result.version);
        setUpdateState("ready");
      } else if (result.status === "error") {
        feedback.show("error", t("mainApp.update.checkFailed"));
        setUpdateState("idle");
      } else {
        feedback.show("success", t("mainApp.update.upToDate"));
        setUpdateState("idle");
      }
    } catch {
      feedback.show("error", t("mainApp.update.checkError"));
      setUpdateState("idle");
    }
  }

  async function handleStartUpdate() {
    setUpdateState("downloading");
    try {
      const { downloadInstallAndRelaunch } = await import("@/lib/autoUpdater");
      await downloadInstallAndRelaunch();
    } catch {
      feedback.show("error", t("mainApp.update.updateFailed"));
      setUpdateState("idle");
      setAvailableVersion("");
    }
  }

  const slogans = getSlogans();

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {t("settings.about.title")}
          </CardTitle>
          <button
            onClick={handleVersionClick}
            className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground select-none"
          >
            v{APP_VERSION}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showEasterEgg && slogans.length > 0 && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
            <p className="text-xs font-medium text-primary">
              {"\u{1F389}"} TypeLate
            </p>
            {slogans.map((slogan, i) => (
              <p key={i} className="text-sm italic text-foreground/80">
                &ldquo;{slogan}&rdquo;
              </p>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {t("settings.about.description")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.about.author")}
            <span className="font-medium text-foreground">Bobo Chen</span>
          </p>
        </div>

        <Separator />

        {/* Update check */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {updateState === "ready"
              ? `v${availableVersion} ${t("mainApp.update.ready").toLowerCase()}`
              : `v${APP_VERSION}`}
          </div>
          {updateState === "ready" ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => void handleStartUpdate()}
            >
              <Download className="h-3.5 w-3.5" />
              {t("mainApp.update.installNow")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={updateState === "checking" || updateState === "downloading"}
              onClick={() => void handleCheckForUpdate()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${updateState === "checking" ? "animate-spin" : ""}`} />
              {updateState === "checking"
                ? t("mainApp.update.checking")
                : updateState === "downloading"
                  ? t("mainApp.update.downloading")
                  : t("mainApp.update.checkUpdate")}
            </Button>
          )}
        </div>

        {feedback.message && (
          <p
            className={`text-sm ${
              feedback.type === "success" ? "text-primary" : "text-destructive"
            }`}
          >
            {feedback.message}
          </p>
        )}

        <Separator />

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <a
            href="https://github.com/bobo52310/TypeLate"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <Github className="size-4" />
            <span>{t("settings.about.sourceCode")}</span>
          </a>
          <a
            href="https://github.com/bobo52310/TypeLate/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <CircleAlert className="size-4" />
            <span>{t("settings.about.reportIssue")}</span>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
