// Внутри сервиса суммы хранятся в целых копейках.
const DECIMAL = /^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const text = typeof raw === "string" ? raw.trim() : "";
  const value = DECIMAL.test(text) ? Number(text) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем. */
export function toKop(rub: number | string): number {
  const value = parseRub(rub);
  if (value === 0) return 0;
  // Сдвигаем точку в исходной записи суммы, сохраняя десятичные разряды.
  const decimal = typeof rub === "string" ? rub.trim().toLowerCase() : String(value);
  const [coefficient, exponent = "0"] = decimal.split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction;
  const centPosition = whole.length + Number(exponent) + 2;
  const kop = centPosition <= 0 ? 0 : Number(digits.slice(0, centPosition).padEnd(centPosition, "0"));
  if (!Number.isSafeInteger(kop)) throw new Error(`amount out of range: ${rub}`);
  return kop;
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
