# API

Base local por defecto:

```text
http://127.0.0.1:3000
```

En Docker o en red local, usa la URL real configurada en `PUBLIC_BASE_URL`, por ejemplo:

```text
http://192.168.1.50:3002
```

## Autenticacion

La autenticacion depende de variables de entorno:

- `ADMIN_TOKEN`: protege endpoints de administracion.
- `DEVICE_TOKEN`: protege endpoints del dispositivo.

Si una variable esta vacia, los endpoints de ese tipo quedan abiertos.

Formas aceptadas:

```http
X-Admin-Token: admin-token
X-Device-Token: device-token
Authorization: Bearer token
```

Tambien existen `?adminToken=` y `?deviceToken=`, pero conviene evitarlos fuera de pruebas porque quedan en historiales y logs.

## Rutas publicas

| Metodo | Ruta | Descripcion |
|---|---|---|
| `GET` | `/` | Sirve la app React. |
| `GET` | `/control` | Panel de control. |
| `GET` | `/eink` | Vista renderizable de 800x480. |
| `GET` | `/api/health` | Estado basico del proceso. |

Respuesta de healthcheck:

```json
{
  "ok": true,
  "uptime": 123.45,
  "timestamp": "2026-08-17T08:00:00.000Z"
}
```

## Endpoints de pantalla

### `GET /api/screen.bmp`

Requiere dispositivo si `DEVICE_TOKEN` esta configurado.

Devuelve `image/bmp` con una imagen de 800x480. Es el endpoint que consume el firmware.

### `GET /api/eink-data`

Requiere administrador o dispositivo si `DEVICE_TOKEN` esta configurado.

Query opcional:

| Parametro | Tipo | Descripcion |
|---|---|---|
| `monthOffset` | integer | Mes relativo entre `-36` y `36`. `0` es el mes actual. |

Devuelve los datos que usa la vista `/eink`: mes activo, dias del calendario, calendarios visibles, eventos de hoy, clima actual y endpoints de navegacion.

### `GET /api/screen/state`

Requiere administrador o dispositivo si `DEVICE_TOKEN` esta configurado.

```json
{
  "monthOffset": 0,
  "updatedAt": "2026-08-17T08:00:00.000Z"
}
```

### `POST /api/screen/month/previous`

Requiere dispositivo. Resta uno a `monthOffset`.

### `POST /api/screen/month/next`

Requiere dispositivo. Suma uno a `monthOffset`.

### `POST /api/screen/month/current`

Requiere dispositivo. Restablece `monthOffset` a `0`.

### `PUT /api/screen/month`

Requiere administrador.

```json
{
  "monthOffset": 0
}
```

## Endpoints de administracion

### `GET /api/dashboard`

Requiere administrador.

Devuelve una fotografia completa para el panel de control:

```json
{
  "sensors": {},
  "settings": {},
  "calendars": [],
  "eventExceptions": [],
  "weatherLocation": {},
  "screenState": {}
}
```

### `GET /api/device/sensors`

Requiere administrador.

```json
{
  "batteryPercent": null,
  "temperatureC": null,
  "humidityPercent": null,
  "rssi": null,
  "updatedAt": ""
}
```

### `POST /api/device/sensors`

Requiere dispositivo.

```json
{
  "batteryPercent": 86,
  "temperatureC": 23.8,
  "humidityPercent": 46,
  "rssi": -61
}
```

Rangos validados:

| Campo | Rango |
|---|---:|
| `batteryPercent` | `0` a `100` |
| `temperatureC` | `-40` a `85` |
| `humidityPercent` | `0` a `100` |
| `rssi` | `-150` a `20` |

### `GET /api/device/settings`

Requiere administrador o dispositivo si `DEVICE_TOKEN` esta configurado.

```json
{
  "deviceId": "seeed-e1002",
  "refreshHours": ["07:00", "12:00", "18:00"],
  "timezone": "Europe/Madrid",
  "timezonePosix": "CET-1CEST,M3.5.0/2,M10.5.0/3",
  "timezoneOptions": [],
  "mqttHost": "mqtt.local",
  "mqttPort": 1883,
  "mqttUsername": "",
  "mqttPassword": "",
  "mqttBaseTopic": "home/eink/e1002",
  "serverUrl": "http://192.168.1.50:3002",
  "screenUrl": "http://192.168.1.50:3002/api/screen.bmp",
  "updatedAt": "2026-08-17T08:00:00.000Z"
}
```

### `PUT /api/device/settings`

Requiere administrador.

```json
{
  "deviceId": "seeed-e1002",
  "refreshHours": ["07:00", "12:00", "18:00"],
  "timezone": "Europe/Madrid",
  "mqttHost": "mqtt.local",
  "mqttPort": 1883,
  "mqttUsername": "",
  "mqttPassword": "",
  "mqttBaseTopic": "home/eink/e1002",
  "serverUrl": "http://192.168.1.50:3002"
}
```

Notas:

- `refreshHours` acepta hasta 12 horas `HH:mm`.
- `timezone` debe estar entre las opciones expuestas por `GET /api/device/settings`.
- `serverUrl` debe empezar por `http://` o `https://`.
- Si se envia una URL terminada en `/api/screen.bmp`, se guarda solo la base.

### `GET /api/calendars`

Requiere administrador.

Devuelve hasta cuatro calendarios ordenados por `position`.

### `PUT /api/calendars`

Requiere administrador.

```json
{
  "calendars": [
    {
      "id": "calendar-1",
      "name": "Daniel",
      "url": "https://example.com/calendar.ics",
      "enabled": true
    }
  ]
}
```

El backend limita la lista a cuatro calendarios. Los colores se asignan por posicion.

### `POST /api/calendars/test`

Requiere administrador.

Prueba los calendarios guardados o los enviados en el body.

```json
{
  "calendars": [],
  "keywords": ["privado", "cancelado"]
}
```

Devuelve estado, numero de calendarios comprobados, fallos y proximos eventos detectados.

### `GET /api/event-exceptions`

Requiere administrador.

Devuelve palabras clave que ocultan eventos si aparecen en el titulo. La comparacion ignora mayusculas y acentos.

### `PUT /api/event-exceptions`

Requiere administrador.

```json
{
  "keywords": ["privado", "cancelado"]
}
```

Se guardan hasta 40 reglas no vacias.

### `GET /api/weather/location`

Requiere administrador.

Devuelve la ubicacion meteorologica sin revelar la API key guardada.

### `PUT /api/weather/location`

Requiere administrador.

```json
{
  "label": "Madrid",
  "country": "ES",
  "latitude": 40.4168,
  "longitude": -3.7038,
  "temperatureUnit": "celsius",
  "windUnit": "kmh",
  "openWeatherApiKey": "opcional"
}
```

Para borrar la key guardada:

```json
{
  "clearOpenWeatherApiKey": true
}
```

Unidades aceptadas:

| Campo | Valores |
|---|---|
| `temperatureUnit` | `celsius`, `fahrenheit`, `kelvin` |
| `windUnit` | `ms`, `kmh`, `mph` |

### `GET /api/weather/test`

Requiere administrador. Prueba la ubicacion y API key guardadas.

### `POST /api/weather/test`

Requiere administrador. Prueba una ubicacion enviada sin guardarla.

```json
{
  "label": "Madrid",
  "country": "ES",
  "latitude": 40.4168,
  "longitude": -3.7038,
  "temperatureUnit": "celsius",
  "windUnit": "kmh",
  "openWeatherApiKey": "opcional"
}
```

## Errores

Errores de validacion y autenticacion devuelven JSON:

```json
{
  "error": "BAD_REQUEST",
  "message": "descripcion"
}
```

Si falta un token:

```json
{
  "error": "AUTH_REQUIRED",
  "message": "Token requerido o incorrecto"
}
```
