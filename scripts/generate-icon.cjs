// 怀沙:用 PowerShell + .NET 生成多张 PNG,Node 写 ICO 容器
// 设计:A · 怀字 + 沙色渐变(参见 resources/icon-master.svg)
//
// 依赖:仅 Windows + .NET Framework
// 跑法:node scripts/generate-icon.cjs
const { spawnSync } = require("node:child_process");
const { writeFileSync, readdirSync, unlinkSync, mkdirSync, rmdirSync } = require("node:fs");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..");
const TMP = path.join(APP_ROOT, "node_modules", ".cache", "icon-build");
const ICO_OUT = path.join(APP_ROOT, "resources", "icon.ico");
const PNG_MASTER = path.join(APP_ROOT, "resources", "icon.png");
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const MASTER_SIZE = 512;

// "怀" 字的 Unicode 码点(避免 PS 字符串里直接放中文导致的编码/转义问题)
// 重要:U+6000 = 怀(huái,品牌名),不是 U+5B5D(那是"孝",容易混淆)
const HUA_CHAR_CODE = 0x6000;
// PowerShell 解析 [16,24,...] 会当成类型字面量,需要元素间空格 + 强制 0x 前缀
const PS_SIZES = SIZES.map(s => `${s}`).join(", ");
const PS_HEX_CHAR = "0x" + HUA_CHAR_CODE.toString(16);

mkdirSync(TMP, { recursive: true });

const ps = `
Add-Type -AssemblyName System.Drawing

\$sizes = @( ${PS_SIZES} )
\$masterSize = ${MASTER_SIZE}
\$outDir = '${TMP.replace(/\\/g, "\\\\")}'
\$pngMasterPath = '${PNG_MASTER.replace(/\\/g, "\\\\")}'

# ---- 颜色常量 ----
\$colSandTop   = [System.Drawing.Color]::FromArgb(255, 229, 166, 89)   # #E5A659 沙色
\$colSandBot   = [System.Drawing.Color]::FromArgb(255, 199, 132, 58)   # #C7843A 深沙
\$colGrain     = [System.Drawing.Color]::FromArgb(192, 255, 245, 220)  # #FFF5DC 浅沙(mod 沙粒)
\$colChar      = [System.Drawing.Color]::FromArgb(244, 255, 255, 255) # 怀字主色(白,带半透)
\$colStroke    = [System.Drawing.Color]::FromArgb(31, 255, 255, 255)   # 内描边(白 12% 不透明)

# 中文字符(用 char 码点避免字符串编码问题)
\$char = [char]${PS_HEX_CHAR}

# 字体优先:微软雅黑 → 黑体 → Segoe UI(后者不保证 CJK 渲染)
\$fontFamily = 'Microsoft YaHei'
try {
    \$testFont = New-Object System.Drawing.Font(\$fontFamily, 12)
    \$testFont.Dispose()
} catch {
    \$fontFamily = 'SimHei'
}

function Draw-HuaIcon(\$bmp) {
    \$sz = \$bmp.Width
    \$g = [System.Drawing.Graphics]::FromImage(\$bmp)
    \$g.SmoothingMode = 'AntiAlias'
    \$g.InterpolationMode = 'HighQualityBicubic'
    \$g.TextRenderingHint = 'AntiAliasGridFit'
    \$g.PixelOffsetMode = 'HighQuality'
    \$g.Clear([System.Drawing.Color]::Transparent)

    # ---- 1. 圆角矩形路径(裁切用, 半径 = 边长 18%) ----
    \$r = [Math]::Max(2, [int](\$sz * 0.18))
    \$path = New-Object System.Drawing.Drawing2D.GraphicsPath
    \$path.AddArc(0, 0, \$r * 2, \$r * 2, 180, 90)
    \$path.AddArc(\$sz - \$r * 2, 0, \$r * 2, \$r * 2, 270, 90)
    \$path.AddArc(\$sz - \$r * 2, \$sz - \$r * 2, \$r * 2, \$r * 2, 0, 90)
    \$path.AddArc(0, \$sz - \$r * 2, \$r * 2, \$r * 2, 90, 90)
    \$path.CloseFigure()

    \$g.SetClip(\$path)

    # ---- 2. 沙色 45° 线性渐变背景 ----
    \$rect = New-Object System.Drawing.Rectangle 0, 0, \$sz, \$sz
    \$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(\$rect, \$colSandTop, \$colSandBot, 45)
    \$g.FillRectangle(\$brush, \$rect)
    \$brush.Dispose()

    \$g.ResetClip()

    # ---- 3. 内描边(白色 12% 不透明,提升精致感) ----
    \$penWidth = [Math]::Max(1, [int](\$sz / 256))
    \$pen = New-Object System.Drawing.Pen(\$colStroke, \$penWidth)
    \$g.DrawPath(\$pen, \$path)
    \$pen.Dispose()
    \$path.Dispose()

    # ---- 4. 右上角 3 颗"mod 沙粒"小点(仅 >= 32px 画,小尺寸易糊) ----
    if (\$sz -ge 32) {
        \$dotR = [Math]::Max(2, [int](\$sz * 0.04))
        \$dotBrush = New-Object System.Drawing.SolidBrush(\$colGrain)
        \$cxBase = [int](\$sz * 0.76)
        \$cyBase = [int](\$sz * 0.20)
        \$g.FillEllipse(\$dotBrush, \$cxBase, \$cyBase, \$dotR, \$dotR)
        \$g.FillEllipse(\$dotBrush, \$cxBase + \$dotR * 2.5, \$cyBase, \$dotR, \$dotR)
        \$g.FillEllipse(\$dotBrush, \$cxBase, \$cyBase + \$dotR * 2.5, \$dotR, \$dotR)
        \$dotBrush.Dispose()
    }

    # ---- 5. 居中"怀"字 ----
    # 小尺寸(<=24px)字符容易糊到边,字号比例降到 0.50 留更多 padding
    if (\$sz -le 24) {
        \$fontSize = [int](\$sz * 0.50)
    } else {
        \$fontSize = [int](\$sz * 0.62)
    }
    if (\$fontSize -lt 6) { \$fontSize = 6 }
    \$font = New-Object System.Drawing.Font(\$fontFamily, \$fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    \$textBrush = New-Object System.Drawing.SolidBrush(\$colChar)
    \$sf = New-Object System.Drawing.StringFormat
    \$sf.Alignment = 'Center'
    \$sf.LineAlignment = 'Center'
    \$textRect = New-Object System.Drawing.RectangleF 0, 0, \$sz, \$sz
    \$g.DrawString(\$char, \$font, \$textBrush, \$textRect, \$sf)
    \$font.Dispose()
    \$textBrush.Dispose()
    \$sf.Dispose()
    \$g.Dispose()
}

# ---- 主流程 ----
foreach (\$sz in \$sizes) {
    \$bmp = New-Object System.Drawing.Bitmap \$sz, \$sz
    Draw-HuaIcon \$bmp
    \$pngPath = Join-Path \$outDir ("icon-" + \$sz + ".png")
    \$bmp.Save(\$pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    \$bmp.Dispose()
}

# 额外生成 512×512 主图(关于页面 / 文档展示用)
\$master = New-Object System.Drawing.Bitmap \$masterSize, \$masterSize
Draw-HuaIcon \$master
\$master.Save(\$pngMasterPath, [System.Drawing.Imaging.ImageFormat]::Png)
\$master.Dispose()

Write-Host ("Wrote {0} ICO PNG files + 1 master PNG ({1}x{1}) to {2}" -f \$sizes.Count, \$masterSize, \$outDir)
`;

const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("[icon-gen] PowerShell 渲染失败");
  process.exit(r.status ?? 1);
}

// ---- Node 拼 ICO 容器(纯 Buffer 操作,字节序可控) ----
const pngs = SIZES.map((sz) => {
  const p = path.join(TMP, `icon-${sz}.png`);
  const buf = require("node:fs").readFileSync(p);
  return { sz, buf };
});

const HEADER = 6;
const ENTRY = 16;
let dataOffset = HEADER + ENTRY * SIZES.length;

const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0);   // reserved
header.writeUInt16LE(1, 2);   // type = ICO
header.writeUInt16LE(SIZES.length, 4);
let out = Buffer.concat([header]);

const entryBuf = Buffer.alloc(ENTRY * SIZES.length);
pngs.forEach((p, i) => {
  const e = i * ENTRY;
  entryBuf.writeUInt8(p.sz >= 256 ? 0 : p.sz, e + 0);
  entryBuf.writeUInt8(p.sz >= 256 ? 0 : p.sz, e + 1);
  entryBuf.writeUInt8(0, e + 2);                   // color count
  entryBuf.writeUInt8(0, e + 3);                   // reserved
  entryBuf.writeUInt16LE(1, e + 4);                // planes
  entryBuf.writeUInt16LE(32, e + 6);               // bpp
  entryBuf.writeUInt32LE(p.buf.length, e + 8);     // size
  entryBuf.writeUInt32LE(dataOffset, e + 12);      // offset
  dataOffset += p.buf.length;
});
out = Buffer.concat([out, entryBuf]);

pngs.forEach((p) => { out = Buffer.concat([out, p.buf]); });

writeFileSync(ICO_OUT, out);
console.log(`[icon-gen] Wrote ${ICO_OUT} (${out.length} bytes, ${SIZES.length} sizes: ${SIZES.join(", ")})`);
console.log(`[icon-gen] Wrote ${PNG_MASTER} (${MASTER_SIZE}x${MASTER_SIZE})`);

// cleanup
for (const f of readdirSync(TMP)) unlinkSync(path.join(TMP, f));
rmdirSync(TMP);