import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("при параллельной доставке сохраняет версию с более поздним updatedAt", async () => {
    const order = apiOrder({ amountPaid: 900 });
    const latest = { ...order, amountPaid: 725.29, updatedAt: "2026-02-11T12:00:00Z" };
    const responses = await Promise.all([postWebhook(ctx.app, latest), postWebhook(ctx.app, order)]);

    expect(responses.map((res) => res.statusCode)).toEqual([200, 200]);
    expect(responses.filter((res) => res.json().result === "created")).toHaveLength(1);
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop, updated_at FROM orders WHERE id = $1`, [order.id]);
    expect(Number(rows[0].amount_paid_kop)).toBe(72529);
    expect(rows[0].updated_at.toISOString()).toBe("2026-02-11T12:00:00.000Z");
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });
});
