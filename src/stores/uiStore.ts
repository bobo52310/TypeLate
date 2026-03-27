import { create } from "zustand";

type SettingsSectionId = "general" | "voice" | "about";

interface UIStore {
  activeSettingsSection: SettingsSectionId;
  setActiveSettingsSection: (section: SettingsSectionId) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeSettingsSection: "general",
  setActiveSettingsSection: (section) => set({ activeSettingsSection: section }),
}));
