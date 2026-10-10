const { resolve } = require("node:path");

async function main() {
  const { createServer } = await import("vite");
  const root = resolve(__dirname, "..");
  const server = await createServer({
    configFile: false,
    root,
    appType: "custom",
    logLevel: "error",
    resolve: {
      alias: {
        "@": resolve(root, "src")
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
        presetId: "stardewvalley",
        name: "星露谷 SMAPI",
        files: ["SMAPI.Installer.dll", "install.exe"],
        expected: "smapi"
      },
      {
        presetId: "stardewvalley",
        name: "星露谷普通 Mod",
        files: ["manifest.json", "assets/content.json"],
        expected: "mods"
      },
      {
        presetId: "monsterhunterworld",
        name: "怪猎世界 Stracker",
        files: ["dtdata.dll", "loader.dll"],
        expected: "stracker"
      },
      {
        presetId: "monsterhunterworld",
        name: "怪猎世界 nativePC",
        files: ["nativePC/pl/f_equip/pl001_0000/mod.bin"],
        expected: "nativePc"
      },
      {
        presetId: "monsterhunterworld",
        name: "怪猎世界插件",
        files: ["some-plugin.dll"],
        expected: "plugins"
      },
      {
        presetId: "taleofimmortal",
        name: "鬼谷八荒通用",
        files: ["ModExportData.cache", "ModExportData.json"],
        expected: "modExportData"
      },
      {
        presetId: "stellarblade",
        name: "剑星 pak",
        files: ["SB/Content/Paks/~mods/mod.pak"],
        expected: "pak"
      },
      {
        presetId: "stellarblade",
        name: "剑星 LogicMods",
        files: ["SB/Content/Paks/LogicMods/mod.pak"],
        expected: "logicMods"
      },
      {
        presetId: "stellarblade",
        name: "剑星 UE4SS",
        files: ["SB/Binaries/Win64/dwmapi.dll", "ue4ss/UE4SS.dll"],
        expected: "ue4ss"
      }
    ];

    const failures = [];

    for (const testCase of cases) {
      const adapter = getGameAdapter(testCase.presetId);
      const actual = adapter.checkModType(testCase.files);

      if (actual !== testCase.expected) {
        failures.push(`${testCase.name}: 期望 ${testCase.expected}, 实际 ${actual}`);
      }
    }

    console.log(`adapter 识别样例: ${cases.length}`);

    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(failure);
      }
      process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
