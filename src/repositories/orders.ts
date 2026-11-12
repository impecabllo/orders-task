import type { Db } from "../db.js";

export interface Order {
  id: string;
  customerId: string;
  amountKop: number;
  amountPaidKop: number | null;
  status: "pending" | "paid" | "refunded";
  createdAt: Date;
  updatedAt: Date;
}

interface Row {
  id: string;
  customer_id: string;
  amount_kop: string;
  amount_paid_kop: string | null;
  status: Order["status"];
  created_at: Date;
  updated_at: Date;
}

const fromRow = (r: Row): Order => ({
  id: r.id,
  customerId: r.customer_id,
  amountKop: Number(r.amount_kop),
  amountPaidKop: r.amount_paid_kop === null ? null : Number(r.amount_paid_kop),
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type ApplyResult = "created" | "updated" | "stale";

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  async saveVersion(o: Order): Promise<ApplyResult> {
    const values = [o.id, o.customerId, o.amountKop, o.amountPaidKop, o.status, o.createdAt, o.updatedAt];
    const inserted = await this.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, amount_paid_kop, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      values,
    );
    if (inserted.rowCount === 1) return "created";

    // Проверяем версию в UPDATE. Повтор той же версии может заполнить неизвестную сумму оплаты.
    const updated = await this.db.query(
      `UPDATE orders
          SET customer_id = $2, amount_kop = $3, amount_paid_kop = $4,
              status = $5, created_at = $6, updated_at = $7
        WHERE id = $1 AND (
          updated_at < $7 OR (
            updated_at = $7 AND amount_paid_kop IS NULL AND $4::bigint IS NOT NULL
            AND customer_id = $2 AND amount_kop = $3 AND status = $5 AND created_at = $6
          )
        )`,
      values,
    );
    return updated.rowCount === 1 ? "updated" : "stale";
  }

  /** Оплаченные заказы клиента, созданные в [from, to). */
  async paidCreatedBetween(customerId: string, from: Date, to: Date): Promise<Order[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM orders
        WHERE customer_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
      [customerId, from, to],
    );
    return rows.map(fromRow);
  }
}
