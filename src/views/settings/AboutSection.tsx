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

export default function AboutSection() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">
          {t("settings.about.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
            href="https://github.com/bobo52310/SayIt"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <Github className="size-4" />
            <span>{t("settings.about.sourceCode")}</span>
          </a>
          <a
            href="https://github.com/bobo52310/SayIt/issues"
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
