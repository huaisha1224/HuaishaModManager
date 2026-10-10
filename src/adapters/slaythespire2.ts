import type { GameAdapter } from "@/types/domain";
import { hasFile, hasPathPart } from "@/adapters/utils";

// HGMM Phase 4.4:杀戮尖塔 2 (Slay the Spire 2,Steam AppId 2868840)
//
// 数据驱动来源:https://download.hs2049.cn/hgmm2/SlayTheSpire2.json 实际分析
//   - 60 个游戏内 mod 全部 InstallLocation="\mods"(落到游戏根\mods\<ModName>)
//   - Delete 字段暴露 mod 加载器是 \mods\dinput8.dll(放在 mods 子目录里,
//     不是游戏根)—— 这是社区自建 mod 加载机制,引擎是 Godot,但跟引擎无关
//   - 1 个外部工具(风灵月影,Modetype="5")用绝对路径,不走游戏目录
//   - 7 个 mod 有 Array=1/2/3 字段(多文件 mod),spare=true 自动按 ModName 建子目录
//
// 为什么不能复用 createUnityAdapter:
//   - 框架 dll:winhttp.dll(unity)≠ mods\dinput8.dll(slaythespire2)
//   - mod 落盘:BepInEx\plugins\ModName\(unity)≠ \mods\ModName\(slaythespire2)
//   - 装错路径游戏根本不认 mod,必须独立 adapter。
export const slaythespire2Adapter: GameAdapter = {
  presetId: "slaythespire2",
  name: "Slay the Spire 2",

  modTypes: [
    {
      // 60 个游戏内 mod 全部走这个,落到 游戏根\mods\<ModName>\...
      // spare=true 让 installFeaturedMod 按 ModName 建子目录,匹配 Array 字段
      id: "mods",
      name: "mods",
      install: {
        kind: "folder",
        installPath: "",
        folderName: "mods",
        spare: true
      }
    },
    {
      // mod 加载器核心 dll,在 mods 子目录里(不是游戏根)
      // 首次装 mod 前必须先装这个,游戏才能识别 mod
      id: "dinput8",
      name: "Slay the Spire 2 Mod Loader",
      install: {
        kind: "fileSibling",
        installPath: "mods",
        fileName: "dinput8.dll"
      }
    },
    {
      id: "root",
      name: "游戏根目录",
      install: {
        kind: "general",
        installPath: "",
        keepPath: false
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该 Slay the Spire 2 Mod 类型未知,请手动安装。"
      }
    }
  ],

  // 压缩包 / N 网下载场景:根据 mod 包内文件推断 modType
  checkModType(files) {
    if (hasFile(files, "dinput8.dll")) return "dinput8";
    if (hasPathPart(files, "mods")) return "mods";
    return "root";
  }
};