# Assistant Bot Prod v2.6

- Reservas con confirmación: guarda intención pendiente por `session_id`, pide nombre y confirma.
- Estilos sin inline para CSP.
- Placeholders con valores por defecto si falta config.
- Heurística de fechas y fallback a LLM.
- Multi-tenant.

## Uso
cp .env.example .env
npm i
npm run init:db
npm start
