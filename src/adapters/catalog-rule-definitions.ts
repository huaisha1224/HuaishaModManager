import type { GameAdapter, InstallStrategy, InstallTargetScope, ModTypeRule } from "@/types/domain";
import { hasExtension, hasFile, hasPathPart } from "@/adapters/utils";

const ARMORED_CORE_6_DICTIONARY = "resources/ArmoredCore6Dictionary.txt";
const SEKIRO_DICTIONARY = "resources/SekiroDictionary.txt";

type DetectKind = "extension" | "fileName" | "pathPart";

interface DetectRule {
  typeId: string;
  kind: DetectKind;
  value: string;
}

interface CatalogRuleDefinition {
  name: string;
  modTypes: ModTypeRule[];
  detect: DetectRule[];
  // BUG-010(2026-10-03):game-specific 扫描扩展名白名单(覆盖默认 SCAN_MOD_FILE_EXTENSIONS)
  //   巫师 3 ScriptStudio mod 主要用 .bundle(REDengine 数据包) + .ws(WitcherScript)
  //   默认白名单只有 .pak/.dll/.lua/.uasset/.uexp,不识别这两个 → mod 被静默跳过
  scanExtensions?: string[];
}

function withScope<T extends InstallStrategy>(strategy: T, targetScope?: InstallTargetScope): T {
  return targetScope ? { ...strategy, targetScope } : strategy;
}

function manual(id = "99", name = "未知", reason = "该类型暂未实现自动安装，请手动处理。"): ModTypeRule {
  return { id, name, install: { kind: "manual", reason } };
}

function general(id: string, name: string, installPath = "", keepPath = true, targetScope?: InstallTargetScope): ModTypeRule {
  return { id, name, install: withScope({ kind: "general", installPath, keepPath }, targetScope) };
}

function folder(
  id: string,
  name: string,
  installPath: string,
  folderName: string | string[],
  spare = true,
  targetScope?: InstallTargetScope
): ModTypeRule {
  return { id, name, install: withScope({ kind: "folder", installPath, folderName, spare }, targetScope) };
}

function folderRoot(id: string, name: string, installPath: string, targetScope?: InstallTargetScope): ModTypeRule {
  return { id, name, install: withScope({ kind: "folderRoot", installPath }, targetScope) };
}

function folderParent(id: string, name: string, installPath: string, folderName: string | string[], targetScope?: InstallTargetScope): ModTypeRule {
  return { id, name, install: withScope({ kind: "folderParent", installPath, folderName }, targetScope) };
}

function file(id: string, name: string, installPath: string, fileName: string, isExtname = false, commonParent = false, targetScope?: InstallTargetScope): ModTypeRule {
  return { id, name, install: withScope({ kind: "file", installPath, fileName, isExtname, commonParent }, targetScope) };
}

function sibling(id: string, name: string, installPath: string, fileName: string, isExtname = false, targetScope?: InstallTargetScope, pass?: string[]): ModTypeRule {
  return { id, name, install: withScope({ kind: "fileSibling", installPath, fileName, isExtname, pass }, targetScope) };
}

function fileOnly(id: string, name: string, installPath: string, fileName: string, isExtname = true, targetScope?: InstallTargetScope): ModTypeRule {
  return { id, name, install: withScope({ kind: "fileOnly", installPath, fileName, isExtname }, targetScope) };
}

const documents = "documents" as const;
const appData = "appData" as const;

export const catalogRuleDefinitions: Record<string, CatalogRuleDefinition> = {
  "7daystodie": {
    name: "7 Days to Die",
    modTypes: [
      file("1", "Mods", "Mods", "modinfo.xml", false, true),
      general("2", "Avatars", "Mods/VRoidMod/Avatars", false),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "pathPart", value: "Avatars" },
      { typeId: "1", kind: "fileName", value: "modinfo.xml" }
    ]
  },
  americantrucksimulator: {
    name: "American Truck Simulator",
    modTypes: [
      fileOnly("1", "scs", "American Truck Simulator/mod", "scs", true, documents),
      file("2", "manifest", "American Truck Simulator/mod", "manifest.sii", false, false, documents),
      manual("3", "versions", "versions 目录需要配合卡车模拟器版本选择，请手动处理。"),
      general("4", "游戏根目录", "", true),
      manual()
    ],
    detect: [
      { typeId: "1", kind: "extension", value: "scs" },
      { typeId: "2", kind: "fileName", value: "manifest.sii" }
    ]
  },
  anno117: {
    name: "Anno 117 - Pax Romana",
    modTypes: [folderParent("1", "mods", "mods", "data"), manual()],
    detect: [{ typeId: "1", kind: "pathPart", value: "data" }]
  },
  anno1800: {
    name: "Anno 1800",
    modTypes: [folderParent("1", "mods", "mods", "data"), manual()],
    detect: [{ typeId: "1", kind: "pathPart", value: "data" }]
  },
  armoredcore6: {
    name: "Armored Core 6",
    modTypes: [
      {
        id: "1",
        name: "通用类型",
        install: {
          kind: "fileMap",
          installPath: "mods",
          dictionaryFile: ARMORED_CORE_6_DICTIONARY
        }
      },
      general("2", "Engine 2", "", true)
    ],
    detect: [{ typeId: "2", kind: "fileName", value: "launchmod_armoredcore6.bat" }]
  },
  acodyssey: {
    name: "Assassins Creed Odyssey",
    modTypes: [
      sibling("1", "forger2", "ForgerPatches", "forger2", true),
      general("2", "游戏根目录", "", true),
      manual()
    ],
    detect: [{ typeId: "1", kind: "extension", value: "forger2" }]
  },
  redalert2: {
    name: "Command & Conquer Red Alert 2 and Yuri's Revenge",
    modTypes: [general("1", "游戏根目录", "", false), manual()],
    detect: []
  },
  crusaderkings3: {
    name: "Crusader Kings 3",
    modTypes: [
      sibling("1", "Mods", "Paradox Interactive/Crusader Kings III/mod", "mod", true, documents, ["descriptor.mod"]),
      manual()
    ],
    detect: [{ typeId: "1", kind: "extension", value: "mod" }]
  },
  darkestdungeon: {
    name: "Darkest Dungeon",
    modTypes: [file("1", "mods", "mods", "project.xml"), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "project.xml" }]
  },
  deadoralive6: {
    name: "Dead or Alive 6",
    modTypes: [
      file("1", "mods", "REDELBE/Layer2", "mod.ini"),
      sibling("2", "Redelbe", "", "dinput8.dll"),
      general("3", "游戏根目录", "", true),
      manual()
    ],
    detect: [
      { typeId: "1", kind: "fileName", value: "mod.ini" },
      { typeId: "2", kind: "fileName", value: "dinput8.dll" }
    ]
  },
  divinityos2: {
    name: "Divinity Original Sin 2",
    modTypes: [
      fileOnly("1", "pak", "Larian Studios/Divinity Original Sin 2 Definitive Edition/Mods", "pak", true, documents),
      manual()
    ],
    detect: [{ typeId: "1", kind: "extension", value: "pak" }]
  },
  dontstarve: {
    name: "Don't Starve Together",
    modTypes: [file("1", "通用类型", "mods", "modmain.lua"), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "modmain.lua" }]
  },
  dyinglight2: {
    name: "Dying Light 2",
    modTypes: [
      {
        id: "1",
        name: "dat",
        install: {
          kind: "numberedPak",
          installPath: "ph/source",
          extension: "pak",
          prefix: "data",
          startIndex: 2,
          listFileName: "pakList.txt"
        }
      },
      manual()
    ],
    detect: [
      { typeId: "1", kind: "extension", value: "pak" },
      { typeId: "1", kind: "extension", value: "dat" }
    ]
  },
  duckov: {
    name: "Escape from Duckov",
    modTypes: [file("1", "mods", "Duckov_Data/mods", "info.ini"), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "info.ini" }]
  },
  eurotrucksimulator2: {
    name: "Euro Truck Simulator 2",
    modTypes: [
      fileOnly("1", "scs", "Euro Truck Simulator 2/mod", "scs", true, documents),
      file("2", "manifest", "Euro Truck Simulator 2/mod", "manifest.sii", false, false, documents),
      manual("3", "versions", "versions 目录需要配合卡车模拟器版本选择，请手动处理。"),
      general("4", "游戏根目录", "", true),
      manual()
    ],
    detect: [
      { typeId: "1", kind: "extension", value: "scs" },
      { typeId: "2", kind: "fileName", value: "manifest.sii" }
    ]
  },
  expeditions: {
    name: "Expeditions A MudRunner Game",
    modTypes: [general("1", "pak", "preload/paks/client", false), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "pak" }]
  },
  fallout4: {
    name: "Fallout 4",
    modTypes: [
      folder("1", "Plugins", "Data/F4SE/plugins", "plugins"),
      {
        id: "2",
        name: "Data",
        install: {
          kind: "bethesdaData",
          installPath: "Data",
          folderName: ["data", "Data"],
          documentsGameFolder: "Fallout4",
          iniFileName: "Fallout4.ini",
          localAppDataGameFolder: "Fallout4"
        }
      },
      sibling("3", "f4se", "", "f4se_loader.exe"),
      manual()
    ],
    detect: [
      { typeId: "3", kind: "fileName", value: "f4se_loader.exe" },
      { typeId: "1", kind: "pathPart", value: "plugins" },
      { typeId: "2", kind: "pathPart", value: "data" },
      { typeId: "2", kind: "extension", value: "esp" },
      { typeId: "2", kind: "extension", value: "esm" }
    ]
  },
  fs22: {
    name: "Farming Simulator 22",
    modTypes: [
      file("1", "通用类型", "My Games/FarmingSimulator2022/mods", "modDesc.xml", false, false, documents),
      manual()
    ],
    detect: [{ typeId: "1", kind: "fileName", value: "modDesc.xml" }]
  },
  "genshin-impact": {
    name: "Genshin Impact",
    modTypes: [
      file("1", "mods", "Mods", "ini", true, true),
      sibling("2", "GIMI", "", "d3d11.dll"),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "fileName", value: "d3d11.dll" },
      { typeId: "1", kind: "extension", value: "ini" }
    ]
  },
  ghostoftsushima: {
    name: "Ghost of Tsushima",
    modTypes: [sibling("1", "psarc", "cache_pc/psarc", "psarc", true), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "psarc" }]
  },
  grimdawn: {
    name: "Grim Dawn",
    modTypes: [folderParent("1", "mods", "mods", ["resources", "database", "localization"]), general("2", "游戏根目录", "", false), manual()],
    detect: [
      { typeId: "1", kind: "pathPart", value: "resources" },
      { typeId: "1", kind: "pathPart", value: "database" },
      { typeId: "1", kind: "pathPart", value: "localization" }
    ]
  },
  hades2: {
    name: "Hades2",
    modTypes: [
      file("1", "Mods", "Content/Mods", "modfile.txt"),
      sibling("2", "ModImporter", "Content", "modimporter.exe"),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "fileName", value: "modimporter.exe" },
      { typeId: "1", kind: "fileName", value: "modfile.txt" }
    ]
  },
  humankind: {
    name: "Humankind",
    modTypes: [folderRoot("1", "mods", "Humankind/Community/Scenarios", documents), manual()],
    detect: []
  },
  jaggedalliance3: {
    name: "Jagged Alliance 3",
    modTypes: [
      file("1", "通用类型", "Roaming/Jagged Alliance 3/Mods", "metadata.lua", false, false, appData),
      manual()
    ],
    detect: [{ typeId: "1", kind: "fileName", value: "metadata.lua" }]
  },
  "just-cause-3": {
    name: "Just Cause 3",
    modTypes: [folder("1", "dropzone", "dropzone", "dropzone", false), general("2", "游戏根目录", "", true), manual()],
    detect: [{ typeId: "1", kind: "pathPart", value: "dropzone" }]
  },
  kenshi: {
    name: "Kenshi",
    modTypes: [file("1", "Mods", "mods", "mod", true), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "mod" }]
  },
  kerbalspaceprogram: {
    name: "Kerbal Space Program",
    modTypes: [folder("1", "GameData", "GameData", "GameData"), folderRoot("2", "craft", "Ships"), manual()],
    detect: [
      { typeId: "1", kind: "pathPart", value: "GameData" },
      { typeId: "2", kind: "extension", value: "craft" }
    ]
  },
  kingdomcomedeliverance: {
    name: "Kingdom Come Deliverance",
    modTypes: [file("1", "Mods", "Mods", "mod.manifest"), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "mod.manifest" }]
  },
  kingdomcomedeliverance2: {
    name: "Kingdom Come Deliverance 2",
    modTypes: [file("1", "Mods", "Mods", "mod.manifest"), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "mod.manifest" }]
  },
  l4d2: {
    name: "Left 4 Dead 2",
    modTypes: [fileOnly("1", "通用类型", "left4dead2/addons", "vpk")],
    detect: [{ typeId: "1", kind: "extension", value: "vpk" }]
  },
  likeadragon8: {
    name: "LikeADragon8",
    modTypes: [general("1", "mods", "mods", true), sibling("2", "RyuModManager", "", "RyuModManager.exe"), manual()],
    detect: [
      { typeId: "2", kind: "fileName", value: "RyuModManager.exe" },
      { typeId: "1", kind: "pathPart", value: "mods" }
    ]
  },
  michangsheng: {
    name: "MiChangSheng",
    modTypes: [
      {
        id: "1",
        name: "bin",
        install: {
          kind: "michangshengLinkedFolder",
          installPath: "本地Mod测试",
          rootFile: "mod.bin"
        }
      },
      {
        id: "2",
        name: "插件",
        install: {
          kind: "michangshengDllPlugins",
          installPath: "本地Mod测试/Mayfly/plugins"
        }
      },
      {
        id: "3",
        name: "Next类",
        install: {
          kind: "michangshengLinkedFolder",
          installPath: "本地Mod测试/Mayfly/plugins/Next",
          rootFile: "modconfig.json"
        }
      },
      manual("4", "未知")
    ],
    detect: [
      { typeId: "1", kind: "fileName", value: "mod.bin" },
      { typeId: "3", kind: "fileName", value: "modconfig.json" },
      { typeId: "2", kind: "extension", value: "dll" }
    ]
  },
  mountblade2: {
    name: "MountBlade2",
    modTypes: [file("1", "Modules", "Modules", "SubModule.xml"), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "SubModule.xml" }]
  },
  nioh2: {
    name: "Nioh 2",
    modTypes: [general("1", "Mod Enabler", "", true), folderRoot("2", "mods", "mods"), general("3", "游戏根目录", "", true), manual()],
    detect: [
      { typeId: "1", kind: "fileName", value: "d3dcompiler_46.dll" },
      { typeId: "2", kind: "extension", value: "ini" },
      { typeId: "2", kind: "pathPart", value: "mods" }
    ]
  },
  nioh3: {
    name: "Nioh 3",
    modTypes: [
      sibling("1", "tools", "package", "exe", true),
      sibling("2", "fdata", "package", "fdata", true),
      general("3", "游戏根目录", "", true),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "extension", value: "fdata" },
      { typeId: "1", kind: "extension", value: "exe" }
    ]
  },
  nomanssky: {
    name: "No Man's Sky",
    modTypes: [
      {
        id: "1",
        name: "pak/lua",
        install: {
          kind: "noMansSkyMods",
          installPath: "GAMEDATA/PCBANKS/MODS",
          keepPath: false
        }
      },
      manual()
    ],
    detect: [
      { typeId: "1", kind: "extension", value: "pak" },
      { typeId: "1", kind: "extension", value: "lua" }
    ]
  },
  planetzoo: {
    name: "Planet Zoo",
    modTypes: [file("1", "Mods", "win64/ovldata", "manifest.xml"), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "manifest.xml" }]
  },
  reddeadredemption: {
    name: "Red Dead Redemption",
    modTypes: [
      sibling("1", "ScriptHookRDR", "", "dinput8.dll"),
      sibling("2", "RedHook", "", "RedHook.dll"),
      sibling("3", "asi", "", "asi", true),
      sibling("4", "red", "", "red", true),
      manual()
    ],
    detect: [
      { typeId: "1", kind: "fileName", value: "dinput8.dll" },
      { typeId: "2", kind: "fileName", value: "RedHook.dll" },
      { typeId: "3", kind: "extension", value: "asi" },
      { typeId: "4", kind: "extension", value: "red" }
    ]
  },
  reddead2: {
    name: "Red Dead Redemption 2",
    modTypes: [
      {
        id: "1",
        name: "asi",
        install: {
          kind: "redDeadAsi",
          installPath: "",
          fileName: "asi",
          isExtname: true
        }
      },
      {
        id: "2",
        name: "lml",
        install: {
          kind: "redDeadLml",
          installPath: "lml"
        }
      },
      general("3", "游戏根目录", "", true),
      sibling("4", "ScriptHookRDR2", "", "ScriptHookRDR2.dll"),
      general("5", "script", "scripts", true),
      manual()
    ],
    detect: [
      { typeId: "4", kind: "fileName", value: "ScriptHookRDR2.dll" },
      { typeId: "1", kind: "extension", value: "asi" },
      { typeId: "2", kind: "pathPart", value: "lml" },
      { typeId: "5", kind: "pathPart", value: "scripts" }
    ]
  },
  residentevilvillage: {
    name: "Resident Evil Village",
    modTypes: [
      general("2", "REFramework", "", true),
      folder("1", "autorun", "reframework/autorun", "autorun", false),
      folder("4", "plugins", "reframework/plugins", "plugins", false),
      folder("3", "模型替换", "natives", "natives", false),
      general("5", "主目录", "", true),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "fileName", value: "dinput8.dll" },
      { typeId: "1", kind: "pathPart", value: "autorun" },
      { typeId: "4", kind: "pathPart", value: "plugins" },
      { typeId: "3", kind: "pathPart", value: "natives" }
    ]
  },
  rimworld: {
    name: "RimWorld",
    modTypes: [file("1", "通用类型", "Mods", "About.xml", false, false), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "About.xml" }]
  },
  sekiro: {
    name: "Sekiro",
    modTypes: [
      {
        id: "1",
        name: "基础类型",
        install: {
          kind: "fileMap",
          installPath: "mods",
          dictionaryFile: SEKIRO_DICTIONARY
        }
      },
      sibling("2", "ModEngine", "", "dinput8.dll"),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "fileName", value: "dinput8.dll" },
      { typeId: "1", kind: "pathPart", value: "parts" },
      { typeId: "1", kind: "pathPart", value: "chr" }
    ]
  },
  sottr: {
    name: "Shadow of the Tomb Raider",
    modTypes: [sibling("1", "forger2", "ForgerPatches", "forger2", true), general("2", "游戏根目录", "", true), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "forger2" }]
  },
  civilizationvi: {
    name: "Sid Meier's Civilization VI",
    modTypes: [file("1", "mods", "My Games/Sid Meier's Civilization VI/Mods", "modinfo", true, false, documents), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "modinfo" }]
  },
  civilizationvii: {
    name: "Sid Meier's Civilization VII",
    modTypes: [file("1", "mods", "Local/Firaxis Games/Sid Meier's Civilization VII/Mods", "modinfo", true, false, appData), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "modinfo" }]
  },
  starfield: {
    name: "Starfield",
    modTypes: [
      {
        id: "1",
        name: "data",
        install: {
          kind: "bethesdaData",
          installPath: "Data",
          folderName: ["data", "Data"],
          documentsGameFolder: "Starfield",
          iniFileName: "Starfield.ini",
          localAppDataGameFolder: "Starfield",
          pluginsHeader: "# This file is used by Starfield to keep track of your downloaded content. (You HAVE to keep a # on the first line here)",
          updateGeneralTestFiles: true
        }
      },
      general("2", "游戏根目录", "", true),
      sibling("3", "sfse", "", "sfse_loader.exe"),
      folder("4", "Plugins", "Data/SFSE/plugins", "plugins"),
      {
        id: "5",
        name: "esp",
        install: {
          kind: "bethesdaPluginFiles",
          installPath: "Data",
          documentsGameFolder: "Starfield",
          iniFileName: "Starfield.ini",
          localAppDataGameFolder: "Starfield",
          pluginsHeader: "# This file is used by Starfield to keep track of your downloaded content. (You HAVE to keep a # on the first line here)",
          updateGeneralTestFiles: true
        }
      },
      manual()
    ],
    detect: [
      { typeId: "3", kind: "fileName", value: "sfse_loader.exe" },
      { typeId: "4", kind: "pathPart", value: "plugins" },
      { typeId: "5", kind: "extension", value: "esp" },
      { typeId: "5", kind: "extension", value: "esm" },
      { typeId: "1", kind: "pathPart", value: "data" }
    ]
  },
  stellaris: {
    name: "Stellaris",
    modTypes: [
      sibling("1", "Mods", "Paradox Interactive/Stellaris/mod", "mod", true, documents, ["descriptor.mod"]),
      manual()
    ],
    detect: [{ typeId: "1", kind: "extension", value: "mod" }]
  },
  streetfighter6: {
    name: "Street Fighter 6",
    modTypes: [
      general("2", "REFramework", "", true),
      folder("1", "autorun", "reframework/autorun", "autorun", false),
      folder("4", "plugins", "reframework/plugins", "plugins", false),
      folder("3", "模型替换", "natives", "natives", false),
      general("5", "主目录", "", true),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "fileName", value: "dinput8.dll" },
      { typeId: "1", kind: "pathPart", value: "autorun" },
      { typeId: "4", kind: "pathPart", value: "plugins" },
      { typeId: "3", kind: "pathPart", value: "natives" }
    ]
  },
  terraria: {
    name: "Terraria",
    modTypes: [
      file("1", "pack", "My Games/Terraria/ResourcePacks", "pack.json", false, false, documents),
      file("2", "tmod", "My Games/Terraria/tModLoader/Mods", "tmod", true, false, documents),
      manual()
    ],
    detect: [
      { typeId: "2", kind: "extension", value: "tmod" },
      { typeId: "1", kind: "fileName", value: "pack.json" }
    ]
  },
  thehuntercotw: {
    name: "The Hunter CotW",
    modTypes: [folder("1", "dropzone", "dropzone", "dropzone"), manual()],
    detect: [{ typeId: "1", kind: "pathPart", value: "dropzone" }]
  },
  lastus2: {
    name: "The Last of Us Part 2",
    modTypes: [general("1", "modloader", "", true), general("2", "mods", "mods", false), manual()],
    detect: [
      { typeId: "1", kind: "pathPart", value: "modloader" },
      { typeId: "2", kind: "pathPart", value: "mods" }
    ]
  },
  thescrolloftaiwu: {
    name: "The Scroll Of Taiwu",
    modTypes: [file("1", "通用", "Mod", "config.lua"), manual("2", "未知")],
    detect: [{ typeId: "1", kind: "fileName", value: "config.lua" }]
  },
  thesims4: {
    name: "The Sims 4",
    modTypes: [folderRoot("1", "通用类型", "Electronic Arts/The Sims 4/Mods/mayflyMods", documents)],
    detect: []
  },
  thewitcher3: {
    name: "The Witcher 3",
    // BUG-010(2026-10-03):Witcher 3 模组实际是装到 <gamePath>/mods/<ModName>/ 直接命名
    //   不是"mod 包内 mod/ 子目录"模式,folderParent 找不到 folderName 标记文件会静默跳过
    //   且被 scanActiveGameMods 的 SCAN_KINDS 排除导致本地扫描看不见手动装的 mod
    //   改 folderRoot:装到 <gamePath>/mods/<ModName>,扫得到 + 装得上
    modTypes: [folderRoot("1", "mods", "mods"), folderRoot("2", "dlc", "dlc"), manual()],
    detect: [
      { typeId: "2", kind: "pathPart", value: "dlc" },
      { typeId: "1", kind: "pathPart", value: "mods" }
    ],
    // BUG-010:ScriptStudio / REDengine mod 主格式不是 Unreal 的 .pak/.dll/.lua
    //   默认白名单不认 .bundle(REDengine 数据包) + .ws(WitcherScript) → 静默漏掉
    //   覆盖默认白名单,加 bundle/ws + 常见数据/配置(xml/csv/json/ini/cfg/txt)
    //   保留 lua(脚本 mod 也支持),加 png/dds(纹理 mod)
    scanExtensions: [
      "bundle", "ws", "lua", "xml", "csv", "json", "ini", "cfg", "txt",
      "png", "dds", "jpg", "jpeg", "tga"
    ]
  },
  titanfall2: {
    name: "Titanfall 2",
    modTypes: [file("1", "mods", "R2Northstar/mods", "mod.json"), sibling("2", "Northstar", "", "NorthstarLauncher.exe"), manual()],
    detect: [
      { typeId: "2", kind: "fileName", value: "NorthstarLauncher.exe" },
      { typeId: "1", kind: "fileName", value: "mod.json" }
    ]
  },
  totalwartk: {
    name: "Total War THREE KINGDOMS",
    modTypes: [fileOnly("1", "pack", "mods", "pack"), folder("2", "UI", "data/UI", ["ui", "UI"]), manual()],
    detect: [
      { typeId: "1", kind: "extension", value: "pack" },
      { typeId: "2", kind: "pathPart", value: "ui" }
    ]
  },
  tww3: {
    name: "Total War WARHAMMER III",
    modTypes: [fileOnly("1", "pack", "data", "pack"), folder("2", "UI", "data/UI", ["ui", "UI"]), manual()],
    detect: [
      { typeId: "1", kind: "extension", value: "pack" },
      { typeId: "2", kind: "pathPart", value: "ui" }
    ]
  },
  twopointcampus: {
    name: "Two Point Campus",
    modTypes: [
      file("1", "mods", "LocalLow/Two Point Studios/Two Point Campus/Mods", "json", true, false, appData),
      manual()
    ],
    detect: [{ typeId: "1", kind: "extension", value: "json" }]
  },
  spacemarine2: {
    name: "Warhammer 40000 Space Marine 2",
    modTypes: [sibling("1", "pak", "client_pc/root/paks/client/default", "pak", true), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "pak" }]
  },
  warriorsorochi4: {
    name: "Warriors Orochi 4",
    modTypes: [sibling("1", "bin", "tmp/dlc", "bin", true), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "bin" }]
  },
  watchdogs2: {
    name: "Watch Dogs 2",
    modTypes: [
      {
        id: "1",
        name: "dat",
        install: {
          kind: "watchDogsPatch",
          installPath: "data_win64",
          listFileName: "pakList.txt"
        }
      },
      manual()
    ],
    detect: [{ typeId: "1", kind: "extension", value: "dat" }]
  },
  x4foundations: {
    name: "X4 Foundations",
    modTypes: [file("1", "extensions", "extensions", "content.xml", false, true), manual()],
    detect: [{ typeId: "1", kind: "fileName", value: "content.xml" }]
  },
  xcom2: {
    name: "XCOM2",
    modTypes: [sibling("1", "通用类型", "Mods", "XComMod", true), manual()],
    detect: [{ typeId: "1", kind: "extension", value: "XComMod" }]
  }
};

export function createCatalogRuleAdapter(presetId: string, definition: CatalogRuleDefinition): GameAdapter {
  return {
    presetId,
    name: definition.name,
    modTypes: definition.modTypes,
    // BUG-010:把 definition.scanExtensions 透传到 adapter,后端 scanGameMods 用它覆盖默认
    scanExtensions: definition.scanExtensions,
    checkModType(files) {
      for (const rule of definition.detect) {
        if (rule.kind === "extension" && hasExtension(files, rule.value)) return rule.typeId;
        if (rule.kind === "fileName" && hasFile(files, rule.value)) return rule.typeId;
        if (rule.kind === "pathPart" && hasPathPart(files, rule.value)) return rule.typeId;
      }

      return definition.modTypes[0]?.id ?? "99";
    }
  };
}
