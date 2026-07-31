# Hardware compatible

## Airspy HF+ (receptor principal)

La configuracion predeterminada usa Airspy HF+ por USB para FM analogico y NRSC-5 HD Radio desde una sola captura continua.

- Cobertura usada: 87.5 a 108.0 MHz.
- Flujo del dispositivo: IQ complejo float32 a 768 kS/s.
- Flujo NRSC-5: remuestreo exacto 3969/4096 a 744187.5 sps, formato CF32.
- Audio analogico: WBFM de 400 kHz, PCM estereo 48 kHz.
- Control: cambio de frecuencia en vivo sin cerrar el dispositivo ni los WebSockets.
- Biblioteca incluida: libairspyhf 1.8.1 y airspyhf_info.exe.

Windows normalmente reconoce Airspy HF+ mediante su controlador USB compatible. No aplique al Airspy la configuracion Zadig destinada al RTL2832U. Cierre SDR#, SDR++ o cualquier programa que este usando el Airspy antes de iniciar FM-DX.

Ejecute `Diagnostico.cmd` para ver el numero de serie, firmware, tasas disponibles y estado de acceso.

## RTL-SDR (respaldo)

RTL2832U sigue disponible seleccionando `rtl` en `Configurar.cmd`. Requiere WinUSB/Zadig y no puede estar abierto simultaneamente en SDR#.

## TEF668x / tarjeta de sonido

El modo TEF/XDR permanece disponible, pero no se selecciona automaticamente mientras Airspy HF+ este configurado como receptor principal.
## FM estereo y RDS analogico

Airspy HF+ entrega una unica captura compartida. El capturador demodula L+R, bloquea el piloto de 19 kHz, recupera L-R a 38 kHz y produce PCM estereo a 48 kHz. En paralelo entrega el multiplex a 192 kHz a Redsea para decodificar PI, PS y RadioText RDS sin abrir el SDR por segunda vez.

Las imagenes LOT recibidas desde HD Radio se muestran como caratula de la melodia y tienen prioridad sobre consultas externas.
