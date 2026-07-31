# Seguridad

No publique vulnerabilidades, contraseñas o tokens en una incidencia pública. Use la función privada de reporte de vulnerabilidades de GitHub si está habilitada o contacte al mantenedor del repositorio.

Version soportada: la ultima Release publicada. El proyecto escucha en `0.0.0.0` para permitir LAN; limite el Firewall a perfil Privado y `LocalSubnet`. Para Internet use un túnel HTTPS o VPN, nunca reenvío directo del puerto 8080.

Las plantillas del repositorio deben conservar `adminPass` y `tunePass` vacíos. Los archivos de una instalación activa dentro de `dist/` no deben versionarse.