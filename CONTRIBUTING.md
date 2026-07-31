# Contribuir

1. Cree una rama desde `main`.
2. No edite directamente `dist/`; use `overlays/`, `patches/`, `native/`, `packaging/` o `config/`.
3. No incluya contraseñas, tokens, números de serie privados ni configuración activa.
4. Mantenga los submódulos fijados y actualice `project.json` si cambia una revision.
5. Ejecute `scripts\Test-GitHubReady.ps1`.
6. Describa el hardware probado, frecuencia, modo FM/HD y resultado.

Los cambios que afecten audio deben probar FM analogica, Stereo, RDS y HD OFF/ON. Los cambios HD deben probar HD1 y todos los subcanales disponibles sin reiniciar el SDR.