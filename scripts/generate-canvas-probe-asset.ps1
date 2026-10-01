$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetDirectory = Join-Path $PSScriptRoot '..\miniprogram\assets\flowers'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
$outputPath = Join-Path $assetDirectory 'anthurium.png'
$bitmap = New-Object System.Drawing.Bitmap(384, 480, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
$graphics.Clear([System.Drawing.Color]::Transparent)

$stemPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 76, 99, 78), 7)
$stemPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$stemPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$leafBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 91, 119, 91))
$leafLightBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 126, 151, 116))
$leafVeinPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(205, 183, 194, 151), 2)
$coralBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(248, 196, 117, 99))
$coralShadeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(190, 163, 76, 72))
$veinPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(190, 255, 222, 194), 3)
$spadixPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 226, 194, 129), 12)
$spadixTipBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 241, 216, 159))

# Stems and two leaves sit behind the spathe.
$graphics.DrawBezier($stemPen, 193, 464, 210, 396, 200, 321, 205, 242)
$graphics.DrawBezier($stemPen, 201, 387, 152, 343, 116, 331, 78, 292)
$graphics.DrawBezier($stemPen, 205, 366, 243, 324, 279, 312, 316, 273)

$leftLeaf = New-Object System.Drawing.Drawing2D.GraphicsPath
$leftLeaf.AddBezier(111, 335, 61, 329, 45, 283, 57, 238)
$leftLeaf.AddBezier(57, 238, 100, 251, 143, 282, 157, 326)
$leftLeaf.AddBezier(157, 326, 143, 346, 126, 344, 111, 335)
$leftLeaf.CloseFigure()
$graphics.FillPath($leafBrush, $leftLeaf)
$graphics.DrawBezier($leafVeinPen, 60, 244, 82, 277, 118, 309, 150, 326)

$rightLeaf = New-Object System.Drawing.Drawing2D.GraphicsPath
$rightLeaf.AddBezier(247, 331, 270, 274, 318, 245, 352, 252)
$rightLeaf.AddBezier(352, 252, 350, 299, 318, 343, 263, 348)
$rightLeaf.AddBezier(263, 348, 253, 343, 249, 337, 247, 331)
$rightLeaf.CloseFigure()
$graphics.FillPath($leafLightBrush, $rightLeaf)
$graphics.DrawBezier($leafVeinPen, 348, 257, 322, 291, 291, 319, 258, 341)

# A single stylised anthurium keeps the cutout shape readable at editor scale.
$spathe = New-Object System.Drawing.Drawing2D.GraphicsPath
$spathe.AddBezier(198, 251, 154, 218, 138, 163, 164, 111)
$spathe.AddBezier(164, 111, 186, 70, 239, 60, 257, 109)
$spathe.AddBezier(257, 109, 283, 151, 251, 207, 216, 248)
$spathe.AddBezier(216, 248, 211, 255, 204, 256, 198, 251)
$spathe.CloseFigure()
$graphics.FillPath($coralBrush, $spathe)

$shade = New-Object System.Drawing.Drawing2D.GraphicsPath
$shade.AddBezier(210, 247, 231, 204, 259, 154, 251, 113)
$shade.AddBezier(251, 113, 277, 152, 247, 205, 216, 248)
$shade.AddBezier(216, 248, 214, 251, 212, 251, 210, 247)
$shade.CloseFigure()
$graphics.FillPath($coralShadeBrush, $shade)
$graphics.DrawBezier($veinPen, 202, 239, 201, 198, 193, 164, 180, 124)
$graphics.DrawBezier($spadixPen, 205, 237, 206, 203, 207, 160, 211, 116)
$graphics.FillEllipse($spadixTipBrush, 201, 103, 20, 24)

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

$loaded = New-Object System.Drawing.Bitmap($outputPath)
if ($loaded.GetPixel(0, 0).A -ne 0 -or $loaded.GetPixel(190, 200).A -eq 0) {
  throw 'The probe asset failed its transparent-background check.'
}
Write-Output ('Created transparent flower material: ' + $outputPath)
Write-Output ('Dimensions: ' + $loaded.Width + 'x' + $loaded.Height + '; corner alpha: ' + $loaded.GetPixel(0, 0).A)
$loaded.Dispose()
