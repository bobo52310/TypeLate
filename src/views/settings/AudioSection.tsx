import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Volume2, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { BUILT_IN_PRESETS, CUSTOM_PRESET_ID, type SoundSlot } from "@/lib/soundPresets";

interface AudioInputDeviceInfo {
  name: string;
}

export default function AudioSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedAudioInputDeviceName = useSettingsStore((s) => s.selectedAudioInputDeviceName);
  const isMuteOnRecordingEnabled = useSettingsStore((s) => s.isMuteOnRecordingEnabled);
  const isSoundEffectsEnabled = useSettingsStore((s) => s.isSoundEffectsEnabled);
  const soundPresetId = useSettingsStore((s) => s.soundPresetId);
  const customSoundPaths = useSettingsStore((s) => s.customSoundPaths);
  const saveAudioInputDevice = useSettingsStore((s) => s.saveAudioInputDevice);
  const saveMuteOnRecording = useSettingsStore((s) => s.saveMuteOnRecording);
  const saveSoundEffectsEnabled = useSettingsStore((s) => s.saveSoundEffectsEnabled);
  const saveSoundPreset = useSettingsStore((s) => s.saveSoundPreset);
  const saveCustomSoundPath = useSettingsStore((s) => s.saveCustomSoundPath);
  const getSoundForSlot = useSettingsStore((s) => s.getSoundForSlot);

  const [deviceList, setDeviceList] = useState<AudioInputDeviceInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadDeviceList() {
    try {
      const list = await invoke<AudioInputDeviceInfo[]>("list_audio_input_devices");
      setDeviceList(list);
    } catch {
      // Device enumeration may fail if no audio hardware available
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
        t("settings.audioInput.refreshed", { count: deviceList.length }),
      );
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleDeviceChange(deviceName: string) {
    try {
      await saveAudioInputDevice(deviceName === "_default" ? "" : deviceName);
      feedback.show("success", t("settings.audioInput.updated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleMuteOnRecording(newValue: boolean) {
    try {
      await saveMuteOnRecording(newValue);
      feedback.show(
        "success",
        newValue ? t("settings.app.muteEnabled") : t("settings.app.muteDisabled"),
      );
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePresetChange(presetId: string) {
    try {
      await saveSoundPreset(presetId);
      feedback.show("success", t("settings.app.soundPresetUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  function handlePreviewSound() {
    const soundName = getSoundForSlot("start");
    if (soundName) {
      void invoke("play_sound", { soundName });
    }
  }

  async function handleSelectCustomFile(slot: SoundSlot) {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "aiff", "m4a"] }],
      });
      if (selected) {
        await saveCustomSoundPath(slot, selected as string);
        feedback.show("success", t("settings.app.customSoundSaved"));
      }
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleSoundFeedback(newValue: boolean) {
    try {
      await saveSoundEffectsEnabled(newValue);
      feedback.show(
        "success",
        newValue ? t("settings.app.soundFeedbackEnabled") : t("settings.app.soundFeedbackDisabled"),
      );
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsGroup
      title={t("settings.audioInput.title")}
      description={t("settings.audioInput.description")}
    >
      {/* Audio input device */}
      <SettingsRow label={t("settings.audioInput.deviceLabel")} htmlFor="audio-input-device">
        <div className="flex items-center gap-2">
          <Select
            value={selectedAudioInputDeviceName || "_default"}
            onValueChange={(val) => void handleDeviceChange(val)}
          >
            <SelectTrigger id="audio-input-device" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_default">{t("settings.audioInput.systemDefault")}</SelectItem>
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
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>
      </SettingsRow>

      {/* Mute on recording */}
      <SettingsRow
        label={t("settings.app.muteOnRecording")}
        description={t("settings.app.muteDescription")}
        htmlFor="mute-on-recording"
      >
        <Switch
          id="mute-on-recording"
          checked={isMuteOnRecordingEnabled}
          onCheckedChange={(val) => void handleToggleMuteOnRecording(val)}
        />
      </SettingsRow>

      {/* Sound effects */}
      <SettingsRow
        label={t("settings.app.soundFeedback")}
        description={t("settings.app.soundFeedbackDescription")}
        htmlFor="sound-feedback"
      >
        <Switch
          id="sound-feedback"
          checked={isSoundEffectsEnabled}
          onCheckedChange={(val) => void handleToggleSoundFeedback(val)}
        />
      </SettingsRow>

      {/* Sound preset selector (visible when sound effects enabled) */}
      {isSoundEffectsEnabled && (
        <SettingsRow
          label={t("settings.app.soundPreset")}
          description={t("settings.app.soundPresetDescription")}
        >
          <div className="flex items-center gap-2">
            <Select
              value={soundPresetId}
              onValueChange={(val) => void handlePresetChange(val)}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUILT_IN_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {t(p.labelKey)}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_PRESET_ID}>
                  {t("settings.app.soundPresets.custom")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={handlePreviewSound}>
              <Volume2 className="h-4 w-4" />
            </Button>
          </div>
        </SettingsRow>
      )}

      {/* Custom sound file pickers */}
      {isSoundEffectsEnabled && soundPresetId === CUSTOM_PRESET_ID && (
        <div className="space-y-2 px-4 py-3">
          <p className="text-sm font-medium">{t("settings.app.customSounds")}</p>
          {(["start", "stop", "error", "learned"] as SoundSlot[]).map((slot) => (
            <div key={slot} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t(`settings.app.soundSlots.${slot}`)}
              </span>
              <div className="flex items-center gap-2">
                <span className="max-w-32 truncate text-xs text-muted-foreground">
                  {customSoundPaths?.[slot]?.split("/").pop() ?? "—"}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSelectCustomFile(slot)}
                >
                  <FolderOpen className="mr-1 h-3 w-3" />
                  {t("settings.app.selectFile")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
