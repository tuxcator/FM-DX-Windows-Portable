# FM-DX Windows Portable con HD Radio Integrado.

Aplicacion portable para Windows 10/11 x64 que integra FM-DX Webserver, FM analogica estereo, RDS y NRSC-5 HD Radio usando Airspy HF+ Discovery, RTL-SDR o TEF668x/XDR.

## Funciones

- Sintonia continua de 87.5 a 108.0 MHz.
- Airspy HF+ y RTL-SDR con una sola captura compartida.
- Spectrum Graph para Airspy HF+ con vista IQ local en vivo, sin resintonizar ni cortar FM/HD.
- Indicador compacto de clima, fecha y hora con proveedor configurable desde el menu del dashboard.
- FM estereo adaptativo, RDS y codigo PI.
- Filtro analogico Airspy seleccionable en vivo: Normal 190 kHz, DX 160 kHz y DX 140 kHz, sin reducir el ancho IQ de HD Radio.
- HD Radio con HD1-HD8, HD OFF/ON sin desconectar el receptor y Artwork LOT.
- SNR, dBm estimado y dBf en la interfaz.
- Acceso local, LAN y tunel HTTPS temporal con sintonia publica persistente y cupos de 1/2 usuarios por 30/60 minutos.
- Construccion reproducible con dependencias fijadas.

## Inicio rapido

Clone con submodulos y construya:

```powershell
git clone --recurse-submodules https://github.com/tuxcator/FM-DX-Windows-Portable.git
cd FM-DX-Windows-Portable
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-Portable.ps1
```

El paquete se crea en `dist\FM-DX-Windows-Portable`. Dentro de esa carpeta:

1. Ejecute `Configurar.cmd`.
2. Ejecute `Diagnostico.cmd`.
3. Ejecute `Iniciar.cmd`.
4. Abra `http://localhost:8080`.

## Documentacion

- [Manual completo para uso, hardware, red, diagnóstico y GitHub](docs/MANUAL_COMPLETO.md)
- [Manual completo en PDF](output/pdf/MANUAL_COMPLETO_FM-DX_WINDOWS_PORTABLE.pdf)
- [Novedades y cambios por version](CHANGELOG.md)
- [Actualizacion directa desde GitHub](docs/ACTUALIZACION_DESDE_GITHUB.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Hardware](docs/HARDWARE.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)

## Actualizar GitHub

Ejecute `Actualizar-GitHub.cmd`. El script comprueba la sesion de GitHub, valida pruebas y secretos, muestra los archivos pendientes, solicita confirmacion, crea el commit y actualiza `main` sin usar force push.

Desde PowerShell tambien puede indicar el mensaje y confirmar automaticamente:

```powershell
.\scripts\Update-GitHub.ps1 -Message "Descripcion breve del cambio" -Yes
# Simular sin crear commit ni subir:
.\scripts\Update-GitHub.ps1 -DryRun
```
## Novedades de la version 0.4.0

- Spectrum Graph fluido usando la captura IQ compartida de Airspy HF+.
- Modos de filtro FM analogico Normal 190 kHz, DX 160 kHz y DX 140 kHz.
- Limite configurable de 1 o 2 usuarios de sintonia durante sesiones de 30 o 60 minutos.
- Correcciones de autenticacion, continuidad de audio TEF668x y cambio FM/HD sin reiniciar el receptor.
- Indicador de clima, fecha y hora configurable desde Settings con Open-Meteo, Weather Company u OpenWeatherMap.
- Mejoras de subcanales HD, Artwork, RDS, PI, SNR y estabilidad de WebSocket.

## Actualizar desde la nube de GitHub

Para recibir la version mas nueva de main, haga doble clic en Actualizar-Desde-GitHub.cmd. El actualizador:

1. Comprueba que el repositorio y el remoto sean correctos.
2. Se detiene si existen cambios locales, para no sobrescribir personalizaciones.
3. Descarga solamente una actualizacion de avance rapido (--ff-only).
4. Sincroniza todos los submodulos y ejecuta las pruebas.

Desde PowerShell:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Update-From-GitHub.ps1 -Yes

Despues ejecute Construir.cmd para generar un paquete portable nuevo. Antes de reconstruir, respalde las configuraciones activas indicadas en la guia de actualizacion.

Actualizar-GitHub.cmd publica cambios locales; Actualizar-Desde-GitHub.cmd recibe cambios desde la nube.

## Publicacion en GitHub

No suba `runtime/`, `.cache/`, `dist/`, `node_modules/`, `backups/` ni configuraciones activas. El workflow de GitHub Actions descarga y compila todas las dependencias, crea un ZIP portable y publica ZIP + SHA-256 al crear una etiqueta `v*`.

Antes del primer push ejecute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-GitHubReady.ps1
```

## Configurar clima, fecha y hora

1. Inicie sesion como administrador en el dashboard.
2. Abra el menu **Settings**.
3. Busque la seccion **Clima, fecha y hora**.
4. Seleccione proveedor, ciudad, coordenadas y unidades.
5. Si el proveedor requiere una clave, escribala y pulse **Guardar clima**.

Proveedores disponibles:

- **Open-Meteo:** opcion predeterminada, no necesita clave API.
- **The Weather Company / Weather Channel:** necesita acceso y clave de [The Weather Company](https://developer.weather.com/).
- **OpenWeatherMap:** necesita una clave de [OpenWeatherMap](https://openweathermap.org/api).

La configuracion se guarda en `app/plugins_configs/TimeDisplay.json`. Las claves permanecen en el servidor y nunca se incluyen en la respuesta publica del dashboard. Si el proveedor no responde, se conserva temporalmente el ultimo dato valido.

La instalacion inicial utiliza Monterrey, Mexico (`25.6866`, `-100.3161`) en grados Celsius y km/h.

## Licencias

Este proyecto integra componentes con licencias diferentes. FM-DX Webserver y nrsc5 usan GPL-3.0; Spectrum Graph usa MIT; Time Display usa GPL-3.0; libairspyhf, redsea, liquid-dsp, Node.js, Python y MSYS2 conservan sus licencias. La revision fijada de NRSC5_HDRadio no incluye un archivo LICENSE independiente: confirme el permiso de redistribucion antes de publicar un binario que lo contenga.
