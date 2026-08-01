# Manual completo - FM-DX Windows Portable

**Version del proyecto:** 0.3.0  
**Plataforma:** Windows 10/11 x64  
**Receptores:** Airspy HF+ Discovery, RTL-SDR RTL2832U y TEF668x/XDR  
**Cobertura FM:** 87.5 a 108.0 MHz

## 1. Objetivo del proyecto

FM-DX Windows Portable integra en una sola carpeta FM-DX Webserver, recepcion FM analogica, FM estereo adaptativo, RDS, NRSC-5 HD Radio, subcanales HD1-HD8, imagenes LOT/Artwork y acceso web. Node.js, Python, FFmpeg, libnrsc5, libairspyhf, RTL-SDR y las herramientas auxiliares quedan dentro del paquete final.

La aplicacion abre un receptor SDR una sola vez y comparte la captura entre FM analogica, RDS y HD Radio. La sintonia se realiza en vivo para evitar reinicios del USB, silencios, bloqueos del puerto y desconexiones de WebSocket.

> Importante: el uso de HD Radio y de las frecuencias debe respetar la legislacion local. No transmita; este proyecto es exclusivamente receptor.

## 2. Funciones principales

- Sintonia continua de 87.5 a 108.0 MHz en pasos de 0.1 MHz.
- Airspy HF+ Discovery como receptor recomendado.
- RTL-SDR RTL2832U con WinUSB como alternativa.
- TEF668x/XDR mediante puerto serie, TCP/IP o tarjeta de sonido.
- FM analogica a 48 kHz con estereo adaptativo y retorno automatico a mono limpio.
- RDS analogico: PI, PS, PTY, RadioText y datos de estacion.
- NRSC-5 HD Radio con deteccion real de sincronizacion.
- Cambio continuo FM analogica <-> HD sin reiniciar el receptor.
- Botones HD RADIO OFF y HD RADIO ON.
- Seleccion de HD1, HD2, HD3 y demas servicios anunciados.
- Artwork recibido por LOT y caratula externa opcional.
- Metricas SNR, potencia estimada en dBm, dBf y codigo PI.
- Acceso local, LAN y tunel HTTPS temporal.
- Distribucion reproducible y publicable mediante GitHub Actions.

## 3. Arquitectura

```text
Navegador
   | HTTP + WebSocket
FM-DX Webserver (Node.js)
   |-- Audio FM analogico PCM 48 kHz -> MP3/WebSocket
   |-- RDS -> redsea -> PI/PS/RadioText
   |-- Audio y metadatos HD -> /hd_audio + /data_plugins
   |
Captura SDR compartida y continua
   |-- Airspy HF+: 768 kS/s CF32
   |-- RTL-SDR: flujo CU8
   |
hybrid_bridge.py -> libnrsc5.dll -> HD1-HD8 + LOT
```

Airspy entrega IQ a 768 kS/s. El puente produce la tasa nativa de NRSC-5 de 744187.5 muestras/s mediante la relacion 3969/4096. En paralelo, el mismo flujo genera FM analogica, multiplex RDS y metricas RF.

## 4. Requisitos

### 4.1 Para usar el paquete portable

- Windows 10 u 11 de 64 bits.
- Puerto USB estable, preferentemente directo al equipo.
- Airspy HF+ Discovery, RTL-SDR o receptor TEF/XDR.
- Antena adecuada para 88-108 MHz.
- Navegador Chromium, Edge o Firefox actualizado.
- Aproximadamente 700 MB libres para el paquete.

### 4.2 Para construir desde GitHub

- Windows 10/11 x64.
- Git para Windows con `patch.exe`.
- PowerShell 5.1 o superior.
- Internet durante la primera compilacion.
- Entre 4 y 6 GB libres para `.cache`, runtimes, fuentes y salida.

No es necesario instalar Node.js, Python, MSYS2, GCC, FFmpeg ni nrsc5 globalmente. Los scripts descargan o construyen copias autocontenidas.

## 5. Conexion del hardware

### 5.1 Airspy HF+ Discovery

1. Conecte la antena FM al Airspy.
2. Conecte el receptor directamente por USB.
3. Cierre SDR#, SDR++, HDSDR y otros programas SDR.
4. No aplique con Zadig el controlador destinado al RTL2832U.
5. Ejecute `Diagnostico.cmd` y confirme que se muestran serie, firmware y tasas disponibles.
6. En `Configurar.cmd`, seleccione Airspy HF+ o Automatico.

Configuracion recomendada inicial:

- Serie: `auto`.
- Atenuacion: `0 dB`; aumentela solamente si hay saturacion o emisoras muy fuertes.
- Ancho analogico efectivo: aproximadamente 190 kHz.
- Audio: 48 kHz estereo adaptativo.

### 5.2 RTL-SDR RTL2832U

1. Instale el controlador WinUSB con Zadig sobre la interfaz RTL2832U correcta.
2. Confirme primero el funcionamiento en SDR#.
3. Cierre SDR# antes de abrir FM-DX; un dongle no puede quedar abierto por dos programas.
4. Ejecute `Diagnostico.cmd`.
5. En `Configurar.cmd`, seleccione RTL-SDR.
6. Ajuste indice, ganancia y PPM si es necesario.

Si aparece `Failed to open rtlsdr device` o `usb_open error`, el dispositivo esta ocupado, se eligio una interfaz incorrecta en Zadig o falta WinUSB.

### 5.3 TEF668x/XDR y tarjeta de sonido

1. Seleccione TEF668x/XDR en `Configurar.cmd`.
2. Elija puerto serie directo o TCP/IP/xdrd.
3. Seleccione la entrada DirectShow de la tarjeta de sonido.
4. Una tarjeta de sonido transporta audio demodulado, pero no sustituye un SDR para decodificar NRSC-5.

## 6. Primera configuracion

Desde la carpeta final `dist\FM-DX-Windows-Portable`:

1. Ejecute `Configurar.cmd`.
2. Elija receptor: Automatico, Airspy HF+, RTL-SDR o TEF/XDR.
3. Revise el puerto web; el valor predeterminado es 8080.
4. Configure parametros de Airspy o RTL cuando el asistente los solicite.
5. Ejecute `Diagnostico.cmd`.
6. Cierre cualquier programa que use el receptor.
7. Ejecute `Iniciar.cmd`.
8. Abra `http://localhost:8080`.

La configuracion activa se guarda en:

```text
app\config.json
app\plugins_configs\NRSC5_HDRadio.json
```

No cambie manualmente `"device": "sdr"` para distinguir Airspy de RTL. Ese valor es el perfil interno de FM-DX. La seleccion real se encuentra en `portableHardware.mode` y debe cambiarse con `Configurar.cmd`.

## 7. Uso de la interfaz web

### 7.1 Reproducir y sintonizar

1. Pulse Play una vez para autorizar audio en el navegador.
2. Seleccione una frecuencia o use los controles arriba/abajo.
3. El receptor cambia de frecuencia en vivo sin cerrar USB.
4. Si la emisora es solamente analogica, permanecen FM, estereo y RDS.
5. Si existe sincronizacion NRSC-5 real, el audio cambia a HD después de acumular un pequeño buffer.

La frecuencia de ejemplo del proyecto es 103.7 MHz.

### 7.2 FM estereo adaptativo

El piloto de 19 kHz activa la separacion izquierda/derecha. Con señal debil la separacion se reduce para evitar ruido metalico o robotizado; con mejor SNR aumenta gradualmente hasta estereo amplio. Si el piloto desaparece, el receptor vuelve a mono limpio sin cortar el audio.

### 7.3 RDS analogico

- `PI`: identificador hexadecimal de cuatro digitos.
- `PS`: nombre corto de la emisora.
- `PTY`: tipo de programa.
- `RadioText`: texto o informacion de la cancion.

Al cambiar de frecuencia se reinician los campos RDS para que no quede texto de la estacion anterior. La decodificacion depende de señal, multipath, antena y de que la emisora transmita datos correctos.

### 7.4 HD RADIO OFF

Use este botón cuando la señal HD sea debil o desee mantener FM analogica. El receptor y la captura permanecen abiertos; solamente se desactiva el uso del audio HD en la interfaz.

### 7.5 HD RADIO ON

Reactiva HD sobre la captura existente. No reinicia Airspy/RTL, RDS, audio analogico ni los WebSockets. Cuando NRSC-5 sincroniza, el cambio a HD ocurre después del prebuffer y FM permanece audible durante la espera.

### 7.6 Subcanales HD

Pulse HD1, HD2, HD3 o el servicio disponible. El cambio de programa se envía al decodificador sin resintonizar el receptor. Los botones pueden habilitarse conforme llegan los metadatos de servicio.

### 7.7 Artwork y RadioText

Las imagenes LOT descargadas directamente de la emisora tienen prioridad. Si la opcion de metadatos enriquecidos esta activa y la emisora no entrega imagen, puede consultarse una caratula externa. El Artwork se muestra centrado y ampliado en el area de RadioText.

## 8. Metricas de recepcion

- `SNR`: relacion señal/ruido calculada por el backend.
- `dBm`: potencia estimada; Airspy usa un desplazamiento calibrable.
- `dBf`: conversion usada por la interfaz FM-DX.
- `PI`: codigo RDS de la estacion analogica.
- `MER/BER`: calidad digital NRSC-5; no prueban por sí solos que exista audio HD.

Una emisora se clasifica como HD solamente después de una sincronizacion NRSC-5 real. Un valor MER aislado no debe ocultar el audio analogico.

## 9. Contraseñas y acceso remoto

### 9.1 Crear contraseñas

1. Cierre FM-DX.
2. Ejecute `Configurar-Contrasenas.cmd`.
3. Escriba una contraseña de administracion de al menos 12 caracteres.
4. Confirme la contraseña.
5. Escriba una contraseña de sintonia distinta, de al menos 10 caracteres.
6. Confirme y pulse Guardar contraseñas.
7. Reinicie con `Iniciar.cmd`.

La casilla **Mostrar contraseñas mientras escribo** permite revisar los caracteres. La contraseña de sintonia controla frecuencia, HD ON/OFF y subcanales. La de administracion abre Setup.

Nunca publique el `app\config.json` de una instalacion activa. El repositorio contiene solamente plantillas con contraseñas vacias.

### 9.2 Bloqueo y sesiones de sintonia

Desde **Admin > Setup > Quick settings** se configuran tres opciones:

- **Siempre publico:** todos pueden sintonizar sin reservar cupo.
- **Sesiones limitadas:** permite 1 o 2 usuarios controladores simultaneos durante 30 o 60 minutos.
- **Solo administrador:** bloquea la sintonia para visitantes y usuarios normales.

Los campos **Usuarios simultaneos** y **Tiempo por sesion** controlan el cupo del modo limitado. Una sesion comienza con el primer cambio de frecuencia, termina al cerrar el navegador o caduca al alcanzar su tiempo maximo. Si no quedan cupos, la interfaz muestra un aviso y no cambia la frecuencia.

El servidor envia un heartbeat cada 30 segundos. Si un navegador se suspende, pierde Wi-Fi o desaparece sin cerrar correctamente, su WebSocket se termina y el cupo se libera. Los controles rapidos del icono de llave cambian entre publico y limitado; el candado selecciona solo administrador.

Al reconstruir o actualizar el paquete, Build-Portable conserva la configuracion activa, las contraseñas, el receptor y estos limites. La plantilla destinada a GitHub mantiene las contraseñas vacias.
### 9.3 Red local

1. Configure ambas contraseñas.
2. Ejecute `Habilitar-Red-Local.cmd` como administrador.
3. Acepte el aviso UAC.
4. El script crea una regla TCP para el puerto configurado, perfil Privado y `LocalSubnet`.
5. Reinicie FM-DX.
6. Desde otro equipo abra `http://IP-LOCAL:8080`.

El servidor usa `0.0.0.0` para escuchar interfaces IPv4, pero el Firewall limita el acceso a la subred local.

### 9.4 Acceso desde Internet

Ejecute `Publicar-Internet.cmd`. El script descarga `cloudflared` oficial, valida SHA-256 o firma digital y muestra una URL HTTPS temporal `trycloudflare.com`. Mantenga la ventana abierta.

No redirija directamente el puerto 8080 en el router. Para una direccion permanente, utilice un tunel administrado y Cloudflare Access o una VPN.

## 10. Diagnostico y problemas frecuentes

Ejecute siempre `Diagnostico.cmd` con FM-DX cerrado.

| Sintoma | Causa probable | Solucion |
|---|---|---|
| Puerto 8080 en uso | Otra instancia o proceso Node | Cierre la instancia anterior o cambie el puerto |
| Airspy no aparece | Otro programa lo usa o fallo USB | Cierre SDR#, cambie de puerto USB y ejecute Diagnostico |
| RTL no detectado | WinUSB incorrecto | Reinstale con Zadig sobre RTL2832U |
| Audio `null` | Entrada DirectShow vacia en modo TEF | Seleccione una entrada real; en modo SDR se usa captura interna |
| Audio robotizado | Estereo L-R inestable o señal multipath | Use antena adecuada; el mezclador adaptativo reducira separación automáticamente |
| No aparece Stereo | Piloto débil o inexistente | Mejore antena y SNR; confirme que la emisora transmita estereo |
| RDS anterior permanece | Datos no reiniciados o navegador antiguo | Resintonice y actualice con Ctrl+F5 |
| HD ON desconecta | Version antigua reiniciaba la captura | Use esta version; HD ON reutiliza el mismo proceso SDR |
| HD no sincroniza | Señal digital insuficiente | Mantenga FM, mejore antena o use HD OFF |
| HD2/HD3 sin audio | Servicio no anunciado o señal insuficiente | Espere metadatos, vuelva a HD1 y compruebe MER/BER |
| Artwork no aparece | Emisora no envia LOT | Active metadatos enriquecidos o espere otra cancion |
| Web se desconecta | Proxy, Wi-Fi o instancia duplicada | Use una sola instancia y revise Firewall/red |

## 11. Copias de seguridad

Antes de actualizar, copie fuera de `dist`:

```text
app\config.json
app\plugins_configs\NRSC5_HDRadio.json
app\web\css\              (si modifico estilos directamente)
app\web\images\           (si agrego recursos propios)
```

Las personalizaciones permanentes de codigo deben vivir en `overlays/`, `patches/`, `config/` o `packaging/`. Todo cambio realizado solamente dentro de `dist/` se pierde al reconstruir.

No incluya contraseñas en una copia que vaya a GitHub.

## 12. Construccion local reproducible

Clone con submodulos:

```powershell
git clone --recurse-submodules https://github.com/USUARIO/FM-DX-Windows-Portable.git
cd FM-DX-Windows-Portable
```

Si ya clono sin submodulos:

```powershell
git submodule update --init --recursive
```

Construya:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-Portable.ps1
```

O haga doble clic en `Construir.cmd`.

El resultado aparece en:

```text
dist\FM-DX-Windows-Portable\
```

La primera ejecucion:

1. Descarga Node.js y Python según `project.json`.
2. Extrae MSYS2 dentro de `.cache`.
3. Instala en ese MSYS2 el compilador y bibliotecas necesarias.
4. Compila libnrsc5, herramientas SDR, redsea y capturadores híbridos.
5. Copia FM-DX Webserver desde el submodulo fijado.
6. Aplica parches y overlays propios.
7. Ejecuta `npm ci --omit=dev` usando `package-lock.json`.
8. Copia runtimes, licencias y lanzadores.
9. Ejecuta `tests\Test-Project.ps1`.

## 13. Dependencias fijadas

| Componente | Revision/version |
|---|---|
| Node.js portable | 24.18.0 |
| Python embebido | 3.13.14 |
| MSYS2 base | 20260611 |
| FM-DX Webserver | `447a4d618647ff4ddccdea241dffd301d3e384d4` |
| NRSC5_HDRadio | `085d4437b8365f403e57a66d4e65dd04071138bd` |
| nrsc5 | `5fe1c3b6d15cc4924e3e1ac8e1b622be33510735` |
| nrsc5-gui | `1113d5a16f3dba834c6ff378d35880433fbd752f` |
| airspyhf | `24fe8ffcb00b14f827268bbad89ae1392de055e5` |
| redsea | `7555c9f6259d50718697ee8c9f218ea012c6892c` |
| liquid-dsp | `8bf87b6fe325d98c250d6911fa50518d14175d86` |

`project.json`, `.gitmodules` y los `package-lock.json` son la fuente de verdad. No sustituya revisiones sin volver a ejecutar todas las pruebas.

## 14. Estructura del repositorio GitHub

```text
.github/       Workflows, Dependabot y plantillas de incidencias
config/        Plantillas sin secretos
native/        Capturadores Airspy/RTL
patches/       Cambios aplicados a fuentes upstream
overlays/      Archivos propios que reemplazan o amplian upstream
packaging/     Lanzadores del paquete final
scripts/       Descargas, compilacion y validacion
tests/         Pruebas automatizadas
third_party/   Submodulos Git fijados por commit
docs/          Documentacion tecnica
output/pdf/    Manual PDF publicado
```

No se versionan:

- `.cache/` (aprox. 2.45 GB en una compilacion completa).
- `runtime/` (aprox. 187 MB).
- `dist/` (aprox. 559 MB).
- `node_modules/`, logs, datos de usuario, respaldos y secretos.

GitHub bloquea archivos individuales mayores de 100 MiB. Los binarios generados deben distribuirse como artefactos de Actions o activos de Releases, no dentro del historial Git.

## 15. Publicar el proyecto en GitHub

### 15.1 Verificacion previa

Ejecute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-GitHubReady.ps1
```

Este script comprueba plantillas sin contraseñas, submodulos, archivos grandes, exclusiones, sintaxis Git y pruebas del proyecto.

### 15.2 Crear repositorio remoto

Cree en GitHub un repositorio vacio, sin README ni licencia generados automáticamente. Después:

```powershell
git init
git branch -M main
git add .
git status
git commit -m "Initial FM-DX Windows Portable release"
git remote add origin https://github.com/USUARIO/FM-DX-Windows-Portable.git
git push -u origin main
```

Revise `git status` antes del commit. No publique `dist`, `runtime`, `.cache`, `backups` ni archivos de configuración activa.

### 15.3 GitHub Actions

El workflow `.github/workflows/windows-portable.yml`:

- Obtiene todos los submodulos recursivamente.
- Construye el paquete en `windows-latest`.
- Ejecuta las pruebas integradas.
- Crea `FM-DX-Windows-Portable-<version>.zip`.
- Genera una suma SHA-256.
- Conserva ambos como artefacto de Actions.
- En una etiqueta `v*`, crea una GitHub Release y adjunta ZIP y checksum.

### 15.4 Crear una version

Actualice `project.json`, confirme los cambios y cree una etiqueta:

```powershell
git tag -a v0.3.0 -m "FM-DX Windows Portable 0.3.0"
git push origin v0.3.0
```

La etiqueta inicia la compilacion y la publicacion de Release. Verifique el checksum después de descargar:

```powershell
Get-FileHash -Algorithm SHA256 .\FM-DX-Windows-Portable-0.3.0.zip
```

### 15.5 Dependabot

`.github/dependabot.yml` vigila semanalmente GitHub Actions y los submodulos. Una actualizacion de submodulo puede cambiar APIs o parches; nunca mezcle automáticamente sin ejecutar la compilacion completa.

## 16. Seguridad para GitHub

- Mantenga contraseñas vacias en `config/config.json`.
- No suba tokens, claves privadas, certificados, URLs privadas ni archivos `.env`.
- Active Secret Scanning y Push Protection en GitHub cuando estén disponibles.
- Use permisos mínimos en Actions.
- El workflow utiliza `GITHUB_TOKEN` solamente al publicar una etiqueta.
- Revise las licencias antes de publicar binarios.
- Reporte vulnerabilidades mediante `SECURITY.md`, no en una incidencia pública.

## 17. Licencias y redistribucion

- FM-DX Webserver: GPL-3.0.
- nrsc5: GPL-3.0.
- nrsc5-gui: el codigo principal declara GPL-3.0-or-later; confirme los archivos de la revision fijada.
- libairspyhf: BSD-3-Clause y componentes GPL-2.0 según sus archivos.
- redsea: MIT.
- liquid-dsp: MIT.
- Node.js, Python, MSYS2 y paquetes: licencias propias incluidas o referenciadas.
- NRSC5_HDRadio no presenta un archivo LICENSE independiente en la revision fijada.

Antes de publicar un ZIP que incluya NRSC5_HDRadio, solicite aclaracion o permiso al autor. Mantenga `THIRD_PARTY_NOTICES.md`, fuentes correspondientes, commits exactos y copias de licencia junto a cada Release.

## 18. Mantenimiento

1. Trabaje en `overlays/`, `patches/`, `native/` y `packaging/`, no directamente en `dist/`.
2. Actualice un componente upstream a la vez.
3. Registre el commit nuevo en `project.json` y en el submodulo.
4. Reconstruya desde cero.
5. Ejecute pruebas de software.
6. Pruebe Airspy, RTL y TEF según disponibilidad.
7. Compruebe FM analogica, Stereo, RDS, HD OFF/ON, HD1-HD3 y Artwork.
8. Cree una etiqueta solamente después de verificar el ZIP.

## 19. Lista de comprobacion final

- [ ] Airspy o RTL detectado y libre.
- [ ] FM analogica continua en 103.7.
- [ ] Stereo y RDS visibles.
- [ ] HD OFF mantiene audio FM.
- [ ] HD ON conserva el mismo proceso SDR.
- [ ] HD1/HD2/HD3 cambian sin resintonizar.
- [ ] Artwork centrado en RadioText.
- [ ] Contraseñas creadas y servidor reiniciado.
- [ ] Acceso LAN limitado a red privada.
- [ ] `config/` no contiene secretos.
- [ ] `runtime/`, `.cache/`, `dist/` y `backups/` están ignorados.
- [ ] Submodulos apuntan a los commits declarados.
- [ ] Pruebas completadas correctamente.
- [ ] ZIP y SHA-256 adjuntos a la Release.
- [ ] Avisos y licencias revisados.

## 20. Referencias

- FM-DX Webserver: https://github.com/NoobishSVK/fm-dx-webserver
- NRSC5_HDRadio: https://github.com/Seehed/NRSC5_HDRadio
- nrsc5: https://github.com/theori-io/nrsc5
- nrsc5-gui: https://github.com/cmnybo/nrsc5-gui
- libairspyhf: https://github.com/airspy/airspyhf
- redsea: https://github.com/windytan/redsea
- GitHub - archivos grandes: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- GitHub - Dependabot: https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file

---

Este manual describe la configuracion reproducible del proyecto y no contiene contraseñas, tokens ni datos privados de una instalación activa.