import type { InjectionKey } from "vue";
import type { StartupPreflightResult } from "../types";

// The preflight runs in main.ts before the Pinia store is created, so the
// blocking startup gate receives the result via provide/inject instead of the
// store.
export const STARTUP_PREFLIGHT_KEY: InjectionKey<StartupPreflightResult> = Symbol("startup-preflight");
