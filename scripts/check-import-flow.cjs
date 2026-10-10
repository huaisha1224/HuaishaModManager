const AdmZip = require("adm-zip");
const { cp, mkdir, readdir, readFile, rm, writeFile } = require("node:fs/promises");
const { mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { basename, dirname, join, relative } = require("node:path");

const COVER_FILE_NAMES = new Set([
  "icon.png",
  "cover.png",
  "cover.jpg",
  "cover.jpeg",
  "cover.webp",
  "preview.png",
  "preview.jpg",
  "preview.jpeg",
  "preview.webp",
  "thumbnail.png",
  "thumbnail.jpg",
  "thumbnail.webp"
]);

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

function firstString(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return value.split(/[,，\s]+/u).map((item) => item.trim()).filter(Boolean);
  return [];
}

function smapiDependencyIds(value) {
  if (!Array.isArray(value)) return stringArray(value);

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return firstString(item.UniqueID, item.uniqueId, item.id, item.name);
      }
      return "";
    })
    .filter(Boolean);
}

async function readManifest(rootPath, files) {
  const manifestPath = files.find((file) => basename(file).toLowerCase() === "manifest.json");
  if (!manifestPath) return {};

  const raw = await readFile(join(rootPath, manifestPath), "utf-8");
  const manifest = JSON.parse(raw);
  const contentPackFor = manifest.ContentPackFor && typeof manifest.ContentPackFor === "object"
    ? manifest.ContentPackFor
    : manifest.contentPackFor && typeof manifest.contentPackFor === "object"
      ? manifest.contentPackFor
      : {};
  const contentPackForId = firstString(contentPackFor.UniqueID, contentPackFor.uniqueId, contentPackFor.id);
  const dependencies = smapiDependencyIds(manifest.Dependencies ?? manifest.dependencies);

  return {
    name: firstString(manifest.Name, manifest.name, manifest.title, manifest.modName, manifest.displayName),
    version: firstString(manifest.Version, manifest.version, manifest.modVersion),
    author: firstString(manifest.Author, manifest.author, manifest.modAuthor),
    website: firstString(manifest.Website, manifest.website, manifest.homepage, manifest.url, manifest.nexusUrl),
    description: firstString(manifest.Description, manifest.description, manifest.summary),
    tags: stringArray(manifest.Tags ?? manifest.tags),
    requirements: [...new Set([
      contentPackForId,
      ...stringArray(manifest.requirements),
      ...dependencies,
      ...stringArray(manifest.deps)
    ].filter(Boolean))]
  };
}

function findCoverImage(files) {
  return files.find((file) => COVER_FILE_NAMES.has(basename(file).toLowerCase())) ?? "";
}

async function importFolderLikeMain(sourcePath, storagePath, gameName, modId) {
  const modRoot = join(storagePath, "mods", gameName, modId);
  await mkdir(modRoot, { recursive: true });
  await cp(sourcePath, modRoot, { recursive: true, force: true, errorOnExist: false });
  const files = await listFiles(modRoot);

  return {
    rootPath: modRoot,
    files,
    manifest: await readManifest(modRoot, files),
    coverImage: findCoverImage(files)
  };
}

async function importZipLikeMain(sourcePath, storagePath, gameName, modId) {
  const modRoot = join(storagePath, "mods", gameName, modId);
  const zip = new AdmZip(sourcePath);
  await mkdir(modRoot, { recursive: true });

  for (const entry of zip.getEntries()) {
    const target = join(modRoot, entry.entryName);
    if (entry.isDirectory) {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.getData());
    }
  }

  const files = await listFiles(modRoot);

  return {
    rootPath: modRoot,
    files,
    manifest: await readManifest(modRoot, files),
    coverImage: findCoverImage(files)
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "mayfly-import-check-"));

  try {
    const storagePath = join(root, "storage");
    const sourceFolder = join(root, "source-folder");
    await mkdir(join(sourceFolder, "assets"), { recursive: true });
    await writeFile(join(sourceFolder, "manifest.json"), JSON.stringify({
      Name: "Folder Mod",
      Version: "1.2.3",
      Author: "Mayfly",
      ContentPackFor: { UniqueID: "Pathoschild.ContentPatcher" },
      Dependencies: [{ UniqueID: "spacechase0.GenericModConfigMenu" }]
    }), "utf-8");
    await writeFile(join(sourceFolder, "cover.png"), "cover", "utf-8");
    await writeFile(join(sourceFolder, "assets", "content.json"), "{}", "utf-8");

    const folderResult = await importFolderLikeMain(sourceFolder, storagePath, "Stardew Valley", "1");
    assert(folderResult.manifest.name === "Folder Mod", "文件夹导入未读取 manifest 名称。");
    assert(folderResult.coverImage === "cover.png", "文件夹导入未识别封面。");
    assert(folderResult.manifest.requirements.includes("Pathoschild.ContentPatcher"), "未识别 ContentPackFor 前置。");
    assert(folderResult.manifest.requirements.includes("spacechase0.GenericModConfigMenu"), "未识别 SMAPI Dependencies 前置。");

    const zipPath = join(root, "source.zip");
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
      Name: "Zip Mod",
      Version: "2.0.0",
      Author: "Mayfly"
    }), "utf-8"));
    zip.addFile("thumbnail.jpg", Buffer.from("cover", "utf-8"));
    zip.addFile("nativePC/file.bin", Buffer.from("data", "utf-8"));
    zip.writeZip(zipPath);

    const zipResult = await importZipLikeMain(zipPath, storagePath, "Monster Hunter World", "2");
    assert(zipResult.manifest.name === "Zip Mod", "zip 导入未读取 manifest 名称。");
    assert(zipResult.coverImage === "thumbnail.jpg", "zip 导入未识别封面。");
    assert(zipResult.files.includes("nativePC/file.bin"), "zip 导入未解压文件。");

    console.log("导入流程样例: 2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
