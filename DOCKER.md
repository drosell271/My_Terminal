# Docker / Portainer

Estructura recomendada en el servidor:

```text
/home/daniel/docker/my_terminal/
├── app/      # repo/codigo
└── data/     # SQLite, configuracion, sensores y cache
```

Dentro del contenedor `data` se monta como `/data`, y la base SQLite queda en:

```text
/data/app.sqlite
```

## Portainer

1. Crea las carpetas en el host:

```bash
mkdir -p /home/daniel/docker/my_terminal/data
cd /home/daniel/docker/my_terminal
git clone TU_REPO app
```

2. En Portainer, crea un stack con `docker-compose.yml` y define estas variables:

```env
APP_PATH=/home/daniel/docker/my_terminal/app
DATA_PATH=/home/daniel/docker/my_terminal/data
PORT=3002
TZ=Europe/Madrid
PUBLIC_BASE_URL=http://IP_DEL_SERVIDOR:3002
EINK_RENDER_URL=
ADMIN_TOKEN=pon-un-token-largo
DEVICE_TOKEN=pon-otro-token-largo
CORS_ORIGIN=
OPENWEATHER_API_KEY=
PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
```

Si defines `DEVICE_TOKEN`, pon el mismo valor en el portal WiFi de la pantalla.

3. Despliega el stack. El servicio publica:

```text
http://IP_DEL_SERVIDOR:3002
```

4. En el panel de control, comprueba que `Servidor backend` usa la URL real de la maquina Docker, por ejemplo:

```text
http://IP_DEL_SERVIDOR:3002
```

La pantalla no debe usar `127.0.0.1`, porque para la E1002 eso apuntaria a si misma, no al servidor. El backend ignora esa URL para el dispositivo si no hay una `PUBLIC_BASE_URL` valida.

En esa misma seccion configura `Zona horaria`. Esa zona se envia al firmware y se usa para calcular a que hora debe despertarse. La variable `TZ` del contenedor solo afecta al proceso Node; la pantalla usa el ajuste del panel.

## Rutas utiles

```text
/control
/eink
/api/screen.bmp
/api/health
```

## Volumen

El volumen configurado es:

```yaml
volumes:
  - ${DATA_PATH:-/home/daniel/docker/my_terminal/data}:/data
```

Si haces copia de seguridad de esa carpeta, conservas configuracion, calendarios, API key, sensores y cache.
