const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join, relative, resolve, isAbsolute } = require("node:path");
const AdmZip = require("adm-zip");

function isPathInside(rootPath, targetPath) {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const rel = relative(root, target);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function safeJoin(rootPath, ...paths) {
  const target = join(rootPath, ...paths);

  if (!isPathInside(rootPath, target)) {
    throw new Error(`目标路径超出允许目录：${target}`);
  }

  return target;
}

async function extractZipLikeMain(sourcePath, targetPath) {
  const zip = new AdmZip(sourcePath);

  for (const entry of zip.getEntries()) {
    const entryTarget = safeJoin(targetPath, entry.entryName);

    if (entry.isDirectory) {
      await mkdir(entryTarget, { recursive: true });
    } else {
      await mkdir(dirname(entryTarget), { recursive: true });
      await writeFile(entryTarget, entry.getData());
    }
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "mayfly-archive-check-"));

  try {
    const validZipPath = join(root, "valid.zip");
    const validTarget = join(root, "valid-target");
    const validZip = new AdmZip();
    validZip.addFile("manifest.json", Buffer.from("{\"Name\":\"Test Mod\"}", "utf-8"));
    validZip.addFile("assets/file.txt", Buffer.from("ok", "utf-8"));
    validZip.writeZip(validZipPath);

    await extractZipLikeMain(validZipPath, validTarget);

    const extracted = await readFile(join(validTarget, "assets", "file.txt"), "utf-8");
    if (extracted !== "ok") {
      throw new Error("正常 zip 解压结果不正确。");
    }

    let blocked = false;
    try {
      safeJoin(join(root, "evil-target"), "../evil.txt");
    } catch (error) {
      blocked = /超出允许目录/u.test(error.message);
    }

    if (!blocked) {
      throw new Error("路径穿越 zip 没有被阻止。");
    }

    console.log("压缩包导入安全样例: 2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
