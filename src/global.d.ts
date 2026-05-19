import type { ProjectBridge } from "./types";

declare global {
  interface Window {
    projectBridge?: ProjectBridge;
    utools?: {
      isDarkColors(): boolean;
      onPluginEnter(callback: (action?: unknown) => void): void;
      outPlugin(isKill?: boolean): boolean;
      showOpenDialog?(options: unknown): Promise<string[] | { filePaths?: string[] } | null>;
      showSaveDialog?(options: unknown): Promise<string | { filePath?: string } | null>;
      dbStorage?: {
        getItem(key: string): unknown;
        setItem(key: string, value: unknown): void;
      };
      db?: {
        put(doc: Record<string, unknown>): unknown;
        get(id: string): unknown;
        remove(doc: Record<string, unknown>): unknown;
        bulkDocs?(docs: Record<string, unknown>[]): unknown;
        allDocs(prefix?: string): unknown;
      };
      [key: string]: unknown;
    };
  }
}

export {};
