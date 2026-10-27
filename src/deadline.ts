export const REQUEST_DEADLINE_MS = 90_000;

let ceilingForTests: number | null = null;

export function setPhraseCeilingForTests(ms: number | null): void {
  ceilingForTests = ms;
}

/** Wall clock for a released answer. A miss ends unresolved. */
export function phraseCeilingMs(verb: string): number {
  if (ceilingForTests != null) return ceilingForTests;
  if (verb === "NEXT") return 10_000;
  if (verb === "PATTERNS") return 25_000;
  return 15_000;
}
export const MODEL_HOP_MS = 35_000;

export class RequestDeadlineError extends Error {
  constructor() {
    super("request deadline");
    this.name = "RequestDeadlineError";
  }
}

export function throwIfRequestDeadline(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RequestDeadlineError();
}

/** One ceiling for the whole request. hop() shrinks the next call; signal aborts in-flight fetches. */
export class Deadline {
  readonly signal: AbortSignal;
  private readonly ac = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private endMs: number;
  private heldAt: number | null = null;
  private readonly startedMs: number;
  private readonly ceilingMs: number;

  private constructor(endMs: number, startedMs: number, ceilingMs: number) {
    this.endMs = endMs;
    this.startedMs = startedMs;
    this.ceilingMs = ceilingMs;
    this.timer = setTimeout(() => this.ac.abort(), Math.max(0, this.endMs - Date.now()));
    this.timer.unref?.();
    this.signal = this.ac.signal;
  }

  static start(ms = REQUEST_DEADLINE_MS): Deadline {
    const startedMs = Date.now();
    return new Deadline(startedMs + ms, startedMs, ms);
  }

  /** Wall time from the start, including spacing and backoff. */
  over(): boolean {
    return this.signal.aborted || Date.now() - this.startedMs >= this.ceilingMs;
  }

  /** Our own spacing and backoff do not spend the request ceiling. */
  hold(): void {
    if (this.heldAt != null || this.signal.aborted) return;
    this.heldAt = Date.now();
    clearTimeout(this.timer);
  }

  resume(): void {
    if (this.heldAt == null) return;
    this.endMs += Date.now() - this.heldAt;
    this.heldAt = null;
    if (this.signal.aborted) return;
    this.timer = setTimeout(() => this.ac.abort(), Math.max(0, this.endMs - Date.now()));
    this.timer.unref?.();
  }

  remaining(): number {
    if (this.heldAt != null) return Math.max(0, this.endMs - this.heldAt);
    return Math.max(0, this.endMs - Date.now());
  }

  hop(budgetMs: number): number {
    throwIfRequestDeadline(this.signal);
    const left = this.remaining();
    if (left < 1_000) throw new RequestDeadlineError();
    return Math.min(budgetMs, left);
  }
}
