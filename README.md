# orders-aggregator

Сервис загружает заказы интернет-магазина из внешнего API, принимает обновления через вебхуки и считает статистику по клиентам.

## Стек

Node 20+, TypeScript, Fastify, PostgreSQL (`pg`), Zod, Vitest.

## Запуск

Образы внешнего API лежат рядом с папкой проекта. Проверьте архитектуру через `uname -m` и выполните одну из команд.

```bash
docker load -i ../orders-mock-arm64.tar.gz   # arm64 / aarch64 (Mac на Apple Silicon)
docker load -i ../orders-mock-amd64.tar.gz   # x86_64
```

```bash
docker compose up -d --wait # PostgreSQL с БД orders и orders_test, внешний API на порту 4000
npm ci
npm run migrate
npm run dev                 # http://localhost:3000
```

В `.env.example` перечислены значения по умолчанию. Другие значения задайте через переменные окружения.

Чтобы отправить вебхуки, оставьте сервис запущенным и выполните команду в другом терминале.

```bash
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
```

Тесты используют PostgreSQL и отдельную базу `orders_test`.

```bash
npm test
```

## Структура

```
src/
  app.ts              Fastify-приложение, обработка ошибок
  container.ts        сборка зависимостей
  db.ts               пул соединений, миграции
  clients/            клиент внешнего API (лимиты, ретраи)
  repositories/       доступ к данным
  services/           бизнес-логика
  routes/             HTTP-слой
  utils/              деньги, время
migrations/           SQL-миграции, применяются по порядку
test/                 интеграционные тесты с PostgreSQL и подменой внешнего API
```

## Соглашения

- Внутри сервиса суммы хранятся в целых копейках. Внешний API передаёт рубли, сервис отвечает в рублях.
- Время храним в UTC (`TIMESTAMPTZ`).
- Для ошибок бизнес-логики используется `AppError`. Ответ содержит `{ error: <код>, message }`.

## API сервиса

| Метод | Путь | Описание |
|---|---|---|
| POST | `/sync` | Загружает заказы из внешнего API и возвращает статистику после завершения синхронизации |
| POST | `/webhooks/order` | Принимает `Order` внешнего API. Устаревшая версия или повтор без новых данных возвращает `200 { result: "stale" }` |
| GET | `/customers/:id/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Статистика по заказам со статусом `paid` за каждый день в таймзоне клиента, включая дни без заказов. Ответ содержит `[{ date, total, gross, discount, net }]` |
| GET | `/health` | Проверка живости |

Поля `total` и `gross` содержат сумму до скидки. В `net` приходит фактически оплаченная сумма, а в `discount` её разница с `gross` (`gross - net`). Суммы указаны в рублях с точностью до копейки. День заказа определяется по `createdAt` в часовом поясе клиента.

## Внешний API (`ORDERS_API_URL`)

- `GET /orders?cursor=<string>&limit=<1..100>` → `{ items: Order[], nextCursor: string | null }`. Лимит 5 rps.
- `GET /customers/:id` → `{ id, timezone }` (IANA, например `Europe/Berlin`).
- Вебхуки приходят на `POST /webhooks/order` с телом `Order`. Один заказ может прийти несколько раз.

```ts
type Order = {
  id: string;
  customerId: string;
  amount: number | string;                 // сумма заказа до скидки, в рублях
  discountPercent?: number | string;       // скидка в процентах (0, если скидки нет)
  amountPaid?: number | string | null;     // фактически оплаченная сумма в рублях
  status: "pending" | "paid" | "refunded";
  createdAt: string;                       // ISO 8601, UTC
  updatedAt: string;                       // ISO 8601, UTC
};
```

Старые заказы могут приходить без `discountPercent` и `amountPaid`. Если сумма оплаты отсутствует, сервис считает её равной сумме до скидки.
