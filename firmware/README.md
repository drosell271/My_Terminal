# Firmware ESP-IDF para Seeed reTerminal E1002

Firmware para el patrón `headless browser` del proyecto:

- Primer arranque sin configuración: crea AP abierto `EINK-E1002-XXXX` y muestra un PIN numérico de 6 dígitos.
- Portal de configuración: `http://192.168.4.1`.
- El PIN cambia cada vez que se enciende el hotspot y se pide en el formulario del portal.
- Guarda en NVS: WiFi SSID, WiFi password, URL base del backend, por ejemplo `http://192.168.1.50:3000`, y token de dispositivo opcional.
- Puede actualizar la URL base del backend leyendo `serverUrl` desde `GET /api/device/settings`, pero ignora URLs loopback y valida la API del nuevo servidor antes de guardarla.
- Descarga pantalla desde `GET /api/screen.bmp`.
- Lee ajustes desde `GET /api/device/settings`.
- Aplica la zona horaria recibida en los ajustes para calcular las horas de despertar.
- Envía sensores al backend con `POST /api/device/sensors`.
- Si el backend define `DEVICE_TOKEN`, el mismo token debe configurarse en el portal WiFi. El firmware lo enviara como `X-Device-Token`.
- Publica sensores por MQTT usando los ajustes recibidos del backend:
  - `<topic_base>/deviceId`
  - `<topic_base>/battery/percent`
  - `<topic_base>/battery/voltage`
  - `<topic_base>/temp`
  - `<topic_base>/hum`
  - `<topic_base>/rssi`
- Entra en deep sleep despues de cada actualizacion y despierta por temporizador o por cualquier boton.
- Botones:
  - GPIO5: beep corto, mes anterior, llama `POST /api/screen/month/previous`.
  - GPIO4: beep corto, mes siguiente, llama `POST /api/screen/month/next`.
  - GPIO3 verde: doble beep corto, vuelve al mes actual, llama `POST /api/screen/month/current`.
  - Tras completar una accion de boton, mantiene una ventana interactiva de 60 segundos para poder pulsar otro boton sin esperar a que despierte. Cada pulsacion reinicia esos 60 segundos.
- Mantener los tres botones pulsados al arrancar borra WiFi/servidor y vuelve al portal.

## Build

Este proyecto esta orientado a ESP-IDF `v5.4.4`. En esta maquina ESP-IDF esta instalado en `C:\esp\v5.4.4\esp-idf`. Desde PowerShell:

```powershell
$env:Path = "C:\Users\drmor\.local\bin;$env:Path"
. C:\esp\v5.4.4\esp-idf\export.ps1
cd firmware
idf.py set-target esp32s3
idf.py build
```

Tambien puedes usar el script local:

```powershell
.\idf-build.ps1
```

Los scripts locales prefieren `C:\esp\v5.4.4\esp-idf`. Si necesitas otra ruta, define `MY_TERMINAL_IDF_PATH`.

El build genera `build/eink_e1002_firmware.bin`.

Para flashear, conecta la E1002 por USB, localiza el puerto y ejecuta:

```powershell
Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Caption
idf.py -p COMx flash monitor
```

O usando el script local:

```powershell
.\idf-flash.ps1 -Port COMx
```

Para el primer flasheo, o si quieres volver al portal de configuracion desde cero, borra antes la flash:

```powershell
.\idf-erase.ps1 -Port COMx
.\idf-flash.ps1 -Port COMx
```

En el portal inicial, la URL del servidor debe ser la IP real del equipo donde corre Node dentro de tu red, por ejemplo `http://192.168.1.50:3000`.

Despues del primer arranque tambien puedes cambiar esa URL desde el panel, en `Dispositivo -> Servidor backend`. El firmware guardara el nuevo valor en NVS al leer los ajustes solo si responde la API del dispositivo. Si dejas una URL incorrecta, manten los tres botones pulsados al arrancar para borrar WiFi/servidor y volver al portal.

## Pines usados

Basado en documentación y ejemplos públicos del reTerminal E1002:

| Función | GPIO |
|---|---:|
| SPI CLK | 7 |
| SPI MOSI | 9 |
| EPD CS | 10 |
| EPD DC | 11 |
| EPD RST | 12 |
| EPD BUSY | 13 |
| Botón verde | 3 |
| Botón derecho | 4 |
| Botón izquierdo | 5 |
| LED usuario | 6 |
| Battery enable | 21 |
| Battery ADC | 1 |
| I2C SDA | 19 |
| I2C SCL | 20 |
| Buzzer PWM | 45 |

## Driver e-paper

El proyecto usa una copia local de `tuanpmt/esp_epaper`, que declara soporte para `GDEP073E01`, 800x480, 6 colores. La integracion LVGL se ha desactivado en esta copia porque la UI final se renderiza en el backend. El backend entrega BMP 24-bit y el firmware lo convierte a 4 bpp usando la paleta:

- negro `0x00`
- blanco `0x01`
- amarillo `0x02`
- rojo `0x03`
- azul `0x05`
- verde `0x06`

La pantalla E1002 no tiene refresco parcial en color; cada cambio de mes o actualización hace refresco completo.

## Sleep

El firmware usa deep sleep entre actualizaciones. Antes de dormir:

- calcula la proxima hora configurada en el panel;
- usa la zona horaria configurada en el panel para convertir esas horas a tiempo local;
- configura wake por temporizador;
- configura wake externo por GPIO3, GPIO4 o GPIO5 en nivel bajo;
- apaga MQTT/WiFi y deja la e-paper en reposo.

Al despertar por boton, el firmware arranca, conecta WiFi, aplica la accion de mes correspondiente, refresca la pantalla y mantiene 60 segundos de escucha activa antes de volver a dormir.
