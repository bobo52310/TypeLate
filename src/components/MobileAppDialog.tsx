import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const WEBSITE_URL = "https://typelate.app";

interface MobileAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileAppDialog({ open, onOpenChange }: MobileAppDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("mainApp.mobileApp.title")}</DialogTitle>
          <DialogDescription>{t("mainApp.mobileApp.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl border bg-white p-3">
            <QRCodeSVG value={WEBSITE_URL} size={180} />
          </div>
          <p className="text-xs text-muted-foreground">{t("mainApp.mobileApp.scanHint")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
