# Arquitectura

My Terminal usa un patron de "headless browser": la UI se construye como una pagina web normal, el backend la renderiza con Puppeteer en una ventana fija de 800x480 y despues convierte la captura a BMP para la pantalla e-paper.

## Componentes

```text
E1002 firmware
  |
  | GET /api/screen.bmp
  | GET /api/device/settings
  | POST /api/device/sensors
  v
Backend Express + SQLite
  |
  | renderiza /eink con Puppeteer
  v
Frontend React
  |
  | consulta /api/eink-data
  v
Servicios externos: ICS, OpenWeather, OpenHolidays
```

## Backend

El backend vive en `backend/src`:

- `server.js`: servidor Express, rutas HTTP, renderizado Puppeteer y codificacion BMP.
- `database.js`: esquema SQLite, migraciones simples, valores por defecto y validacion de datos.
- `eink-data-service.js`: compone los datos finales de calendario, clima, festivos y estado de pantalla.
- `ics-service.js`: descarga, cachea y expande calendarios ICS.
- `weather-service.js`: consulta OpenWeather y normaliza unidades.
- `holiday-service.js`: consulta festivos nacionales y de Madrid en OpenHolidays.
- `auth.js`: tokens opcionales de administrador y dispositivo.
- `timezones.js`: zonas horarias admitidas y conversion a formato POSIX para firmware.

SQLite se crea automaticamente en `DB_FILE`. La ruta por defecto en desarrollo es `backend/data/app.sqlite`; en Docker es `/data/app.sqlite`.

## Frontend

El frontend vive en `frontend/src`:

- `App.jsx`: decide si renderiza `/control` o `/eink`.
- `ControlPanel.jsx`: panel de administracion.
- `App.css`: estilos de la pantalla e-paper.
- `ControlPanel.css`: estilos del panel de control.

En desarrollo, Vite sirve en `127.0.0.1:5173` y proxyfica `/api` al backend en `127.0.0.1:3000`.

En produccion, `npm run build` genera `frontend/dist` y Express sirve esos assets. Si `frontend/dist/index.html` existe, Puppeteer renderiza `http://localhost:${PORT}/eink`.

## Firmware

El firmware vive en `firmware/` y esta pensado para Seeed reTerminal E1002:

- Portal WiFi inicial con PIN.
- Configuracion persistente en NVS.
- Descarga del BMP desde el backend.
- Lectura de ajustes desde `/api/device/settings`.
- Envio de sensores a `/api/device/sensors`.
- Publicacion MQTT usando la configuracion del panel.
- Deep sleep entre actualizaciones.
- Botones fisicos para navegar meses.

La documentacion especifica del firmware esta en `firmware/README.md`.

## Flujo de renderizado

1. La E1002 pide `GET /api/screen.bmp`.
2. Express valida el token de dispositivo si `DEVICE_TOKEN` esta configurado.
3. Puppeteer abre `/eink` en 800x480.
4. La vista `/eink` pide `GET /api/eink-data`.
5. El backend compone datos desde SQLite, ICS, OpenWeather y OpenHolidays.
6. Puppeteer captura PNG.
7. Sharp aplana la imagen sobre blanco, fuerza 800x480 y devuelve pixeles RGB.
8. `server.js` codifica esos pixeles como BMP 24-bit.
9. El firmware convierte BMP 24-bit a la paleta de 6 colores de la pantalla.

## Datos externos y cache

El backend usa la tabla `external_cache` para reducir llamadas externas:

| Fuente | TTL |
|---|---:|
| Calendarios ICS | 10 minutos |
| OpenWeather | 15 minutos |
| OpenHolidays | 24 horas |

Si una fuente externa falla, la pantalla intenta seguir funcionando con los datos disponibles. OpenWeather vuelve a una respuesta sin datos climaticos si falta API key o coordenadas validas.

## Seguridad

La autenticacion es opcional:

- `ADMIN_TOKEN` protege el panel y endpoints de administracion.
- `DEVICE_TOKEN` protege los endpoints usados por la E1002.
- El token de administrador tambien puede acceder a endpoints de dispositivo.

Los tokens se aceptan por cabecera dedicada, `Authorization: Bearer ...` o query string. Para despliegues reales conviene usar cabeceras y evitar tokens en URLs.

## Limitaciones conocidas

- El firmware esta ajustado a la E1002 y a una pantalla e-paper de 800x480.
- La paleta final depende de la conversion del firmware, no del backend.
- Los festivos estan fijados a Espana/Madrid en `holiday-service.js`.
- El panel soporta hasta cuatro calendarios ICS.
- `PUBLIC_BASE_URL` no debe ser `localhost`, `127.0.0.1`, `0.0.0.0` ni `::1`, porque la pantalla lo interpreta desde su propia red.
