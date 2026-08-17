# Desarrollo

## Instalacion

Desde la raiz del repositorio:

```bash
npm install
```

El proyecto usa workspaces npm para `frontend` y `backend`.

## Variables locales

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

En PowerShell:

```powershell
Copy-Item .env.example .env
```

Para desarrollo local sin Docker, valores habituales:

```env
PORT=3000
TZ=Europe/Madrid
DB_FILE=backend/data/app.sqlite
PUBLIC_BASE_URL=
EINK_RENDER_URL=
ADMIN_TOKEN=
DEVICE_TOKEN=
CORS_ORIGIN=
OPENWEATHER_API_KEY=
PUPPETEER_CACHE_DIR=.cache/puppeteer
```

Si activas tokens y usas Vite en `5173`, define:

```env
CORS_ORIGIN=http://127.0.0.1:5173
```

## Comandos

| Comando | Descripcion |
|---|---|
| `npm run dev` | Arranca Vite para el frontend. |
| `npm run start` | Arranca el backend Express. |
| `npm run build` | Compila el frontend en `frontend/dist`. |
| `npm test` | Ejecuta las pruebas del backend. |

## Modo desarrollo

Usa dos terminales.

Terminal 1:

```bash
npm run start
```

Terminal 2:

```bash
npm run dev
```

Abre:

- `http://127.0.0.1:5173/control`
- `http://127.0.0.1:5173/eink`

Vite tiene proxy para `/api`, y el codigo tambien usa `http://127.0.0.1:3000` cuando detecta el puerto `5173`.

## Modo produccion local

```bash
npm run build
npm run start
```

Abre:

- `http://127.0.0.1:3000/control`
- `http://127.0.0.1:3000/eink`
- `http://127.0.0.1:3000/api/screen.bmp`

En este modo Express sirve `frontend/dist` y Puppeteer renderiza `/eink` desde el propio backend.

## Base de datos

SQLite se inicializa al cargar `backend/src/database.js`.

Tablas:

- `sensor_readings`: ultima lectura de bateria, temperatura, humedad y RSSI.
- `device_settings`: identificador, horarios, zona horaria, MQTT y URL del backend.
- `calendars`: hasta cuatro calendarios ICS.
- `event_exceptions`: palabras clave para ocultar eventos.
- `weather_location`: ubicacion, unidades y API key de OpenWeather.
- `screen_state`: mes visible actualmente.
- `external_cache`: cache de ICS, clima y festivos.

Para reiniciar datos en desarrollo, para el backend y borra el fichero configurado en `DB_FILE`.

## Autenticacion durante desarrollo

Sin tokens, todo queda abierto. Es practico para desarrollo local.

Con tokens:

```env
ADMIN_TOKEN=admin-local
DEVICE_TOKEN=device-local
```

El panel pregunta el token de administrador y lo guarda en `localStorage` con la clave `my-terminal.adminToken`.

Ejemplos con `curl`:

```bash
curl -H "X-Admin-Token: admin-local" http://127.0.0.1:3000/api/dashboard
curl -H "X-Device-Token: device-local" http://127.0.0.1:3000/api/screen.bmp --output screen.bmp
```

## Integraciones externas

### Calendarios ICS

- Se admiten URLs `http://`, `https://` y `webcal://`.
- `webcal://` se convierte a `https://`.
- Se soportan eventos recurrentes, excepciones y cancelaciones.
- Las palabras clave de excepcion se comparan sin mayusculas ni acentos.

### OpenWeather

La API key puede venir de dos sitios:

- Campo guardado desde `/control`.
- Variable `OPENWEATHER_API_KEY`.

La key guardada en SQLite tiene prioridad sobre la variable de entorno. El panel nunca devuelve la key guardada; solo indica si existe.

### OpenHolidays

`holiday-service.js` consulta festivos de Espana y filtra nacionales o de Madrid (`ES-MD`). La cache dura 24 horas.

## Docker

Para construir y arrancar:

```bash
docker compose up --build
```

Con variables en `.env`:

```env
PORT=3002
DATA_PATH=/home/daniel/docker/my_terminal/data
PUBLIC_BASE_URL=http://IP_DEL_SERVIDOR:3002
ADMIN_TOKEN=pon-un-token-largo
DEVICE_TOKEN=pon-otro-token-largo
```

Mas detalles en `DOCKER.md`.

## Firmware

El firmware se compila desde `firmware/`. En Windows hay scripts auxiliares:

```powershell
cd firmware
.\idf-build.ps1
.\idf-flash.ps1 -Port COMx
```

Mas detalles en `firmware/README.md`.

## Pruebas

```bash
npm test
```

Las pruebas usan una base SQLite temporal en la carpeta temporal del sistema, por lo que no deberian modificar tu base local.

## Problemas frecuentes

### La pantalla no actualiza

Comprueba que `PUBLIC_BASE_URL` y el campo `Servidor backend` del panel usan una IP alcanzable desde la WiFi de la E1002. No uses `localhost` ni `127.0.0.1` para el dispositivo.

### `/api/screen.bmp` falla en Docker

Revisa logs del contenedor. Puppeteer necesita Chromium y memoria compartida suficiente; `docker-compose.yml` ya define `shm_size: "1gb"`.

### El panel devuelve `Token requerido o incorrecto`

Elimina o corrige el token guardado en el navegador. La clave usada es `my-terminal.adminToken`.

### No aparece meteorologia

Comprueba `OPENWEATHER_API_KEY` o la key guardada en el panel, y verifica latitud/longitud con el boton `Probar`.

### No aparecen eventos

Usa `Probar` en la seccion de calendarios. Revisa que la URL ICS sea accesible desde el servidor y que no este filtrada por una palabra clave de excepcion.
