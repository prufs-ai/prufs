/**
 * Minimal typed event emitter for sync progress reporting.
 *
 * Avoids pulling in Node's events module to keep the package portable
 * (the sync engine is designed to run in both Node and Deno environments).
 */

import type { SyncEventPayload, SyncEventType } from "./types.js";

type Listener = (payload: SyncEventPayload) => void;

export class SyncEmitter {
  private listeners: Map<SyncEventType | "*", Listener[]> = new Map();

  on(event: SyncEventType | "*", listener: Listener): this {
    const existing = this.listeners.get(event);
    if (existing) {
      existing.push(listener);
    } else {
      this.listeners.set(event, [listener]);
    }
    return this;
  }

  off(event: SyncEventType | "*", listener: Listener): this {
    const existing = this.listeners.get(event);
    if (existing) {
      const index = existing.indexOf(listener);
      if (index >= 0) {
        existing.splice(index, 1);
      }
    }
    return this;
  }

  emit(payload: SyncEventPayload): void {
    const specific = this.listeners.get(payload.type);
    if (specific) {
      for (const listener of specific) {
        listener(payload);
      }
    }
    const all = this.listeners.get("*");
    if (all) {
      for (const listener of all) {
        listener(payload);
      }
    }
  }

  listenerCount(event: SyncEventType | "*"): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}
