import gamePresetsFromJson from "@/data/game-presets.json";
import { baldursGate3Adapter } from "@/adapters/baldursgate3";
import { blackWukongAdapter } from "@/adapters/blackwukong";
import { commonAdapter } from "@/adapters/common";
import { cyberpunk2077Adapter } from "@/adapters/cyberpunk2077";
import { eldenRingAdapter } from "@/adapters/eldenring";
import { createGta5Adapter } from "@/adapters/gta5";
import { catalogEngineDefinitions } from "@/adapters/engine-definitions";
import { createCatalogRuleAdapter, catalogRuleDefinitions } from "@/adapters/catalog-rule-definitions";
import { inzoiAdapter } from "@/adapters/inzoi";
import { legendOfHerosAdapter } from "@/adapters/legendofheros";
import { createReEngineAdapter, monsterHunterWorldAdapter } from "@/adapters/monsterhunter";
import { oblivionRemasteredAdapter } from "@/adapters/oblivionremastered";
import { skyrimSeAdapter } from "@/adapters/skyrimse";
import { slaythespire2Adapter } from "@/adapters/slaythespire2";
import { stardewValleyAdapter } from "@/adapters/stardewvalley";
import { taleOfImmortalAdapter } from "@/adapters/taleofimmortal";
import { createCatalogAdapter } from "@/adapters/utils";
import { createMelonLoaderAdapter, createUnityAdapter } from "@/adapters/unity";
import { createUnrealAdapter } from "@/adapters/unreal";
import type { GameAdapter, GamePreset } from "@/types/domain";

const gamePresets = gamePresetsFromJson as GamePreset[];

const explicitAdapters: GameAdapter[] = [
  baldursGate3Adapter,
  cyberpunk2077Adapter,
  createGta5Adapter("gta5", "Grand Theft Auto V"),
  createGta5Adapter("gta5enhanced", "Grand Theft Auto V Enhanced"),
  inzoiAdapter,
  monsterHunterWorldAdapter,
  createReEngineAdapter("monsterhunterrise", "MonsterHunterRise"),
  createReEngineAdapter("monsterhunterwilds", "Monster Hunter Wilds"),
  legendOfHerosAdapter,
  oblivionRemasteredAdapter,
  skyrimSeAdapter,
  stardewValleyAdapter,
  taleOfImmortalAdapter,
  blackWukongAdapter,
  eldenRingAdapter,
  createUnrealAdapter("hogwartslegacy", "Hogwarts Legacy", "Phoenix"),
  createUnrealAdapter("stellarblade", "Stellar Blade", "SB"),
  // HGMM Phase 2 修复:palworld / expedition33 原先走 catalogAdapterMap 兜底,
  // 只配了"通用类型"(id="1"),无法区分 pak/ue4ss,精选 mod modTypeId="ue4ss"/"pak" 会拒绝安装。
  // 这两款游戏实际是 Unreal 引擎(项目结构与 stellarblade 一致),接入 Unreal adapter:
  //   - palworld basePath="Pal"(虚幻 Content 在 Pal/Content/Paks/~mods)
  //   - expedition33 basePath="Sandfall"(Sandfall/Content/Paks/~mods)
  createUnrealAdapter("palworld", "Palworld", "Pal"),
  createUnrealAdapter("expedition33", "Clair Obscur Expedition 33", "Sandfall"),
  createUnrealAdapter("tekken8", "Tekken 8", "Polaris"),
  createUnityAdapter("riskofrain2", "Risk of Rain 2"),
  createUnityAdapter("valheim", "Valheim"),
  createUnityAdapter("lethalcompany", "Lethal Company"),
  // HGMM Phase 4.3:渔力全开 (How to Fish,Steam AppId 4001890) — Unity + BepInEx 游戏,
  // 复用 unity adapter 提供 bepinex/plugins/root 三种 modType。
  // preset.sourceFile 字段("HowtoFish.ts")仅为声明性约定,代码侧不消费,故不新建独立 adapter 文件。
  createUnityAdapter("How to Fish", "How to Fish"),
  // HGMM Phase 4.4:杀戮尖塔 2 (Slay the Spire 2,Steam AppId 2868840) — Godot 引擎
  // + 社区自建 mod 加载机制(\mods\dinput8.dll)。不能复用 unity adapter:
  // 路径完全不同(mods\dinput8.dll vs winhttp.dll,\mods\ModName\ vs BepInEx\plugins\)。
  // 数据驱动来源:download.hs2049.cn/hgmm2/SlayTheSpire2.json 实际分析。
  slaythespire2Adapter
];

const explicitAdapterMap = new Map(explicitAdapters.map((adapter) => [adapter.presetId, adapter]));
const engineAdapterMap = new Map(
  gamePresets
    .map((preset): [string, GameAdapter] | null => {
      const definition = catalogEngineDefinitions[preset.id];
      if (!definition) return null;

      switch (definition.kind) {
        case "unreal":
          return [preset.id, createUnrealAdapter(preset.id, preset.name, definition.basePath)];
        case "unity":
          return [preset.id, createUnityAdapter(preset.id, preset.name)];
        case "melon":
          return [preset.id, createMelonLoaderAdapter(preset.id, preset.name)];
        case "reengine":
          return [preset.id, createReEngineAdapter(preset.id, preset.name)];
        default:
          return null;
      }
    })
    .filter((entry): entry is [string, GameAdapter] => Boolean(entry))
);
const catalogAdapterMap = new Map(
  gamePresets.map((preset) => [preset.id, createCatalogAdapter(preset)])
);
const ruleAdapterMap = new Map(
  Object.entries(catalogRuleDefinitions).map(([presetId, definition]) => [
    presetId,
    createCatalogRuleAdapter(presetId, definition)
  ])
);

export function getGameAdapter(presetId: string): GameAdapter {
  return explicitAdapterMap.get(presetId) ??
    engineAdapterMap.get(presetId) ??
    ruleAdapterMap.get(presetId) ??
    catalogAdapterMap.get(presetId) ??
    commonAdapter;
}

export function getModType(adapter: GameAdapter, typeId: string) {
  return adapter.modTypes.find((type) => type.id === typeId) ?? adapter.modTypes[0];
}
