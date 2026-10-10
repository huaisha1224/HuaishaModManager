// 怀沙:图标多尺寸预览工具
// 用途:把 icon.ico 内嵌的每个尺寸(16/24/32/48/64/128)渲染成独立 PNG + 横向对比条
// 场景:每次改 generate-icon.cjs 后,跑这个肉眼验证小尺寸字符是否糊
// 跑法:node scripts/inspect-icon.cjs
// 输出:node_modules/.cache/icon-inspect/_preview-strip.png
const { execSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const TMP = path.join(__dirname, "node_modules", ".cache", "icon-inspect");
const PS1 = path.join(TMP, "_inspect.ps1");
mkdirSync(TMP, { recursive: true });

const psContent = `
Add-Type -AssemblyName System.Drawing
$outDir = '${TMP.replace(/\\/g, "\\\\")}'

$char = [char]0x6000
$colSandTop = [System.Drawing.Color]::FromArgb(255, 229, 166, 89)
$colSandBot = [System.Drawing.Color]::FromArgb(255, 199, 132, 58)
$colGrain = [System.Drawing.Color]::FromArgb(192, 255, 245, 220)
$colChar = [System.Drawing.Color]::FromArgb(244, 255, 255, 255)
$colStroke = [System.Drawing.Color]::FromArgb(31, 255, 255, 255)
$fontFamily = 'Microsoft YaHei'
try { (New-Object System.Drawing.Font($fontFamily, 12)).Dispose() } catch { $fontFamily = 'SimHei' }

$sizes = @(16, 24, 32, 48, 64, 128)
foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.PixelOffsetMode = 'HighQuality'
    $r = [Math]::Max(2, [int]($sz * 0.18))
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $p.AddArc($sz - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $p.AddArc($sz - $r * 2, $sz - $r * 2, $r * 2, $r * 2, 0, 90)
    $p.AddArc(0, $sz - $r * 2, $r * 2, $r * 2, 90, 90)
    $p.CloseFigure()
    $g.SetClip($p)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $sz, $sz
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $colSandTop, $colSandBot, 45)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
    $g.ResetClip()
    $penWidth = [Math]::Max(1, [int]($sz / 256))
    $pen = New-Object System.Drawing.Pen($colStroke, $penWidth)
    $g.DrawPath($pen, $p)
    $pen.Dispose()
    $p.Dispose()
    if ($sz -ge 32) {
        $dotR = [Math]::Max(2, [int]($sz * 0.04))
        $dotBrush = New-Object System.Drawing.SolidBrush($colGrain)
        $cxBase = [int]($sz * 0.76)
        $cyBase = [int]($sz * 0.20)
        $g.FillEllipse($dotBrush, $cxBase, $cyBase, $dotR, $dotR)
        $g.FillEllipse($dotBrush, $cxBase + $dotR * 2.5, $cyBase, $dotR, $dotR)
        $g.FillEllipse($dotBrush, $cxBase, $cyBase + $dotR * 2.5, $dotR, $dotR)
        $dotBrush.Dispose()
    }
    if ($sz -le 24) { $fontSize = [int]($sz * 0.50) } else { $fontSize = [int]($sz * 0.62) }
    $fontSize = [Math]::Max(6, $fontSize)
    $font = New-Object System.Drawing.Font($fontFamily, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush($colChar)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $textRect = New-Object System.Drawing.RectangleF 0, 0, $sz, $sz
    $g.DrawString($char, $font, $textBrush, $textRect, $sf)
    $font.Dispose()
    $textBrush.Dispose()
    $sf.Dispose()
    $g.Dispose()
    $bmp.Save((Join-Path $outDir ("icon-" + $sz + ".png")), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# 拼接成预览条(横向:16/24/32/48/64/128 真实像素,每个 128px 大格内显示)
$previewBmp = New-Object System.Drawing.Bitmap 1024, 256
$pg = [System.Drawing.Graphics]::FromImage($previewBmp)
$pg.Clear([System.Drawing.Color]::FromArgb(255, 240, 240, 240))
$pg.TextRenderingHint = 'AntiAliasGridFit'
$x = 0
foreach ($sz in $sizes) {
    $bmp = [System.Drawing.Image]::FromFile((Join-Path $outDir ("icon-" + $sz + ".png")))
    $pg.DrawImage($bmp, $x + 32, 32, 128, 128)
    $labelFont = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $pg.DrawString(($sz.ToString() + "px"), $labelFont, [System.Drawing.Brushes]::Black, ($x + 64), 180)
    $labelFont.Dispose()
    $bmp.Dispose()
    $x += 160
}
$previewBmp.Save((Join-Path $outDir "_preview-strip.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$previewBmp.Dispose()
$pg.Dispose()
Write-Host "Done"
`;

writeFileSync(PS1, psContent, "utf8");
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS1}"`, { stdio: "inherit" });
console.log(`[inspect] PNGs + preview strip saved to ${TMP}`);