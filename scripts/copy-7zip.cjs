// 怀沙:把 7-Zip 26.03 (7z.exe + 7z.dll + License.txt) 拷到 resources/win-x64/7zip/
//
// 关键:必须拷 7z.exe (GUI launcher),不是 7za.exe (standalone CLI)
// 7-Zip 26.x 起 7za.exe (CLI standalone) 不再带 RAR 解码器(只有 7z.exe + 7z.dll 才有)
// 7zip-bin npm 包 5.2.0 停在 21.07,某些 RAR5 变种不能解 ——
// 用户机器可能没装 7-Zip,所以打包进 app 自带兜底
//
// 跑法:手动跑一次(把 26.03 extra 或完整版装到系统后再跑)。后续 npm run build / dist 不依赖这个脚本。
const { cpSync, mkdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");

// 从系统安装位置拷(已装 7-Zip 26.03 GUI 版,7z.exe + 7z.dll)
const sourceDir = "C:\\Program Files\\7-Zip";
const licenseSource = "H:\\tools\\Download\\浏览器默认下载\\7z2603-extra";
const target = join(__dirname, "..", "resources", "win-x64", "7zip");

if (!existsSync(join(sourceDir, "7z.exe"))) {
  console.error(`source not found: ${join(sourceDir, "7z.exe")}`);
  console.error("请先在系统安装 7-Zip 26+ GUI 版,再跑这个脚本。");
  process.exit(1);
}

mkdirSync(target, { recursive: true });

// 主二进制
cpSync(join(sourceDir, "7z.exe"), join(target, "7z.exe"));
console.log("copied: 7z.exe");
cpSync(join(sourceDir, "7z.dll"), join(target, "7z.dll"));
console.log("copied: 7z.dll");
// License.txt 从 extra 包(根目录有)
if (existsSync(join(licenseSource, "License.txt"))) {
  cpSync(join(licenseSource, "License.txt"), join(target, "License.txt"));
  console.log("copied: License.txt");
}

console.log(`done. target: ${target}`);