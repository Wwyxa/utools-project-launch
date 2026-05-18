import type { ProjectBridge } from "./types";

declare global {
  interface Window {
    projectBridge?: ProjectBridge;
    utools?: {
      isDarkColors(): boolean;
      onPluginEnter(callback: () => void): void;
      [key: string]: any;
    };
  }
}

export {};
