# Dual-mode Bot (Ventas / Reservas)

Bot listo para Railway. No inventa datos. Usa DB para respuestas y LLM solo para detectar intención y redactar breve.

## Requisitos
- Node 18+
- PostgreSQL (dos instancias o dos DB)
- Variables en `.env`

## Setup
```bash
cp .env.example .env
npm i
npm run init:db
npm run dev
```

## Endpoints
- `GET /api/config?bot_id=default`
- `POST /api/config` body parcial para actualizar campos
- `GET/POST/PUT/DELETE /api/rules`
- `POST /api/rules/restore-defaults`
- `GET/POST /api/products`
- `GET /api/appointments`
- `GET /api/appointments/available?starts_at=YYYY-MM-DDTHH:mm:ss`
- `POST /api/appointments`
- `POST /api/chat` { bot_id, message }

## Campos de `bot_configs`
`mode,name,address,hours,phone,payment_methods,cash_discount,service_list,cancellation_policy`

## Front
Abrí `/` y usá los paneles de Productos, Reservas y Reglas.
