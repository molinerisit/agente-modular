# Agri Bot - Full (demo)

Proyecto demo con:
- Inicialización automática de tablas en las dos bases (BOT y BUSINESS).
- CRUD para productos, reservas y reglas.
- Página de configuración que muestra *todo* lo que el bot puede ver.
- Chat que utiliza OpenAI (necesitas API key).

Instrucciones:
1. Copiar .env.example -> .env y completar las variables.
2. npm install
3. npm run dev
4. Abrir http://localhost:3000

Endpoints/UI:
- /                 -> Chat
- /products.html    -> Gestionar productos
- /reservations.html-> Gestionar reservas
- /rules.html       -> Gestionar reglas
- /config.html      -> Panel que muestra datos que el bot ve

Nota: Este proyecto es demo; no usar en producción sin seguridad y validación.