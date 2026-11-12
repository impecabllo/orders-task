import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { datesBetween, localDateFormatter } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

export interface DailyTotal {
  date: string;
  total: number;
  gross: number;
  discount: number;
  net: number;
}

const DAY = 86_400_000;

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Сумма оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат — с нулём.
   */
  async daily(customerId: string, from: string, to: string): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);
    const localDate = localDateFormatter(timezone);

    // Смещения таймзон в пределах ±14 ч: берём с запасом в сутки с каждой стороны
    const rows = await this.orders.paidCreatedBetween(
      customerId,
      new Date(Date.parse(`${from}T00:00:00Z`) - DAY),
      new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY),
    );

    const sums = new Map(datesBetween(from, to).map((date) => [date, { grossKop: 0, netKop: 0 }]));
    for (const order of rows) {
      const day = sums.get(localDate(order.createdAt));
      if (day === undefined) continue;
      day.grossKop += order.amountKop;
      day.netKop += order.amountPaidKop ?? order.amountKop;
    }
    return [...sums].map(([date, { grossKop, netKop }]) => {
      const gross = fromKop(grossKop);
      return { date, total: gross, gross, discount: fromKop(grossKop - netKop), net: fromKop(netKop) };
    });
  }
}
