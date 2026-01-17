import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AtSign,
  CircleAlert,
  Facebook,
  Github,
  Globe,
  Instagram,
} from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { getSlogans } from "@/lib/slogans";

const EASTER_EGG_CLICKS = 7;

export default function AboutSection() {
  const { t } = useTranslation();
  const [clickCount, setClickCount] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  const handleVersionClick = useCallback(() => {
    const next = clickCount + 1;
    setClickCount(next);
    if (next >= EASTER_EGG_CLICKS && !showEasterEgg) {
      setShowEasterEgg(true);
    }
  }, [clickCount, showEasterEgg]);

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
        {/* Easter egg: slogans revealed */}
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
            <a
              href="https://bobo.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground transition-colors hover:text-primary"
            >
              Bobo Chen
            </a>
          </p>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <a
            href="https://bobo.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <Globe className="size-4" />
            <span>{t("settings.about.website")}</span>
          </a>
          <a
            href="https://www.facebook.com/bobo52310"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <Facebook className="size-4" />
            <span>Facebook</span>
          </a>
          <a
            href="https://www.instagram.com/bobo52310"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <Instagram className="size-4" />
            <span>Instagram</span>
          </a>
          <a
            href="https://www.threads.com/@bobo52310"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <AtSign className="size-4" />
            <span>Threads</span>
          </a>
        </div>

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
