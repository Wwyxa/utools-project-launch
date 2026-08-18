import { readonly, shallowRef } from "vue";

export type ActionStatusState = "loading" | "success" | "warning" | "error";
export type ActionStatusEntry = { timestamp: string; message: string; stage?: string };
export type ActionStatus = {
  id: number;
  operationId?: string;
  isProgress: boolean;
  state: ActionStatusState;
  message: string;
  entries: ActionStatusEntry[];
};
export type ActionStatusInput = {
  state: ActionStatusState;
  message: string;
  entries?: readonly ActionStatusEntry[];
  dismissAfterMs?: number | null;
};
export type ActionProgressInput = ActionStatusInput & {
  operationId: string;
};

const defaultDismissAfterMs = {
  loading: null,
  success: 3200,
  warning: 4800,
  error: 6000,
} satisfies Record<ActionStatusState, number | null>;

const currentActionStatus = shallowRef<ActionStatus | null>(null);
let dismissTimer: number | null = null;
let nextActionStatusId = 0;

export const activeActionStatus = readonly(currentActionStatus);

const cancelDismissTimer = () => {
  if (dismissTimer) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
};

const resolveDismissAfterMs = (input: ActionStatusInput) => {
  if (input.dismissAfterMs === null) {
    return null;
  }
  if (typeof input.dismissAfterMs === "number" && Number.isFinite(input.dismissAfterMs)) {
    return Math.max(0, Math.floor(input.dismissAfterMs));
  }
  return defaultDismissAfterMs[input.state];
};

const setActionStatus = (input: ActionStatusInput, operationId?: string) => {
  const message = input.message.trim();
  if (!message) {
    dismissActionStatus();
    return 0;
  }

  cancelDismissTimer();
  const id = ++nextActionStatusId;
  const dismissAfterMs = resolveDismissAfterMs(input);
  currentActionStatus.value = {
    id,
    operationId,
    isProgress: operationId !== undefined,
    state: input.state,
    message,
    entries: input.entries?.slice(-20).map((entry) => ({ ...entry })) || [],
  };

  if (dismissAfterMs === null) {
    return id;
  }

  dismissTimer = window.setTimeout(() => {
    if (currentActionStatus.value?.id === id) {
      currentActionStatus.value = null;
    }
    dismissTimer = null;
  }, dismissAfterMs);
  return id;
};

export const showActionStatus = (input: ActionStatusInput) => setActionStatus(input);

export const showActionProgress = (input: ActionProgressInput) => setActionStatus(input, input.operationId);

export const completeActionProgress = (
  state: Exclude<ActionStatusState, "loading">,
  message: string,
  operationId: string,
) => {
  const status = currentActionStatus.value;
  if (!status?.isProgress || status.operationId !== operationId) {
    return 0;
  }
  return showActionProgress({ state, message, operationId, entries: status.entries });
};

export const dismissActionStatus = (statusId?: number) => {
  if (statusId !== undefined && currentActionStatus.value?.id !== statusId) {
    return;
  }
  cancelDismissTimer();
  currentActionStatus.value = null;
};
