import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { ApplyResult, Order, OrdersRepository } from "../repositories/orders.js";
import { parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

const MoneyAmount = z.union([z.number(), z.string()]);

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: MoneyAmount,
  amountPaid: MoneyAmount.nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type { ApplyResult } from "../repositories/orders.js";

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop: toKop(parseRub(o.amount)),
        amountPaidKop: o.amountPaid == null ? null : toKop(parseRub(o.amountPaid)),
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами и не по порядку, поэтому версию сохраняем,
   * по updatedAt. Повтор может дополнить ту же версию суммой оплаты.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.saveVersion(this.normalize(raw));
  }
}
