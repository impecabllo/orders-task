import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("распределяет заказы по местным дням до и после перехода на летнее время", async () => {
    ctx.api.customers.set("c_1", "Europe/Berlin");
    // До перехода 22:30Z — 23:30 того же дня, после перехода — 00:30 следующего.
    await postWebhook(ctx.app, apiOrder({ amount: 100, createdAt: "2026-03-28T22:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 200, createdAt: "2026-03-29T22:30:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-03-28", "2026-03-30");
    expect(res.statusCode).toBe(200);
    expect(res.json().map(({ total }: { total: number }) => total)).toEqual([100, 0, 200]);
  });

  it("суммирует gross и фактически оплаченное в копейках после синка и вебхука", async () => {
    const order = apiOrder({ amount: "10.29", amountPaid: 8.57, discountPercent: 17 });
    ctx.api.pages.set(null, { items: [order, apiOrder({ amount: 0.29, amountPaid: 0 })], nextCursor: null });
    const sync = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(sync.json()).toMatchObject({ applied: 2, invalid: 0 });
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json()).toEqual([
      { date: "2026-02-10", total: 10.58, gross: 10.58, discount: 2.01, net: 8.57 },
    ]);

    const update = await postWebhook(ctx.app, { ...order, amountPaid: "7.29", updatedAt: "2026-02-11T12:00:00Z" });
    expect(update.json()).toEqual({ result: "updated" });
    expect((await postWebhook(ctx.app, order)).json()).toEqual({ result: "stale" });
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json()).toEqual([
      { date: "2026-02-10", total: 10.58, gross: 10.58, discount: 3.29, net: 7.29 },
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, amountPaid: 600, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, amountPaid: 800, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 500, gross: 500, discount: 0, net: 500 }]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 800, gross: 800, discount: 0, net: 800 }]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-13-01", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
});
