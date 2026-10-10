const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, relative } = require("node:path");
const { readdir } = require("node:fs/promises");

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

async function createFiles(rootPath, files) {
  for (const file of files) {
    const target = join(rootPath, file);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "test", "utf-8");
  }
}

async function main() {
  const { createServer } = await import("vite");
  const root = await mkdtemp(join(tmpdir(), "mayfly-real-mod-check-"));
  const projectRoot = join(__dirname, "..");
  const server = await createServer({
    configFile: false,
    root: projectRoot,
    appType: "custom",
    logLevel: "error",
    resolve: {
      alias: {
        "@": join(projectRoot, "src")
      }
    },
    server: {
      middlewareMode: true
    }
  });

  try {
    const { getGameAdapter } = await server.ssrLoadModule("/src/adapters/index.ts");
    const cases = [
      {
        presetId: "cyberpunk2077",
        name: "Cyberpunk 2077 archive",
        files: ["archive/pc/mod/test.archive"],
        expected: "archive"
      },
      {
        presetId: "stellarblade",
        name: "Unreal pak",
        files: ["SB/Content/Paks/~mods/test.pak"],
        expected: "pak"
      },
      {
        presetId: "riskofrain2",
        name: "Unity BepInEx",
        files: ["BepInEx/plugins/TestPlugin.dll"],
        expected: "plugins"
      }
    ];
    const failures = [];

    for (const testCase of cases) {
      const modRoot = join(root, testCase.presetId);
      await createFiles(modRoot, testCase.files);
      const files = await listFiles(modRoot);
      const actual = getGameAdapter(testCase.presetId).checkModType(files);

      if (actual !== testCase.expected) {
        failures.push(`${testCase.name}: 期望 ${testCase.expected}, 实际 ${actual}`);
      }
    }

    console.log(`真实 Mod 文件夹样例: ${cases.length}`);

    if (failures.length > 0) {
      for (const failure of failures) console.error(failure);
      process.exitCode = 1;
    }
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
