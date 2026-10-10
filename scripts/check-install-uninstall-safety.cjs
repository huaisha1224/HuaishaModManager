const { cp, mkdir, readdir, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { basename, dirname, isAbsolute, join, relative, resolve } = require("node:path");

const PASS_FILE_NAMES = new Set(["readme.md", "manifest.json", "icon.png", "changelog.md", "license"]);

async function listFiles(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = join(currentPath, entry.name);
      if (entry.isDirectory()) return listFiles(rootPath, nextPath);
      return [relative(rootPath, nextPath).replace(/\\/g, "/")];
    })
  );

  return files.flat();
}

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

function isPassFile(filePath) {
  return PASS_FILE_NAMES.has(basename(filePath).toLowerCase());
}

function normalizePathParts(filePath) {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

async function isDirectoryEmpty(folderPath) {
  try {
    return (await readdir(folderPath)).length === 0;
  } catch {
    return false;
  }
}

async function deleteEmptyParents(gamePath, startFolder) {
  let current = startFolder;

  while (isPathInside(gamePath, current) && resolve(current) !== resolve(gamePath)) {
    if (!(await isDirectoryEmpty(current))) return;
    await rm(current, { force: true, recursive: true });
    current = dirname(current);
  }
}

async function deleteRelativeFiles(gamePath, files) {
  const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))]
    .sort((left, right) => normalizePathParts(right).length - normalizePathParts(left).length);

  for (const file of uniqueFiles) {
    const target = safeJoin(gamePath, file);
    await rm(target, { force: true, recursive: true });
    await deleteEmptyParents(gamePath, dirname(target));
  }
}

async function copyOrRemoveFile(source, target, isInstall, gamePath, useSymlink = false) {
  const deployedFile = relative(gamePath, target).replace(/\\/g, "/");
  safeJoin(gamePath, deployedFile);

  if (isInstall) {
    if (existsSync(target)) {
      throw new Error(`目标文件已存在，已阻止覆盖：${deployedFile}`);
    }

    await mkdir(dirname(target), { recursive: true });
    if (useSymlink) {
      await symlink(source, target, "file");
    } else {
      await cp(source, target, { force: true, errorOnExist: false });
    }
    return [deployedFile];
  }

  await rm(target, { force: true });
  await deleteEmptyParents(gamePath, dirname(target));
  return [];
}

async function applyGeneralStrategy(options) {
  const files = await listFiles(options.modRoot);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    deployedFiles.push(
      ...(await copyOrRemoveFile(
        join(options.modRoot, file),
        join(targetRoot, options.keepPath ? file : basename(file)),
        options.isInstall,
        options.gamePath,
        options.useSymlink
      ))
    );
  }

  return deployedFiles;
}

async function applyFolderRootStrategy(options) {
  const target = safeJoin(options.gamePath, options.installPath || ".", options.targetFolderName || basename(options.modRoot));
  const deployedFolder = relative(options.gamePath, target).replace(/\\/g, "/");

  if (options.isInstall) {
    if (existsSync(target)) {
      if (!options.useSymlink) throw new Error(`目标目录已存在，已阻止覆盖：${deployedFolder}`);
      await rm(target, { recursive: true, force: true });
    }

    await mkdir(dirname(target), { recursive: true });
    if (options.useSymlink) {
      await symlink(options.modRoot, target, process.platform === "win32" ? "junction" : "dir");
    } else {
      await cp(options.modRoot, target, { recursive: true, force: true, errorOnExist: false });
    }
    return [deployedFolder];
  }

  await rm(target, { recursive: true, force: true });
  await deleteEmptyParents(options.gamePath, dirname(target));
  return [];
}

async function assertFile(path, expected) {
  const actual = await readFile(path, "utf-8");
  if (actual !== expected) throw new Error(`文件内容不符合预期：${path}`);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "mayfly-install-check-"));

  try {
    const gamePath = join(root, "game");
    const modRoot = join(root, "mod");
    await mkdir(join(gamePath, "archive", "pc", "mod"), { recursive: true });
    await mkdir(join(modRoot, "archive", "pc", "mod"), { recursive: true });
    await writeFile(join(gamePath, "archive", "pc", "mod", "keep.archive"), "keep", "utf-8");
    await writeFile(join(modRoot, "archive", "pc", "mod", "new.archive"), "new", "utf-8");
    await writeFile(join(modRoot, "manifest.json"), "skip", "utf-8");

    const deployed = await applyGeneralStrategy({
      modRoot,
      gamePath,
      installPath: "archive/pc/mod",
      keepPath: false,
      isInstall: true
    });

    if (deployed.includes("archive/pc/mod/manifest.json")) {
      throw new Error("安装时不应部署 manifest.json。");
    }
    await assertFile(join(gamePath, "archive", "pc", "mod", "new.archive"), "new");
    await assertFile(join(gamePath, "archive", "pc", "mod", "keep.archive"), "keep");

    await deleteRelativeFiles(gamePath, deployed);
    if (existsSync(join(gamePath, "archive", "pc", "mod", "new.archive"))) {
      throw new Error("按部署记录卸载后，Mod 文件仍然存在。");
    }
    await assertFile(join(gamePath, "archive", "pc", "mod", "keep.archive"), "keep");

    const folderModRoot = join(root, "folder-mod");
    await mkdir(folderModRoot, { recursive: true });
    await writeFile(join(folderModRoot, "content.txt"), "folder", "utf-8");
    const folderDeployed = await applyFolderRootStrategy({
      modRoot: folderModRoot,
      gamePath,
      installPath: "Mods",
      targetFolderName: "My Mod",
      isInstall: true,
      useSymlink: true
    });

    if (folderDeployed[0] !== "Mods/My Mod") {
      throw new Error("目录 Mod 部署记录不正确。");
    }
    await assertFile(join(gamePath, "Mods", "My Mod", "content.txt"), "folder");
    await deleteRelativeFiles(gamePath, folderDeployed);
    if (existsSync(join(gamePath, "Mods", "My Mod"))) {
      throw new Error("目录软链卸载后目标目录仍然存在。");
    }

    console.log("安装/卸载安全样例: 3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
