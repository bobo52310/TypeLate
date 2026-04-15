/**
 * Serialized paste queue.
 *
 * When multiple transcription pipelines finish close together (CleanShot X–style
 * chained recordings), each wants to invoke `paste_text`, which simulates
 * Cmd/Ctrl+V at the OS level. Firing two of those concurrently races on the
 * clipboard and the synthetic keystroke — the second paste can clobber or
 * interleave with the first.
 *
 * This module funnels every paste through a single promise chain so they run
 * strictly in order. A failure in one paste does not block subsequent pastes.
 */

import { invoke } from "@tauri-apps/api/core";

let chain: Promise<void> = Promise.resolve();

export interface PasteOptions {
  text: string;
  preserveClipboard: boolean;
}

/**
 * Enqueue a paste. Resolves (or rejects) when *this* paste finishes, not when
 * the whole chain drains. Errors are isolated: one failed paste does not
 * reject the tail of the chain.
 */
export function enqueuePaste({ text, preserveClipboard }: PasteOptions): Promise<void> {
  const task = chain.then(
    () => invoke<void>("paste_text", { text, preserveClipboard }),
    () => invoke<void>("paste_text", { text, preserveClipboard }),
  );
  // Keep chain alive even if this task rejects, so later pastes still run.
  chain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/** Test helper: reset the chain. */
export function __resetPasteQueueForTest(): void {
  chain = Promise.resolve();
}
