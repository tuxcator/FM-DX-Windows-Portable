# Arquitectura

```text
Navegador <- HTTP/WebSocket -> FM-DX Webserver (Node.js)
                                  |
                                  +-- audio FM analogico 48 kHz
                                  +-- metadatos y audio HD Radio
                                  |
                         receptor SDR compartido y continuo
                                  |
                 +----------------+----------------+
                 |                                 |
          airspyhf_hybrid.exe                rtl_hybrid.exe
          768 kS/s float32                   1.488375 MS/s CU8
                 |                                 |
          libairspyhf.dll                    librtlsdr.dll
                 +----------------+----------------+
                                  |
                        hybrid_bridge.py
                                  |
                            libnrsc5.dll
```

Airspy HF+ es el backend predeterminado. Su flujo de 768 kS/s se convierte con relacion exacta 3969/4096 a la entrada nativa CF32 de NRSC-5 (744187.5 sps). El mismo flujo original genera FM analogico; cambiar de frecuencia no reinicia los procesos, el servidor de audio ni las conexiones web.

Las rutas son relativas y todas las DLL, Node.js y Python quedan dentro de la distribucion portatil.