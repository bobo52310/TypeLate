import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

interface AudioInputDeviceInfo {
  name: string;
}

export default function AudioSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();
  const muteOnRecordingFeedback = useFeedbackMessage();
  const soundFeedbackFeedback = useFeedbackMessage();

  const selectedAudioInputDeviceName = useSettingsStore(
    (s) => s.selectedAudioInputDeviceName,
  );
  const isMuteOnRecordingEnabled = useSettingsStore(
    (s) => s.isMuteOnRecordingEnabled,
  );
  const isSoundEffectsEnabled = useSettingsStore(
    (s) => s.isSoundEffectsEnabled,
  );
  const saveAudioInputDevice = useSettingsStore(
    (s) => s.saveAudioInputDevice,
  );
  const saveMuteOnRecording = useSettingsStore((s) => s.saveMuteOnRecording);
  const saveSoundEffectsEnabled = useSettingsStore(
    (s) => s.saveSoundEffectsEnabled,
  );

  const [deviceList, setDeviceList] = useState<AudioInputDeviceInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadDeviceList() {
    try {
      const list = await invoke<AudioInputDeviceInfo[]>(
        "list_audio_input_devices",
      );
      setDeviceList(list);
    } catch (err) {
      console.error(
        "[AudioSection] Failed to list audio input devices:",
        err,
      );
    }
  }

  useEffect(() => {
    void loadDeviceList();
  }, []);

  async function handleRefreshDeviceList() {
    setIsRefreshing(true);
    try {
      await loadDeviceList();
      feedback.show(
        "success",
        t("settings.audioInput.refreshed", {
          count: deviceList.length,
        }),
      );
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleDeviceChange(deviceName: string) {
    try {
      await saveAudioInputDevice(
        deviceName === "_default" ? "" : deviceName,
      );
      feedback.show("success", t("settings.audioInput.updated"));
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleToggleMuteOnRecording(newValue: boolean) {
    try {
      await saveMuteOnRecording(newValue);
      muteOnRecordingFeedback.show(
        "success",
        newValue
          ? t("settings.app.muteEnabled")
          : t("settings.app.muteDisabled"),
      );
    } catch (err) {
      muteOnRecordingFeedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleToggleSoundFeedback(newValue: boolean) {
    try {
      await saveSoundEffectsEnabled(newValue);
      soundFeedbackFeedback.show(
        "success",
        newValue
          ? t("settings.app.soundFeedbackEnabled")
          : t("settings.app.soundFeedbackDisabled"),
      );
    } catch (err) {
      soundFeedbackFeedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">
          {t("settings.audioInput.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.audioInput.description")}
        </p>

        {/* Audio input device */}
        <div className="space-y-2">
          <Label htmlFor="audio-input-device">
            {t("settings.audioInput.deviceLabel")}
          </Label>
          <div className="flex items-center gap-2">
            <Select
              value={selectedAudioInputDeviceName || "_default"}
              onValueChange={(val) => void handleDeviceChange(val)}
            >
              <SelectTrigger id="audio-input-device" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">
                  {t("settings.audioInput.systemDefault")}
                </SelectItem>
                {deviceList.map((device) => (
                  <SelectItem key={device.name} value={device.name}>
                    {device.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              disabled={isRefreshing}
              onClick={() => void handleRefreshDeviceList()}
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
            </Button>
          </div>
        </div>

        {feedback.message && (
          <p
            className={`text-sm ${
              feedback.type === "success"
                ? "text-green-400"
                : "text-destructive"
            }`}
          >
            {feedback.message}
          </p>
        )}

        <div className="border-t border-border" />

        {/* Mute on recording */}
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="mute-on-recording">
              {t("settings.app.muteOnRecording")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.app.muteDescription")}
            </p>
          </div>
          <Switch
            id="mute-on-recording"
            checked={isMuteOnRecordingEnabled}
            onCheckedChange={(val) =>
              void handleToggleMuteOnRecording(val)
            }
          />
        </div>

        {muteOnRecordingFeedback.message && (
          <p
            className={`text-sm ${
              muteOnRecordingFeedback.type === "success"
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {muteOnRecordingFeedback.message}
          </p>
        )}

        <div className="border-t border-border" />

        {/* Sound effects */}
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="sound-feedback">
              {t("settings.app.soundFeedback")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.app.soundFeedbackDescription")}
            </p>
          </div>
          <Switch
            id="sound-feedback"
            checked={isSoundEffectsEnabled}
            onCheckedChange={(val) =>
              void handleToggleSoundFeedback(val)
            }
          />
        </div>

        {soundFeedbackFeedback.message && (
          <p
            className={`text-sm ${
              soundFeedbackFeedback.type === "success"
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {soundFeedbackFeedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
