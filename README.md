# Assistant Bot Prod v2.3

CSP-safe. Multi-tenant. Grounded en DB. Fallbacks robustos.

## Uso
```bash
cp .env.example .env
npm i
npm run init:db
npm start
```
Variables: `OPENAI_API_KEY`, `BOT_DB_URL`, `BUSINESS_DB_URL`, `PORT`.

## Endpoints
- `GET /healthz`
- `GET /api/config?bot_id=ID`, `POST /api/config`
- `GET/POST/PUT/DELETE /api/rules` (+ `?bot_id=ID`)
- `POST /api/rules/restore-defaults` body opcional `{ bot_id }`
- `GET/POST /api/products` (+ `?bot_id=ID`)
- `GET /api/appointments` (+ `?bot_id=ID`), `POST /api/appointments`
- `GET /api/appointments/available?bot_id=ID&starts_at=YYYY-MM-DDTHH:mm`
- `POST /api/chat` `{ bot_id, message }`
