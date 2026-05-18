import type { ProjectBridge } from "./types";

declare global {
  interface Window {
    projectBridge?: ProjectBridge;
  }
}

export {};
