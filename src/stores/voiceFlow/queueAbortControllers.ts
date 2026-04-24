/**
 * Per-queue-item abort controllers.
 *
 * Lives in a separate module so both voiceFlowStore (for cleanup) and
 * transcriptionPipeline (for managing per-recording aborts) can access it
 * without creating a circular import.
 *
 * Not stored in Zustand state because AbortController is not serializable.
 */

const controllers = new Map<string, AbortController>();

export function setQueueAbortController(id: string, controller: AbortController): void {
  controllers.set(id, controller);
}

export function getQueueAbortController(id: string): AbortController | undefined {
  return controllers.get(id);
}

export function deleteQueueAbortController(id: string): void {
  controllers.delete(id);
}

export function abortAllQueueControllers(): void {
  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
}
