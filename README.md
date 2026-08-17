# My Terminal

Panel para una pantalla e-paper Seeed reTerminal E1002. El backend renderiza una vista web de 800x480 con calendario, eventos, festivos, meteorologia y sensores, la convierte a BMP y el firmware la descarga para mostrarla en la pantalla.

## Que incluye

- Backend Node/Express con SQLite, renderizado via Puppeteer y salida BMP en `/api/screen.bmp`.
- Frontend Vite/React con dos vistas:
  - `/eink`: pantalla final para la E1002.
  - `/control`: panel de administracion.
- Firmware ESP-IDF para la Seeed reTerminal E1002.
- Despliegue Docker/Portainer con volumen persistente para datos.

## Estructura

```text
.
├── backend/       # API, SQLite, render BMP, integraciones externas
├── frontend/      # UI React para /eink y /control
├── firmware/      # firmware ESP-IDF de la pantalla
├── docs/          # documentacion tecnica del proyecto
├── Dockerfile
├── docker-compose.yml
├── DOCKER.md
└── package.json
```

## Requisitos

- Node.js 22 o superior.
- npm.
- Docker, si se despliega en contenedor.
- ESP-IDF 6.0, si se compila el firmware.
- Una API key de OpenWeather si se quiere mostrar meteorologia real.

Node 22 es importante porque el backend usa `node:sqlite`.

## Puesta en marcha local

Instala dependencias desde la raiz:

```bash
npm install
```

Copia la configuracion de ejemplo:

```bash
cp .env.example .env
```

En Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Para desarrollo con Vite y backend separados, usa dos terminales:

```bash
npm run start
```

```bash
npm run dev
```

URLs locales:

- Panel de control: `http://127.0.0.1:5173/control`
- Pantalla e-paper: `http://127.0.0.1:5173/eink`
- API backend: `http://127.0.0.1:3000/api/health`

## Build y ejecucion en produccion

Genera el frontend estatico:

```bash
npm run build
```

Arranca el backend:

```bash
npm run start
```

Cuando existe `frontend/dist`, Express sirve la app React y renderiza `/eink` desde el propio backend.

## Configuracion principal

Las variables se pueden poner en `.env`, en el entorno del proceso o en Portainer:

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP del backend. |
| `TZ` | Zona horaria del proceso Node. |
| `DB_FILE` | Ruta del fichero SQLite. |
| `PUBLIC_BASE_URL` | URL real que vera la E1002 desde la WiFi. |
| `EINK_RENDER_URL` | URL que Puppeteer debe renderizar para generar el BMP. |
| `ADMIN_TOKEN` | Token opcional para endpoints de administracion. |
| `DEVICE_TOKEN` | Token opcional para endpoints del dispositivo. |
| `CORS_ORIGIN` | Origen CORS permitido en desarrollo con tokens activos. |
| `OPENWEATHER_API_KEY` | API key global de OpenWeather. |
| `PUPPETEER_CACHE_DIR` | Cache de Chromium/Puppeteer. |

Si `ADMIN_TOKEN` queda vacio, el panel de control queda abierto. Si `DEVICE_TOKEN` queda vacio, los endpoints del dispositivo quedan abiertos.

## Rutas principales

- `/control`: panel de administracion.
- `/eink`: composicion web de la pantalla.
- `/api/screen.bmp`: BMP de 800x480 para el firmware.
- `/api/eink-data`: datos JSON usados por `/eink`.
- `/api/health`: healthcheck.

La referencia completa esta en [docs/API.md](docs/API.md).

## Firmware

La pantalla arranca en modo portal WiFi si no tiene configuracion guardada, descarga `/api/screen.bmp`, publica sensores, aplica horarios de despertador y permite navegar meses con botones fisicos.

Consulta [firmware/README.md](firmware/README.md) para compilar, flashear y ver los pines usados.

## Docker y Portainer

Consulta [DOCKER.md](DOCKER.md). El despliegue recomendado monta una carpeta persistente en `/data`, donde queda `app.sqlite` con configuracion, calendarios, sensores y cache.

## Documentacion

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): componentes y flujo de datos.
- [docs/API.md](docs/API.md): rutas, autenticacion y payloads.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): desarrollo local, pruebas y notas operativas.

## Pruebas

```bash
npm test
```

Las pruebas cubren normalizacion de configuracion, autenticacion, unidades de clima y parsing ICS.
