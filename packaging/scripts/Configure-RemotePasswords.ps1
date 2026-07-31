param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configPath = Join-Path $root 'app\config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    [Windows.Forms.MessageBox]::Show("No se encontró app\config.json.`r`nConstruya primero el paquete portable.", 'FM-DX', 'OK', 'Error') | Out-Null
    exit 1
}

function Add-Label([Windows.Forms.Control]$Parent, [string]$Text, [int]$X, [int]$Y, [int]$Width = 390) {
    $label = [Windows.Forms.Label]::new()
    $label.Text = $Text
    $label.Location = [Drawing.Point]::new($X, $Y)
    $label.Size = [Drawing.Size]::new($Width, 22)
    $Parent.Controls.Add($label)
    return $label
}

function Add-PasswordBox([Windows.Forms.Control]$Parent, [int]$Y) {
    $box = [Windows.Forms.TextBox]::new()
    $box.Location = [Drawing.Point]::new(24, $Y)
    $box.Size = [Drawing.Size]::new(420, 26)
    $box.UseSystemPasswordChar = $true
    $Parent.Controls.Add($box)
    return $box
}

$form = [Windows.Forms.Form]::new()
$form.Text = 'FM-DX - Configurar contraseñas remotas'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = [Drawing.Size]::new(470, 490)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = [Drawing.Font]::new('Segoe UI', 10)

$title = Add-Label $form 'PROTECCIÓN DEL ACCESO REMOTO' 24 18 420
$title.Font = [Drawing.Font]::new('Segoe UI Semibold', 13)
$info = Add-Label $form "Administrador: permite entrar a Configuración/Setup.`r`nSintonización: permite cambiar frecuencia, HD y controles desde otro equipo." 24 54 420
$info.Size = [Drawing.Size]::new(420, 52)

Add-Label $form 'Contraseña de administrador (mínimo 12 caracteres)' 24 116 | Out-Null
$admin = Add-PasswordBox $form 140
Add-Label $form 'Confirmar contraseña de administrador' 24 176 | Out-Null
$adminConfirm = Add-PasswordBox $form 200
Add-Label $form 'Contraseña de sintonización (mínimo 10 caracteres)' 24 236 | Out-Null
$tune = Add-PasswordBox $form 260
Add-Label $form 'Confirmar contraseña de sintonización' 24 296 | Out-Null
$tuneConfirm = Add-PasswordBox $form 320

$show = [Windows.Forms.CheckBox]::new()
$show.Text = 'Mostrar contraseñas mientras escribo'
$show.Location = [Drawing.Point]::new(24, 360)
$show.Size = [Drawing.Size]::new(300, 28)
$show.Add_CheckedChanged({
    $masked = -not $show.Checked
    $admin.UseSystemPasswordChar = $masked
    $adminConfirm.UseSystemPasswordChar = $masked
    $tune.UseSystemPasswordChar = $masked
    $tuneConfirm.UseSystemPasswordChar = $masked
})
$form.Controls.Add($show)

$status = Add-Label $form '' 24 394 420
$status.ForeColor = [Drawing.Color]::Firebrick

$save = [Windows.Forms.Button]::new()
$save.Text = 'Guardar contraseñas'
$save.Location = [Drawing.Point]::new(270, 430)
$save.Size = [Drawing.Size]::new(174, 38)
$save.Add_Click({
    $status.Text = ''
    if ($admin.Text.Length -lt 12) { $status.Text = 'La contraseña de administrador necesita 12 caracteres.'; return }
    if ($tune.Text.Length -lt 10) { $status.Text = 'La contraseña de sintonización necesita 10 caracteres.'; return }
    if ($admin.Text -ne $adminConfirm.Text) { $status.Text = 'La confirmación de administrador no coincide.'; return }
    if ($tune.Text -ne $tuneConfirm.Text) { $status.Text = 'La confirmación de sintonización no coincide.'; return }
    if ($admin.Text -eq $tune.Text) { $status.Text = 'Use dos contraseñas diferentes.'; return }
    try {
        $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
        $config.password.adminPass = $admin.Text
        $config.password.tunePass = $tune.Text
        $config.publicTuner = $false
        $json = $config | ConvertTo-Json -Depth 100
        [IO.File]::WriteAllText($configPath, $json, [Text.UTF8Encoding]::new($false))
        $check = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
        if ($check.password.adminPass -ne $admin.Text -or $check.password.tunePass -ne $tune.Text) { throw 'La verificación de escritura no coincide.' }
        $form.Tag = 'saved'
        [Windows.Forms.MessageBox]::Show("Contraseñas guardadas correctamente.`r`n`r`nReinicie FM-DX antes de iniciar sesión.`r`nEn la web, pulse el icono de llave e introduzca la contraseña correspondiente.", 'FM-DX', 'OK', 'Information') | Out-Null
        $form.Close()
    } catch {
        $status.Text = "Error al guardar: $($_.Exception.Message)"
    }
})
$form.Controls.Add($save)
$form.AcceptButton = $save

$cancel = [Windows.Forms.Button]::new()
$cancel.Text = 'Cancelar'
$cancel.Location = [Drawing.Point]::new(166, 430)
$cancel.Size = [Drawing.Size]::new(92, 38)
$cancel.Add_Click({ $form.Close() })
$form.Controls.Add($cancel)
$form.CancelButton = $cancel

[void]$form.ShowDialog()
if ($form.Tag -eq 'saved') { exit 0 }
exit 2