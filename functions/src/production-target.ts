export const PRODUCTION_PROJECT = "line-auto-translate-bot";
export const PRODUCTION_RUNTIME_ACCOUNT = "line-translator-runtime@" + PRODUCTION_PROJECT + ".iam.gserviceaccount.com";
export const PRODUCTION_OPERATIONS_COLLECTION = "lineEventOperations";
export function isSupportedRuntimeProject(projectId: string): boolean {
  return projectId === PRODUCTION_PROJECT || projectId === "line-auto-translate-bot-dev";
}
