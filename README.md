# Assistant Bot Prod v2.8

UI mejorada
- Burbujas de chat, tarjetas, inputs y botones.
- Tecla Enter para enviar.
- Sin estilos inline. CSP ok.

Backend
- Reservas robustas con TIMESTAMPTZ, pending intents, NLU opcional, placeholders con defaults.

Setup
```
cp .env.example .env
npm i
npm run init:db
npm start
```
