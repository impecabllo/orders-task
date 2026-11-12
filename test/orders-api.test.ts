import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpOrdersApi } from "../src/clients/orders-api.js";

const BASE_URL = "http://orders.test";
const NOW = Date.parse("2026-03-29T10:00:00Z");

describe("HTTP-клиент заказов", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["HTTP 429 с паузой в секундах", () => new Response(null, { status: 429, headers: { "Retry-After": "1" } })],
    ["HTTP 429 с датой", () => new Response(null, { status: 429, headers: { "Retry-After": new Date(NOW + 1000).toUTCString() } })],
    ["HTTP 200 с rate_limited", () => Response.json({ error: "rate_limited" })],
  ] as const)("учитывает общую паузу при параллельных запросах (%s)", async (_label, limitedResponse) => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn((url: URL) => Response.json({
      id: url.pathname.split("/").at(-1),
      timezone: "UTC",
    })).mockImplementationOnce(limitedResponse);
    vi.stubGlobal("fetch", fetchMock);
    const api = new HttpOrdersApi(BASE_URL);
    const customers = Promise.all([api.getCustomer("a"), api.getCustomer("b")]);

    try {
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(251);
      await expect(customers).resolves.toEqual([{ id: "a", timezone: "UTC" }, { id: "b", timezone: "UTC" }]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["неверный курсор", () => Response.json({ items: [], nextCursor: 42 })],
    ["невалидный JSON", () => new Response("{")],
  ] as const)("отклоняет неверный ответ списка заказов (%s)", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn(response));
    const api = new HttpOrdersApi(BASE_URL);
    await expect(api.getOrdersPage(null, 100)).rejects.toMatchObject({ statusCode: 502, code: "upstream_error" });
  });
});
