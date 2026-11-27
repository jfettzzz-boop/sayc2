# Despliegue en Vercel y Render

SAYC se publica en dos plataformas que trabajan juntas:

| Parte | Plataforma | Dirección de ejemplo | Quién la usa |
| --- | --- | --- | --- |
| App web (Angular/Ionic, PWA) | **Vercel** | `https://sayc.vercel.app` | Los navegadores |
| API REST (`server/`) | **Render**, *web service* | `https://sayc-api.onrender.com` | La app, desde el navegador o el teléfono |
| MySQL 8 | **Render**, *private service* | `sayc-mysql-xxxx:3306` (interna) | Solo la API |

```
Navegador ──https──▶ Vercel (archivos de la app)
    │
    └──https + CORS──▶ Render: sayc-api ──red privada──▶ Render: sayc-mysql
```

- La app llama a la API **directamente** en su dirección pública de Render. Por eso la API debe permitir el origen de Vercel (CORS).
- MySQL **no tiene dirección pública**: solo la API lo alcanza, por la red privada de Render, con su nombre interno.
- Render no ofrece MySQL administrado. Por eso corre como servicio privado con disco. La [opción B](#opción-b-mysql-fuera-de-render) usa un MySQL externo.

Sustituye las direcciones de ejemplo por las tuyas en todos los pasos.

---

## Qué está preparado en el proyecto

| Archivo | Función |
| --- | --- |
| `render.yaml` | Blueprint de Render: crea `sayc-mysql` y `sayc-api` y los conecta. |
| `vercel.json` | Build, carpeta de salida `www`, rutas de la SPA y cabeceras del service worker. |
| `scripts/build-web.mjs` (`npm run build:web`) | Build de producción que incorpora la dirección de la API desde `SAYC_API_URL`. |
| `server/src/init-db.js` | Crea las tablas al primer arranque si la base está vacía (`DB_INIT`). |

### Variables de la API (Render)

| Variable | Valor en Render | Para qué |
| --- | --- | --- |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Las rellena el Blueprint desde `sayc-mysql` | Conexión por la red privada |
| `DB_PORT` | `3306` | |
| `DB_INIT` | `schema` (o `demo`) | Crea las tablas si la base está vacía. Nunca toca una base que ya las tiene. |
| `DB_SSL`, `DB_SSL_CA` | Sin definir con la base interna | TLS para un MySQL externo ([opción B](#opción-b-mysql-fuera-de-render)) |
| `JWT_SECRET` | Generada por Render | Firma de las sesiones; 32 caracteres o más |
| `TRUST_PROXY` | `1` | Render pone un proxy delante. Sin esto, el límite de intentos de inicio de sesión contaría a todos los usuarios como uno solo. |
| `CORS_ORIGINS` | Las direcciones de Vercel, separadas por comas | Orígenes que pueden llamar a la API |
| `PORT` | No la definas: la pone Render | |

### Variable de la app (Vercel)

| Variable | Valor | Para qué |
| --- | --- | --- |
| `SAYC_API_URL` | `https://sayc-api.onrender.com` | Dirección de la API incorporada al build. Debe ser `https` y sin `/api/v1`. |

La dirección queda fija en el build: **si cambia, hay que volver a desplegar en Vercel**. Cada usuario puede usar otra dirección desde **Conexión** en la pantalla de inicio de sesión; la que guarde tiene prioridad.

---

## Orden de los pasos

Cada plataforma necesita la dirección de la otra:

1. **Render**: crear la base y la API. Así se obtiene la dirección de la API.
2. **Vercel**: publicar la app con esa dirección. Así se obtiene la dirección de la app.
3. **Render**: permitir la dirección de la app en `CORS_ORIGINS`.

Requisito previo: el repositorio en GitHub, GitLab o Bitbucket, con estos archivos en la rama que se va a desplegar.

---

## 1. Render: base de datos y API

1. En [dashboard.render.com](https://dashboard.render.com): **New > Blueprint** y elige el repositorio. Render lee `render.yaml`.
2. Cuando pida `CORS_ORIGINS`, deja por ahora `https://localhost`. Se corrige en el paso 3.
3. Revisa los planes y confirma con **Apply**:
   - `sayc-mysql` usa el plan **Starter** (de pago). Los servicios privados y los discos no existen en el plan gratuito.
   - `sayc-api` usa el plan **Free**. Se duerme tras 15 minutos sin uso, y la primera petición siguiente tarda alrededor de un minuto. Para uso real, cámbialo a Starter.
   - Ambos deben estar en la **misma región**, porque la red privada no cruza regiones.
4. Espera a que `sayc-mysql` esté *Live* y después `sayc-api`. En el primer arranque, el registro (*Logs*) de la API muestra:

   ```
   Created the SAYC tables (DB_INIT=schema).
   SAYC API listening on ...
   ```

5. Copia la dirección pública de `sayc-api`, arriba a la izquierda de su página (`https://sayc-api.onrender.com`), y comprueba:

   ```bash
   curl https://sayc-api.onrender.com/api/v1/health
   # {"status":"ok"}
   ```

**Dirección interna de MySQL.** El Blueprint enlaza `DB_HOST` con `fromService`. Render escribe ahí el nombre interno del servicio (por ejemplo `sayc-mysql-ab12`), que figura en *sayc-mysql > Connect > Internal*. No uses una dirección pública ni `localhost`: dentro de Render, `localhost` es el propio contenedor de la API.

**Datos iniciales.**

- Con `DB_INIT=schema` la base queda vacía, solo con los roles. La primera empresa se registra desde la app, en **Registra tu empresa**.
- Con `DB_INIT=demo` se cargan las empresas de ejemplo, con usuarios como `admin@sayc.com` y la contraseña `admin123`. Úsalo solo para demostraciones, porque esas contraseñas son públicas.
- Una vez creadas las tablas, `DB_INIT` ya no hace nada. Puedes dejarlo o ponerlo en `off`.

### Sin Blueprint (configuración manual)

Si prefieres crear los servicios a mano:

- **Base de datos**:
  1. **New > Private Service > Existing image**, con la imagen `docker.io/library/mysql:8.4`.
  2. *Docker Command*: `docker-entrypoint.sh mysqld --datadir=/var/lib/mysql/data --performance-schema=OFF --innodb-buffer-pool-size=128M`
  3. Disco montado en `/var/lib/mysql`.
  4. Variables: `MYSQL_DATABASE=sayc_db`, `MYSQL_USER=sayc`, `MYSQL_PASSWORD` y `MYSQL_ROOT_PASSWORD` (contraseñas largas al azar).
- **API**:
  1. **New > Web Service** con el repositorio, sin *Root Directory*.
  2. *Build Command*: `cd server && npm ci --omit=dev`
  3. *Start Command*: `cd server && npm start`
  4. *Health Check Path*: `/api/v1/health`
  5. Variables de la tabla anterior. `DB_HOST` es la dirección interna de *sayc-mysql > Connect*.

### Opción B: MySQL fuera de Render

Sirve para usar un MySQL 8 administrado (Aiven, TiDB Cloud, Railway…) y ahorrarse el servicio privado:

1. Quita el bloque `sayc-mysql` de `render.yaml`, o crea solo la API a mano.
2. En la API, define `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` con los datos del proveedor, y además `DB_SSL=true`.
3. Si el proveedor usa un certificado propio (Aiven lo hace), copia su CA en `DB_SSL_CA`. Puede ir en varias líneas, o en una sola con `\n` en lugar de cada salto de línea.
4. `DB_NAME` es la base que da el proveedor. `DB_INIT` crea las tablas en ella sin intentar crear ni borrar bases.

En esta opción la conexión sale por internet, por eso el TLS es obligatorio. El proveedor también puede pedir que autorices las IP de salida de Render (*sayc-api > Connect > Outbound*).

---

## 2. Vercel: la app

1. En [vercel.com/new](https://vercel.com/new), importa el repositorio.
2. Deja *Root Directory* en la raíz del proyecto y *Framework Preset* en **Other**. Build, instalación y carpeta de salida vienen de `vercel.json`; no los cambies en el panel.
3. En **Environment Variables** añade `SAYC_API_URL` = `https://sayc-api.onrender.com`, al menos para *Production*. Para que las vistas previas usen la misma API, márcala también en *Preview*.
4. Usa la versión de Node.js **22.x o superior** (*Settings > Build and Deployment > Node.js Version*).
5. **Deploy**. En el registro del build aparece:

   ```
   API address: https://sayc-api.onrender.com
   ```

6. Copia la dirección de producción, por ejemplo `https://sayc.vercel.app`.

Qué hace `vercel.json`:

- Envía a `index.html` cualquier ruta que no sea un archivo (`/login`, `/inventory`…), para que funcionen los enlaces directos y la recarga de página.
- Reenvía `/api/cgi/*` a Open Food Facts. Es la búsqueda de respaldo, que en desarrollo cubría `proxy.conf.json`. La búsqueda principal (`search.openfoodfacts.org`) se llama directamente.
- Sirve `service-worker.js` sin caché, para que cada despliegue llegue a la PWA instalada.

---

## 3. Render: permitir la app (CORS)

En *sayc-api > Environment*, cambia `CORS_ORIGINS` por la lista de orígenes que pueden llamar a la API:

```
https://sayc.vercel.app,https://sayc-*-mi-equipo.vercel.app,https://localhost,capacitor://localhost
```

| Origen | Para qué |
| --- | --- |
| `https://sayc.vercel.app` | Producción. Añade también tu dominio propio, si tienes. |
| `https://sayc-*-mi-equipo.vercel.app` | Vistas previas de Vercel. El `*` vale por una sola parte del nombre: no deja pasar otros sitios de `vercel.app`. Sustituye `sayc` y `mi-equipo` por tu proyecto y tu equipo. |
| `https://localhost`, `capacitor://localhost` | App de Android y de iOS, si se conectan a esta API |

Reglas para cada origen:

- Esquema y dominio exactos.
- Sin barra final, sin ruta, y sin `/api/v1`.

Guarda los cambios: Render vuelve a desplegar la API. Para comprobarlo:

```bash
curl -si -X OPTIONS https://sayc-api.onrender.com/api/v1/auth/login \
  -H "Origin: https://sayc.vercel.app" -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
# access-control-allow-origin: https://sayc.vercel.app
```

---

## 4. Comprobación final

1. Abre `https://sayc.vercel.app`: debe aparecer la página de bienvenida.
2. Usa **Registra tu empresa**. Si entras al panel, la app, la API y la base funcionan juntas.
3. En **Productos**, busca un producto de Open Food Facts.
4. PWA: en Chrome o Edge aparece **Instalar** en la barra de direcciones. Instalada, la app abre sin conexión, aunque sus datos requieren la API.

---

## App de Android con la API publicada

Hay dos formas de conectar la app instalada:

- **Sin recompilar**: en la app, **Conexión > Servidor** con `https://sayc-api.onrender.com`, y **Probar conexión**.
- **Con la dirección incorporada**:

  ```bash
  SAYC_API_URL=https://sayc-api.onrender.com npm run build:web
  npx cap sync android
  ```

  La app sigue empezando en modo **En este dispositivo**, pero al elegir **Servidor** ya trae la dirección.

En ambos casos:

- `CORS_ORIGINS` debe incluir `https://localhost`.
- Con la API en `https`, quita `cleartext` y `allowMixedContent` de `capacitor.config.ts`.

---

## Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| La consola dice *blocked by CORS policy* | El origen exacto no está en `CORS_ORIGINS`: revisa `https`, el dominio y que no haya barra final. Tras cambiarlo, espera a que la API vuelva a desplegarse. |
| La app llama a `https://sayc.vercel.app/api/v1/...` y recibe 404 o HTML | El build se hizo sin `SAYC_API_URL`. Defínela en Vercel y vuelve a desplegar. Un navegador que guardó otra dirección en **Conexión** la sigue usando: cámbiala ahí. |
| *Mixed content* | `SAYC_API_URL` empieza por `http://`. Debe ser `https://` (`build:web` lo rechaza). |
| La primera petición tarda casi un minuto | El plan Free de Render duerme la API. Es normal, o usa un plan de pago. |
| La API no arranca: `Could not connect to MySQL` | `sayc-mysql` no está *Live*, está en otra región, o `DB_HOST` no es la dirección interna. Si persiste con la API en plan Free, prueba Starter: algunas cuentas no permiten tráfico privado desde instancias gratuitas. |
| `sayc-mysql` no arranca: *data directory has files in it* | Falta `--datadir=/var/lib/mysql/data` en el *Docker Command* |
| `The database has only some SAYC tables` | Un primer arranque se interrumpió a mitad. Vacía la base y reinicia la API, o carga `database/schema.sql` a mano. |
| Todos reciben *demasiados intentos* a la vez | Falta `TRUST_PROXY=1` |
| La PWA instalada muestra una versión vieja | Se actualiza en la siguiente visita con conexión. Para descartar todo lo guardado, cambia `CACHE_NAME` en `public/service-worker.js`. |

> **Cuidado:** no cargues `database/schema.sql` completo en una base con datos. Empieza con `DROP DATABASE`. `DB_INIT` nunca ejecuta esa parte.
