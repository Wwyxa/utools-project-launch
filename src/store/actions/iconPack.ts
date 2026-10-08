import type { AppStore } from "../appStoreShape";
import type { IconPackLoadResult, IconPackUpdateResult, IconPackRemoveResult } from "../../types";
import { bridge } from "../helpers/bridge";
import { normalizeUiPreferences } from "../../lib/projectBridge";

export const iconPackActions = {
  async loadIconPack(this: AppStore): Promise<IconPackLoadResult> {
    try {
      const result = await bridge.loadInstalledIconPack();
      const selectedPackId = this.uiPreferences.iconPackId;
      this.activeIconPack = result.ok && result.manifest?.id === selectedPackId ? result.manifest : null;
      const status = await bridge.getIconPackStatus();
      this.iconPackStatus = {
        ...status,
        selectedPackId,
        active: Boolean(this.activeIconPack),
      };
      this.iconPackMessage = result.ok ? "" : result.message || "";
      return result;
    } catch (error) {
      this.activeIconPack = null;
      this.iconPackStatus = {
        selectedPackId: this.uiPreferences.iconPackId,
        installedPackId: null,
        installedVersion: null,
        state: "unavailable",
        active: false,
      };
      this.iconPackMessage = "外部图标包不可用，已使用内置图标。";
      return {
        ok: false,
        manifest: null,
        state: "unavailable",
        message: this.iconPackMessage,
      };
    }
  },

  async setIconPack(this: AppStore, packId: string): Promise<IconPackLoadResult> {
    const nextPreferences = normalizeUiPreferences({ ...this.uiPreferences, iconPackId: packId });
    if (nextPreferences.iconPackId !== this.uiPreferences.iconPackId) {
      this.uiPreferences = nextPreferences;
      bridge.saveUiPreferences(this.uiPreferences);
    }
    return this.loadIconPack();
  },

  async checkIconPackUpdate(this: AppStore): Promise<IconPackUpdateResult> {
    const result = await bridge.checkIconPackUpdate();
    if (this.iconPackStatus) {
      this.iconPackStatus = {
        ...this.iconPackStatus,
        updateAvailable: result.ok ? result.updateAvailable : false,
        latestVersion: result.latestVersion,
      };
    }
    this.iconPackMessage = result.ok ? result.message || "" : result.message || "外部图标包更新检查失败。";
    return result;
  },

  async installIconPack(this: AppStore): Promise<IconPackLoadResult> {
    const result = await bridge.downloadIconPack();
    await this.loadIconPack();
    this.iconPackMessage = result.ok ? "" : result.message || "外部图标包安装失败。";
    return result;
  },

  async verifyIconPackInstall(this: AppStore): Promise<IconPackLoadResult> {
    const result = await bridge.verifyIconPackInstall();
    await this.loadIconPack();
    this.iconPackMessage = result.ok ? "" : result.message || "外部图标包验证失败。";
    return result;
  },

  async removeIconPack(this: AppStore): Promise<IconPackRemoveResult> {
    const result = await bridge.removeIconPack();
    this.uiPreferences = normalizeUiPreferences(bridge.loadUiPreferences());
    await this.loadIconPack();
    this.iconPackMessage = result.ok ? "" : result.message || "外部图标包移除失败。";
    return result;
  },

  async openIconPackDirectory(this: AppStore) {
    await bridge.openIconPackDirectory();
  },

  async openIconPackReleases(this: AppStore) {
    await bridge.openIconPackReleases();
  }
};
