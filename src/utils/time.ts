const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

/** Время без указателя зоны считаем UTC. */
export function parseUtc(raw: unknown): Date {
  if (typeof raw !== "string") throw new Error(`invalid date: ${JSON.stringify(raw)}`);
  const s = raw.trim();
  const parts = ISO_DATE_TIME.exec(s);
  if (!parts || !isCalendarDate(parts[1])) throw new Error(`invalid date: ${JSON.stringify(raw)}`);
  const d = new Date(parts[2] ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${JSON.stringify(raw)}`);
  return d;
}

/** Смещение таймзоны относительно UTC в минутах в момент `at` (Europe/Moscow → 180). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Календарная дата (YYYY-MM-DD) момента `at` при смещении `offsetMinutes`. */
export function dateAtOffset(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Форматирует местную календарную дату с учётом смещения в момент заказа. */
export function localDateFormatter(timeZone: string): (at: Date) => string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (at) => {
    const parts = formatter.formatToParts(at);
    const year = parts.find((part) => part.type === "year")!.value.padStart(4, "0");
    const month = parts.find((part) => part.type === "month")!.value;
    const day = parts.find((part) => part.type === "day")!.value;
    return `${year}-${month}-${day}`;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}

/** Все даты от from до to включительно. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
