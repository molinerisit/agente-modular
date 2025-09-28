# Assistant Bot Prod (Ventas / Reservas) v2

Multi-tenant. Grounding en DB. NLU acotado. Fallbacks semánticos. Listo para Railway.

## Setup
```bash
cp .env.example .env
npm i
npm run init:db
npm run dev
```
Seteá en Railway `OPENAI_API_KEY`, `BOT_DB_URL`, `BUSINESS_DB_URL` y `PORT`.

## Endpoints clave
- `GET /healthz`
- `GET /api/config?bot_id=ID`
- `POST /api/config` body parcial: `{ bot_id, mode, name, address, hours, phone, payment_methods, cash_discount, service_list, cancellation_policy, slot_minutes }`
- `POST /api/rules/restore-defaults` con `{ bot_id }` opcional
- `GET /api/products?bot_id=ID`, `POST /api/products` `{ bot_id, name, price, stock }`
- `GET /api/appointments?bot_id=ID`, `POST /api/appointments` `{ bot_id, customer, starts_at, notes }`
- `GET /api/appointments/available?bot_id=ID&starts_at=YYYY-MM-DDTHH:mm:ss`
- `POST /api/chat` `{ bot_id, message }`

## Seguridad y robustez
- `helmet`, rate limit 180 rpm, body limit 512kb
- Validación con Zod
- IA con `gpt-4o-mini` solo para intención y redacción; contexto estricto
- Fallback sin IA por modo
- Coincidencia exacta, semántica (Jaccard), y guardas de placeholders
- Multi-tenant total: `bot_id` en productos, reglas y turnos
- Slot configurable: `slot_minutes`
