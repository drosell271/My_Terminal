# Docker / Portainer

El stack guarda los datos persistentes en:

```text
/home/daniel/docker/my_terminal/data
```

Dentro del contenedor esa carpeta se monta como `/data`, y la base SQLite queda en:

```text
/data/app.sqlite
```

## Portainer

1. Crea la carpeta en el host:

```bash
mkdir -p /home/daniel/docker/my_terminal/data
```

2. Crea las variables del stack o un `.env` junto al `docker-compose.yml`:

```env
PUBLIC_BASE_URL=http://IP_DEL_SERVIDOR:3000
ADMIN_TOKEN=pon-un-token-largo
DEVICE_TOKEN=pon-otro-token-largo
CORS_ORIGIN=
OPENWEATHER_API_KEY=
```

Si defines `DEVICE_TOKEN`, pon el mismo valor en el portal WiFi de la pantalla.

3. En Portainer, crea un stack usando `docker-compose.yml`.

4. Despliega el stack. El servicio publica:

```text
http://IP_DEL_SERVIDOR:3000
```

5. En el panel de control, comprueba que `Servidor backend` usa la URL real de la maquina Docker, por ejemplo:

```text
http://192.168.1.50:3000
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
  - /home/daniel/docker/my_terminal/data:/data
```

Si haces copia de seguridad de esa carpeta, conservas configuracion, calendarios, API key, sensores y cache.
