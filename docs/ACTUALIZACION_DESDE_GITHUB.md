# Actualizacion directa desde GitHub

Esta guia distingue dos operaciones:

- Actualizar-Desde-GitHub.cmd recibe la version publicada en origin/main.
- Actualizar-GitHub.cmd confirma y publica cambios locales en GitHub.

## Requisitos

- Una copia clonada con Git; el actualizador no funciona dentro de un ZIP sin carpeta .git.
- Git para Windows disponible en PATH.
- Conexion a Internet.
- Rama main activa.

## Actualizacion automatica

1. Cierre FM-DX Windows Portable y cualquier consola que use el receptor.
2. Respalde fuera de dist:
   - dist\FM-DX-Windows-Portable\app\config.json
   - dist\FM-DX-Windows-Portable\app\plugins_configs\NRSC5_HDRadio.json
   - dist\FM-DX-Windows-Portable\app\plugins_configs\TimeDisplay.json
3. Haga doble clic en Actualizar-Desde-GitHub.cmd.
4. Confirme la descarga cuando se muestre el numero de commits nuevos.
5. Cuando terminen las pruebas, ejecute Construir.cmd para regenerar dist\FM-DX-Windows-Portable.
6. Ejecute Configurar.cmd, restaure solamente los valores personales necesarios y luego use Diagnostico.cmd.

El actualizador nunca usa reset, force pull ni elimina cambios locales. Si encuentra archivos modificados o commits locales, se detiene y muestra el motivo.

## PowerShell

Para confirmar automaticamente:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Update-From-GitHub.ps1 -Yes

Para actualizar sin ejecutar las pruebas al final:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Update-From-GitHub.ps1 -Yes -SkipTests

Use -SkipTests solamente para diagnostico. Antes de reconstruir o publicar conviene ejecutar:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-GitHubReady.ps1

## Si aparece hay cambios locales

No copie ni borre archivos a ciegas. Revise:

    git status --short

Conserve los cambios en un commit o haga una copia de seguridad antes de volver a ejecutar el actualizador. Las configuraciones activas, contrasenas y claves API no deben subirse al repositorio.

## Instalacion descargada como ZIP

Un ZIP no tiene historial Git y no puede usar git pull. Descargue el ZIP o Release mas reciente desde GitHub, extraigalo en una carpeta nueva y copie de forma manual solamente su configuracion personal. No reemplace una instalacion en ejecucion.