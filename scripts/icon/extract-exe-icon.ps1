# 验证辅助:通过 shell API 提取 exe 内嵌图标(即资源管理器实际渲染的帧),保存为 PNG。
# 用法: powershell -File scripts/icon/extract-exe-icon.ps1 -Exe <path.exe> -Out <path.png> [-Size 256]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Size = 256
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShellIcon {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHDefExtractIcon(string iconFile, int iconIndex, uint flags, out IntPtr hIconLarge, out IntPtr hIconSmall, uint size);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
'@

$large = [IntPtr]::Zero
$small = [IntPtr]::Zero
$hr = [ShellIcon]::SHDefExtractIcon((Resolve-Path $Exe).Path, 0, 0, [ref]$large, [ref]$small, [uint32]$Size)
if ($hr -ne 0 -or $large -eq [IntPtr]::Zero) { throw "SHDefExtractIcon failed: hr=$hr" }
try {
  $icon = [System.Drawing.Icon]::FromHandle($large)
  $bmp = $icon.ToBitmap()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  "extracted $($bmp.Width)x$($bmp.Height) -> $Out"
  $bmp.Dispose()
  $icon.Dispose()
} finally {
  [void][ShellIcon]::DestroyIcon($large)
  if ($small -ne [IntPtr]::Zero) { [void][ShellIcon]::DestroyIcon($small) }
}
