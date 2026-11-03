# sayc
Sistema de administración y cobro. Aplicación híbrida desarrollada con Ionic 7 y Angular (empleando componentes Standalone y arquitectura modular basada en rutas) y soporte para internacionalización (ngx-translate).

---

## Función principal
Búsqueda de Productos con Open Food Facts: Módulo de búsqueda de alimentos en tiempo reale con control de errores, reintentos, debouncing (`rxjs`) y cabeceras personalizadas (`User-Agent`).

---

## Estructura

```text
└── src
    ├── app
    │   ├── food-search
    │   │   ├── food-search.page.html
    │   │   └── food-search.page.ts
    │   ├── home
    │   │   ├── home.page.html
    │   │   └── home.page.ts
    │   ├── app.component.html
    │   ├── app.component.ts
    │   └── app.routes.ts
    ├── index.html
    └── main.ts
    ├── .gitignore
├── package.json
└── README.md
```

## Instalación

```bash
npm install
```

## Instalación y ejecución

```bash
npm start
```

---

## Backend (`server/`)

API REST con Express conectada a la base de datos MySQL `sayc_db`. Se expone en `/api/v1`; en desarrollo, `proxy.conf.json` envía `/api/v1` al backend y el resto de `/api` a Open Food Facts.

### Configuración

Requiere Node.js 22.9 o superior y MySQL 8.

> **Atención:** `database/schema.sql` ejecuta `DROP DATABASE IF EXISTS sayc_db`. Cargarlo borra todos los datos existentes en esa base.

```bash
# 1. Crear la base de datos con los datos de prueba
mysqlsh --sql --uri root@localhost:3306 --file database/schema.sql

# 2. Instalar dependencias y configurar. Editar .env con DB_PASSWORD y JWT_SECRET
cd server
npm install
cp .env.example .env

# 3. Cifrar las contraseñas de prueba, que schema.sql guarda en texto plano.
#    Sin este paso, los usuarios de prueba no pueden iniciar sesión.
npm run db:hash-passwords

# 4. Iniciar la API (npm run dev reinicia al detectar cambios)
npm start
```

Usuarios de prueba: `admin@sayc.com` y `empleado@sayc.com`, con la contraseña `admin123`.

### Endpoints

Todas las rutas requieren `Authorization: Bearer <token>`, excepto `health` y `auth/login`.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/health` | Público | Estado de la API y la base de datos |
| POST | `/auth/login` | Público | Devuelve `token` y `user` a partir de `email` y `password` |
| GET | `/auth/me` | Sesión | Usuario actual |
| POST | `/auth/change-password` | Sesión | Cambia la contraseña propia |
| GET, POST | `/users` | Admin | Listar y crear usuarios |
| GET, PATCH, DELETE | `/users/:id` | Admin | Consultar, editar y desactivar (no se borran) |
| GET | `/roles` | Admin | Listar roles |
| GET, POST | `/products` | Sesión | Listar (`q`, `low_stock=true`) y crear productos |
| GET | `/products/barcode/:barcode` | Sesión | Buscar por código de barras |
| GET | `/products/:id` | Sesión | Consultar un producto |
| PATCH, DELETE | `/products/:id` | Admin | Editar y eliminar (409 si tiene historial) |
| GET, POST | `/sales` | Sesión | Listar y registrar ventas |
| GET | `/sales/:id` | Sesión | Venta con su detalle |
| GET, POST | `/inventory/adjustments` | Sesión | Listar (`product_id`) y registrar ajustes de stock |

- Los listados aceptan `limit` (máx. 200) y `offset`.
- Los campos usan los mismos nombres que las columnas de `schema.sql`.
- Registrar una venta: `POST /sales` con `{ "items": [{ "product_id": "...", "quantity": 2 }], "received_pay": 100 }`. Los precios se toman de la base de datos y el stock se descuenta en la misma transacción.
- El stock solo cambia mediante ventas y ajustes, para conservar el historial.
- Un empleado solo ve sus propias ventas.
- Los errores tienen la forma `{ "error": { "code", "message", "details" } }`.

### Pruebas

Las pruebas ejecutan `schema.sql`, que **borra `sayc_db`**. Por eso solo corren con `TEST_DB_PORT` definido, y se niegan a usar el puerto 3306. Usa un servidor MySQL desechable:

```bash
cd server
TEST_DB_PORT=33999 npm test
```

También se pueden definir `TEST_DB_HOST`, `TEST_DB_USER` y `TEST_DB_PASSWORD`.