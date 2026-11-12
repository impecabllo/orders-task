/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем. */
export function toKop(rub: number): number {
  // Сдвигаем десятичную точку в строке, чтобы 0.29 не превратилось в 28.999… копейки.
  const [coefficient, exponent = "0"] = rub.toString().split("e");
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
