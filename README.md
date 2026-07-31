# FM-DX Windows Portable con HD Radio Integrado.

Aplicacion portable para Windows 10/11 x64 que integra FM-DX Webserver, FM analogica estereo, RDS y NRSC-5 HD Radio usando Airspy HF+ Discovery, RTL-SDR o TEF668x/XDR.

## Funciones

- Sintonia continua de 87.5 a 108.0 MHz.
- Airspy HF+ y RTL-SDR con una sola captura compartida.
- FM estereo adaptativo, RDS y codigo PI.
- HD Radio con HD1-HD8, HD OFF/ON sin desconectar el receptor y Artwork LOT.
- SNR, dBm estimado y dBf en la interfaz.
- Acceso local, LAN protegida y tunel HTTPS temporal.
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
- [Arquitectura](docs/ARQUITECTURA.md)
- [Hardware](docs/HARDWARE.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)

## Publicacion en GitHub

No suba `runtime/`, `.cache/`, `dist/`, `node_modules/`, `backups/` ni configuraciones activas. El workflow de GitHub Actions descarga y compila todas las dependencias, crea un ZIP portable y publica ZIP + SHA-256 al crear una etiqueta `v*`.

Antes del primer push ejecute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-GitHubReady.ps1
```

## Licencias

Este proyecto integra componentes con licencias diferentes. FM-DX Webserver y nrsc5 usan GPL-3.0; libairspyhf, redsea, liquid-dsp, Node.js, Python y MSYS2 conservan sus licencias. La revision fijada de NRSC5_HDRadio no incluye un archivo LICENSE independiente: confirme el permiso de redistribucion antes de publicar un binario que lo contenga.
