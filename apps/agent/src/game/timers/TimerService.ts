import { randomUUID } from "crypto";

export interface TimerService {
  /** Schedule a callback after given ms; returns an id for cancellation */
  schedule(ms: number, cb: () => void): string;
  /** Cancel a previously scheduled timer */
  cancel(id: string): void;
}

export class RealTimerService implements TimerService {
  private map = new Map<string, NodeJS.Timeout>();
  schedule(ms: number, cb: () => void): string {
    const id = randomUUID();
    const handle = setTimeout(() => {
      this.map.delete(id);
      cb();
    }, ms);
    this.map.set(id, handle);
    return id;
  }
  cancel(id: string) {
    const h = this.map.get(id);
    if (h) clearTimeout(h);
    this.map.delete(id);
  }
}

/**
 * Deterministic timer service for tests – nothing fires until `advance()` is called.
 */
export class ManualTimerService implements TimerService {
  private now = 0;
  private queue: Array<{ at: number; cb: () => void; id: string }> = [];
  schedule(ms: number, cb: () => void): string {
    const id = `t-${this.queue.length}`;
    this.queue.push({ at: this.now + ms, cb, id });
    return id;
  }
  cancel(id: string) {
    this.queue = this.queue.filter((t) => t.id !== id);
  }
  /** Advance virtual time and fire due timers */
  advance(ms: number) {
    this.now += ms;
    const due = this.queue.filter((t) => t.at <= this.now);
    this.queue = this.queue.filter((t) => t.at > this.now);
    for (const t of due) t.cb();
  }
}
