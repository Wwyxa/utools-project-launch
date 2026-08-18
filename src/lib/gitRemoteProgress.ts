export const gitRemoteProgressOperationId = "git-remote-progress";

export const gitRemoteProgressStage = (message: string) =>
  message
    .replace(/^remote:\s*/i, "")
    .split(":", 1)[0]
    ?.trim()
    .toLocaleLowerCase() || message;
