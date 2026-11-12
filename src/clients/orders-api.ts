import { UpstreamError } from "../errors.js";

export interface OrdersPage {
  items: unknown[];
  nextCursor: string | null;
}

export interface Customer {
  id: string;
  timezone: string;
}

/** То, что сервису нужно от внешнего API. В тестах подменяется фейком. */
export interface OrdersApi {
  getOrdersPage(cursor: string | null, limit: number): Promise<OrdersPage>;
  getCustomer(id: string): Promise<Customer | null>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryDelay(header: string | null, now: number): number {
  if (!header) return 1000;
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? 1000 : Math.max(0, date - now);
}

/**
 * Внешний API принимает до 5 запросов в секунду. При превышении возвращает 429
 * или 200 с телом { "error": "rate_limited" }.
 */
export class HttpOrdersApi implements OrdersApi {
  private nextSlot = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly opts: { rps?: number; maxAttempts?: number } = {},
  ) {}

  async getOrdersPage(cursor: string | null, limit: number): Promise<OrdersPage> {
    const url = new URL("/orders", this.baseUrl);
    url.searchParams.set("limit", String(limit));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const body = (await this.request(url)) as Partial<OrdersPage> | null;
    if (!body || !Array.isArray(body.items) || (body.nextCursor !== null && typeof body.nextCursor !== "string")) {
      throw new UpstreamError("unexpected /orders response");
    }
    return { items: body.items, nextCursor: body.nextCursor };
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const body = (await this.request(new URL(`/customers/${encodeURIComponent(id)}`, this.baseUrl))) as Partial<Customer> | null;
    if (body === null) return null;
    if (body.id !== id || typeof body.timezone !== "string") {
      throw new UpstreamError("unexpected /customers response");
    }
    return { id, timezone: body.timezone };
  }

  private async throttle(): Promise<void> {
    let wait = this.nextSlot - Date.now();
    while (wait > 0) {
      await sleep(wait);
      wait = this.nextSlot - Date.now();
    }
    this.nextSlot = Date.now() + 1000 / (this.opts.rps ?? 4);
  }

  /** Возвращает null при HTTP 404. */
  private async request(url: URL): Promise<unknown> {
    const maxAttempts = this.opts.maxAttempts ?? 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.throttle();
      const backoff = Math.min(500 * 2 ** (attempt - 1), 8000);
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      } catch {
        if (attempt < maxAttempts) await sleep(backoff);
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 429) {
        const now = Date.now();
        this.nextSlot = Math.max(this.nextSlot, now + retryDelay(res.headers.get("retry-after"), now));
        continue;
      }
      if (res.status >= 500) {
        if (attempt < maxAttempts) await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new UpstreamError(`${url.pathname}: HTTP ${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new UpstreamError(`${url.pathname}: invalid JSON response`);
      }
      if (body && typeof body === "object" && "error" in body && body.error === "rate_limited") {
        this.nextSlot = Math.max(this.nextSlot, Date.now() + 1000);
        continue;
      }
      return body;
    }
    throw new UpstreamError(`${url.pathname}: no successful response after ${maxAttempts} attempts`);
  }
}
