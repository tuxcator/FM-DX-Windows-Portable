# Registro de cambios

Todos los cambios importantes de FM-DX Windows Portable se documentan aqui.

## 0.4.0 - 2026-07-31

### Novedades

- Spectrum Graph integrado para Airspy HF+ mediante la misma captura IQ usada por FM y NRSC-5.
- Indicador compacto de clima, fecha y hora en el dashboard.
- Menu administrativo para elegir Open-Meteo, The Weather Company / Weather Channel u OpenWeatherMap, ciudad, coordenadas y unidades.
- Modos de filtro analogico seleccionables: Normal 190 kHz, DX 160 kHz y DX 140 kHz.
- Control de acceso a sintonia para 1 o 2 usuarios con sesiones de 30 o 60 minutos.
- Actualizador seguro para recibir cambios y submodulos directamente desde GitHub.

### Mejoras

- Sintonia continua de Airspy HF+ y RTL-SDR sin reabrir el receptor en cada frecuencia.
- Cambio FM analogica/HD Radio y HD OFF/ON sobre la captura existente.
- Seleccion de HD1-HD8 sin resintonizar el receptor.
- Artwork HD/LOT ampliado y centrado en RadioText.
- RDS, codigo PI, SNR, dBm y estado analogico/HD mas consistentes.
- Estereo adaptativo para reducir ruido metalico o robotizado con senales debiles.
- Actualizacion mas fluida del espectro sin interrumpir audio, RDS o HD.
- Sintonia publica persistente con bloqueo administrativo guardado.

### Correcciones

- Las contrasenas nuevas de administrador se recargan sin conservar bloqueos de intentos anteriores.
- El audio TEF668x usa mayor buffer y resincronizacion para reducir cortes.
- El audio no necesita Stop/Play despues de cambiar de emisora.
- El RDS anterior se limpia al resintonizar.
- HD Radio ON ya no desconecta el receptor analogico.
- Se evita que procesos duplicados mantengan ocupado el puerto del servidor.

### Dependencias y construccion

- Spectrum Graph y webserver-time se incorporan como submodulos fijados.
- El paquete incluye sus licencias correspondientes.
- Las pruebas validan proveedores meteorologicos, claves protegidas, filtros Airspy, espectro, cupos de sintonia y estabilidad de audio.

## 0.3.0

- Primera distribucion portable integrada para Airspy HF+, RTL-SDR y TEF668x/XDR.
- FM analogica, RDS, NRSC-5 HD Radio, subcanales y acceso web local/LAN.