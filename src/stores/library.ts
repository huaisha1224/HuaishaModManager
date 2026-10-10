import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { getGameAdapter, getModType } from "@/adapters";
import { commonAdapter } from "@/adapters/common";
import { appConfirm, appAlert } from "@/services/dialog";
import gamePresetsFromJson from "@/data/game-presets.json";
const gamePresets = gamePresetsFromJson as GamePreset[];
import {
  fetchHGMMFeatured,
  fetchBigMods,
  CDN_SCHEMA_FILES
} from "@/sources/hgmm-cdn-source";
import type {
  FeaturedMod,
  FeaturedFetchResult,
  RawCleanupRule,
  BigMod
} from "@/sources/hgmm-cdn-source";
import type {
  AppData,
  AppLogEntry,
  BackupEntry,
  DataBackupEntry,
  DownloadTask,
  CustomAdapterRule,
  GameAdapter,
  GamePreset,
  InstallPlan,
  InstallStrategy,
  LocalMod,
  ManagedGame,
  AppSettings,
  AppUpdateInfo,
  AppUpdateCheckResult,
  NexusModDetail,
  NexusModFile,
  NexusModItem,
  NexusModListResult,
  ModOriginKind,
  ModUpdateCheck,
  ModUpdateSource,
  ModProfile
} from "@/types/domain";

import { MOD_ORIGIN_TAGS } from "@/types/domain";

/** HGMM Phase 5:追加来源 tag(保留用户已有自定义 tag,如"战斗""画质") */
function appendOriginTag(tags: string[] | undefined, origin: ModOriginKind): string[] {
  const list = Array.isArray(tags) ? tags : [];
  const tag = MOD_ORIGIN_TAGS[origin];
  return list.includes(tag) ? list : [...list, tag];
}

const DATA_FILE = "huaisha-library.json";
// 2026-10-05 重命名:原 mayfly-library.json 是 mayfly 基座时代的残留(2026-09-23
//   复制 mayfly 时沿用),跟现在"怀沙模组管理器"产品名不一致。改成 huaisha-library.json。
//   老用户升级时由 main.ts:ensureJsonFile 启动检测旧文件名做 rename 迁移,数据不丢。
const DATA_VERSION = 9;
const HIDDEN_PRESET_IDS = new Set(["gta5", "gta5enhanced"]);

/**
 * HGMM 2.0 白名单:"添加游戏"弹窗只显示 HGMM CDN 实际出 mod 包的游戏
 *
 * 数据源对应 download.hs2049.cn/hgmm2/ 下的 8 款 JSON:
 *   - PalSchema.json       → palworld
 *   - StellarBlade.json    → stellarblade
 *   - SlayTheSpire2.json   → slaythespire2
 *   - HKSilksong.json      → silksong
 *   - blackwukong.json     → blackwukong
 *   - Expedition.json      → expedition33
 *   - HowtoFish.json       → "How to Fish" (Phase 3.5)
 *   - bigmod.json          → bigmod 收录的 stellarblade/palworld/blackwukong/silksong/expedition33(在上面)
 *
 * 其他 137 款 mayfly 内置 preset 暂不显示,等 HGMM 适配完成再加进白名单。
 */
const HGMM_VISIBLE_PRESET_IDS = new Set([
  "palworld",
  "stellarblade",
  // HGMM Phase 4.4:slaythespire2 已在 preset + adapter 全套接入(nexusGameId 待补)
  "slaythespire2",
  "silksong",
  "blackwukong",
  "expedition33",
  "How to Fish",
  // FEATURE-015(2026-10-03):巫师 3 入白名单,游戏本体 + Nexus 下载 mod 即可用
  // 精选 CDN JSON(Witcher3.json)尚未生成,fetch 404 → 精选 tab 是空的
  // 出 JSON 时同步确认 CDN_SCHEMA_FILES 里的 URL 路径(命名不规律,见 hgmm-cdn-source.ts:122 注释)
  "thewitcher3"
]);
const LEGACY_PACKAGE_EXTENSION = ["g", "m", "m"].join("");
type PackageProgress = {
  visible: boolean;
  operation: "import" | "export" | "";
  phase: string;
  current: number;
  total: number;
  message: string;
};
type UpdateBatchProgress = {
  visible: boolean;
  current: number;
  total: number;
  message: string;
};

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function baseName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function modNameFromPath(path: string) {
  const packagePattern = new RegExp(`\\.(zip|rar|7z|mmp|${LEGACY_PACKAGE_EXTENSION})$`, "i");
  return baseName(path).replace(packagePattern, "");
}

function isPackageArchive(path: string) {
  const lowerPath = path.toLowerCase();
  return [".zip", ".mmp", `.${LEGACY_PACKAGE_EXTENSION}`].some((extension) => lowerPath.endsWith(extension));
}

function normalizeText(value: string) {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextDuplicateName(name: string, existingNames: Set<string>) {
  let index = 2;
  let candidate = `${name} 副本`;

  while (existingNames.has(normalizeText(candidate))) {
    candidate = `${name} 副本 ${index}`;
    index += 1;
  }

  return candidate;
}

function dirName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  const prefix = /^[a-z]:/i.test(parts[0] ?? "") ? "" : "/";
  return `${prefix}${parts.join("/")}`.replace(/\//g, "\\");
}

function joinGameRelativePath(gamePath: string, relativePath: string) {
  // HGMM 一键修复:Palworld JSON 的 Delete[] 里有绝对路径规则(如 "C:\\Palworld\\"
  // 用于 PSP/PST 这类独立 exe 工具,跟游戏目录解耦),需要原样透传,不走 gamePath 拼接。
  // 绝对路径判定:Windows 盘符前缀(如 "C:\...")或 UNC 路径("\\server\...")。
  const normalized = relativePath.replace(/\//g, "\\");
  if (/^[a-z]:[\\]/i.test(normalized) || normalized.startsWith("\\\\")) {
    return normalized.replace(/[\\/]+$/u, "");
  }

  const parts = normalized.split("\\").filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === "..")) {
    return "";
  }

  return `${gamePath.replace(/[\\/]+$/u, "")}\\${parts.join("\\")}`;
}

/**
 * BUG-010 round 5 老游戏兼容(2026-10-03):
 *   ManagedGame 入库时拷贝 preset.gameBasePath,但用户可能在我把 gameBasePath
 *   加进 preset 之前就已经添加了该游戏 → ManagedGame.gameBasePath 是 undefined。
 *   运行时 fallback 到对应 preset.gameBasePath,让老游戏也能享受新机制。
 *   preset 都没有(undefined 的 undefined)→ 返 undefined,行为完全不变。
 */
function resolveGameBasePath(game: ManagedGame | null | undefined): string | undefined {
  if (!game) return undefined;
  if (game.gameBasePath) return game.gameBasePath;
  return getPresetGameBasePath(game.presetId);
}

function getPresetGameBasePath(presetId: string): string | undefined {
  if (!presetId) return undefined;
  const preset = gamePresets.find((p) => p.id === presetId);
  return preset?.gameBasePath;
}

// BUG-015(2026-10-04):per-game scan modTypeId 白名单 runtime fallback。
//   跟 resolveGameBasePath 同模式 — 用户游戏入库早于字段加入时,
//   ManagedGame.scanModTypeIds 为 undefined,回退到 preset.scanModTypeIds。
//   返回值语义:
//     undefined  → preset 也没配 → 行为不变(扫所有 SCAN_KINDS 命中 modType)
//     []          → 显式空数组 → scan 不扫任何 modType(scan 形同禁用)
//     ["1", "2"]  → 只扫 modTypeId 在白名单内的 target
function resolveGameScanModTypeIds(game: ManagedGame | null | undefined): string[] | undefined {
  if (!game) return undefined;
  if (Array.isArray(game.scanModTypeIds)) return game.scanModTypeIds;
  return getPresetScanModTypeIds(game.presetId);
}

function getPresetScanModTypeIds(presetId: string): string[] | undefined {
  if (!presetId) return undefined;
  const preset = gamePresets.find((p) => p.id === presetId);
  return preset?.scanModTypeIds;
}

function joinRelativePath(rootPath: string, relativePath: string) {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === ".." || /^[a-z]:$/i.test(part))) {
    return "";
  }

  return `${rootPath.replace(/[\\/]+$/u, "")}\\${parts.join("\\")}`;
}

function fileName(path: string) {
  return baseName(path);
}

function sanitizeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-").trim() || "download.bin";
}

function nexusModWebsite(gameDomain: string, modId: string, fileId = "") {
  const domain = gameDomain.trim();
  const id = modId.trim();
  if (!domain || !id) return "";

  const url = new URL(`https://www.nexusmods.com/${domain}/mods/${id}`);
  if (fileId.trim()) {
    url.searchParams.set("tab", "files");
    url.searchParams.set("file_id", fileId.trim());
  }

  return url.toString();
}

function hashText(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function stripHtmlText(value: string) {
  return value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stripBbCodeText(value: string) {
  return value
    .replace(/\[(\/)?(b|i|u|s|center|left|right|size|color|font|url|img|spoiler|quote|list|\\*)[^\]]*\]/giu, "")
    .replace(/\[\*\]/gu, "- ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function nexusTranslationSource(detail: NexusModDetail) {
  const description = detail.descriptionFormat === "html"
    ? stripHtmlText(detail.description)
    : stripBbCodeText(detail.description);

  return {
    summary: detail.summary.trim(),
    description
  };
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return String(record.value || record.label || record.name || record.title || "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(/[,，\s]+/u).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function groupIdList(value: unknown) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  }

  const single = String(value ?? "").trim();
  return single ? [single] : [];
}

const legacyTypeIdMap: Record<string, Record<string, string>> = {
  stardewvalley: {
    "1": "smapi",
    "2": "mods",
    "99": "unknown"
  },
  monsterhunterworld: {
    "1": "stracker",
    "2": "nativePc",
    "3": "plugins",
    "4": "unknown",
    "99": "unknown"
  },
  taleofimmortal: {
    "1": "modExportData",
    "2": "unknown",
    "99": "unknown"
  },
  stellarblade: {
    "1": "pak",
    "2": "ue4ss",
    "3": "mods",
    "4": "logicMods",
    "5": "scripts",
    "6": "root",
    "99": "unknown"
  }
};

function normalizeTypeName(value: string) {
  return value.trim().replace(/\s+/gu, "").toLowerCase();
}

function resolveStoredModType(
  adapter: GameAdapter,
  presetId: string,
  rawTypeId: unknown,
  rawTypeName: unknown,
  files: string[]
) {
  const rawId = String(rawTypeId ?? "").trim();
  const directType = adapter.modTypes.find((type) => type.id === rawId);
  if (directType) return directType;

  const mappedId = legacyTypeIdMap[presetId]?.[rawId];
  const mappedType = mappedId ? adapter.modTypes.find((type) => type.id === mappedId) : undefined;
  if (mappedType) return mappedType;

  const name = normalizeTypeName(String(rawTypeName ?? ""));
  if (name) {
    const namedType = adapter.modTypes.find((type) => normalizeTypeName(type.name) === name);
    if (namedType) return namedType;
  }

  const detectedId = adapter.checkModType(files);
  return adapter.modTypes.find((type) => type.id === detectedId) ?? adapter.modTypes[0];
}

function modInstallPriority(mod: Pick<LocalMod, "modTypeId" | "modTypeName" | "name">) {
  const text = `${mod.modTypeId} ${mod.modTypeName} ${mod.name}`.toLowerCase();
  const rules: Array<[RegExp, number]> = [
    [/(smapi|stracker|bepinex|melonloader|modengine|mod enabler|northstar|redhook)/u, 10],
    [/(reframework|ue4ss|script ?hook|cet|f4se|skse|sfse|bg3se)/u, 20],
    [/(nativepc|natives|data|archive|pak|mods|通用)/u, 50],
    [/(plugin|plugins|autorun|scripts|脚本)/u, 70],
    [/(patch|补丁|dlc|ui|model|模型|texture|材质)/u, 90],
    [/(unknown|未知|manual)/u, 200]
  ];

  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? 100;
}

function compareGameInstallOrder(left: LocalMod, right: LocalMod) {
  return modInstallPriority(left) - modInstallPriority(right) ||
    left.sortIndex - right.sortIndex ||
    left.createdAt - right.createdAt;
}

function strategyNeedsManagedUninstall(kind: string) {
  return [
    "bethesdaData",
    "bethesdaPluginFiles",
    "oblivionPlugins",
    "numberedPak",
    "watchDogsPatch",
    "bg3Pak",
    "redDeadAsi",
    "redDeadLml",
    "michangshengLinkedFolder",
    "michangshengDllPlugins",
    "legendPortraits",
    "inzoiModKit"
  ].includes(kind);
}

function normalizeInstallStrategy(value: unknown): CustomAdapterRule["install"] {
  if (!value || typeof value !== "object") {
    return { kind: "general", installPath: "", keepPath: true };
  }

  const strategy = value as Partial<CustomAdapterRule["install"]> & Record<string, unknown>;
  const installPath = String(strategy.installPath ?? "");
  const targetScope = strategy.targetScope === "documents" || strategy.targetScope === "appData"
    ? strategy.targetScope
    : undefined;

  switch (strategy.kind) {
    case "folder":
      return {
        kind: "folder",
        installPath,
        folderName: Array.isArray(strategy.folderName)
          ? strategy.folderName.map(String).filter(Boolean)
          : String(strategy.folderName || "mods"),
        include: Boolean(strategy.include),
        spare: strategy.spare !== false,
        targetScope
      };
    case "folderRoot":
      return { kind: "folderRoot", installPath, targetScope };
    case "file":
      return {
        kind: "file",
        installPath,
        fileName: String(strategy.fileName || ""),
        isExtname: Boolean(strategy.isExtname),
        commonParent: Boolean(strategy.commonParent),
        targetScope
      };
    case "fileSibling":
      return {
        kind: "fileSibling",
        installPath,
        fileName: String(strategy.fileName || ""),
        isExtname: Boolean(strategy.isExtname),
        targetScope
      };
    case "fileOnly":
      return {
        kind: "fileOnly",
        installPath,
        fileName: String(strategy.fileName || ""),
        isExtname: Boolean(strategy.isExtname),
        targetScope
      };
    case "fileMap":
      return {
        kind: "fileMap",
        installPath,
        dictionaryFile: String(strategy.dictionaryFile || "")
      };
    case "legendPortraits":
      return {
        kind: "legendPortraits",
        installPath,
        portraitFolders: Array.isArray(strategy.portraitFolders)
          ? strategy.portraitFolders.map(String).filter(Boolean)
          : []
      };
    case "manual":
      return { kind: "manual", reason: String(strategy.reason || "该自定义类型需要手动安装。") };
    case "general":
    default:
      return {
        kind: "general",
        installPath,
        keepPath: strategy.keepPath !== false,
        targetScope
      };
  }
}

function normalizeCustomAdapterRules(value: unknown): CustomAdapterRule[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((rule, index) => {
      if (!rule || typeof rule !== "object") return null;

      const record = rule as Record<string, unknown>;
      const detect = record.detect && typeof record.detect === "object"
        ? record.detect as Record<string, unknown>
        : {};
      const detectKind = ["always", "fileName", "extension", "pathPart"].includes(String(detect.kind))
        ? String(detect.kind) as CustomAdapterRule["detect"]["kind"]
        : "always";
      const name = String(record.name || `自定义类型 ${index + 1}`).trim();

      return {
        id: String(record.id || `custom-${index + 1}`),
        name,
        detect: {
          kind: detectKind,
          value: String(detect.value || "").trim()
        },
        install: normalizeInstallStrategy(record.install)
      };
    })
    .filter((rule): rule is CustomAdapterRule => Boolean(rule?.name));
}

function createCustomGameAdapter(game: ManagedGame): GameAdapter {
  const customTypes = normalizeCustomAdapterRules(game.customAdapterRules);
  const presetAdapter = game.presetId ? getGameAdapter(game.presetId) : commonAdapter;
  // HGMM Phase 2 修复:custom rules 与 preset adapter modTypes 合并(原设计是"完全替换",
  // 用户加一条 custom rule 就会丢掉预设的 pak/ue4ss/mods 等所有类型)。
  // 合并策略:custom 在前(优先级),preset 在后(id 冲突时 custom 赢)。
  const customTypeDefs = customTypes.map((rule) => ({
    id: rule.id,
    name: rule.name,
    install: rule.install
  }));
  const customIds = new Set(customTypeDefs.map(r => r.id));
  const presetTypeDefs = presetAdapter.modTypes.filter((t: { id: string }) => !customIds.has(t.id));
  const fallbackType = {
    id: "custom-root",
    name: "游戏根目录",
    install: {
      kind: "general",
      installPath: game.installPath || "",
      keepPath: true
    } as const
  };
  const finalTypes = customTypeDefs.length > 0
    ? [...customTypeDefs, ...presetTypeDefs]
    : [fallbackType];

  return {
    presetId: game.presetId || game.id,
    name: game.name,
    modTypes: finalTypes,
    checkModType(files) {
      // HGMM Phase 2 修复:checkModType 优先级应为
      //   1. preset adapter(具体的 pak/ue4ss/mods/logicMods/... 自动识别)
      //   2. 用户非-"always" custom rule(精确覆盖,如指定扩展名/文件名/路径段)
      //   3. 用户 "always" custom rule 兜底(游戏根目录,匹配不到的具体文件)
      //
      // 原实现把 custom rules 放在最前,导致 HGMM 1.0 导入的
      // detect.kind="always" 兜底规则抢先匹配所有文件,modTypeId 错位到
      // custom_type_xxx,install 用错路径(游戏根目录或用户自定义路径)
      // 而不是 preset adapter 的 Pak/Content/Paks/~mods。
      const presetId = presetAdapter.checkModType(files);
      // preset adapter 认出来了 → 直接用
      if (presetId && presetId !== "root") return presetId;

      // preset 没认出(返回 root/unknown),再试 custom rules
      const alwaysRule = customTypes.find((rule) => rule.detect.kind === "always");
      for (const rule of customTypes) {
        if (rule.detect.kind === "always") continue;  // always 留到最后兜底
        const value = rule.detect.value.toLowerCase().replace(/^\./u, "");

        if (!value) continue;
        if (rule.detect.kind === "fileName" && files.some((file) => baseName(file).toLowerCase() === value)) return rule.id;
        if (rule.detect.kind === "extension" && files.some((file) => baseName(file).toLowerCase().endsWith(`.${value}`))) return rule.id;
        if (rule.detect.kind === "pathPart" && files.some((file) =>
          file.replace(/\\/g, "/").split("/").some((part) => part.toLowerCase() === value)
        )) {
          return rule.id;
        }
      }

      // 都没有命中,用 always 兜底;没有 always 就用 preset 的 root
      return alwaysRule?.id ?? presetId;
    }
  };
}

function adapterForGame(game: ManagedGame) {
  return game.customAdapterRules.length > 0
    ? createCustomGameAdapter(game)
    : getGameAdapter(game.presetId);
}

function modFolderName(rootPath: string, fallback: string) {
  const folder = baseName(rootPath);
  return /^\d+$/u.test(folder) ? folder : fallback;
}

function isExternalUrl(url: string) {
  return /^https?:\/\/www\.nexusmods\.com\//i.test(url);
}

function isNexusUpdateSource(value: unknown): value is ModUpdateSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<ModUpdateSource>;

  return source.type === "nexus" &&
    typeof source.gameDomain === "string" &&
    typeof source.modId === "string" &&
    typeof source.fileId === "string";
}

function normalizeModUpdateSource(value: unknown): ModUpdateSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<ModUpdateSource>;

  // 怀沙:精选 mod 来源(无 gameDomain/fileVersion/filePageUrl 等字段,填空字符串)
  // 不走 Nexus 校验路径 — featured mod 没有 gameDomain,isNexusUpdateSource 会拒掉
  if (source.type === "featured") {
    return {
      type: "featured",
      gameDomain: "",
      gameName: String(source.gameName || ""),
      modId: String(source.modId || ""),
      fileId: String(source.fileId || ""),
      fileName: String(source.fileName || ""),
      fileVersion: "",
      modVersion: "",
      categoryName: "",
      modPageUrl: "",
      filePageUrl: "",
      coverImage: String(source.coverImage || "") || undefined,
      downloadedAt: Number(source.downloadedAt) || Date.now(),
    };
  }

  // Nexus 来源(原逻辑)
  if (!isNexusUpdateSource(value)) return undefined;
  const check = value.check && typeof value.check === "object"
    ? value.check as Partial<ModUpdateCheck>
    : undefined;

  return {
    type: "nexus",
    gameDomain: value.gameDomain,
    gameName: String(value.gameName || ""),
    modId: value.modId,
    fileId: value.fileId,
    fileName: String(value.fileName || ""),
    fileVersion: String(value.fileVersion || ""),
    modVersion: String(value.modVersion || ""),
    categoryName: String(value.categoryName || ""),
    modPageUrl: String(value.modPageUrl || nexusModWebsite(value.gameDomain, value.modId)),
    filePageUrl: String(value.filePageUrl || nexusModWebsite(value.gameDomain, value.modId, value.fileId)),
    coverImage: String(value.coverImage || "") || undefined,
    downloadedAt: Number(value.downloadedAt) || Date.now(),
    check: check
      ? {
        status: ["latest", "available", "unsupported", "failed"].includes(String(check.status))
          ? check.status as ModUpdateCheck["status"]
          : "unknown",
        checkedAt: Number(check.checkedAt) || 0,
        message: String(check.message || ""),
        latestFileId: String(check.latestFileId || ""),
        latestFileName: String(check.latestFileName || ""),
        latestVersion: String(check.latestVersion || ""),
        latestUploadedAt: String(check.latestUploadedAt || ""),
        detailsUrl: String(check.detailsUrl || "")
      }
      : undefined
  };
}

interface NexusDownloadAuthorization {
  key?: string;
  expires?: string;
}

interface CustomGameInput {
  name: string;
  path: string;
  exeNames: string[];
  installPath: string;
  launchArgs: string;
  coverUrl: string;
}

interface CustomAdapterRuleInput {
  name: string;
  detectKind: CustomAdapterRule["detect"]["kind"];
  detectValue: string;
  installKind: "general" | "folderRoot" | "folder" | "file" | "fileSibling" | "manual";
  installPath: string;
  installName: string;
  keepPath: boolean;
}

const fallbackData: AppData = {
  dataVersion: DATA_VERSION,
  settings: {
    storagePath: "",
    tagColors: {},
    useSymlinkInstall: false,
    nexusApiKey: "",
    nexusAccessToken: "",
    nexusRefreshToken: "",
    nexusTokenExpiresAt: 0,
    nexusUser: null,
    translationProvider: "off",
    translationTargetLang: "zh-CN",
    baiduTranslateAppId: "",
    baiduTranslateSecret: "",
    youdaoTranslateAppKey: "",
    youdaoTranslateSecret: "",
    tencentTranslateSecretId: "",
    tencentTranslateSecretKey: "",
    tencentTranslateRegion: "ap-guangzhou",
    volcengineTranslateAccessKeyId: "",
    volcengineTranslateSecretAccessKey: "",
    volcengineTranslateRegion: "cn-north-1",
    ollamaTranslateBaseUrl: "http://127.0.0.1:11434",
    ollamaTranslateModel: "",
    ollamaTranslateTimeoutMs: 120000,
    theme: "dark",
    language: "zh-CN",
    defaultTab: "manager",
    autoImportAfterDownload: true,
    downloadEngine: "builtin",
    aria2ExecutablePath: "",
    aria2MaxConnections: 4,
    proxyEnabled: false,
    proxyUrl: "",
    preferDirectoryGamePicker: false,
    launchAtStartup: false,
    allowGameRunningChanges: false,
    debugMode: false,
    showDebugInfo: false,
    autoCheckUpdates: false,
    appUpdateUrl: "https://api.hs2049.cn/tools/hgmm2",//HGMM 升级检查 URL(自建 REST endpoint,字段大写 Version/Description/DownloadUrl)
    lastAppUpdateCheckAt: 0,
    lastAutoUpdateCheckAt: 0
  },
  games: [],
  activeGameId: "",
  modProfiles: [],
  mods: [],
  downloads: [],
  logs: [],
  backups: [],
  dataBackups: [],
  translationCache: {},
  // FEATURE-020(2026-10-08):精选 mod 缓存复用,key=FeaturedMod.id,value=updatedAt
  featuredCache: {}
};

function normalizeAppData(rawData: Partial<AppData> | null | undefined): AppData {
  const data = rawData ?? {};
  const settings = (data.settings ?? {}) as Partial<AppSettings>;
  const games = Array.isArray(data.games) ? data.games : [];
  const rawModProfiles = Array.isArray(data.modProfiles) ? data.modProfiles : [];
  const mods = Array.isArray(data.mods) ? data.mods : [];
  const downloads = Array.isArray(data.downloads) ? data.downloads : [];
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const backups = Array.isArray(data.backups) ? data.backups : [];
  const dataBackups = Array.isArray(data.dataBackups) ? data.dataBackups : [];
  const rawTranslationCache = data.translationCache && typeof data.translationCache === "object"
    ? data.translationCache
    : {};
  const modProfiles: ModProfile[] = rawModProfiles
    .filter((profile) => profile && typeof profile === "object")
    .map((profile, index) => ({
      id: String(profile.id || `profile_${profile.gameId || "game"}_${index + 1}`),
      gameId: String(profile.gameId || ""),
      name: String(profile.name || `配置档案 ${index + 1}`).trim() || `配置档案 ${index + 1}`,
      enabledModIds: groupIdList(profile.enabledModIds),
      modOrder: groupIdList(profile.modOrder),
      createdAt: Number(profile.createdAt) || Date.now(),
      updatedAt: Number(profile.updatedAt) || Date.now()
    }))
    .filter((profile) => profile.gameId);

  return {
    dataVersion: Number(data.dataVersion) || DATA_VERSION,
    settings: {
      ...fallbackData.settings,
      ...settings,
      tagColors: settings.tagColors ?? {},
      // 怀沙:用户要求默认直接拷贝,不再强制软链;读设置项
      useSymlinkInstall: false,
      nexusApiKey: settings.nexusApiKey ?? "",
      nexusAccessToken: settings.nexusAccessToken ?? "",
      nexusRefreshToken: settings.nexusRefreshToken ?? "",
      nexusTokenExpiresAt: Number(settings.nexusTokenExpiresAt) || 0,
      nexusUser: settings.nexusUser ?? null,
      translationProvider: ["google-gtx", "baidu", "youdao", "tencent", "volcengine", "ollama"].includes(String(settings.translationProvider))
        ? settings.translationProvider as AppSettings["translationProvider"]
        : "off",
      translationTargetLang: "zh-CN",
      baiduTranslateAppId: settings.baiduTranslateAppId ?? "",
      baiduTranslateSecret: settings.baiduTranslateSecret ?? "",
      youdaoTranslateAppKey: settings.youdaoTranslateAppKey ?? "",
      youdaoTranslateSecret: settings.youdaoTranslateSecret ?? "",
      tencentTranslateSecretId: settings.tencentTranslateSecretId ?? "",
      tencentTranslateSecretKey: settings.tencentTranslateSecretKey ?? "",
      tencentTranslateRegion: settings.tencentTranslateRegion ?? "ap-guangzhou",
      volcengineTranslateAccessKeyId: settings.volcengineTranslateAccessKeyId ?? "",
      volcengineTranslateSecretAccessKey: settings.volcengineTranslateSecretAccessKey ?? "",
      volcengineTranslateRegion: settings.volcengineTranslateRegion ?? "cn-north-1",
      ollamaTranslateBaseUrl: settings.ollamaTranslateBaseUrl ?? "http://127.0.0.1:11434",
      ollamaTranslateModel: settings.ollamaTranslateModel ?? "",
      ollamaTranslateTimeoutMs: Number(settings.ollamaTranslateTimeoutMs) || 120000,
      theme: settings.theme ?? "dark",
      language: settings.language ?? "zh-CN",
      defaultTab: settings.defaultTab === "backup" || settings.defaultTab === "nexus"
        ? "manager"
        : settings.defaultTab ?? "manager",
      autoImportAfterDownload: settings.autoImportAfterDownload ?? true,
      downloadEngine: settings.downloadEngine === "aria2" ? "aria2" : "builtin",
      aria2ExecutablePath: settings.aria2ExecutablePath ?? "",
      aria2MaxConnections: Math.max(1, Math.min(16, Number(settings.aria2MaxConnections) || 4)),
      proxyEnabled: settings.proxyEnabled ?? false,
      proxyUrl: settings.proxyUrl ?? "",
      preferDirectoryGamePicker: settings.preferDirectoryGamePicker ?? false,
      launchAtStartup: settings.launchAtStartup ?? false,
      allowGameRunningChanges: settings.allowGameRunningChanges ?? false,
      debugMode: settings.debugMode ?? false,
      showDebugInfo: settings.showDebugInfo ?? false,
      autoCheckUpdates: settings.autoCheckUpdates ?? false,
      // HGMM Phase 5:老 mayfly 上游 URL 自动迁移到自建 endpoint
      appUpdateUrl: settings.appUpdateUrl && !settings.appUpdateUrl.includes("mayflyyx.com")
        ? settings.appUpdateUrl
        : fallbackData.settings.appUpdateUrl,
      lastAppUpdateCheckAt: Number(settings.lastAppUpdateCheckAt || settings.lastAutoUpdateCheckAt) || 0,
      lastAutoUpdateCheckAt: Number(settings.lastAutoUpdateCheckAt) || 0
    },
    games: games.map((game) => ({
      ...game,
      launchArgs: game.launchArgs ?? "",
      coverUrl: game.coverUrl ?? "",
      typeNames: Array.isArray(game.typeNames) ? game.typeNames : [],
      customAdapterRules: normalizeCustomAdapterRules((game as Partial<ManagedGame>).customAdapterRules)
    })),
    activeGameId: typeof data.activeGameId === "string" ? data.activeGameId : "",
    modProfiles,
    mods: mods.map((mod, index) => ({
      ...mod,
      sortIndex: Number.isFinite(Number(mod.sortIndex)) ? Number(mod.sortIndex) : index,
      modTypeId: mod.modTypeId ?? "root",
      modTypeName: mod.modTypeName ?? "游戏根目录",
      deployedFiles: mod.deployedFiles ?? [],
      website: mod.website ?? "",
      description: mod.description ?? "",
      coverImage: mod.coverImage ?? "",
      requirements: stringList(mod.requirements),
      tags: stringList(mod.tags),
      updateSource: normalizeModUpdateSource((mod as Partial<LocalMod>).updateSource)
    })),
    downloads: downloads.map((task) => ({
      ...task,
      status: task.status ?? "queued",
      receivedBytes: task.receivedBytes ?? 0,
      totalBytes: task.totalBytes ?? 0,
      coverImage: task.coverImage ?? "",
      updateSource: normalizeModUpdateSource((task as Partial<DownloadTask>).updateSource),
      updateTargetModId: typeof task.updateTargetModId === "string" ? task.updateTargetModId : "",
      error: task.error ?? ""
    })),
    logs: logs
      .filter((entry) => entry && typeof entry.message === "string")
      .slice(-300)
      .map((entry) => ({
        id: entry.id || createId("log"),
        level: entry.level === "info" ? "info" : "error",
        source: entry.source || "app",
        message: entry.message,
        detail: entry.detail || "",
        createdAt: Number(entry.createdAt) || Date.now()
      })),
    backups: backups
      .filter((backup) => backup && typeof backup.outputPath === "string")
      .map((backup) => ({
        id: backup.id || createId("backup"),
        gameId: backup.gameId || "",
        gameName: backup.gameName || "",
        name: backup.name || baseName(backup.outputPath),
        sourcePath: backup.sourcePath || "",
        outputPath: backup.outputPath,
        size: Number(backup.size) || 0,
        filesCount: Number(backup.filesCount) || 0,
        createdAt: Number(backup.createdAt) || Date.now()
      })),
    dataBackups: dataBackups
      .filter((backup) => backup && typeof backup.outputPath === "string")
      .map((backup) => ({
        id: backup.id || createId("data_backup"),
        name: backup.name || baseName(backup.outputPath),
        outputPath: backup.outputPath,
        size: Number(backup.size) || 0,
        createdAt: Number(backup.createdAt) || Date.now()
      })),
    translationCache: Object.fromEntries(
      Object.entries(rawTranslationCache)
        .filter(([, entry]) => entry && typeof entry === "object" && typeof entry.text === "string")
        .slice(-300)
        .map(([key, entry]) => {
          const record = entry as { text: string; createdAt?: number };
          return [key, {
            text: record.text,
            createdAt: Number(record.createdAt) || Date.now()
          }];
        })
    ),
    // FEATURE-020(2026-10-08):精选 mod 缓存复用
    //   老数据 runtime fallback:字段缺失时降级空对象,客户端按"每次都下"baseline
    featuredCache: data.featuredCache && typeof data.featuredCache === "object"
      ? { ...data.featuredCache }
      : {}
  };
}

export const useLibraryStore = defineStore("library", () => {
  const initialized = ref(false);
  const busy = ref(false);
  const error = ref("");
  const updateCheckResult = ref({ visible: false, available: 0, failed: 0 });
  // 怀沙:切换游戏时延迟重新打点升级检查的定时器句柄
  let appUpdateRecheckTimer: number | undefined;
  const packageProgress = ref<PackageProgress>({
    visible: false,
    operation: "",
    phase: "",
    current: 0,
    total: 0,
    message: ""
  });
  const updateBatchProgress = ref<UpdateBatchProgress>({
    visible: false,
    current: 0,
    total: 0,
    message: ""
  });
  const appUpdateChecking = ref(false);
  const appUpdateDialogVisible = ref(false);
  const appUpdateInfo = ref<AppUpdateInfo | null>(null);
  const appUpdateCurrentVersion = ref("");
  const appUpdateMessage = ref("");
  const settings = ref({ ...fallbackData.settings });
  const games = ref<ManagedGame[]>([]);
  const activeGameId = ref("");
  const modProfiles = ref<ModProfile[]>([]);
  const nexusPresetId = ref("");
  const mods = ref<LocalMod[]>([]);

  /** HGMM Phase 5:从老数据推断 mod 来源(用于数据迁移)
   *  判定优先级:
   *  1. updateSource.type === "nexus" → Nexus
   *  2. sourcePath 含 downloads\custom\ 前缀(精选 mod 下载路径规则)→ 精选
   *  3. 其他 → 导入(默认) */
  function inferOriginFromLegacy(mod: LocalMod): ModOriginKind {
    if (mod.updateSource?.type === "nexus") return "nexus";
    if (mod.sourcePath && mod.sourcePath.toLowerCase().includes("downloads\\custom\\")) {
      return "featured";
    }
    return "imported";
  }

  /** HGMM Phase 5:迁移老 mod,根据启发式规则补加来源 tag */
  function migrateOriginTags() {
    const allOriginTagValues = Object.values(MOD_ORIGIN_TAGS);
    let touched = 0;
    mods.value = mods.value.map((mod) => {
      const hasOriginTag = Array.isArray(mod.tags) && mod.tags.some((t) => (allOriginTagValues as string[]).includes(t));
      if (hasOriginTag) return mod;
      touched += 1;
      const origin = inferOriginFromLegacy(mod);
      return {
        ...mod,
        tags: appendOriginTag(mod.tags, origin)
      };
    });
    if (touched > 0) {
      void recordLog("info", "library", `mod 来源 tag 迁移: ${touched} 条`);
    }
  }

  /** HGMM Phase 5:注册 5 个来源 tag 的默认颜色到 settings.tagColors */
  function registerOriginTagColors() {
    const defaults: Record<string, string> = {
      [MOD_ORIGIN_TAGS.featured]: "#66c0f4",       // Steam 蓝
      [MOD_ORIGIN_TAGS.nexus]: "#65d289",          // Steam 绿
      [MOD_ORIGIN_TAGS.steamWorkshop]: "#c084fc",  // 紫色(预留)
      [MOD_ORIGIN_TAGS.imported]: "#f5b85c",       // 橙色
      [MOD_ORIGIN_TAGS.custom]: "#8f98a0"          // 灰色
    };
    let changed = false;
    const next = { ...settings.value.tagColors };
    for (const [tag, color] of Object.entries(defaults)) {
      if (!next[tag]) {
        next[tag] = color;
        changed = true;
      }
    }
    if (changed) {
      settings.value.tagColors = next;
    }
  }

  const downloads = ref<DownloadTask[]>([]);
  const logs = ref<AppLogEntry[]>([]);
  const backups = ref<BackupEntry[]>([]);
  const dataBackups = ref<DataBackupEntry[]>([]);
  const translationCache = ref<AppData["translationCache"]>({});
  // FEATURE-020(2026-10-08):精选 mod 缓存复用,key=FeaturedMod.id,value=JSON updatedAt
  //   重装同版本精选 mod 时,客户端用这个判断要不要复用本地 .zip(省 CDN 流量)
  const featuredCache = ref<Record<string, string>>({});
  const backupContents = ref<Record<string, Array<{ path: string; isDirectory: boolean; size: number }>>>({});
  const search = ref("");
  const selectedTypeId = ref("all");
  const selectedTag = ref("all");
  const sortMode = ref<"custom" | "createdDesc" | "createdAsc" | "nameAsc" | "nameDesc" | "installedFirst">("createdDesc");
  const selectedModIds = ref<string[]>([]);
  const selectedProfileId = ref("");
  const profileApplying = ref(false);
  const updateCheckingIds = ref<string[]>([]);
  const presetSearch = ref("");
  const installPlans = ref<Record<string, InstallPlan>>({});
  const nexusSearch = ref("");
  const nexusPage = ref(1);
  const nexusPageSize = ref(20);
  const nexusSort = ref<"default" | "updatedAt" | "createdAt" | "downloads">("downloads");
  const nexusCategory = ref("");
  const nexusLanguage = ref("");
  const nexusTag = ref("");
  const nexusFacets = ref<NexusModListResult["facets"]>({
    categoryName: [],
    languageName: [],
    tag: []
  });
  const nexusMods = ref<NexusModItem[]>([]);
  const nexusTotalCount = ref(0);
  const nexusTotalPages = ref(0);
  const nexusLoading = ref(false);
  const nexusDetailLoading = ref(false);
  const nexusLoginLoading = ref(false);
  const nexusTranslationLoading = ref(false);
  const nexusTranslationVisible = ref(false);
  const nexusTranslationError = ref("");
  const nexusTranslatedSummary = ref("");
  const nexusTranslatedDescription = ref("");
  const selectedNexusMod = ref<NexusModDetail | null>(null);
  // ====== HGMM 精选 mod(Phase 1B) ======
  // 当前激活游戏的精选 mod 列表(fetchHGMMFeatured 归一化结果)
  const featuredMods = ref<FeaturedMod[]>([]);

  // FEATURE-020(2026-10-08):精选 mod 缓存复用 helpers
  //   用法:installAbsoluteFeatured / installOneFeatured 入口判断 updatedAt 一致 +
  //   .zip 还在 → 跳过 downloadFile / downloadCustomUrl,省 CDN 流量
  //   降级路径(updatedAt 缺失 / 缓存未匹配 / .zip 不存在)→ 跟老逻辑一致走下载

  /** 计算精选 mod .zip 缓存路径(settings.storagePath\downloads\custom\<fileName>)
   *  返回 null = 未设置 storagePath */
  function computeFeaturedArchivePath(mod: { downloadUrl: string; name: string }): string | null {
    if (!settings.value.storagePath) return null;
    const urlExtMatch = mod.downloadUrl.match(/\.([a-z0-9]+)(?:\?[^/]*)?$/iu);
    const urlExt = urlExtMatch ? urlExtMatch[1].toLowerCase() : "";
    const archiveExt = ["zip", "7z", "rar"].includes(urlExt) ? urlExt : "zip";
    const fileName = `${sanitizeFileName(mod.name)}.${archiveExt}`;
    return `${settings.value.storagePath}\\downloads\\custom\\${fileName}`;
  }

  function getFeaturedCacheUpdatedAt(modId: string): string | undefined {
    return featuredCache.value[modId];
  }

  function setFeaturedCacheUpdatedAt(modId: string, updatedAt: string): void {
    if (featuredCache.value[modId] === updatedAt) return;
    featuredCache.value = { ...featuredCache.value, [modId]: updatedAt };
  }

  /** FEATURE-020:精选 mod 缓存复用判断
   *  - mod.updatedAt 缺失 → false(降级每次都下)
   *  - featuredCache[modId] 不一致 → false(版本变了/新 mod)
   *  - .zip 文件不在 → false(用户清理过,走下载重下)
   *  - 全部满足 → true(跳过 CDN 下载,直接走解压/import)
   */
  async function shouldReuseFeaturedArchive(mod: FeaturedMod): Promise<boolean> {
    if (!mod.updatedAt) return false;
    if (getFeaturedCacheUpdatedAt(mod.id) !== mod.updatedAt) return false;
    const archivePath = computeFeaturedArchivePath(mod);
    if (!archivePath) return false;
    try {
      return await window.mayfly.exists(archivePath);
    } catch {
      return false;
    }
  }
  // 顶层 Delete[] 清理规则(Phase 1B 仅展示,不自动执行)
  const featuredDeleteRules = ref<RawCleanupRule[]>([]);
  // 顶层 Enable:false → 全局灰度关闭,UI 提示用户
  const featuredGlobalEnabled = ref(true);
  // 精选 mod 加载状态(网络请求期间)
  const featuredLoading = ref(false);
  // 用户已激活的互斥分组(Set<groupId>)
  // iGroupID(Array 字段)>0 时,同组其他 mod 视为禁用
  const featuredActiveGroupIds = ref<Set<number>>(new Set());
  // manager tab 内的 sub-tab:library / featured / nexus / bigmod / steamworkshop
  // 默认 library(玩家高频场景:管理已装的 mod;看精选/Nexus 是偶发动作)
  const activeSubTab = ref<"featured" | "library" | "nexus" | "bigmod" | "steamworkshop">("library");
  // 当前正在一键安装的精选 mod id(用于按钮显示 spinner)
  // installFeaturedMod 串行执行,同一时刻最多一个 mod 在安装
  const installingFeaturedId = ref<string | null>(null);
  // ====== HGMM 大型 mod(Phase 4) ======
  // 按 presetId 索引(整文件一次性拉取,内存切片)
  const bigMods = ref<Record<string, BigMod[]>>({});
  const bigModLoading = ref(false);
  // 独立错误,不复用全局 library.error(避免跟 featured/import 错误互相覆盖)
  const bigModError = ref("");
  // 首次 fetch 完成时间戳(留作未来缓存失效)
  const bigModLoadedAt = ref(0);
  const tagPalette = ["#66c0f4", "#65d289", "#f5b85c", "#ff5e5e", "#c084fc", "#7dcdfa"];

  const activeGame = computed(() =>
    games.value.find((game) => game.id === activeGameId.value) ?? null
  );

  /** 当前 activeGame 的大型 mod 切片(空数组 = 未收录) */
  const activeBigMods = computed<BigMod[]>(
    () => bigMods.value[activeGame.value?.presetId ?? ""] ?? []
  );

  const visibleGamePresets = computed(() =>
    gamePresets.filter(
      (preset) =>
        !HIDDEN_PRESET_IDS.has(preset.id) &&
        HGMM_VISIBLE_PRESET_IDS.has(preset.id)
    )
  );

  const nexusPresets = computed(() =>
    visibleGamePresets.value
  );

  const nexusPreset = computed(() =>
    nexusPresets.value.find((preset) => preset.id === nexusPresetId.value) ??
    nexusPresets.value[0] ??
    null
  );

  const presetList = computed(() => {
    const keyword = presetSearch.value.trim().toLowerCase();

    if (!keyword) {
      return visibleGamePresets.value;
    }

    return visibleGamePresets.value.filter((preset) =>
      JSON.stringify(preset).toLowerCase().includes(keyword)
    );
  });

  const presetCount = computed(() => visibleGamePresets.value.length);

  const activeMods = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    let list = mods.value.filter((mod) => mod.gameId === activeGameId.value);

    if (selectedProfileId.value) {
      const profile = activeProfiles.value.find((p) => p.id === selectedProfileId.value);
      if (profile) {
        list = list.filter((mod) => profile.enabledModIds.includes(mod.id));
      }
    }

    if (selectedTypeId.value !== "all") {
      list = list.filter((mod) => mod.modTypeId === selectedTypeId.value);
    }

    if (selectedTag.value !== "all") {
      list = list.filter((mod) => mod.tags.includes(selectedTag.value));
    }

    if (!keyword) {
      return sortMods(list);
    }

    return sortMods(list.filter((mod) =>
      [mod.name, mod.author, mod.version, mod.sourcePath, mod.modTypeName, mod.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    ));
  });

  const activeTags = computed(() => {
    const tags = mods.value
      .filter((mod) => mod.gameId === activeGameId.value)
      .flatMap((mod) => mod.tags);

    return [...new Set(tags)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  });

  const activeProfiles = computed(() =>
    modProfiles.value
      .filter((profile) => profile.gameId === activeGameId.value)
      .sort((left, right) => left.createdAt - right.createdAt)
  );

  const installedCount = computed(
    () => activeMods.value.filter((mod) => mod.installed).length
  );

  const canReorderMods = computed(() =>
    !search.value.trim() &&
    selectedTypeId.value === "all" &&
    selectedTag.value === "all" &&
    !selectedProfileId.value
  );

  const selectedMods = computed(() =>
    activeMods.value.filter((mod) => selectedModIds.value.includes(mod.id))
  );

  const activeUpdateAvailableCount = computed(() =>
    mods.value.filter((mod) =>
      mod.gameId === activeGameId.value &&
      mod.updateSource?.check?.status === "available"
    ).length
  );

  const activeAdapter = computed(() =>
    activeGame.value ? adapterForGame(activeGame.value) : null
  );

  const activeDownloads = computed(() =>
    [...downloads.value]
      .sort((a, b) => b.createdAt - a.createdAt)
  );

  const nexusAuthorized = computed(() =>
    Boolean(
      settings.value.nexusAccessToken?.trim() ||
      settings.value.nexusApiKey?.trim() ||
      settings.value.nexusUser?.key?.trim()
    )
  );

  function nexusRequestAuth() {
    return {
      apiKey: settings.value.nexusApiKey,
      accessToken: settings.value.nexusAccessToken
    };
  }

  function activeProxyUrl() {
    return settings.value.proxyEnabled ? settings.value.proxyUrl.trim() : "";
  }

  function managedToolCandidates(fileNameValue: string) {
    const normalizedFileName = fileNameValue.toLowerCase();

    return activeMods.value
      .flatMap((mod) => mod.files
        .filter((file) => fileName(file).toLowerCase() === normalizedFileName)
        .map((file) => joinRelativePath(mod.rootPath, file))
      )
      .filter(Boolean);
  }

  function managedToolCandidatesForStrategy(strategy: { kind: string; managedToolFileName?: string }) {
    return strategy.kind === "bg3Pak" && strategy.managedToolFileName
      ? managedToolCandidates(strategy.managedToolFileName)
      : [];
  }

  function toData(): AppData {
    const data = {
      dataVersion: DATA_VERSION,
      settings: settings.value,
      games: games.value,
      activeGameId: activeGameId.value,
      modProfiles: modProfiles.value,
      mods: mods.value,
      downloads: downloads.value,
      logs: logs.value,
      backups: backups.value,
      dataBackups: dataBackups.value,
      translationCache: translationCache.value,
      featuredCache: featuredCache.value
    };

    return JSON.parse(JSON.stringify(data)) as AppData;
  }

  function getGameModRoot(game: ManagedGame) {
    return `${settings.value.storagePath}\\mods\\${sanitizeFileName(game.name)}`;
  }

  function toPortableModInfo(mod: LocalMod, index: number, usedIds: Set<number>) {
    // BUG-029(2026-10-09):写入 mod.json 时 id 保证唯一
    //   旧逻辑直接用 modFolderName(rootPath, fallback) 算 id,
    //   两个 mod 的 rootPath 末尾都是纯数字(如 ...\Palworld\1 和 ...\Palworld\1)
    //   时会生成同 id → 写出的 mod.json 自己就坏 → 启动时 loadModsFromGameFiles
    //   反向污染主数据(两条 legacy_xxx_1 撞 id)。
    //   现在加 usedIds 兜底:撞 id 就 +1 跳过,保证写出的 mod.json 一定唯一。
    let id = Number(modFolderName(mod.rootPath, String(index + 1))) || index + 1;
    while (usedIds.has(id)) {
      id += 1;
    }
    usedIds.add(id);
    return {
      id,
      modName: mod.name,
      fileName: baseName(mod.sourcePath),
      modFiles: mod.files,
      modVersion: mod.version || "1.0.0",
      modAuthor: mod.author,
      modWebsite: mod.website,
      modDesc: mod.description,
      cover: mod.coverImage,
      weight: index + 1,
      isInstalled: mod.installed,
      from: "Customize",
      tags: mod.tags,
      modType: mod.modTypeId,
      advanced: {
        deployedFiles: mod.deployedFiles,
        updateSource: mod.updateSource
      }
    };
  }

  async function syncGameModFiles() {
    if (!settings.value.storagePath) return;

    for (const game of games.value) {
      const gameMods = mods.value
        .filter((mod) => mod.gameId === game.id)
        .sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt);
      // BUG-029(2026-10-09):每个 game 用独立 Set 去重 id,保证写出的 mod.json 唯一
      const usedPortableIds = new Set<number>();
      const gameRoot = getGameModRoot(game);
      const tags = [...new Set(gameMods.flatMap((mod) => mod.tags))]
        .filter(Boolean)
        .map((tag, index) => ({
          id: index + 1,
          name: tag,
          label: tag,
          value: tag,
          color: settings.value.tagColors[tag] ?? ""
        }));

      await window.mayfly.writeJsonFile(
        `${gameRoot}\\mod.json`,
        toPlain(gameMods.map((mod, index) => toPortableModInfo(mod, index, usedPortableIds)))
      );
      await window.mayfly.writeJsonFile(`${gameRoot}\\tags.json`, toPlain(tags));
    }
  }

  async function persist() {
    await window.mayfly.writeStore(DATA_FILE, toData());
    await syncGameModFiles();
  }

  async function migrateModCachesToGameLayout() {
    if (!settings.value.storagePath) return;

    const nextFolderByGame = new Map<string, number>();
    const nextFolder = (game: ManagedGame) => {
      const current = nextFolderByGame.get(game.id);
      if (current) {
        nextFolderByGame.set(game.id, current + 1);
        return current;
      }

      const maxFolder = Math.max(
        0,
        ...mods.value
          .filter((mod) => mod.gameId === game.id)
          .map((mod) => Number(modFolderName(mod.rootPath, "0")) || 0)
      );
      nextFolderByGame.set(game.id, maxFolder + 2);
      return maxFolder + 1;
    };
    const migrated: LocalMod[] = [];

    for (const mod of mods.value) {
      const game = games.value.find((item) => item.id === mod.gameId);
      if (!game || mod.installed) {
        migrated.push(mod);
        continue;
      }

      const alreadyGameLayout =
        mod.rootPath.startsWith(`${getGameModRoot(game)}\\`) &&
        /^\d+$/u.test(baseName(mod.rootPath));

      if (alreadyGameLayout || !(await window.mayfly.exists(mod.rootPath))) {
        migrated.push(mod);
        continue;
      }

      try {
        const result = await window.mayfly.migrateModCacheFolder({
          sourcePath: mod.rootPath,
          storagePath: settings.value.storagePath,
          gameName: game.name,
          folderName: String(nextFolder(game))
        });

        migrated.push({
          ...mod,
          rootPath: result.rootPath,
          files: result.files,
          coverImage: result.coverImage ?? mod.coverImage,
          updatedAt: Date.now()
        });
      } catch (caught) {
        await recordLog(
          "error",
          "migration",
          `迁移 Mod 缓存失败：${mod.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
        migrated.push(mod);
      }
    }

    mods.value = migrated;
  }

  async function loadModsFromGameFiles() {
    if (!settings.value.storagePath) return;

    const nextModsByGame = new Map<string, LocalMod[]>();
    let nextTagColors = { ...settings.value.tagColors };

    for (const game of games.value) {
      // BUG-029(2026-10-09):不再无条件用 mod.json 覆盖主数据
      //   坏 mod.json(老 mayfly 写时 id 不唯一)会反向污染 huaisha-library.json,
      //   导致 PST/卡顿两条 mod 都生成 legacy_xxx_1 → UI/卸载传染。
      //   现在只在主数据里没该 game 的 mod 时才用 mod.json 兜底迁移
      //   (正常用户主数据已有 mod → 跳过;主数据丢了想恢复的用户场景手动重装即可)
      if (mods.value.some((mod) => mod.gameId === game.id)) {
        continue;
      }

      const gameRoot = getGameModRoot(game);
      const modJsonPath = `${gameRoot}\\mod.json`;

      if (!(await window.mayfly.exists(modJsonPath))) {
        continue;
      }

      try {
        const rawMods = await window.mayfly.readJsonFile<Array<Record<string, unknown>>>(modJsonPath);
        const rawTagsPath = `${gameRoot}\\tags.json`;

        if (await window.mayfly.exists(rawTagsPath)) {
          const rawTags = await window.mayfly.readJsonFile<Array<Record<string, unknown>>>(rawTagsPath);
          for (const tag of Array.isArray(rawTags) ? rawTags : []) {
            const value = String(tag.value || tag.label || tag.name || tag.title || "").trim();
            const color = String(tag.color || "").trim();
            if (value && color) {
              nextTagColors[value] = color;
            }
          }
        }

        if (!Array.isArray(rawMods)) continue;

        const adapter = adapterForGame(game);
        // BUG-029(2026-10-09):legacy id 撞 numericId 时加随机后缀(双保险)
        //   修 1 之后这条函数基本走不到,但万一有用户主数据丢失需要兜底迁移时,
        //   防止坏 mod.json 里 numericId 重复导致生成两条同 id 的 legacy mod
        const usedLegacyIds = new Set<string>();
        const parsedMods: LocalMod[] = rawMods.map((item, index) => {
          const numericId = String(item.id || index + 1);
          const rootPath = `${gameRoot}\\${sanitizeFileName(numericId)}`;
          const advanced = item.advanced && typeof item.advanced === "object"
            ? item.advanced as Record<string, unknown>
            : {};
          const tags = stringList(item.tags);
          const files = Array.isArray(item.modFiles) ? item.modFiles.map(String) : [];
          const modType = resolveStoredModType(
            adapter,
            game.presetId,
            item.modType ?? item.modTypeId,
            item.modTypeName,
            files
          );

          let legacyId = `legacy_${game.id}_${numericId}`;
          if (usedLegacyIds.has(legacyId)) {
            legacyId = `legacy_${game.id}_${numericId}_${Math.random().toString(36).slice(2, 6)}`;
            void recordLog(
              "warn",
              "legacy-data",
              `[BUG-029] mod.json 里 numericId=${numericId} 重复,自动加 suffix: ${legacyId}`,
            );
          }
          usedLegacyIds.add(legacyId);

          return {
            id: legacyId,
            gameId: game.id,
            sortIndex: Number(item.weight) || index + 1,
            name: String(item.modName || item.name || `Mod ${numericId}`),
            sourcePath: String(item.fileName || rootPath),
            rootPath,
            version: String(item.modVersion || item.version || "1.0.0"),
            author: String(item.modAuthor || item.author || ""),
            website: String(item.modWebsite || item.website || ""),
            description: String(item.modDesc || item.description || ""),
            coverImage: String(item.cover || ""),
            tags,
            requirements: stringList(item.requirements),
            files,
            modTypeId: modType.id,
            modTypeName: modType.name,
            installed: Boolean(item.isInstalled),
            deployedFiles: Array.isArray(advanced.deployedFiles) ? advanced.deployedFiles.map(String) : [],
            updateSource: normalizeModUpdateSource(advanced.updateSource),
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now()
          };
        });

        nextModsByGame.set(game.id, parsedMods);
      } catch (caught) {
        await recordLog(
          "error",
          "legacy-data",
          `读取历史 Mod 数据失败：${game.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
      }
    }

    if (nextModsByGame.size === 0) return;

    mods.value = [
      ...mods.value.filter((mod) => !nextModsByGame.has(mod.gameId)),
      ...[...nextModsByGame.values()].flat()
    ];
    settings.value = {
      ...settings.value,
      tagColors: nextTagColors
    };
  }

  function normalizeStoredModTypes() {
    const gameMap = new Map(games.value.map((game) => [game.id, game]));

    mods.value = mods.value.map((mod) => {
      const game = gameMap.get(mod.gameId);
      if (!game) return mod;

      const adapter = adapterForGame(game);
      if (adapter.modTypes.some((type) => type.id === mod.modTypeId)) {
        const modType = getModType(adapter, mod.modTypeId);
        return mod.modTypeName === modType.name ? mod : { ...mod, modTypeName: modType.name };
      }

      const modType = resolveStoredModType(adapter, game.presetId, mod.modTypeId, mod.modTypeName, mod.files);
      return {
        ...mod,
        modTypeId: modType.id,
        modTypeName: modType.name,
        updatedAt: Date.now()
      };
    });
  }

  async function initialize() {
    if (initialized.value) return;

    busy.value = true;
    error.value = "";

    try {
      const data = normalizeAppData(await window.mayfly.readStore<AppData>(DATA_FILE, fallbackData));
      const previousDataVersion = data.dataVersion;
      if (data.dataVersion < DATA_VERSION) {
        data.dataVersion = DATA_VERSION;
      }
      settings.value = data.settings;
      games.value = data.games;
      modProfiles.value = data.modProfiles;
      activeGameId.value = data.activeGameId || games.value[0]?.id || "";
      const activePresetId = games.value.find((game) => game.id === activeGameId.value)?.presetId;
      nexusPresetId.value = nexusPresets.value.some((preset) => preset.id === activePresetId)
        ? activePresetId ?? ""
        : nexusPresets.value[0]?.id ?? "";
      mods.value = data.mods;
      normalizeStoredModTypes();
      downloads.value = data.downloads;
      logs.value = data.logs;
      backups.value = data.backups;
      dataBackups.value = data.dataBackups;
      translationCache.value = data.translationCache;
      featuredCache.value = data.featuredCache ?? {};
      initialized.value = true;
      if (previousDataVersion < 4) {
        await migrateModCachesToGameLayout();
      }
      await loadModsFromGameFiles();
      await migrateLegacyModCoverImages();
      // HGMM Phase 5:启动时迁移老 mod 来源 tag + 注册默认颜色
      migrateOriginTags();
      registerOriginTagColors();
      // HGMM Phase 1B:启动时按已持久化的 activeGameId 加载精选 mod
      // (initialize 直接给 activeGameId.value 赋值,不走 setActiveGame,需手动触发)
      if (activeGameId.value) {
        await loadFeaturedMods();
        // HGMM Phase 4:同样手动触发大型 mod 列表加载
        await loadBigMods();
      }
      await persist();
      if (settings.value.appUpdateUrl.trim()) {
        settings.value.lastAppUpdateCheckAt = Date.now();
        await persist();
        window.setTimeout(() => {
          void checkAppUpdate({ silent: true });
        }, 1500);
      }
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "读取本地数据失败";
    } finally {
      busy.value = false;
    }
  }

  async function chooseStoragePath() {
    const selected = await window.mayfly.openDirectory();
    if (!selected) return;

    settings.value.storagePath = selected;
    await persist();
  }

  async function addGame(preset?: GamePreset): Promise<boolean> {
    // BUG-028(2026-10-08):按 presetId 去重,阻止重复添加同款游戏
    //   此前 addGame 入口没任何去重检查,黑神话悟空可以加 N 次,左侧列表堆叠同款游戏。
    //   修复:传了 preset 时,先查 games 里同 presetId 是否已存在,
    //   有 → 自动切到该游戏 + 弹窗提示,不再创建新 game 记录。
    //   自定义游戏流程(不传 preset)不去重,符合"自定义用户自由管理"的产品边界。
    //   调 setActiveGame(existing.id) 而不是直接 activeGameId.value = ...,复用其
    //   loadFeaturedMods / loadBigMods / persist 等副作用,跟"用户主动切游戏"语义对齐。
    if (preset?.id) {
      const existing = games.value.find((g) => g.presetId === preset.id);
      if (existing) {
        await setActiveGame(existing.id);
        await appAlert({
          title: "游戏已添加",
          message: `${preset.zhName || preset.name} 已在游戏列表中,已自动切到该游戏。`,
        });
        return false;
      }
    }

    let resolvedPath = "";
    let finalExeNames = preset?.exeNames ?? [];
    // HGMM 3.0:用户走"自定义游戏"流程但 game-presets.json 有匹配时,自动升格为预设。
    // 用 effectivePreset 而不是 preset 构造 game 对象,避免"选了丝之歌.exe 却没填 presetId"
    // 这类 UX 陷阱(用户照旧选 exe,程序自动补 presetId/typeNames/coverUrl)。
    let effectivePreset = preset;

    if (!settings.value.preferDirectoryGamePicker) {
      const selectedExe = await window.mayfly.openExecutable({
        title: effectivePreset
          ? `请选择 ${effectivePreset.zhName || effectivePreset.name} 游戏安装目录下的 ${effectivePreset.exeNames[0]}`
          : "请选择游戏主程序 (.exe)"
      });
      if (!selectedExe) return false;

      resolvedPath = dirName(selectedExe);
      const exeName = fileName(selectedExe);

      // HGMM 减法 Phase 1:严格验证 exe 名,选错直接报错而不是默默接受
      if (effectivePreset?.exeNames.length) {
        if (!effectivePreset.exeNames.includes(exeName)) {
          const message = `请选择 ${effectivePreset.zhName || effectivePreset.name} 游戏安装目录下的 ${effectivePreset.exeNames[0]} 程序`;
          await appAlert({ title: "选择错误", message });
          return false;
        }
        finalExeNames = [...effectivePreset.exeNames];
      } else {
        finalExeNames = [exeName];
      }
    } else {
      const selected = await window.mayfly.openDirectory({
        title: effectivePreset
          ? `请选择 ${effectivePreset.zhName || effectivePreset.name} 游戏安装目录`
          : "请选择游戏安装目录"
      });
      if (!selected) return false;

      resolvedPath = selected;

      if (effectivePreset?.exeNames.length) {
        const foundExe = await window.mayfly.findFileByName({
          rootPath: selected,
          fileNames: [...effectivePreset.exeNames],
          maxDepth: 5
        });

        if (!foundExe) {
          error.value = `所选目录没有找到预期主程序：${effectivePreset.exeNames.join(", ")}`;
          return false;
        }

        resolvedPath = dirName(foundExe);
      }
    }

    // HGMM 3.0:没传 preset 时,根据 finalExeNames[0] 反查 gamePresets
    // 匹配成功就把整个 preset 字段填进来(presetId/steamAppId/typeNames/coverUrl 全套)
    // 解决用户"选了丝之歌.exe 但走了自定义流程,导致精选 mod 拿不到"的根问题
    if (!effectivePreset && finalExeNames[0]) {
      const targetExe = finalExeNames[0].toLowerCase();
      const matched = gamePresets.find((p) =>
        p.exeNames.some((e) => e.toLowerCase() === targetExe)
      );
      // HGMM 3.2 调试:反推匹配结果实时打印,定位用户重加后仍拿不到精选的根因
      console.log(
        `[hgmm] addGame reverse-lookup: exeName="${finalExeNames[0]}" matched=${matched?.id ?? "NONE"} (gamePresets中含silksong=${gamePresets.some(p => p.id === "silksong")})`
      );
      if (matched) {
        effectivePreset = matched;
        if (!finalExeNames.some((e) => matched.exeNames.includes(e))) {
          finalExeNames = [finalExeNames[0], ...matched.exeNames];
        }
      }
    }

    const now = Date.now();
    const game: ManagedGame = {
      id: createId("game"),
      presetId: effectivePreset?.id ?? "",
      catalogGameId: effectivePreset?.catalogGameId ?? 0,
      steamAppId: effectivePreset?.steamAppId ?? 0,
      nexusDomain: effectivePreset?.nexusDomain ?? "",
      nexusGameId: effectivePreset?.nexusGameId ?? 0,
      name: effectivePreset?.name ?? baseName(resolvedPath),
      path: resolvedPath,
      installPath: "",
      // HGMM 3.9.1:用 preset 的默认 launchArgs(blackwukong 默认 -fileopenlog 等),
      // 用户在 UI 输入框改过会覆盖。空字符串表示用户未填,用 preset 默认值。
      launchArgs: effectivePreset?.launchArgs ?? "",
      exeNames: finalExeNames,
      coverUrl: effectivePreset?.coverUrl ?? "",
      typeNames: effectivePreset ? getGameAdapter(effectivePreset.id).modTypes.map((type) => type.name) : ["游戏根目录"],
      customAdapterRules: [],
      adapterStatus: effectivePreset?.adapterStatus ?? "custom",
      // BUG-010:从 preset 拷贝 gameBasePath(exe 在子目录时上溯到游戏根)
      gameBasePath: effectivePreset?.gameBasePath,
      createdAt: now
    };

    games.value = [...games.value, game];
    activeGameId.value = game.id;
    if (effectivePreset?.nexusDomain) {
      nexusPresetId.value = effectivePreset.id;
    }
    // HGMM Phase 1B:addGame 直接赋值 activeGameId,不走 setActiveGame
    // 必须手动触发精选 mod 加载,否则首次添加游戏后看不到精选列表
    await loadFeaturedMods();
    // HGMM Phase 4:同样手动触发大型 mod 加载
    await loadBigMods();
    await persist();
    return true;
  }

  async function openActiveGameModFolder() {
    if (!activeGame.value || !settings.value.storagePath) return;

    const modPath = `${settings.value.storagePath}\\mods\\${activeGame.value.id}`;
    await window.mayfly.openPath(modPath);
  }

  async function setActiveGame(gameId: string) {
    activeGameId.value = gameId;
    error.value = "";
    selectedModIds.value = [];
    selectedTypeId.value = "all";
    selectedTag.value = "all";
    selectedNexusMod.value = null;
    resetNexusTranslation();
    nexusMods.value = [];
    nexusPage.value = 1;
    nexusTotalCount.value = 0;
    nexusTotalPages.value = 0;
    // HGMM Phase 4 修复:Nexus 模组按 activeGame 隔离,不能继承上次 addGame 的 presetId
    // (否则切换游戏后 watcher 触发 loadNexusMods,会用上次的 presetId 拉到错游戏的 mod)
    const newActive = activeGame.value;
    if (newActive?.presetId && nexusPresets.value.some((p) => p.id === newActive.presetId)) {
      // setNexusPreset 会 reset 过滤条件 + 清空 mod + watcher 看到 presetId 变化触发 loadNexusMods
      setNexusPreset(newActive.presetId);
    }
    // 切换游戏后,自动加载该游戏的精选 mod 列表
    await loadFeaturedMods();
    // HGMM Phase 4:同样加载大型 mod 列表(本会话内已 fetch 过则跳过)
    await loadBigMods();
    await persist();
    // 怀沙:切换游戏后,延迟重新打点升级检查(URL 会带新 game 参数)
    if (appUpdateRecheckTimer !== undefined) {
      window.clearTimeout(appUpdateRecheckTimer);
    }
    appUpdateRecheckTimer = window.setTimeout(() => {
      appUpdateRecheckTimer = undefined;
      if (settings.value.appUpdateUrl.trim()) {
        void checkAppUpdate({ silent: true });
      }
    }, 2500);
  }

  function setNexusPreset(presetId: string) {
    if (!nexusPresets.value.some((preset) => preset.id === presetId)) return;

    nexusPresetId.value = presetId;
    nexusSearch.value = "";
    nexusCategory.value = "";
    nexusLanguage.value = "";
    nexusTag.value = "";
    nexusPage.value = 1;
    nexusMods.value = [];
    nexusTotalCount.value = 0;
    nexusTotalPages.value = 0;
    nexusMods.value = [];
    nexusTotalCount.value = 0;
    nexusTotalPages.value = 0;
    nexusFacets.value = { categoryName: [], languageName: [], tag: [] };
    selectedNexusMod.value = null;
    error.value = "";
  }

  async function updateGame(gameId: string, patch: Partial<ManagedGame>) {
    games.value = games.value.map((game) =>
      game.id === gameId ? { ...game, ...patch } : game
    );
    await persist();
  }

  function customRuleInputToRule(input: CustomAdapterRuleInput): CustomAdapterRule {
    const name = input.name.trim() || "自定义类型";
    const detectValue = input.detectValue.trim();
    const installPath = input.installPath.trim();
    const installName = input.installName.trim() || detectValue || name;

    const install: CustomAdapterRule["install"] = (() => {
      switch (input.installKind) {
        case "folderRoot":
          return { kind: "folderRoot", installPath };
        case "folder":
          return { kind: "folder", installPath, folderName: installName, spare: true };
        case "file":
          return {
            kind: "file",
            installPath,
            fileName: installName,
            isExtname: input.detectKind === "extension",
            commonParent: true
          };
        case "fileSibling":
          return {
            kind: "fileSibling",
            installPath,
            fileName: installName,
            isExtname: input.detectKind === "extension"
          };
        case "manual":
          return { kind: "manual", reason: `${name} 需要手动安装。` };
        case "general":
        default:
          return { kind: "general", installPath, keepPath: input.keepPath };
      }
    })();

    return {
      id: createId("custom_type"),
      name,
      detect: {
        kind: input.detectKind,
        value: detectValue
      },
      install
    };
  }

  async function addCustomAdapterRule(input: CustomAdapterRuleInput) {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    const rule = customRuleInputToRule(input);
    const nextRules = [...activeGame.value.customAdapterRules, rule];

    await updateGame(activeGame.value.id, {
      customAdapterRules: nextRules,
      typeNames: nextRules.map((item) => item.name),
      adapterStatus: "custom"
    });
  }

  async function removeCustomAdapterRule(ruleId: string) {
    if (!activeGame.value) return;

    const nextRules = activeGame.value.customAdapterRules.filter((rule) => rule.id !== ruleId);
    const fallbackTypeId = nextRules[0]?.id || "custom-root";
    const presetStatus = gamePresets.find((preset) => preset.id === activeGame.value?.presetId)?.adapterStatus ?? "custom";
    await updateGame(activeGame.value.id, {
      customAdapterRules: nextRules,
      typeNames: nextRules.length > 0 ? nextRules.map((item) => item.name) : ["游戏根目录"],
      adapterStatus: nextRules.length > 0 ? "custom" : presetStatus
    });
    mods.value = mods.value.map((mod) =>
      mod.gameId === activeGame.value?.id && mod.modTypeId === ruleId
        ? { ...mod, modTypeId: fallbackTypeId, modTypeName: nextRules[0]?.name || "游戏根目录", updatedAt: Date.now() }
        : mod
    );
    await persist();
  }

  async function addCustomGameFromInput(input: CustomGameInput) {
    const now = Date.now();
    const game: ManagedGame = {
      id: createId("game"),
      presetId: "",
      catalogGameId: 0,
      steamAppId: 0,
      nexusDomain: "",
      nexusGameId: 0,
      name: input.name.trim() || baseName(input.path),
      path: input.path.trim(),
      installPath: input.installPath.trim(),
      launchArgs: input.launchArgs.trim(),
      exeNames: input.exeNames,
      coverUrl: input.coverUrl.trim(),
      typeNames: ["游戏根目录", "mods"],
      customAdapterRules: [
        {
          id: "custom-root",
          name: "游戏根目录",
          detect: { kind: "always", value: "" },
          install: {
            kind: "general",
            installPath: input.installPath.trim(),
            keepPath: true
          }
        }
      ],
      adapterStatus: "custom",
      createdAt: now
    };

    games.value = [...games.value, game];
    activeGameId.value = game.id;
    await persist();
  }

  async function locateActiveGameFromSteam() {
    if (!activeGame.value?.steamAppId) {
      error.value = "当前游戏没有 Steam AppID，无法自动定位。";
      return;
    }

    const foundPath = await window.mayfly.findSteamGamePath(activeGame.value.steamAppId);
    if (!foundPath) {
      error.value = `没有在 Steam 库中找到 AppID ${activeGame.value.steamAppId}。`;
      return;
    }

    await updateGame(activeGame.value.id, {
      path: foundPath
    });
  }

  async function chooseActiveGamePath() {
    if (!activeGame.value) return;

    const selected = await window.mayfly.openDirectory();
    if (!selected) return;

    await updateGame(activeGame.value.id, {
      path: selected
    });
  }

  async function chooseActiveGameExecutable() {
    if (!activeGame.value) return;

    const selected = await window.mayfly.openExecutable();
    if (!selected) return;

    const exeName = fileName(selected);
    const exeNames = [...new Set([exeName, ...activeGame.value.exeNames])];

    await updateGame(activeGame.value.id, {
      path: dirName(selected),
      exeNames
    });
  }

  async function launchActiveGame() {
    if (!activeGame.value) return;

    if (!activeGame.value.path) {
      error.value = "请先在左侧游戏列表右键，进入“高级设置”配置游戏目录。";
      return;
    }

    // HGMM 3.9 优先级:有 steamAppId > 0 → 走 Steam 协议启动(避免直接 spawn 触发
    // Steam "非 Steam 启动" 提示框、Steam overlay 失效、成就/云存档丢失)。
    // 无 steamAppId(用户自定义游戏、非 Steam 游戏)→ fallback 直接 spawn exe。
    const launchArgs = activeGame.value.launchArgs
      .split(/\s+/u)
      .map((arg) => arg.trim())
      .filter(Boolean);

    if (activeGame.value.steamAppId && activeGame.value.steamAppId > 0) {
      try {
        await window.mayfly.launchViaSteam({
          steamAppId: activeGame.value.steamAppId,
          args: launchArgs
        });
        await recordLog(
          "info",
          "library",
          `通过 Steam 协议启动: ${activeGame.value.name} (AppID=${activeGame.value.steamAppId})`,
        );
        return;
      } catch (caught) {
        // shell.openExternal 在 Steam 客户端未装/协议未注册时会 reject,
        // 记录错误后 fallback 到直接 spawn(用户能启动游戏,只是没有 Steam overlay)
        const steamErr = caught instanceof Error ? caught.message : "Steam 协议启动失败";
        await recordLog("error", "library", `Steam 协议启动失败,fallback 到直接 spawn: ${steamErr}`);
      }
    }

    try {
      const exeNames = activeGame.value.exeNames.length > 0
        ? [...activeGame.value.exeNames]
        : [`${activeGame.value.name}.exe`];
      const executablePath = await window.mayfly.findFileByName({
        rootPath: activeGame.value.path,
        fileNames: exeNames,
        maxDepth: 3
      });

      if (!executablePath) {
        error.value = `没有找到可启动文件：${exeNames.join(", ")}。请检查游戏目录是否正确。`;
        return;
      }

      await window.mayfly.launchExecutable({
        executablePath,
        cwd: dirName(executablePath),
        args: launchArgs
      });
      await recordLog(
        "info",
        "library",
        `直接启动 exe(非 Steam): ${activeGame.value.name} → ${executablePath}`,
      );
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "启动游戏失败";
      await recordLog("error", "library", error.value);
    }
  }

  /** HGMM 一键修复:删除当前游戏的所有 mod —— 游戏目录部署文件 + 前置依赖(Delete[] 规则)
   *  + 本地缓存(storagePath 下的 mod 目录)+ mod 记录。
   *  完整清理后,该游戏回到"刚添加"状态:
   *    - 游戏目录里没 mod 文件
   *    - storagePath/mods/<gameName>/ 空了
   *    - mods.value 不再有该游戏的记录
   *  注意:不删其他游戏的 mod(其它游戏不受影响)。 */
  async function repairActiveGame() {
    if (!activeGame.value) return false;

    const game = activeGame.value;
    const gamePath = game.path;
    if (!gamePath) {
      error.value = "请先配置游戏目录。";
      return false;
    }

    busy.value = true;
    error.value = "";

    try {
      // 收集当前游戏的所有 mod(后面清理本地缓存 + 删记录用)
      const gameMods = mods.value.filter((m) => m.gameId === game.id);
      const storagePath = settings.value.storagePath.trim();

      // 第 1 阶段:删除游戏目录里的 mod 部署文件 + 前置依赖
      const targets = new Set<string>();
      const modIdByDeployedFile = new Map<string, string>();

      // 1a. 精选 mod JSON 顶层 Delete[] 规则(覆盖前置依赖 UE4SS/BepInEx 等)
      for (const rule of featuredDeleteRules.value) {
        if (rule.Directory) targets.add(rule.Directory);
      }

      // 1b. 所有已安装 mod 的 deployedFiles(同时建映射,用于跟踪 mod 状态)
      for (const mod of gameMods) {
        if (mod.installed && Array.isArray(mod.deployedFiles)) {
          for (const file of mod.deployedFiles) {
            if (!file) continue;
            modIdByDeployedFile.set(file, mod.id);
            targets.add(file);
          }
        }
      }

      let deleted = 0;
      let skipped = 0;
      const failures: string[] = [];
      const normalizedGamePath = gamePath.replace(/[\\/]+$/u, "").toLowerCase();

      for (const relPath of targets) {
        const absPath = joinGameRelativePath(gamePath, relPath);
        if (!absPath) {
          failures.push(`${relPath}: joinGameRelativePath 返回空(非法路径)`);
          continue;
        }
        // 防御:绝对路径规则 == gamePath 本身(大小写不敏感),跳过,避免误删整个游戏目录
        if (absPath.toLowerCase() === normalizedGamePath) {
          skipped += 1;
          await recordLog(
            "info",
            "library",
            `[repair-skip] 跳过: 目标路径 == gamePath 本身(${absPath})`
          );
          continue;
        }
        const exists = await window.mayfly.exists(absPath);
        if (!exists) {
          skipped += 1;
          continue;
        }
        try {
          await window.mayfly.remove(absPath);
          deleted += 1;
        } catch (caught) {
          // 单项失败不阻断整体:游戏在跑 / Steam 锁 / 病毒软件拦截都会 EPERM,记录后继续
          const msg = caught instanceof Error ? caught.message : String(caught);
          failures.push(`${absPath}: ${msg}`);
        }
      }

      // 第 2 阶段:清理本地缓存(storagePath/mods/<gameName>/<modId>/)
      //   - 只删 storagePath 下的目录(mod.rootPath 不在 storagePath 跳过,如游戏目录扫描的 mod)
      //   - 删不到(已手动删过/被锁)不算失败,不影响 mod 记录删除
      const normalizedStorage = storagePath
        ? storagePath.replace(/[\\/]+$/u, "").toLowerCase()
        : "";
      let cacheDeleted = 0;
      let cacheFailed = 0;
      for (const mod of gameMods) {
        if (!mod.rootPath || !normalizedStorage) continue;
        const normalizedRoot = mod.rootPath.replace(/[\\/]+$/u, "").toLowerCase();
        // 安全:只清理 storagePath 下的目录(游戏目录扫描的 mod 跳过)
        if (!normalizedRoot.startsWith(normalizedStorage + "\\") &&
            !normalizedRoot.startsWith(normalizedStorage + "/")) {
          continue;
        }
        try {
          await window.mayfly.remove(mod.rootPath);
          cacheDeleted += 1;
        } catch (caught) {
          cacheFailed += 1;
          const msg = caught instanceof Error ? caught.message : String(caught);
          await recordLog("info", "library", `[repair-cache-fail] ${mod.name}: ${msg}`);
        }
      }

      // 第 3 阶段:删除该游戏的所有 mod 记录
      //   不管 mod 之前是否 installed、未清理成功与否,一键修复就是完整重置
      const removedCount = gameMods.length;
      const removedModIdSet = new Set(gameMods.map((m) => m.id));
      mods.value = mods.value.filter((m) => !removedModIdSet.has(m.id));
      // 清理 selectedModIds 里属于该游戏的 id
      selectedModIds.value = selectedModIds.value.filter((id) => !removedModIdSet.has(id));
      // 清理 modProfiles 里 enabledModIds 里的 id
      modProfiles.value = modProfiles.value.map((profile) =>
        profile.gameId === game.id
          ? { ...profile, enabledModIds: profile.enabledModIds.filter((id) => !removedModIdSet.has(id)) }
          : profile
      );

      // 第 4 阶段:清理该游戏的下载任务记录
      //   关键:不清理会导致下载 dedup 报"队列里已经有"。downloadNexusFile 用
      //   (modId + fileId + status in queued|downloading|completed|external) 去重,
      //   repair 只删 mod 记录但保留 downloads 里的 completed 任务 → 重新点下载被挡。
      //   - Nexus 任务:gameId 格式 `nexus:<presetId>`,匹配 game.presetId
      //   - Custom / featured 任务:gameId 直接是 local game.id
      //   - external(下载并提示让用户去浏览器下)也清,反正 mod 记录都没了
      const beforeDownloads = downloads.value.length;
      const nexusGameId = game.presetId ? `nexus:${game.presetId}` : null;
      // 先取消正在下载的任务(避免文件半下载状态留底)
      for (const task of downloads.value) {
        if (task.status !== "downloading") continue;
        const belongsToGame =
          (nexusGameId && task.gameId === nexusGameId) ||
          task.gameId === game.id;
        if (belongsToGame) {
          try {
            await window.mayfly.cancelDownload(task.id);
          } catch {
            // 取消失败不阻断,反正下一步要从队列移除
          }
        }
      }
      downloads.value = downloads.value.filter((task) => {
        const belongsToGame =
          (nexusGameId && task.gameId === nexusGameId) ||
          task.gameId === game.id;
        return !belongsToGame;
      });
      const removedDownloads = beforeDownloads - downloads.value.length;
      await recordLog(
        "info",
        "library",
        `[repair-downloads] 清理 ${removedDownloads} 个下载任务 (${game.name})`,
      );
      await persist();

      const summary =
        failures.length > 0
          ? `[部分失败] 一键修复: 删除 ${deleted} 项游戏目录文件 + ${cacheDeleted} 项本地缓存 + ${removedDownloads} 个下载任务,跳过 ${skipped} 项不存在,${failures.length} 项文件失败 / ${cacheFailed} 项缓存失败,移除 ${removedCount} 个 mod 记录(${game.name})`
          : `一键修复: 删除 ${deleted} 项游戏目录文件 + ${cacheDeleted} 项本地缓存 + ${removedDownloads} 个下载任务,跳过 ${skipped} 项不存在,移除 ${removedCount} 个 mod 记录(${game.name})`;
      await recordLog("info", "library", summary);
      if (failures.length > 0) {
        const failureDetail = failures.join(" | ");
        await recordLog("info", "library", `失败项: ${failureDetail}`);
        error.value = `已删除 ${deleted} 项游戏目录文件 + ${cacheDeleted} 项本地缓存,${failures.length} 项失败。\n失败详情:\n${failureDetail}\n\n建议关闭游戏后重试,或手动到 Steam 验证完整性。`;
      }
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "一键修复失败";
      error.value = message;
      await recordLog("error", "library", message);
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** HGMM Phase 5:扫描当前游戏的 mod 安装目录,发现用户手动丢入的 mod(打"自定义" tag)
   *  适配器每个 modType 的 install.installPath 是 mod 文件应该放的位置;
   *  扫描该目录下所有子目录 + 顶层 mod 文件,跟现有 mods 比较去重。
   *  @returns 新发现的 mod 数量 */
  async function scanActiveGameMods(): Promise<number> {
    if (!activeGame.value) return 0;
    const game = activeGame.value;
    // BUG-010 round 5(2026-10-03):exe 在子目录时(game.path 指向 exe 目录而非游戏根),
    //   用 game.gameBasePath 算出 effectiveGamePath(真正的游戏根),
    //   扫描路径解析 / 去重比较 / 后端 IPC 都基于 effectiveGamePath,
    //   避免把 bin\x64_dx12\mods 误识别成 mods 目录。
    // BUG-010 round 5 老游戏兼容:ManagedGame.gameBasePath 可能 undefined,
    //   fallback 到 preset.gameBasePath(用户游戏入库早于 gameBasePath 字段加入 preset)
    const gameBasePath = resolveGameBasePath(game);
    const gamePath = gameBasePath
      ? await window.mayfly.resolveGamePath({
          gamePath: game.path,
          prefix: gameBasePath,
        })
      : game.path;

    if (!gamePath) {
      error.value = "请先配置游戏目录。";
      return 0;
    }

    const adapter = adapterForGame(game);
    // 扫描规则:只接受 install.kind ∈ {general, folder, folderRoot} 且 installPath 非空
    //   参照原 HGMM sModScanDirs(只扫 2 个固定目录:~mods 和 LogicMods 或 BepInEx\plugins)
    //   - 排除 fileSibling / fileOnly / folderParent:这些是 mod 内部路径,不是 mod 落点
    //   - 排除 manual:用户手动装路径
    //   - 排除 root(空 installPath):避免把整个游戏根当成 mod 目录
    //
    // BUG-015(2026-10-04):per-game scan modTypeId 白名单(preset.scanModTypeIds)。
    //   适用:游戏有多个 modType 但只希望 scan 在"主" modType 子目录发现手动 mod,
    //   其他 modType(dlc / scripts 等)留给 installOneFeatured 主动创建 LocalMod,不通过 scan 自动入库。
    //   例:巫师 3 配 ["1"] → scan 只扫 mods/ 子目录,跳过 dlc/ 子目录
    //       (装"声望系统"时 4 个 dlc subFile 各自独立 LocalMod,但 scan 不会再发现它们)
    //   语义:
    //     undefined → preset 也没配 → 行为不变(扫所有 SCAN_KINDS 命中 modType)
    //     []        → 显式空数组 → scan 不扫任何 modType
    //     ["1",...] → 只扫 modTypeId 在白名单内的 target
    const scanModTypeIds = resolveGameScanModTypeIds(game);
    const hasScanWhitelist = Array.isArray(scanModTypeIds);
    if (hasScanWhitelist && scanModTypeIds.length === 0) {
      await recordLog(
        "info",
        "library",
        `扫描游戏目录: preset.scanModTypeIds 为空数组,${game.name} scan 已禁用`,
      );
      return 0;
    }
    type ScanKind = "general" | "folder" | "folderRoot";
    const SCAN_KINDS = new Set<ScanKind>(["general", "folder", "folderRoot"]);
    const scanTargets = adapter.modTypes
      .map((mt) => {
        const install = mt.install;
        if (!SCAN_KINDS.has(install.kind as ScanKind)) return null;
        // 走到这里 kind 一定是 general/folder/folderRoot,都有 installPath 字段
        const rel = (install as { installPath: string }).installPath.trim();
        if (!rel) return null;
        // BUG-015:per-game 白名单过滤 — modTypeId 不在白名单 → 排除
        if (hasScanWhitelist && !scanModTypeIds.includes(mt.id)) return null;
        return {
          modTypeId: mt.id,
          modTypeName: mt.name,
          relativePath: rel,
          kind: install.kind as ScanKind
        };
      })
      .filter((t): t is {
        modTypeId: string;
        modTypeName: string;
        relativePath: string;
        kind: ScanKind;
      } => t !== null);

    if (scanTargets.length === 0) {
      await recordLog("info", "library", `扫描游戏目录: 当前游戏没有可扫描的 installPath(${game.name})`);
      return 0;
    }

    // 解析为绝对路径,按绝对路径去重(scripts 和 mods 可能共享 Binaries/Win64/ue4ss/Mods,
    // 即使这里过滤后只剩 general/folder,同路径仍可能出现)。
    // BUG-010:absTargets 加 scanExtensions 字段(per-target 覆盖默认 SCAN_MOD_FILE_EXTENSIONS)
    //   从 adapter 拿 game-specific 白名单(巫师 3 需 .bundle/.ws,默认不识别)
    const absTargets: Array<{
      modTypeId: string;
      modTypeName: string;
      absPath: string;
      kind: "general" | "folder" | "folderRoot";
      scanExtensions?: string[];
    }> = [];
    const seenAbs = new Set<string>();
    for (const t of scanTargets) {
      const abs = joinGameRelativePath(gamePath, t.relativePath);
      if (!abs) continue;
      const key = abs.replace(/[\\/]+$/u, "").toLowerCase();
      if (seenAbs.has(key)) continue;
      seenAbs.add(key);
      absTargets.push({
        modTypeId: t.modTypeId,
        modTypeName: t.modTypeName,
        absPath: abs,
        kind: t.kind,
        scanExtensions: adapter.scanExtensions
      });
    }

    if (absTargets.length === 0) {
      await recordLog("info", "library", `扫描游戏目录: 解析后的绝对路径全部非法(${game.name})`);
      return 0;
    }

    busy.value = true;
    error.value = "";

    try {
      const result = await window.mayfly.scanGameMods({
        gamePath,
        // BUG-010 round 5(2026-10-03):把 gameBasePath 同步给后端,让后端也按游戏根解析
        //   exe 在子目录时,后端要 path.resolve(gamePath, gameBasePath) 后再扫 absTargets
        gamePathPrefix: gameBasePath,
        targets: absTargets
      });

      // 用归一化路径(去尾部斜杠 + 小写)去重
      const existingKeys = new Set<string>();
      for (const mod of mods.value) {
        if (mod.gameId !== game.id) continue;
        existingKeys.add(normalizeText(mod.rootPath.replace(/[\\/]+$/u, "")));
        // 也用 deployedFiles 的绝对化路径作为弱匹配(扫描结果可能不带完整 rootPath)
        if (Array.isArray(mod.deployedFiles)) {
          for (const dep of mod.deployedFiles) {
            const abs = joinGameRelativePath(gamePath, dep);
            if (abs) existingKeys.add(normalizeText(abs.replace(/[\\/]+$/u, "")));
          }
        }
      }

      const now = Date.now();
      let discovered = 0;
      const newMods: LocalMod[] = [];

      // HGMM Phase 5 增强:扫描到的 mod 若文件名命中精选 mod 的 zip 名,用精选 mod 的友好名/描述/封面填充。
      //   场景:用户手动丢了一批 mod → 扫描发现 → 文件名匹配精选 → 显示"二师姐天眼"而非"EveEyes_W3_CNS"
      //   匹配规则:scanned.modRoot 的 baseName == featured.downloadUrl 的 baseName(strip archive ext)
      //   来源 tag 仍标"自定义"(用户确实手动放的),只是显示名友好化
      //
      // BUG-012(2026-10-04):原版只填 friendly name,没写 updateSource / tag = "featured",
      //   导致精选 mod 列表无法识别"已安装",按钮仍可点(可能重复安装)。
      //   修复:扫描时若命中精选,反查 featuredMods 拿完整 FeaturedMod,写 updateSource + 改 tag。
      const featuredLookup = buildFeaturedNameLookup();

      for (const scanned of result.scannedMods) {
        const rootKey = normalizeText(scanned.modRoot.replace(/[\\/]+$/u, ""));
        if (existingKeys.has(rootKey)) continue;
        existingKeys.add(rootKey);

        // 计算相对游戏目录的部署路径(deployedFiles 用)
        const relRoot = (() => {
          const normalizedGame = normalizeGamePathForCompare(gamePath);
          const normalizedRoot = scanned.modRoot.replace(/\\/g, "/");
          if (!normalizedRoot.toLowerCase().startsWith(normalizedGame + "/")) return "";
          return normalizedRoot
            .slice(normalizedGame.length + 1)
            .replace(/\//g, "\\");
        })();
        const deployedFiles = relRoot ? [relRoot] : [];

        // 默认用目录/文件名(用户友好度低)
        //   匹配前要先去扩展名,因为游戏目录里可能是 .7z/.zip 压缩包(用户直接放进去没解压)
        //   或者 .pak/.dll 单文件 mod(用户重命名了),都跟精选 URL 文件名去扩展名后对得上
        const rawName = baseName(scanned.modRoot).replace(STRIP_FILE_EXT, "");
        // 尝试匹配精选 mod,获取友好名/描述/封面
        const featuredMatch = featuredLookup.get(rawName.toLowerCase());
        // BUG-012:featuredMatch 命中时反查 featuredMods 拿完整 FeaturedMod(写 updateSource 需要 modId/fileId)
        //   key 是 rawName.toLowerCase()(URL basename 去扩展名)
        const matchedFeatured =
          featuredMatch
            ? featuredMods.value.find(
                (fm) => baseName(fm.downloadUrl || "").replace(STRIP_FILE_EXT, "").toLowerCase() === rawName.toLowerCase(),
              )
            : undefined;
        const featuredUpdateSource = matchedFeatured
          ? {
              type: "featured" as const,
              gameDomain: "",
              gameName: game.name,
              modId: matchedFeatured.id,
              fileId: matchedFeatured.id,
              fileName: matchedFeatured.downloadUrl ? baseName(matchedFeatured.downloadUrl) : "",
              fileVersion: "",
              modVersion: "",
              categoryName: "",
              modPageUrl: "",
              filePageUrl: "",
              coverImage: matchedFeatured.coverUrl ?? "",
              downloadedAt: 0
            }
          : undefined;

        const id = createId("mod");
        newMods.push({
          id,
          gameId: game.id,
          sortIndex: mods.value.filter((m) => m.gameId === game.id).length + discovered,
          name: featuredMatch?.name ?? rawName,
          sourcePath: scanned.modRoot, // 标记"自定义"来源的关键:游戏目录路径
          rootPath: scanned.modRoot,
          version: "",
          author: "",
          website: "",
          description: featuredMatch?.description ?? "",
          coverImage: featuredMatch?.coverUrl ?? "",
          // BUG-012:命中精选时打 "featured" tag(而非 "custom"),精选 mod 列表才能识别"已安装"
          tags: appendOriginTag(undefined, matchedFeatured ? "featured" : "custom"),
          requirements: [],
          files: scanned.files,
          modTypeId: scanned.modTypeId,
          modTypeName: scanned.modTypeName,
          installed: true, // 已经在游戏目录里了
          deployedFiles,
          // BUG-012:命中精选时写 updateSource,让 isInstalledByOrigin('featured', ...) 能命中
          updateSource: featuredUpdateSource,
          createdAt: now,
          updatedAt: now
        });
        discovered += 1;
      }

      if (discovered > 0) {
        mods.value = [...newMods, ...mods.value];
        await persist();
      }

      const friendlyCount = newMods.filter((n) => featuredLookup.has(baseName(n.rootPath).toLowerCase())).length;
      // BUG-012:日志分别统计"命中精选"和"普通自定义",便于排查
      const featuredCount = newMods.filter((n) => n.updateSource?.type === "featured").length;
      await recordLog(
        "info",
        "library",
        `扫描游戏目录: 发现 ${discovered} 个 mod(` +
          `${friendlyCount > 0 ? `${friendlyCount} 个用精选友好名,${featuredCount} 个已关联精选 updateSource,` : ""}` +
          `扫描 ${absTargets.length} 个目录,${game.name})`
      );
      return discovered;
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      error.value = `扫描游戏目录失败: ${msg}`;
      await recordLog("error", "library", `扫描游戏目录失败: ${msg}`);
      return 0;
    } finally {
      busy.value = false;
    }
  }

  function normalizeGamePathForCompare(gamePath: string): string {
    return gamePath.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
  }

  /** HGMM Phase 5 增强:用精选 mod 的 downloadUrl 文件名建查找表。
   *  key = URL 文件名去扩展名(小写),value = 精选 mod 完整信息。
   *  例:downloadUrl="https://.../EveEyes_W3_CNS.zip" → key="eveeyes_w3_cns"
   *  这样扫描到的 mod 文件名匹配时,可直接拿到友好名/描述/封面。 */
  // 匹配时统一去掉的扩展名:既覆盖压缩包格式(.zip/.7z/.rar/.mmp),也覆盖单文件 mod 格式
  //   (.pak/.dll/.lua/.uasset/.uexp),允许扫描到的 .pak/.7z 等跟精选 URL 文件名对得上
  const STRIP_FILE_EXT = /\.(zip|7z|rar|mmp|pak|dll|lua|uasset|uexp)$/i;
  function buildFeaturedNameLookup(): Map<string, { name: string; description: string; coverUrl: string }> {
    const map = new Map<string, { name: string; description: string; coverUrl: string }>();
    for (const fm of featuredMods.value) {
      if (!fm.downloadUrl) continue;
      const urlFileName = baseName(fm.downloadUrl).replace(STRIP_FILE_EXT, "");
      if (!urlFileName) continue;
      map.set(urlFileName.toLowerCase(), {
        name: fm.name,
        description: fm.description ?? "",
        coverUrl: fm.coverUrl ?? ""
      });
      // 同时把精选 mod 自己的 name 也作为 key(防止某些 mod 的 name == 文件名)
      if (fm.name) {
        map.set(fm.name.toLowerCase(), {
          name: fm.name,
          description: fm.description ?? "",
          coverUrl: fm.coverUrl ?? ""
        });
      }
    }
    return map;
  }

  /** HGMM Phase 5 增强:迁移已存在的 mod,若与精选 mod 文件名匹配,刷新成友好名/描述/封面。
   *  解决"之前扫描的 mod 没显示精选名"的问题 ——
   *  之前扫描时如果 featuredMods 还没加载/字段不匹配,mod 记录用了原始文件名。
   *  此函数在 loadFeaturedMods 末尾调,扫一遍当前游戏的 mod,匹配上精选的就改名。
   *  只改当前游戏,且只动 mod 的展示字段(name/description/coverImage),不动 tag/source/deployedFiles。 */
  async function migrateCustomModsToFeaturedNames() {
    if (!activeGame.value || featuredMods.value.length === 0) return;
    const lookup = buildFeaturedNameLookup();
    if (lookup.size === 0) return;

    const gameId = activeGame.value.id;
    let touched = 0;
    const now = Date.now();
    mods.value = mods.value.map((m) => {
      if (m.gameId !== gameId) return m;
      // 跳过已有非空 description + coverImage 的 mod(很可能用户已经手动改过名,不要覆盖)
      // 但只描述有内容 + coverImage 都有才跳过;只有一个有说明是老扫描的空记录
      if (m.description && m.coverImage) return m;
      // 用 sourcePath / rootPath 的 baseName 尝试匹配(优先 sourcePath 因为它标识文件来源)
      const candidate = (m.sourcePath || m.rootPath || "").trim();
      if (!candidate) return m;
      const stripped = baseName(candidate).replace(STRIP_FILE_EXT, "");
      if (!stripped) return m;
      const featured = lookup.get(stripped.toLowerCase());
      if (!featured) return m;
      // 已经有自定义 friendly name 了别覆盖(用户手动改的)
      // 判定:"原始文件名 == 当前 name" 才覆盖(说明是扫描自动生成的名字)
      const isRawName = normalizeText(m.name) === normalizeText(stripped);
      if (!isRawName && m.description && m.coverImage) return m;
      touched += 1;
      return {
        ...m,
        name: featured.name,
        description: featured.description || m.description,
        coverImage: featured.coverUrl || m.coverImage,
        updatedAt: now
      };
    });
    if (touched > 0) {
      await persist();
      await recordLog("info", "library", `已为 ${touched} 个已存在 mod 同步精选 mod 友好信息(${activeGame.value.name})`);
    }
  }

  /**
   * BUG-016 round 3(2026-10-04):清理 round 1+2 期间残留的 LocalMod 记录。
   * round 1+2 用 installOneFeatured 给 subFile 创建 LocalMod,UI 用 parentModId 折叠。
   *   round 3 改为不创建 LocalMod 记录,但用户库里的老 subFile 记录还在,会让"本地 mod"
   *   页面仍显示 N 条。
   * 规则:updateSource.type="featured" 且 modId 命中某个 FeaturedMod.subFiles[].id 的
   *   LocalMod → 从 mods.value 移除(只删记录,不删磁盘部署文件,不调 uninstallMod)。
   * 触发时机:loadFeaturedMods 末尾(精选列表加载后才能判定 modId 是否属于 subFile)。
   * 边界:主 mod 自己的 modId 也可能跟某个 subFile.id 撞名(理论上不会),优先保留
   *   有 parentModId 为空的(主 mod 标识)。这里靠"round 3 不再写 parentModId 字段"
   *   + "loadFeaturedMods 末尾清理"的顺序保证不误删主 mod(主 mod 安装时已写在
   *   featuredMods.value 里,但 cleanup 用的是子文件 id 集合,只要 subFile.id 不跟
   *   主 mod.id 撞,就安全)。
   */
  async function cleanupSubFileResidualLocalMods() {
    if (!activeGame.value || featuredMods.value.length === 0) return;
    const gameId = activeGame.value.id;

    // 收集所有 FeaturedMod.subFiles 的 id
    const subFileIds = new Set<string>();
    for (const fm of featuredMods.value) {
      if (!fm.subFiles) continue;
      for (const sub of fm.subFiles) {
        if (sub.id) subFileIds.add(sub.id);
      }
    }
    if (subFileIds.size === 0) return;

    const beforeIds = new Set(mods.value.filter((m) => m.gameId === gameId).map((m) => m.id));
    const toRemove: LocalMod[] = [];
    const kept: string[] = [];
    for (const m of mods.value) {
      if (m.gameId !== gameId) continue;
      if (m.updateSource?.type !== "featured") continue;
      if (!m.updateSource.modId) continue;
      if (subFileIds.has(m.updateSource.modId)) {
        toRemove.push(m);
      } else {
        kept.push(m.updateSource.modId);
      }
    }
    if (toRemove.length === 0) return;

    const removeIdSet = new Set(toRemove.map((m) => m.id));
    mods.value = mods.value.filter((m) => !removeIdSet.has(m.id));
    selectedModIds.value = selectedModIds.value.filter((id) => !removeIdSet.has(id));
    await persist();
    await recordLog(
      "info",
      "library",
      `[BUG-016 round 3] 清理 round 1+2 残留的 subFile LocalMod 记录 × ${toRemove.length} (${activeGame.value.name});保留主 mod ${kept.length} 条`,
    );
    void beforeIds;  // 调试占位,保持 lint 平静
  }

  async function removeGame(gameId: string) {
    games.value = games.value.filter((game) => game.id !== gameId);
    mods.value = mods.value.filter((mod) => mod.gameId !== gameId);

    if (activeGameId.value === gameId) {
      activeGameId.value = games.value[0]?.id ?? "";
    }

    await persist();
  }

  async function importLocalMods() {
    const sources = await window.mayfly.openModSource();
    await importLocalModsFromPaths(sources);
  }

  async function chooseModCoverImage(modId: string) {
    const mod = mods.value.find((item) => item.id === modId);
    if (!mod) return;

    const sourcePath = await window.mayfly.openImage();
    if (!sourcePath) return;

    try {
      const result = await window.mayfly.copyModCoverImage({
        sourcePath,
        modRoot: mod.rootPath
      });
      await updateMod(modId, {
        coverImage: result.coverImage,
        updatedAt: Date.now()
      });
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "保存 Mod 预览图失败";
    }
  }

  async function migrateLegacyModCoverImages() {
    let changed = false;
    const migratedMods: LocalMod[] = [];

    for (const mod of mods.value) {
      if (!/^\.mayfly[\\/]+preview\./iu.test(mod.coverImage)) {
        migratedMods.push(mod);
        continue;
      }

      try {
        const result = await window.mayfly.migrateModCoverImage({
          modRoot: mod.rootPath,
          coverImage: mod.coverImage
        });
        if (result.coverImage !== mod.coverImage) {
          changed = true;
          migratedMods.push({
            ...mod,
            coverImage: result.coverImage,
            updatedAt: Date.now()
          });
        } else {
          migratedMods.push(mod);
        }
      } catch (caught) {
        await recordLog(
          "error",
          "preview",
          `迁移 Mod 预览图失败：${mod.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
        migratedMods.push(mod);
      }
    }

    if (changed) {
      mods.value = migratedMods;
    }
  }

  async function importLocalModsFromPaths(
    sources: string[],
    sourceWebsite = "",
    updateSources: Record<string, ModUpdateSource> = {},
    origin?: ModOriginKind
  ) {
    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    if (!activeGame.value) {
      error.value = "请先添加并选择一个游戏。";
      return;
    }

    const uniqueSources = [...new Set(sources.map((source) => source.trim()).filter(Boolean))];
    if (uniqueSources.length === 0) return;

    busy.value = true;
    error.value = "";

    try {
      const imported: LocalMod[] = [];
      const existingSourcePaths = new Set(
        mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => normalizeText(mod.sourcePath))
      );
      const existingNames = new Set(
        mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => normalizeText(mod.name))
      );
      let nextSortIndex = Math.max(
        -1,
        ...mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => mod.sortIndex)
      ) + 1;
      let nextFolderId = Math.max(
        0,
        ...mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => Number(modFolderName(mod.rootPath, "0")) || 0)
      ) + 1;
      let skipped = 0;
      let keptDuplicates = 0;

      for (const sourcePath of uniqueSources) {
        let modName = modNameFromPath(sourcePath);
        // HGMM marker mod 分支(2026-10-04):压缩包内有 HGMM-MOD-MANIFEST →
        //   game 字段匹配当前 presetId → 直接解压到 effectiveGamePath,
        //   不创建 LocalMod 记录,不写入 storagePath(跟 BUG-016 round 3 subFile 同款"不加记录")。
        //   跳过原 importer 整个循环体(continue)。
        if (activeGame.value && settings.value.storagePath) {
          const gameBasePath = resolveGameBasePath(activeGame.value);
          const effectiveGamePath = gameBasePath
            ? await window.mayfly.resolveGamePath({
                gamePath: activeGame.value.path,
                prefix: gameBasePath,
              })
            : activeGame.value.path;
          try {
            const markerResult = await window.mayfly.importMarkerMod({
              sourcePath,
              effectiveGamePath,
              expectedGame: activeGame.value.presetId,
            });
            if (markerResult.kind === "marker") {
              await recordLog(
                "info",
                "library",
                `[HGMM marker] 已部署到游戏根目录(跳过 storagePath): ${modName} → ${markerResult.extractedTo}`,
              );
              // 跳过原 importer 流程,标记为已处理
              skipped += 1;
              continue;
            }
            // markerResult.kind === "no-marker" → 走原导入流程
          } catch (markerError) {
            // game 不匹配或解压失败:抛给用户,中断整个 import 流程
            // (避免 marker 包夹在普通包里时静默吞掉)
            error.value =
              markerError instanceof Error
                ? markerError.message
                : "marker 导入失败";
            await recordLog("error", "library", error.value);
            throw markerError;
          }
        }
        const matchedDownload = downloads.value.find((task) =>
          task.source === "NexusMods" &&
          task.modId &&
          normalizeText(task.outputPath) === normalizeText(sourcePath)
        );
        const matchedGame = matchedDownload
          ? games.value.find((game) => game.presetId === matchedDownload.gameId.replace(/^nexus:/u, ""))
          : null;
        const importedCoverImage = matchedDownload?.coverImage ?? "";
        const importedUpdateSource = updateSources[sourcePath] ??
          updateSources[normalizeText(sourcePath)] ??
          matchedDownload?.updateSource;
        const importedSourceWebsite = sourceWebsite ||
          importedUpdateSource?.modPageUrl ||
          (matchedDownload && matchedGame
            ? nexusModWebsite(matchedGame.nexusDomain, matchedDownload.modId)
            : "");
        // HGMM Phase 5:推断来源 tag(显式 origin 优先,fallback 到 updateSource / matchedDownload)
        const inferredOrigin: ModOriginKind = origin
          ?? (importedUpdateSource?.type === "nexus" ? "nexus" : "imported");
        const isDuplicate =
          existingSourcePaths.has(normalizeText(sourcePath)) ||
          existingNames.has(normalizeText(modName));

        if (isDuplicate) {
          const keepCopy = await appConfirm({
            title: "Mod 疑似重复",
            message: `“${modName}”疑似已经导入过。要继续导入并保留为副本吗？`,
            danger: false,
            confirmText: "继续导入"
          });

          if (!keepCopy) {
            skipped += 1;
            continue;
          }

          modName = nextDuplicateName(modName, existingNames);
          keptDuplicates += 1;
        }

        const now = Date.now();
        const id = createId("mod");
        const folderId = String(nextFolderId);
        const result = await window.mayfly.importModFolder({
          sourcePath,
          storagePath: settings.value.storagePath,
          gameId: activeGame.value.id,
          gameName: activeGame.value.name,
          modId: folderId
        });
        const adapter = adapterForGame(activeGame.value);
        const modTypeId = adapter.checkModType(result.files);
        const modType = getModType(adapter, modTypeId);

        imported.push({
          id,
          gameId: activeGame.value.id,
          sortIndex: nextSortIndex,
          name: result.manifest?.name && !isDuplicate ? result.manifest.name : modName,
          sourcePath,
          rootPath: result.rootPath,
          version: result.manifest?.version ?? "",
          author: result.manifest?.author ?? "",
          website: result.manifest?.website || importedSourceWebsite,
          description: result.manifest?.description ?? "",
          coverImage: importedCoverImage || result.coverImage || "",
          // HGMM Phase 5:manifest 已有 tag + 追加来源 tag(保留用户自定义)
          tags: appendOriginTag(result.manifest?.tags ?? [], inferredOrigin),
          requirements: result.manifest?.requirements ?? [],
          files: result.files,
          modTypeId: modType.id,
          modTypeName: modType.name,
          installed: false,
          deployedFiles: [],
          updateSource: importedUpdateSource,
          createdAt: now,
          updatedAt: now
        });
        nextFolderId += 1;
        nextSortIndex += 1;
        existingSourcePaths.add(normalizeText(sourcePath));
        existingNames.add(normalizeText(modName));
      }

      if (imported.length > 0) {
        mods.value = [...imported, ...mods.value];
        await persist();
      }

      // FEATURE-018 round 2(2026-10-04):导入完成后自动 scan 一次,刷新"本地 mod"页面。
      //   背景:用户反馈"导入模组后看不到,需要手动点扫描本地模组才能看到"。
      //   - 普通 mod:导入到 storagePath → 已经创建 LocalMod,但用户期望跟磁盘状态一致(可能用户已手动复制 mod 进游戏目录)
      //   - marker mod(.hgmm_mod):解压到游戏根 → 不创建 LocalMod → 必须 scan 才能在 UI 看到
      //   一致解决方案:导入结束都触发 scanActiveGameMods(),让 LocalMod 表跟游戏目录同步。
      //   scan 是 idempotent + 走 BUG-015 白名单,不会重复创建已存在的 mod。
      await scanActiveGameMods();

      if (skipped > 0) {
        error.value = `已跳过 ${skipped} 个疑似重复 Mod。`;
      } else if (keptDuplicates > 0) {
        error.value = `已保留 ${keptDuplicates} 个重复 Mod 副本。`;
      }
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导入本地 Mod 失败";
    } finally {
      busy.value = false;
    }
  }

  async function saveNexusApiKey(apiKey: string) {
    settings.value.nexusApiKey = apiKey.trim();
    await persist();
  }

  async function loginNexusWithBrowser() {
    nexusLoginLoading.value = true;
    error.value = "";

    try {
      const result = await window.mayfly.startNexusOAuthLogin({
        proxyUrl: activeProxyUrl()
      });
      settings.value.nexusAccessToken = result.accessToken;
      settings.value.nexusRefreshToken = result.refreshToken;
      settings.value.nexusTokenExpiresAt = result.expiresAt;
      settings.value.nexusUser = result.user;
      await persist();
      return result.user;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "Nexus 网页登录失败";
      return null;
    } finally {
      nexusLoginLoading.value = false;
    }
  }

  // 怀沙:Nexus OAuth 访问令牌自动刷新 — 2026-09-29 暂时隐藏(FEATURE-012)
  // 原因:refreshToken 长期有效会让用户 30 天内不需要重登,设备安全风险高(明文存 settings.json);
  //      且主动刷新可能撞 Nexus 反滥用边界(known-risks #1)。
  // 当前行为:6 小时后 accessToken 过期 → N 网 API 调用失败 → renderer 兜底 clearNexusAuth → 用户重新走 OAuth 浏览器登录
  // 启用方式:把下方 withNexusTokenRefresh 注释解除 + 恢复 expires_in 用 Nexus 返回值(去掉 6h override)
  let pendingNexusRefresh: Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> | null = null;

  async function refreshNexusAccessToken(): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> {
    const refreshToken = settings.value.nexusRefreshToken?.trim() ?? "";
    if (!refreshToken) {
      throw new Error("没有 refreshToken,请重新登录 Nexus。");
    }
    // 并发去重:Nexus refresh_token grant 一次性消费,同时发两个会让其中一个失败
    if (pendingNexusRefresh) return pendingNexusRefresh;
    const promise = window.mayfly.refreshNexusAccessToken({
      refreshToken,
      proxyUrl: activeProxyUrl()
    });
    pendingNexusRefresh = promise;
    try {
      return await promise;
    } finally {
      pendingNexusRefresh = null;
    }
  }

  async function persistRefreshedNexusTokens(refreshed: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }) {
    settings.value.nexusAccessToken = refreshed.accessToken;
    settings.value.nexusRefreshToken = refreshed.refreshToken;
    settings.value.nexusTokenExpiresAt = refreshed.expiresAt;
    await persist();
  }

  async function withNexusTokenRefresh<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
    // HGMM 隐藏功能(2026-09-29):暂时不做任何自动刷新 — 直接调 fn,失败就抛
    // renderer 层 catch 后检测认证错误 → clearNexusAuth() → 弹窗让用户重新 OAuth 登录
    // 启用自动续期时:解除下方注释,主动 + 被动双保险恢复
    return fn(settings.value.nexusAccessToken);
    /*
    // 没有 OAuth token(只用 API key 登录)→ 直接调用,无需刷新
    if (!settings.value.nexusAccessToken?.trim()) {
      return fn(settings.value.nexusAccessToken);
    }
    // 主动刷新:过期前 60 秒提前换新,避开"先失败再重试"的延迟
    if (settings.value.nexusTokenExpiresAt > 0
        && settings.value.nexusTokenExpiresAt < Date.now() + 60 * 1000) {
      try {
        const refreshed = await refreshNexusAccessToken();
        await persistRefreshedNexusTokens(refreshed);
      } catch {
        // 主动刷新失败继续往下走,等 fn 真触发再补救一次
      }
    }
    try {
      return await fn(settings.value.nexusAccessToken);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!/token has expired|invalid access token|unauthor/i.test(message)) {
        throw caught;
      }
      // 被动刷新:fn 调用中 token 失效(并发请求撞上临界点)
      try {
        const refreshed = await refreshNexusAccessToken();
        await persistRefreshedNexusTokens(refreshed);
        return await fn(refreshed.accessToken);
      } catch {
        throw caught; // 刷新也失败 → 抛原错,renderer 兜底走 clearNexusAuth
      }
    }
    */
  }

  async function validateNexusApiKey(apiKey = settings.value.nexusApiKey) {
    const key = apiKey.trim();

    if (!key) {
      error.value = "请先填写 NexusMods API Key。";
      return null;
    }

    busy.value = true;
    error.value = "";

    try {
      const user = await window.mayfly.validateNexusApiKey({
        apiKey: key,
        proxyUrl: activeProxyUrl()
      });
      settings.value.nexusApiKey = user.key || key;
      settings.value.nexusAccessToken = "";
      settings.value.nexusRefreshToken = "";
      settings.value.nexusTokenExpiresAt = 0;
      settings.value.nexusUser = user;
      await persist();
      return user;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "校验 NexusMods API Key 失败";
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function clearNexusAuth() {
    settings.value.nexusApiKey = "";
    settings.value.nexusAccessToken = "";
    settings.value.nexusRefreshToken = "";
    settings.value.nexusTokenExpiresAt = 0;
    settings.value.nexusUser = null;
    await persist();
  }

  async function recordLog(
    level: AppLogEntry["level"],
    source: string,
    message: string,
    detail = ""
  ) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) return;

    logs.value = [
      ...logs.value,
      {
        id: createId("log"),
        level,
        source: source.trim() || "app",
        message: normalizedMessage,
        detail: String(detail || ""),
        createdAt: Date.now()
      }
    ].slice(-300);

    // BUG-010(2026-10-03):UI 日志 tab 默认隐藏(详见 App.vue:2280 / 3303),
    //   用户排查问题没法直接看 recordLog 内容。
    //   这里同时输出到 console(主进程 + 渲染进程 devtools 都能看到),
    //   日志 tab 隐藏状态下也能定位问题。level → console method 映射。
    const consoleMsg = `[HGMM ${level.toUpperCase()}][${source.trim() || "app"}] ${normalizedMessage}`;
    if (level === "error") console.error(consoleMsg, detail);
    else if (level === "warn") console.warn(consoleMsg, detail);
    else console.log(consoleMsg, detail);

    if (initialized.value) {
      await persist();
    }
  }

  async function clearLogs() {
    logs.value = [];
    await persist();
  }

  async function checkAppUpdate(options: { silent?: boolean } = {}): Promise<AppUpdateCheckResult | null> {
    const updateUrl = settings.value.appUpdateUrl.trim();

    if (!updateUrl) {
      if (!options.silent) {
        appUpdateMessage.value = "";
        error.value = "请先在设置里填写应用更新地址。";
      }
      return null;
    }

    // 怀沙:附当前激活游戏的 presetId 给服务端做按游戏统计(无激活游戏时不带)
    let finalUpdateUrl = updateUrl;
    const activePresetId = activeGame.value?.presetId;
    if (activePresetId) {
      try {
        const url = new URL(updateUrl);
        url.searchParams.set("game", activePresetId);
        finalUpdateUrl = url.toString();
      } catch {
        finalUpdateUrl = updateUrl;
      }
    }

    appUpdateChecking.value = true;
    appUpdateMessage.value = options.silent ? "" : "正在检查应用更新...";
    if (!options.silent) {
      error.value = "";
    }

    try {
      const result = await window.mayfly.checkAppUpdate({
        updateUrl: finalUpdateUrl,
        proxyUrl: activeProxyUrl()
      });

      settings.value.lastAppUpdateCheckAt = Date.now();
      await persist();
      appUpdateCurrentVersion.value = result.currentVersionName;

      if (result.hasUpdate) {
        appUpdateInfo.value = result.remote;
        appUpdateDialogVisible.value = true;
        appUpdateMessage.value = `发现新版本 ${result.remote.versionName}`;
        await recordLog(
          "info",
          "updater",
          `发现应用新版本：${result.remote.versionName}`,
          result.remote.updateLog
        );
      } else if (!options.silent) {
        appUpdateMessage.value = `已是最新版本 ${result.currentVersionName || ""}`.trim();
        await recordLog("info", "updater", "应用已是最新版本", result.currentVersionName);
      }

      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "检查应用更新失败";
      appUpdateMessage.value = "";
      if (!options.silent) {
        error.value = message;
      }
      await recordLog("error", "updater", "检查应用更新失败", message);
      return null;
    } finally {
      appUpdateChecking.value = false;
    }
  }

  function closeAppUpdateDialog() {
    if (appUpdateInfo.value?.forceUpdate) return;
    appUpdateDialogVisible.value = false;
  }

  async function openAppUpdateDownload() {
    const downloadUrl = appUpdateInfo.value?.downloadUrl.trim() ?? "";

    if (!downloadUrl) {
      error.value = "更新下载地址为空。";
      return;
    }

    await window.mayfly.openExternal(downloadUrl);
  }

  async function loadNexusMods(page = nexusPage.value, append = false) {
    if (!nexusPreset.value?.nexusDomain) {
      error.value = "没有选择带 Nexus 配置的游戏。";
      return;
    }

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return;
    }

    nexusLoading.value = true;
    error.value = "";

    try {
      const _startTime = performance.now();
      const result = await withNexusTokenRefresh((accessToken) =>
        window.mayfly.listNexusMods({
          apiKey: settings.value.nexusApiKey,
          accessToken,
          gameDomain: nexusPreset.value.nexusDomain,
          page,
          pageSize: nexusPageSize.value,
          proxyUrl: activeProxyUrl(),
          searchText: nexusSearch.value,
          sort: nexusSort.value,
          facets: {
            categoryName: nexusCategory.value,
            languageName: nexusLanguage.value,
            tag: nexusTag.value
          }
        })
      );
      const _duration = Math.round(performance.now() - _startTime);
      console.groupCollapsed(`%c🌐 [Nexus API] List Mods - ${_duration}ms`, "color: #66c0f4; font-weight: bold;");
      console.log("Request Page:", page);
      console.log("Response:", result);
      console.groupEnd();
      await recordLog("info", "network", `[API/Nexus] 获取列表耗时 ${_duration}ms`, `第 ${page} 页 / ${nexusPageSize.value} 条`);

      const displayResult = await translateNexusListResult(result);

      if (append) {
        nexusMods.value = [...nexusMods.value, ...displayResult.items];
      } else {
        nexusMods.value = displayResult.items;
      }
      nexusPage.value = displayResult.page;
      nexusTotalCount.value = displayResult.totalCount;
      nexusTotalPages.value = displayResult.totalPages;
      nexusFacets.value = displayResult.facets;
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "获取 NexusMods 列表失败";
      // 怀沙:刷新也失败(refreshToken 撤销 / 账号被封)→ 清授权引导重登
      if (/token has expired|invalid access token|unauthor/i.test(raw)) {
        void clearNexusAuth();
        error.value = "Nexus 登录已过期,请重新登录";
        return;
      }
      error.value = raw || "获取 NexusMods 列表失败";
    } finally {
      nexusLoading.value = false;
    }
  }

  async function openNexusModDetail(item: NexusModItem) {
    if (!nexusPreset.value?.nexusDomain) return;

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return;
    }

    nexusDetailLoading.value = true;
    resetNexusTranslation();
    error.value = "";

    try {
      const detail = await withNexusTokenRefresh((accessToken) =>
        window.mayfly.getNexusModDetail({
          apiKey: settings.value.nexusApiKey,
          accessToken,
          gameDomain: nexusPreset.value.nexusDomain,
          modId: item.id,
          proxyUrl: activeProxyUrl()
        })
      );
      selectedNexusMod.value = await translateNexusDetailData(detail);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "获取 NexusMods 详情失败";
    } finally {
      nexusDetailLoading.value = false;
    }
  }

  function resetNexusTranslation() {
    nexusTranslationVisible.value = false;
    nexusTranslationError.value = "";
    nexusTranslatedSummary.value = "";
    nexusTranslatedDescription.value = "";
  }

  function cacheTranslation(key: string, text: string) {
    const nextEntries = [
      ...Object.entries(translationCache.value).filter(([entryKey]) => entryKey !== key),
      [key, { text, createdAt: Date.now() }] as const
    ].slice(-300);

    translationCache.value = Object.fromEntries(nextEntries);
  }

  async function translateTextCached(text: string, context: string, force = false) {
    const normalized = text.trim();
    if (!normalized) return "";

    const key = [
      settings.value.translationProvider,
      settings.value.translationTargetLang,
      context,
      hashText(normalized)
    ].join(":");
    const cached = translationCache.value[key];

    if (cached && !force) {
      return cached.text;
    }

    const _startTime = performance.now();
    try {
      const translated = await window.mayfly.translateText({
        text: normalized,
        provider: settings.value.translationProvider,
        targetLang: settings.value.translationTargetLang,
        proxyUrl: activeProxyUrl(),
        baiduAppId: settings.value.baiduTranslateAppId,
        baiduSecret: settings.value.baiduTranslateSecret,
        youdaoAppKey: settings.value.youdaoTranslateAppKey,
        youdaoSecret: settings.value.youdaoTranslateSecret,
        tencentSecretId: settings.value.tencentTranslateSecretId,
        tencentSecretKey: settings.value.tencentTranslateSecretKey,
        tencentRegion: settings.value.tencentTranslateRegion,
        volcengineAccessKeyId: settings.value.volcengineTranslateAccessKeyId,
        volcengineSecretAccessKey: settings.value.volcengineTranslateSecretAccessKey,
        volcengineRegion: settings.value.volcengineTranslateRegion,
        ollamaBaseUrl: settings.value.ollamaTranslateBaseUrl,
        ollamaModel: settings.value.ollamaTranslateModel,
        ollamaTimeoutMs: settings.value.ollamaTranslateTimeoutMs
      });
      const _duration = Math.round(performance.now() - _startTime);
      console.groupCollapsed(`%c📝 [Translate API] - ${_duration}ms`, "color: #65d289; font-weight: bold;");
      console.log("Provider:", settings.value.translationProvider);
      console.log("Original:", normalized);
      console.log("Translated:", translated);
      console.groupEnd();
      await recordLog("info", "network", `[API/翻译] 耗时 ${_duration}ms`, `文本: ${normalized.slice(0, 50)}...\n提供商: ${settings.value.translationProvider}`);

      cacheTranslation(key, translated);
      return translated;
    } catch (error) {
      const _duration = Math.round(performance.now() - _startTime);
      console.groupCollapsed(`%c❌ [Translate API] Failed - ${_duration}ms`, "color: #ff5e5e; font-weight: bold;");
      console.log("Provider:", settings.value.translationProvider);
      console.log("Original:", normalized);
      console.error(error);
      console.groupEnd();
      await recordLog("error", "network", `[API/翻译] 请求失败，耗时 ${_duration}ms`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  function canTranslateNexusText() {
    return settings.value.translationProvider !== "off";
  }

  async function translateManyTexts(values: string[], context: string, force = false) {
    const result = new Map<string, string>();
    const uniqueValues = [...new Set(values.map((value) => value.replace(/\r?\n/g, " ").trim()).filter(Boolean))];

    if (uniqueValues.length === 0) return result;

    const missingValues: string[] = [];

    for (const value of uniqueValues) {
      const individualContext = `${context}:${hashText(value)}`;
      const key = [
        settings.value.translationProvider,
        settings.value.translationTargetLang,
        individualContext,
        hashText(value)
      ].join(":");

      const cached = translationCache.value[key];
      if (cached && !force) {
        result.set(value, cached.text);
      } else {
        missingValues.push(value);
      }
    }

    if (missingValues.length > 0) {
      try {
        const combinedText = missingValues.join("\n");
        const translatedCombined = await translateTextCached(combinedText, `${context}:batch`, force);

        const translatedLines = translatedCombined.split("\n").map(line => line.trim());

        for (let i = 0; i < missingValues.length; i++) {
          const original = missingValues[i];
          const translated = translatedLines[i] || original;
          result.set(original, translated);

          const individualContext = `${context}:${hashText(original)}`;
          const key = [
            settings.value.translationProvider,
            settings.value.translationTargetLang,
            individualContext,
            hashText(original)
          ].join(":");
          cacheTranslation(key, translated);
        }
      } catch (caught) {
        for (const value of missingValues) result.set(value, value);
        await recordLog(
          "error",
          "translate",
          `批量翻译失败：${missingValues.length} 项`,
          caught instanceof Error ? caught.message : String(caught)
        );
      }
    }

    return result;
  }

  function translatedValue(map: Map<string, string>, value: string) {
    const normalized = value.trim();
    return normalized ? map.get(normalized) ?? value : value;
  }

  async function translateNexusListResult(result: NexusModListResult) {
    if (!canTranslateNexusText()) return result;

    const facetLabels = [
      ...result.facets.categoryName.map((facet) => facet.label)
    ];
    const itemTexts = result.items.flatMap((item) => [
      item.title
    ]);
    const textMap = await translateManyTexts([...facetLabels, ...itemTexts], "nexus:list");
    const translateFacet = <T extends { label: string }>(facet: T) => ({
      ...facet,
      label: translatedValue(textMap, facet.label)
    });

    await persist();

    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        title: translatedValue(textMap, item.title),
        summary: item.summary,
        categories: item.categories
      })),
      facets: {
        categoryName: result.facets.categoryName.map(translateFacet),
        languageName: [],
        tag: result.facets.tag // return untranslated tags since they are not shown
      }
    };
  }

  async function translateNexusDetailData(detail: NexusModDetail) {
    if (!canTranslateNexusText()) return detail;

    const source = nexusTranslationSource(detail);
    const shortTextMap = await translateManyTexts([
      detail.title,
      ...detail.categories,
      ...detail.images.map((image) => image.title),
      ...detail.files.flatMap((file) => [
        file.name,
        file.categoryName
      ])
    ], `nexus:detail:${detail.id}`);
    try {
      const [translatedSummary, translatedDescription] = await Promise.all([
        translateTextCached(source.summary, `nexus:${detail.id}:summary`),
        translateTextCached(source.description, `nexus:${detail.id}:description`)
      ]);

      nexusTranslatedSummary.value = translatedSummary;
      nexusTranslatedDescription.value = translatedDescription;
      nexusTranslationVisible.value = Boolean(translatedSummary || translatedDescription);
    } catch (caught) {
      nexusTranslationError.value = caught instanceof Error ? caught.message : "翻译 Nexus 说明失败";
      await recordLog("error", "translate", "翻译 Nexus 说明失败", nexusTranslationError.value);
    }

    await persist();

    return {
      ...detail,
      title: translatedValue(shortTextMap, detail.title),
      summary: detail.summary,
      categories: detail.categories.map((category) => translatedValue(shortTextMap, category)),
      images: detail.images.map((image) => ({
        ...image,
        title: translatedValue(shortTextMap, image.title)
      })),
      files: detail.files.map((file) => ({
        ...file,
        name: translatedValue(shortTextMap, file.name),
        categoryName: translatedValue(shortTextMap, file.categoryName)
      }))
    };
  }

  function protectBbCode(text: string) {
    const placeholders: string[] = [];
    let protectedText = text.replace(/\[(img|url|youtube|video|spoiler)(?:=[^\]]+)?\][\s\S]*?\[\/\1\]/gi, (match) => {
      placeholders.push(match);
      return ` MAYFLY_TOKEN_${placeholders.length - 1}_ `;
    });

    protectedText = protectedText.replace(/\[\/?(?:b|i|u|s|size|font|center|left|right|color|quote|hr|br|list|li|\*)(?:=[^\]]*)?\]/gi, (match) => {
      placeholders.push(match);
      return ` MAYFLY_TOKEN_${placeholders.length - 1}_ `;
    });

    return { protectedText, placeholders };
  }

  function restoreBbCode(text: string, placeholders: string[]) {
    return text.replace(/MAYFLY_TOKEN_(\d+)_/gi, (match, index) => {
      return placeholders[Number(index)] || match;
    });
  }

  async function translateSelectedNexusMod(force = false) {
    const detail = selectedNexusMod.value;
    if (!detail) return false;

    if (settings.value.translationProvider === "off") {
      nexusTranslationError.value = "请先在设置里开启实验性 Google 免费翻译。";
      await recordLog("error", "translate", nexusTranslationError.value);
      return false;
    }

    nexusTranslationLoading.value = true;
    nexusTranslationError.value = "";

    try {
      const source = nexusTranslationSource(detail);
      const { protectedText, placeholders } = protectBbCode(source.description);

      const [summary, rawTranslatedDescription] = await Promise.all([
        translateTextCached(source.summary, `nexus:${detail.id}:summary`, force),
        translateTextCached(protectedText, `nexus:${detail.id}:description_v2`, force)
      ]);

      const description = restoreBbCode(rawTranslatedDescription, placeholders);

      nexusTranslatedSummary.value = summary;
      nexusTranslatedDescription.value = description;
      nexusTranslationVisible.value = true;
      await persist();
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "翻译失败";
      nexusTranslationError.value = message;
      await recordLog("error", "translate", "Nexus 内容翻译失败", message);
      return false;
    } finally {
      nexusTranslationLoading.value = false;
    }
  }

  function showOriginalNexusText() {
    nexusTranslationVisible.value = false;
  }

  async function openNexusUrl(url: string) {
    if (!url) return;
    await window.mayfly.openExternal(url);
  }

  function comparableNexusFiles(source: ModUpdateSource, detail: NexusModDetail) {
    const currentFile = detail.files.find((file) => file.id === source.fileId);
    const categoryName = currentFile?.categoryName || source.categoryName;
    const sameCategory = categoryName
      ? detail.files.filter((file) => file.categoryName === categoryName)
      : [];
    const mainFiles = detail.files.filter((file) => file.categoryName === "MAIN");

    return sameCategory.length > 0
      ? sameCategory
      : mainFiles.length > 0
        ? mainFiles
        : detail.primaryFile
          ? [detail.primaryFile]
          : detail.files;
  }

  function buildUpdateCheck(source: ModUpdateSource, detail: NexusModDetail): ModUpdateCheck {
    const latestFile = comparableNexusFiles(source, detail)[0] ?? null;
    const checkedAt = Date.now();

    if (!latestFile) {
      return {
        status: "unsupported",
        checkedAt,
        message: "Nexus 没有返回可比较的文件。",
        latestFileId: "",
        latestFileName: "",
        latestVersion: "",
        latestUploadedAt: "",
        detailsUrl: source.modPageUrl
      };
    }

    const latestVersion = latestFile.version || detail.version || "";
    const currentVersion = source.fileVersion || source.modVersion;
    if (!source.fileId && !currentVersion.trim()) {
      return {
        status: "unsupported",
        checkedAt,
        message: "缺少当前版本，无法和 Nexus 最新版本比较。",
        latestFileId: latestFile.id,
        latestFileName: latestFile.name,
        latestVersion,
        latestUploadedAt: latestFile.createdAt,
        detailsUrl: latestFile.detailsUrl || nexusModWebsite(source.gameDomain, source.modId, latestFile.id)
      };
    }

    const hasNewFile = source.fileId
      ? Boolean(latestFile.id && latestFile.id !== source.fileId)
      : Boolean(currentVersion && latestVersion && currentVersion.trim() !== latestVersion.trim());

    return {
      status: hasNewFile ? "available" : "latest",
      checkedAt,
      message: hasNewFile
        ? `发现新版本：${latestVersion || latestFile.name || latestFile.id}`
        : "已是最新。",
      latestFileId: latestFile.id,
      latestFileName: latestFile.name,
      latestVersion,
      latestUploadedAt: latestFile.createdAt,
      detailsUrl: latestFile.detailsUrl || nexusModWebsite(source.gameDomain, source.modId, latestFile.id)
    };
  }

  async function checkModUpdate(mod: LocalMod) {
    const source = mod.updateSource;
    if (!source || source.type !== "nexus") {
      await updateMod(mod.id, {
        updateSource: source
          ? {
            ...source,
            check: {
              status: "unsupported",
              checkedAt: Date.now(),
              message: "这个 Mod 没有可用的 Nexus 来源信息。",
              latestFileId: "",
              latestFileName: "",
              latestVersion: "",
              latestUploadedAt: "",
              detailsUrl: ""
            }
          }
          : undefined
      });
      return null;
    }

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return null;
    }

    if (updateCheckingIds.value.includes(mod.id)) return source.check ?? null;
    updateCheckingIds.value = [...updateCheckingIds.value, mod.id];
    error.value = "";

    try {
      const detail = await withNexusTokenRefresh((accessToken) =>
        window.mayfly.getNexusModDetail({
          apiKey: settings.value.nexusApiKey,
          accessToken,
          gameDomain: source.gameDomain,
          modId: source.modId,
          proxyUrl: activeProxyUrl()
        })
      );
      const check = buildUpdateCheck(source, detail);
      await updateMod(mod.id, {
        updateSource: {
          ...source,
          modVersion: detail.version || source.modVersion,
          coverImage: detail.cover || source.coverImage,
          check
        },
        updatedAt: Date.now()
      });
      return check;
    } catch (caught) {
      const check: ModUpdateCheck = {
        status: "failed",
        checkedAt: Date.now(),
        message: caught instanceof Error ? caught.message : "检查更新失败",
        latestFileId: "",
        latestFileName: "",
        latestVersion: "",
        latestUploadedAt: "",
        detailsUrl: source.modPageUrl
      };
      await updateMod(mod.id, {
        updateSource: {
          ...source,
          check
        },
        updatedAt: Date.now()
      });
      return check;
    } finally {
      updateCheckingIds.value = updateCheckingIds.value.filter((id) => id !== mod.id);
    }
  }

  async function checkActiveGameUpdates(options: { silent?: boolean } = {}) {
    const targets = mods.value.filter((mod) =>
      mod.gameId === activeGameId.value &&
      mod.updateSource?.type === "nexus"
    );

    if (targets.length === 0) {
      if (!options.silent) {
        error.value = "当前游戏没有可检查更新的 Nexus 来源 Mod。";
      }
      return;
    }

    if (!nexusAuthorized.value) {
      if (!options.silent) {
        error.value = "请先登录 NexusMods。";
      }
      return;
    }

    busy.value = true;
    error.value = "";

    try {
      for (const mod of targets) {
        await checkModUpdate(mod);
      }
      await recordLog("info", "updates", `已检查 ${targets.length} 个 Nexus 来源 Mod 更新。`);

      let availableCount = 0;
      let failedCount = 0;
      for (const mod of targets) {
        const status = mod.updateSource?.check?.status;
        if (status === "available") availableCount++;
        else if (status === "failed") failedCount++;
      }
      updateCheckResult.value = { visible: true, available: availableCount, failed: failedCount };
      setTimeout(() => {
        if (updateCheckResult.value.visible) updateCheckResult.value.visible = false;
      }, 5000);
    } finally {
      busy.value = false;
    }
  }

  async function updateNexusMod(mod: LocalMod, options: { skipConfirm?: boolean } = {}) {
    const source = mod.updateSource;
    if (!source || source.type !== "nexus") {
      error.value = "这个 Mod 没有 Nexus 来源信息，无法自动更新。";
      return;
    }

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    let check = source.check;
    if (check?.status !== "available") {
      check = await checkModUpdate(mod) ?? undefined;
    }

    const latestSource = mods.value.find((item) => item.id === mod.id)?.updateSource ?? source;
    check = latestSource.check;

    if (check?.status !== "available" || !check.latestFileId) {
      error.value = check?.message || "没有可更新的文件。";
      return;
    }

    if (!options.skipConfirm) {
      const confirmed = await appConfirm({
        title: "更新 Mod",
        message: `确定更新“${mod.name}”吗？\n\n当前文件：${latestSource.fileName || latestSource.fileId}\n新文件：${check.latestFileName || check.latestFileId}`,
        danger: false,
        confirmText: "更新"
      });
      if (!confirmed) return;
    }

    const now = Date.now();
    const outputFile = sanitizeFileName(`${mod.name}-${check.latestFileName || check.latestFileId}`);
    const extension = /\.[a-z0-9]{2,5}$/i.test(outputFile) ? "" : ".zip";
    const nextUpdateSource: ModUpdateSource = {
      ...latestSource,
      fileId: check.latestFileId,
      fileName: check.latestFileName,
      fileVersion: check.latestVersion,
      filePageUrl: check.detailsUrl || nexusModWebsite(latestSource.gameDomain, latestSource.modId, check.latestFileId),
      downloadedAt: now,
      check
    };
    const game = games.value.find((item) => item.id === mod.gameId);
    const task: DownloadTask = {
      id: createId("download"),
      gameId: `nexus:${game?.presetId || latestSource.gameDomain}`,
      gameName: game?.name || latestSource.gameName,
      source: "NexusMods",
      modId: latestSource.modId,
      modName: mod.name,
      fileId: check.latestFileId,
      fileName: check.latestFileName || check.latestFileId,
      url: "",
      outputPath: `${settings.value.storagePath}\\downloads\\updates\\${outputFile}${extension}`,
      coverImage: latestSource.coverImage || mod.coverImage,
      updateSource: nextUpdateSource,
      updateTargetModId: mod.id,
      status: "queued",
      receivedBytes: 0,
      totalBytes: 0,
      error: "",
      createdAt: now,
      updatedAt: now
    };

    downloads.value = [task, ...downloads.value];
    await persist();

    try {
      const url = await withNexusTokenRefresh((accessToken) =>
        window.mayfly.getNexusDownloadUrl({
          apiKey: settings.value.nexusApiKey,
          accessToken,
          gameDomain: latestSource.gameDomain,
          modId: latestSource.modId,
          fileId: check.latestFileId,
          proxyUrl: activeProxyUrl()
        })
      );

      updateDownloadTask(task.id, { url });
      await persist();

      if (isExternalUrl(url)) {
        updateDownloadTask(task.id, {
          status: "external",
          error: ""
        });
        await persist();
        await window.mayfly.openExternal(url);
        return;
      }

      await runDownloadTask(task.id);
    } catch (caught) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载更新失败"
      });
      await persist();
    }
  }

  async function updateAllAvailableMods() {
    const targets = activeMods.value.filter((mod) =>
      mod.updateSource?.check?.status === "available"
    );

    if (targets.length === 0) {
      error.value = "当前游戏没有已检查出的可更新 Mod。";
      return;
    }

    const confirmed = await appConfirm({
      title: "批量更新 Mod",
      message: `确定更新当前游戏的 ${targets.length} 个 Mod 吗？会逐个下载并替换。`,
      danger: false,
      confirmText: "全部更新"
    });
    if (!confirmed) return;

    updateBatchProgress.value = {
      visible: true,
      current: 0,
      total: targets.length,
      message: "准备批量更新..."
    };

    for (let index = 0; index < targets.length; index += 1) {
      const mod = targets[index];
      updateBatchProgress.value = {
        visible: true,
        current: index + 1,
        total: targets.length,
        message: `正在更新：${mod.name}`
      };

      try {
        await updateNexusMod(mod, { skipConfirm: true });
      } catch (caught) {
        await recordLog(
          "error",
          "updates",
          `批量更新失败：${mod.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
      }
    }

    updateBatchProgress.value = {
      visible: false,
      current: 0,
      total: 0,
      message: ""
    };
  }

  function parseNxmUrl(url: string) {
    const normalized = url.trim();
    if (!/^nxm:\/\//i.test(normalized)) return null;

    try {
      const parsed = new URL(normalized);
      const gameId = decodeURIComponent(parsed.hostname || "").trim().toLowerCase();
      const segments = parsed.pathname.split("/").filter(Boolean);
      const modIndex = segments.findIndex((segment) => segment.toLowerCase() === "mods");
      const fileIndex = segments.findIndex((segment) => segment.toLowerCase() === "files");
      const modId = modIndex >= 0 ? decodeURIComponent(segments[modIndex + 1] || "").trim() : "";
      const fileId = fileIndex >= 0 ? decodeURIComponent(segments[fileIndex + 1] || "").trim() : "";
      const key = parsed.searchParams.get("key")?.trim() || undefined;
      const expires = parsed.searchParams.get("expires")?.trim() || undefined;

      if (!gameId || !modId) return null;

      return { gameId, modId, fileId, key, expires };
    } catch {
      return null;
    }
  }

  async function handleNxmUrl(url: string) {
    const parsed = parseNxmUrl(url);
    if (!parsed) {
      error.value = "无法识别 NXM 链接。";
      return false;
    }

    const preset = nexusPresets.value.find((item) => item.nexusDomain.toLowerCase() === parsed.gameId);
    if (!preset) {
      error.value = `当前未收录 NXM 游戏：${parsed.gameId}。`;
      return false;
    }

    setNexusPreset(preset.id);

    const linkedGame = games.value.find((game) => game.presetId === preset.id);
    if (linkedGame) {
      activeGameId.value = linkedGame.id;
    }

    if (!nexusAuthorized.value) {
      error.value = "收到 NXM 链接，但还没有填写 NexusMods API Key。";
      return false;
    }

    const item: NexusModItem = {
      id: parsed.modId,
      title: parsed.modId,
      summary: "",
      author: "",
      version: "",
      website: "",
      cover: "",
      downloads: 0,
      likes: 0,
      categories: [],
      createdAt: "",
      updatedAt: "",
      nsfw: false,
      filesCount: 0,
      primaryFile: null
    };

    await openNexusModDetail(item);

    if (selectedNexusMod.value && parsed.fileId) {
      const targetFile = selectedNexusMod.value.files.find((file) => file.id === parsed.fileId);
      if (targetFile) {
        await downloadNexusFile(targetFile, selectedNexusMod.value, {
          key: parsed.key,
          expires: parsed.expires
        });
        return true;
      }
    }

    return Boolean(selectedNexusMod.value);
  }

  function updateDownloadTask(taskId: string, patch: Partial<DownloadTask>) {
    downloads.value = downloads.value.map((task) =>
      task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task
    );
  }

  const speedTracker = new Map<string, { lastTime: number; lastBytes: number }>();
  window.mayfly.onDownloadProgress((data) => {
    const task = downloads.value.find((t) => t.id === data.taskId);
    if (!task || task.status !== "downloading") return;

    const now = Date.now();
    const track = speedTracker.get(data.taskId);
    let speed = task.speed || 0;

    if (track) {
      const timeDiff = (now - track.lastTime) / 1000;
      if (timeDiff > 0) {
        const bytesDiff = Math.max(0, data.receivedBytes - track.lastBytes);
        const currentSpeed = bytesDiff / timeDiff;
        speed = speed ? speed * 0.5 + currentSpeed * 0.5 : currentSpeed;
      }
    }

    speedTracker.set(data.taskId, { lastTime: now, lastBytes: data.receivedBytes });

    updateDownloadTask(data.taskId, {
      receivedBytes: data.receivedBytes,
      totalBytes: data.totalBytes,
      speed
    });
  });

  let packageOperationId = "";
  window.mayfly.onPackageProgress((data) => {
    if (!packageOperationId || data.operationId !== packageOperationId) return;

    packageProgress.value = {
      visible: true,
      operation: data.operation,
      phase: data.phase,
      current: data.current,
      total: data.total,
      message: data.message
    };
  });

  function beginPackageOperation(operation: "import" | "export", message: string) {
    packageOperationId = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    packageProgress.value = {
      visible: true,
      operation,
      phase: "准备中",
      current: 0,
      total: 0,
      message
    };
    return packageOperationId;
  }

  function endPackageOperation(operationId: string) {
    if (packageOperationId !== operationId) return;

    packageOperationId = "";
    packageProgress.value = {
      visible: false,
      operation: "",
      phase: "",
      current: 0,
      total: 0,
      message: ""
    };
  }

  function isAbortError(caught: unknown) {
    return caught instanceof Error && (
      caught.name === "AbortError" ||
      /abort|cancel|取消|终止|terminated/iu.test(caught.message)
    );
  }

  async function refreshDownloadSize(task: DownloadTask) {
    if (!task.outputPath || !(await window.mayfly.exists(task.outputPath))) return;

    const fileStat = await window.mayfly.stat(task.outputPath);
    updateDownloadTask(task.id, {
      receivedBytes: fileStat.size,
      totalBytes: Math.max(task.totalBytes, fileStat.size)
    });
  }

  async function replaceModFromDownloadedUpdate(task: DownloadTask, outputPath: string) {
    const targetMod = mods.value.find((mod) => mod.id === task.updateTargetModId);
    if (!targetMod || !task.updateSource) return false;

    const targetGame = games.value.find((game) => game.id === targetMod.gameId);
    if (!targetGame) return false;

    const previousActiveGameId = activeGameId.value;
    const wasInstalled = targetMod.installed;
    const backupPath = `${settings.value.storagePath}\\mod-update-backups\\${sanitizeFileName(targetGame.name)}\\${sanitizeFileName(targetMod.name)}-${Date.now()}.zip`;
    let backupCreated = false;

    try {
      activeGameId.value = targetGame.id;

      if (targetMod.rootPath && await window.mayfly.exists(targetMod.rootPath)) {
        await window.mayfly.createBackupZip({
          sourcePath: targetMod.rootPath,
          outputPath: backupPath
        });
        backupCreated = true;
      }

      if (wasInstalled) {
        const uninstalled = await uninstallMod(targetMod);
        if (!uninstalled) {
          throw new Error(error.value || "更新前卸载旧 Mod 失败。");
        }
      }

      if (targetMod.rootPath && await window.mayfly.exists(targetMod.rootPath)) {
        await window.mayfly.remove(targetMod.rootPath);
      }

      const result = await window.mayfly.importModFolder({
        sourcePath: outputPath,
        storagePath: settings.value.storagePath,
        gameId: targetGame.id,
        gameName: targetGame.name,
        modId: modFolderName(targetMod.rootPath, baseName(targetMod.rootPath))
      });
      const nextUpdateSource: ModUpdateSource = {
        ...task.updateSource,
        downloadedAt: Date.now(),
        check: {
          status: "latest",
          checkedAt: Date.now(),
          message: "已更新到当前文件。",
          latestFileId: task.updateSource.fileId,
          latestFileName: task.updateSource.fileName,
          latestVersion: task.updateSource.fileVersion,
          latestUploadedAt: task.updateSource.check?.latestUploadedAt || "",
          detailsUrl: task.updateSource.filePageUrl
        }
      };
      const updatedMod: LocalMod = {
        ...targetMod,
        sourcePath: outputPath,
        rootPath: result.rootPath,
        version: result.manifest?.version || task.updateSource.fileVersion || targetMod.version,
        website: result.manifest?.website || task.updateSource.modPageUrl || targetMod.website,
        description: targetMod.description || result.manifest?.description || "",
        coverImage: targetMod.coverImage || task.updateSource.coverImage || result.coverImage || "",
        requirements: targetMod.requirements.length > 0 ? targetMod.requirements : result.manifest?.requirements ?? [],
        files: result.files,
        installed: false,
        deployedFiles: [],
        updateSource: nextUpdateSource,
        updatedAt: Date.now()
      };

      mods.value = mods.value.map((mod) => mod.id === targetMod.id ? updatedMod : mod);
      await persist();

      if (wasInstalled) {
        await installMod(updatedMod);
      }

      await recordLog("info", "updates", `已更新 Mod：${targetMod.name}`);
      return true;
    } catch (caught) {
      if (backupCreated) {
        try {
          if (targetMod.rootPath && await window.mayfly.exists(targetMod.rootPath)) {
            await window.mayfly.remove(targetMod.rootPath);
          }
          await window.mayfly.restoreBackupZip({
            backupPath,
            targetPath: targetMod.rootPath
          });
          mods.value = mods.value.map((mod) => mod.id === targetMod.id ? targetMod : mod);
          await persist();

          if (wasInstalled && !targetMod.installed) {
            await installMod(targetMod);
          }
        } catch (rollbackCaught) {
          await recordLog(
            "error",
            "updates",
            `更新失败且回滚失败：${targetMod.name}`,
            rollbackCaught instanceof Error ? rollbackCaught.message : String(rollbackCaught)
          );
        }
      }

      error.value = caught instanceof Error ? caught.message : "更新 Mod 失败";
      await recordLog("error", "updates", `更新 Mod 失败：${targetMod.name}`, error.value);
      return false;
    } finally {
      activeGameId.value = previousActiveGameId;
    }
  }

  async function importCompletedDownload(task: DownloadTask, outputPath: string) {
    if (!settings.value.autoImportAfterDownload) return;

    if (task.updateTargetModId) {
      await replaceModFromDownloadedUpdate(task, outputPath);
      return;
    }

    if (task.source === "NexusMods") {
      const presetId = task.gameId.replace(/^nexus:/u, "");
      const localGame = games.value.find((game) => game.presetId === presetId);
      if (!localGame) return;

      const previousActiveGameId = activeGameId.value;
      activeGameId.value = localGame.id;
      await importLocalModsFromPaths([outputPath], "", task.updateSource
        ? {
          [outputPath]: task.updateSource,
          [normalizeText(outputPath)]: task.updateSource
        }
        : {}, "nexus");
      activeGameId.value = previousActiveGameId;
      return;
    }

    // HGMM Phase 5:非 Nexus 下载(目前只有精选 mod 的 downloadCustomUrl 入口),打"精选" tag
    const targetGame = games.value.find((game) => game.id === task.gameId) ?? activeGame.value;
    if (!targetGame) return;

    const previousActiveGameId = activeGameId.value;
    activeGameId.value = targetGame.id;
    await importLocalModsFromPaths([outputPath], "", {}, "featured");
    activeGameId.value = previousActiveGameId;
  }

  async function runDownloadTask(taskId: string, resume = false) {
    const task = downloads.value.find((item) => item.id === taskId);
    if (!task || !task.url || task.status === "downloading") return;

    updateDownloadTask(task.id, {
      status: "downloading",
      error: ""
    });
    await persist();

    try {
      const result = await window.mayfly.downloadFile({
        taskId: task.id,
        url: task.url,
        outputPath: task.outputPath,
        resume,
        proxyUrl: activeProxyUrl(),
        engine: settings.value.downloadEngine,
        aria2ExecutablePath: settings.value.aria2ExecutablePath,
        aria2MaxConnections: settings.value.aria2MaxConnections
      });

      // 怀沙:下载完整性校验 — Nexus CDN 偶发 URL 失效/网络截断会留 partial 文件
      // 只校验 expected vs actual(Content-Length 一致性),不卡字节数 ——
      // 合法小 mod(单 DLL 补丁、几行 JSON)打包后可能就几百字节,4 KB 阈值会误伤
      const expectedBytes = task.totalBytes;
      const actualBytes = result.receivedBytes;
      if (expectedBytes > 0 && actualBytes < expectedBytes) {
        throw new Error(
          `下载不完整(期望 ${expectedBytes} 字节,实际 ${actualBytes} 字节)。` +
          `可能是 Nexus CDN URL 失效或网络中断,稍候自动重试。`
        );
      }
      // 文件过小但 expectedBytes 也为 0(Nexus 没返回 Content-Length)→
      // 留 0 字节 / 残文件 当个明确错误,引导重下而不是静默成功
      if (actualBytes === 0) {
        throw new Error(
          `下载文件为空。可能是网络中断或 Nexus 返回了空响应,请重新下载。`
        );
      }

      updateDownloadTask(task.id, {
        status: "completed",
        outputPath: result.outputPath,
        receivedBytes: result.receivedBytes,
        totalBytes: result.totalBytes,
        error: ""
      });
      await persist();
      await importCompletedDownload(task, result.outputPath);
    } catch (caught) {
      const current = downloads.value.find((item) => item.id === task.id);

      // 1. Manually paused by user
      if (current?.status === "paused") {
        await refreshDownloadSize(current ?? task);
        updateDownloadTask(task.id, {
          status: "paused",
          error: "已暂停"
        });
        await persist();
        return;
      }

      // 2. Unexpected error or disconnect (including aborts not triggered by user)
      const errorMessage = caught instanceof Error ? caught.message : String(caught);
      // 怀沙:文件损坏类(7-Zip "Is not archive"/"Cannot open"、AdmZip "END header")不重试
      // 重试 CDN 截断响应 100% 还是截断,只把 task 卡死不会成功。透传真实错因。
      const isFileCorruption = /is not archive|cannot open|end header|signature|no end/i
        .test(errorMessage);
      await refreshDownloadSize(current ?? task);
      updateDownloadTask(task.id, {
        status: "failed",
        error: errorMessage
      });
      await persist();

      // 仅对瞬时错误(网络/超时/CDN URL 失效)3 秒后自动重试
      if (!isFileCorruption) {
        window.setTimeout(() => {
          const checkTask = downloads.value.find((item) => item.id === task.id);
          if (checkTask && checkTask.status === "failed") {
            resumeDownloadTask(task.id).catch(console.error);
          }
        }, 3000);
      } else {
        console.warn(
          "[hgmm] download task failed with non-retryable file corruption:",
          task.fileName,
          errorMessage
        );
      }
    }
  }

  async function downloadNexusFile(
    file: NexusModFile,
    mod = selectedNexusMod.value,
    authorization?: NexusDownloadAuthorization
  ) {
    if (!nexusPreset.value || !mod) return;

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return;
    }

    const existingTask = downloads.value.find((task) =>
      task.source === "NexusMods" &&
      task.gameId === `nexus:${nexusPreset.value?.id}` &&
      task.modId === mod.id &&
      task.fileId === file.id &&
      ["queued", "downloading", "completed", "external"].includes(task.status)
    );

    // HGMM Phase 5.x:completed task 孤儿放行
    // 场景:用户下载 → 一键修复 / 手动删 LocalMod → 想再下 → 不能被死任务挡住
    // 只有 status=completed 且库中无对应 LocalMod 才放行
    // queued/downloading/external 仍挡(避免并发 + 浏览器外链需要人工处理)
    if (existingTask && existingTask.status !== "external") {
      const isOrphanCompleted =
        existingTask.status === "completed" &&
        (() => {
          const localGame = games.value.find((g) => g.presetId === nexusPreset.value?.id);
          if (!localGame) return true; // 找不到对应本地游戏,当孤儿处理
          return !mods.value.some(
            (m) =>
              m.gameId === localGame.id &&
              m.updateSource?.type === "nexus" &&
              m.updateSource.modId === existingTask.modId &&
              m.updateSource.fileId === existingTask.fileId,
          );
        })();

      if (!isOrphanCompleted) {
        error.value = `下载队列里已经有“${file.name}”。`;
        return;
      }
      // 孤儿任务,清掉放行
      downloads.value = downloads.value.filter((t) => t.id !== existingTask.id);
      await persist();
    }

    const now = Date.now();
    const outputFile = sanitizeFileName(`${mod.title || mod.id}-${file.name || file.id}`);
    const extension = /\.[a-z0-9]{2,5}$/i.test(outputFile) ? "" : ".zip";
    const updateSource: ModUpdateSource = {
      type: "nexus",
      gameDomain: nexusPreset.value.nexusDomain,
      gameName: nexusPreset.value.name,
      modId: mod.id,
      fileId: file.id,
      fileName: file.name,
      fileVersion: file.version,
      modVersion: mod.version,
      categoryName: file.categoryName,
      modPageUrl: mod.website || nexusModWebsite(nexusPreset.value.nexusDomain, mod.id),
      filePageUrl: file.detailsUrl || nexusModWebsite(nexusPreset.value.nexusDomain, mod.id, file.id),
      coverImage: mod.cover || "",
      downloadedAt: now
    };
    const task: DownloadTask = existingTask ?? {
      id: createId("download"),
      gameId: `nexus:${nexusPreset.value.id}`,
      gameName: nexusPreset.value.name,
      source: "NexusMods",
      modId: mod.id,
      modName: mod.title,
      fileId: file.id,
      fileName: file.name,
      url: "",
      outputPath: `${settings.value.storagePath}\\downloads\\nexus-${nexusPreset.value.id}\\${outputFile}${extension}`,
      coverImage: mod.cover || "",
      updateSource,
      status: "queued",
      receivedBytes: 0,
      totalBytes: file.size,
      error: "",
      createdAt: now,
      updatedAt: now
    };

    if (existingTask) {
      updateDownloadTask(task.id, {
        url: "",
        status: "queued",
        error: "",
        coverImage: mod.cover || "",
        updateSource,
        totalBytes: Math.max(task.totalBytes, file.size)
      });
    } else {
      downloads.value = [task, ...downloads.value];
    }
    await persist();

    try {
      const url = await withNexusTokenRefresh((accessToken) =>
        window.mayfly.getNexusDownloadUrl({
          apiKey: settings.value.nexusApiKey,
          accessToken,
          gameDomain: nexusPreset.value.nexusDomain,
          modId: mod.id,
          fileId: file.id,
          proxyUrl: activeProxyUrl(),
          key: authorization?.key,
          expires: authorization?.expires
        })
      );

      updateDownloadTask(task.id, { url });
      await persist();

      if (isExternalUrl(url)) {
        updateDownloadTask(task.id, {
          status: "external",
          error: ""
        });
        await persist();
        await window.mayfly.openExternal(url);
        return;
      }

      await runDownloadTask(task.id);
    } catch (caught) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载 NexusMods 文件失败"
      });
      await persist();
    }
  }

  async function openDownloadFile(task: DownloadTask) {
    if (task.status === "external" && task.url) {
      await window.mayfly.openExternal(task.url);
      return;
    }

    if (!task.outputPath) return;
    await window.mayfly.openPath(task.outputPath);
  }

  async function openDownloadFolder(task: DownloadTask) {
    if (!task.outputPath) return;
    await window.mayfly.openPath(dirName(task.outputPath));
  }

  async function downloadCustomUrl(url: string, fileNameInput = "") {
    const normalizedUrl = url.trim();

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      error.value = "请输入有效的 http 或 https 下载地址。";
      return;
    }

    const guessedName =
      fileNameInput.trim() ||
      decodeURIComponent(normalizedUrl.split("?")[0].split("/").filter(Boolean).pop() ?? "") ||
      "custom-download.zip";
    const safeName = sanitizeFileName(guessedName);
    const now = Date.now();
    const task: DownloadTask = {
      id: createId("download"),
      gameId: activeGame.value?.id ?? "custom",
      gameName: activeGame.value?.name ?? "自定义下载",
      source: "Custom",
      modId: "",
      modName: fileNameInput.trim() || safeName,
      fileId: "",
      fileName: safeName,
      url: normalizedUrl,
      outputPath: `${settings.value.storagePath}\\downloads\\custom\\${safeName}`,
      status: "queued",
      receivedBytes: 0,
      totalBytes: 0,
      error: "",
      createdAt: now,
      updatedAt: now
    };

    downloads.value = [task, ...downloads.value];
    await persist();

    try {
      await runDownloadTask(task.id);
    } catch (caught) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载自定义 URL 失败"
      });
      await persist();
    }
  }

  async function removeDownloadTask(taskId: string) {
    await removeDownloadTasks([taskId], false);
  }

  async function removeDownloadTasks(taskIds: string[], removeFiles = false) {
    const ids = new Set(taskIds.filter(Boolean));
    const targets = downloads.value.filter((task) => ids.has(task.id));

    for (const task of targets) {
      if (task.status === "downloading") {
        await window.mayfly.cancelDownload(task.id);
      }

      if (removeFiles && task.outputPath) {
        try {
          if (await window.mayfly.exists(task.outputPath)) {
            await window.mayfly.remove(task.outputPath);
          }
        } catch (caught) {
          await recordLog(
            "error",
            "downloads",
            `删除下载文件失败：${task.fileName}`,
            caught instanceof Error ? caught.message : String(caught)
          );
        }
      }
    }

    downloads.value = downloads.value.filter((task) => !ids.has(task.id));
    await persist();
  }

  async function pauseDownloadTask(taskId: string) {
    const task = downloads.value.find((item) => item.id === taskId);
    if (!task || task.status !== "downloading") return;

    updateDownloadTask(task.id, {
      status: "paused",
      error: "正在暂停..."
    });
    await window.mayfly.cancelDownload(task.id);
    await refreshDownloadSize(task);
    updateDownloadTask(task.id, { error: "已暂停" });
    await persist();
  }

  async function resumeDownloadTask(taskId: string) {
    const task = downloads.value.find((item) => item.id === taskId);
    if (!task || !["paused", "failed", "queued"].includes(task.status)) return;

    if (!task.url) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: "没有可继续的下载地址，请重新发起下载。"
      });
      await persist();
      return;
    }

    await runDownloadTask(task.id, true);
  }

  async function pauseDownloadTasks(taskIds: string[]) {
    for (const taskId of [...new Set(taskIds)]) {
      await pauseDownloadTask(taskId);
    }
  }

  async function resumeDownloadTasks(taskIds: string[]) {
    for (const taskId of [...new Set(taskIds)]) {
      await resumeDownloadTask(taskId);
    }
  }

  async function createActiveGameBackup(nameInput = "") {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    busy.value = true;
    error.value = "";

    try {
      const now = Date.now();
      const name = sanitizeFileName(nameInput.trim() || `${activeGame.value.name}-${new Date(now).toISOString().slice(0, 10)}`);
      const outputPath = `${settings.value.storagePath}\\backups\\${activeGame.value.id}\\${name}.zip`;
      const result = await window.mayfly.createBackupZip({
        sourcePath: activeGame.value.path,
        outputPath
      });

      backups.value = [
        {
          id: createId("backup"),
          gameId: activeGame.value.id,
          gameName: activeGame.value.name,
          name,
          sourcePath: activeGame.value.path,
          outputPath: result.outputPath,
          size: result.size,
          filesCount: result.filesCount,
          createdAt: now
        },
        ...backups.value
      ];
      await persist();
      await recordLog("info", "backup", `已创建备份：${name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "创建备份失败";
    } finally {
      busy.value = false;
    }
  }

  async function createActiveSaveBackup(nameInput = "") {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    const savePath = await window.mayfly.openDirectory();
    if (!savePath) return;

    busy.value = true;
    error.value = "";

    try {
      const now = Date.now();
      const name = sanitizeFileName(nameInput.trim() || `${activeGame.value.name}-存档-${new Date(now).toISOString().slice(0, 10)}`);
      const outputPath = `${settings.value.storagePath}\\backups\\${activeGame.value.id}\\saves\\${name}.zip`;
      const result = await window.mayfly.createBackupZip({
        sourcePath: savePath,
        outputPath
      });

      backups.value = [
        {
          id: createId("backup"),
          gameId: activeGame.value.id,
          gameName: `${activeGame.value.name} 存档`,
          name,
          sourcePath: savePath,
          outputPath: result.outputPath,
          size: result.size,
          filesCount: result.filesCount,
          createdAt: now
        },
        ...backups.value
      ];
      await persist();
      await recordLog("info", "backup", `已创建存档备份：${name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "创建存档备份失败";
    } finally {
      busy.value = false;
    }
  }

  async function restoreBackup(backup: BackupEntry) {
    const targetPath = backup.sourcePath || games.value.find((item) => item.id === backup.gameId)?.path || "";

    if (!targetPath) {
      error.value = "恢复失败：没有找到恢复目录。";
      return;
    }

    busy.value = true;
    error.value = "";

    try {
      await window.mayfly.restoreBackupZip({
        backupPath: backup.outputPath,
        targetPath
      });
      await recordLog("info", "backup", `已恢复备份：${backup.name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "恢复备份失败";
    } finally {
      busy.value = false;
    }
  }

  async function removeBackup(backup: BackupEntry, removeFile = false) {
    if (removeFile && backup.outputPath) {
      await window.mayfly.remove(backup.outputPath);
    }

    backups.value = backups.value.filter((item) => item.id !== backup.id);
    await persist();
  }

  async function renameBackup(backupId: string, name: string) {
    const nextName = name.trim();
    if (!nextName) return;

    backups.value = backups.value.map((backup) =>
      backup.id === backupId ? { ...backup, name: nextName } : backup
    );
    await persist();
  }

  async function importBackupFile() {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    const paths = await window.mayfly.openArchive();
    const backupPath = paths.find((path) => /\.zip$/iu.test(path)) ?? "";
    if (!backupPath) {
      error.value = "请选择 zip 备份文件。";
      return;
    }

    try {
      const fileStat = await window.mayfly.stat(backupPath);
      const contents = await window.mayfly.listBackupZip(backupPath);
      const backup: BackupEntry = {
        id: createId("backup"),
        gameId: activeGame.value.id,
        gameName: activeGame.value.name,
        name: modNameFromPath(backupPath),
        sourcePath: activeGame.value.path,
        outputPath: backupPath,
        size: fileStat.size,
        filesCount: contents.filter((entry) => !entry.isDirectory).length,
        createdAt: Date.now()
      };

      backups.value = [backup, ...backups.value];
      backupContents.value = {
        ...backupContents.value,
        [backup.id]: contents
      };
      await persist();
      await recordLog("info", "backup", `已导入备份文件：${backup.name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导入备份文件失败";
    }
  }

  async function loadBackupContents(backup: BackupEntry) {
    try {
      backupContents.value = {
        ...backupContents.value,
        [backup.id]: await window.mayfly.listBackupZip(backup.outputPath)
      };
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "读取备份内容失败";
    }
  }

  async function openBackupFolder(backup?: BackupEntry) {
    if (backup?.outputPath) {
      await window.mayfly.openPath(dirName(backup.outputPath));
      return;
    }

    if (!settings.value.storagePath) return;
    await window.mayfly.openPath(`${settings.value.storagePath}\\backups`);
  }

  async function exportData() {
    const defaultName = `mayfly-data-${new Date().toISOString().slice(0, 10)}.json`;
    const outputPath = await window.mayfly.saveJson(defaultName);
    if (!outputPath) return;

    await window.mayfly.writeJsonFile(outputPath, toData());
    await recordLog("info", "data", `已导出数据：${outputPath}`);
  }

  async function importData() {
    const inputPath = await window.mayfly.openJson();
    if (!inputPath) return;

    try {
      const imported = normalizeAppData(await window.mayfly.readJsonFile<Partial<AppData>>(inputPath));
      const gameIds = new Set(games.value.map((game) => game.id));
      const profileIds = new Set(modProfiles.value.map((profile) => profile.id));
      const modIds = new Set(mods.value.map((mod) => mod.id));
      const downloadIds = new Set(downloads.value.map((task) => task.id));
      const backupIds = new Set(backups.value.map((backup) => backup.id));
      const logIds = new Set(logs.value.map((log) => log.id));

      games.value = [
        ...games.value,
        ...imported.games.filter((game) => !gameIds.has(game.id))
      ];
      modProfiles.value = [
        ...modProfiles.value,
        ...imported.modProfiles.filter((profile) => !profileIds.has(profile.id))
      ];
      mods.value = [
        ...mods.value,
        ...imported.mods.filter((mod) => !modIds.has(mod.id))
      ];
      downloads.value = [
        ...downloads.value,
        ...imported.downloads.filter((task) => !downloadIds.has(task.id))
      ];
      backups.value = [
        ...backups.value,
        ...imported.backups.filter((backup) => !backupIds.has(backup.id))
      ];
      logs.value = [
        ...logs.value,
        ...imported.logs.filter((log) => !logIds.has(log.id))
      ].slice(-300);

      if (!activeGameId.value && games.value[0]) {
        activeGameId.value = games.value[0].id;
      }

      await persist();
      await recordLog("info", "data", `已导入数据：${inputPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导入数据失败";
    }
  }

  async function exportModsToPackage(options: {
    targetMods: LocalMod[];
    name: string;
    author: string;
    version: string;
    description: string;
  }) {
    const targetMods = options.targetMods.filter((mod) => mod.rootPath);

    if (targetMods.length === 0) {
      error.value = "请先选择要导出的 Mod。";
      return;
    }

    const packageName = options.name.trim() || (targetMods.length === 1 ? targetMods[0].name : "Mayfly Mod Pack");
    const outputPath = await window.mayfly.saveFile({
      defaultPath: `${sanitizeFileName(packageName)}.mmp`,
      filters: [
        { name: "Mayfly Mod Package", extensions: ["mmp"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (!outputPath) return;

    const manifest = {
      format: "mayfly-mod-package",
      version: 1,
      name: packageName,
      author: options.author.trim(),
      modVersion: options.version.trim(),
      description: options.description.trim(),
      exportedAt: new Date().toISOString(),
      mods: targetMods.map((mod) => ({
        id: mod.id,
        name: mod.name,
        version: mod.version,
        author: mod.author,
        website: mod.website,
        description: mod.description,
        tags: mod.tags,
        requirements: mod.requirements,
        updateSource: mod.updateSource,
        folder: sanitizeFileName(mod.name || mod.id)
      }))
    };

    const operationId = beginPackageOperation("export", "正在导出 Mod 包...");
    busy.value = true;
    error.value = "";

    try {
      const finalPath = outputPath.toLowerCase().endsWith(".mmp")
        ? outputPath
        : `${outputPath}.mmp`;
      await window.mayfly.exportModPackage({
        outputPath: finalPath,
        operationId,
        manifest: toPlain(manifest),
        mods: toPlain(targetMods.map((mod) => ({
          rootPath: mod.rootPath,
          folderName: sanitizeFileName(mod.name || mod.id)
        })))
      });
      await recordLog("info", "package", `已导出 .mmp：${finalPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导出 .mmp 失败";
    } finally {
      busy.value = false;
      endPackageOperation(operationId);
    }
  }

  async function exportActiveGamePack(nameInput = "") {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    const gameMods = mods.value.filter((mod) => mod.gameId === activeGame.value?.id && mod.rootPath);
    if (gameMods.length === 0) {
      error.value = "当前游戏还没有可导出的 Mod。";
      return;
    }

    const packageName = nameInput.trim() || `${activeGame.value.name} Mod 整合包`;
    const outputPath = await window.mayfly.saveFile({
      defaultPath: `${sanitizeFileName(packageName)}.zip`,
      filters: [
        { name: "Mayfly Game Mod Pack", extensions: ["zip"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (!outputPath) return;

    const orderedMods = [...gameMods].sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt);
    const manifest = {
      format: "mayfly-game-pack",
      version: 1,
      name: packageName,
      game: {
        id: activeGame.value.id,
        presetId: activeGame.value.presetId,
        name: activeGame.value.name,
        path: activeGame.value.path,
        installPath: activeGame.value.installPath,
        launchArgs: activeGame.value.launchArgs,
        exeNames: activeGame.value.exeNames,
        coverUrl: activeGame.value.coverUrl,
        typeNames: activeGame.value.typeNames,
        customAdapterRules: activeGame.value.customAdapterRules,
        adapterStatus: activeGame.value.adapterStatus,
        steamAppId: activeGame.value.steamAppId,
        nexusDomain: activeGame.value.nexusDomain,
        nexusGameId: activeGame.value.nexusGameId,
        catalogGameId: activeGame.value.catalogGameId
      },
      tagColors: settings.value.tagColors,
      exportedAt: new Date().toISOString(),
      mods: orderedMods.map((mod, index) => ({
        id: mod.id,
        folder: modFolderName(mod.rootPath, String(index + 1)),
        name: mod.name,
        sourcePath: mod.sourcePath,
        version: mod.version,
        author: mod.author,
        website: mod.website,
        description: mod.description,
        coverImage: mod.coverImage,
        tags: mod.tags,
        requirements: mod.requirements,
        updateSource: mod.updateSource,
        modTypeId: mod.modTypeId,
        modTypeName: mod.modTypeName,
        sortIndex: index,
        installed: mod.installed
      }))
    };
    const finalPath = isPackageArchive(outputPath) ? outputPath : `${outputPath}.zip`;
    const operationId = beginPackageOperation("export", "正在导出游戏整合包...");
    busy.value = true;
    error.value = "";

    try {
      await window.mayfly.exportModPackage({
        outputPath: finalPath,
        operationId,
        manifest: toPlain(manifest),
        mods: toPlain(orderedMods.map((mod, index) => ({
          rootPath: mod.rootPath,
          folderName: modFolderName(mod.rootPath, String(index + 1))
        })))
      });
      await recordLog("info", "package", `已导出游戏整合包：${finalPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导出游戏整合包失败";
    } finally {
      busy.value = false;
      endPackageOperation(operationId);
    }
  }

  async function restoreActiveGamePack() {
    if (!settings.value.storagePath) {
      error.value = "请先设置 Mod 存储路径。";
      return;
    }

    const paths = await window.mayfly.openArchive();
    const packagePath = paths.find(isPackageArchive) ?? "";
    if (!packagePath) return;
    const manifest = await window.mayfly.readPackageManifest(packagePath);
    const gameMeta = manifest.game && typeof manifest.game === "object"
      ? manifest.game as Record<string, unknown>
      : {};
    const gameName = String(gameMeta.name || "").trim();

    if (manifest.format !== "mayfly-game-pack" || !gameName) {
      error.value = "这不是有效的游戏 Mod 整合包。";
      return;
    }

    const confirmed = await appConfirm({
      title: "恢复整合包",
      message: `确定恢复“${gameName}”整合包吗？这会添加或选中该游戏，并替换它的 Mod 管理列表。`,
      confirmText: "恢复"
    });
    if (!confirmed) return;

    busy.value = true;
    error.value = "";
    const operationId = beginPackageOperation("import", "正在准备导入整合包...");

    try {
      let targetGame = games.value.find((game) =>
        (game.presetId && game.presetId === String(gameMeta.presetId || "")) ||
        game.name === gameName
      );

      if (!targetGame) {
        const now = Date.now();
        targetGame = {
          id: createId("game"),
          presetId: String(gameMeta.presetId || ""),
          catalogGameId: Number(gameMeta.catalogGameId) || 0,
          steamAppId: Number(gameMeta.steamAppId) || 0,
          nexusDomain: String(gameMeta.nexusDomain || ""),
          nexusGameId: Number(gameMeta.nexusGameId) || 0,
          name: gameName,
          path: String(gameMeta.path || ""),
          installPath: String(gameMeta.installPath || ""),
          launchArgs: String(gameMeta.launchArgs || ""),
          exeNames: Array.isArray(gameMeta.exeNames) ? gameMeta.exeNames.map(String) : [],
          coverUrl: String(gameMeta.coverUrl || ""),
          typeNames: Array.isArray(gameMeta.typeNames) ? gameMeta.typeNames.map(String) : [],
          customAdapterRules: normalizeCustomAdapterRules(gameMeta.customAdapterRules),
          adapterStatus: gameMeta.adapterStatus === "custom" ? "custom" : "implemented",
          createdAt: now
        };
        games.value = [...games.value, targetGame];
      } else {
        games.value = games.value.map((game) =>
          game.id === targetGame?.id
            ? {
              ...game,
              name: gameName,
              path: String(gameMeta.path || game.path),
              installPath: String(gameMeta.installPath || game.installPath),
              launchArgs: String(gameMeta.launchArgs || game.launchArgs),
              coverUrl: String(gameMeta.coverUrl || game.coverUrl),
              customAdapterRules: normalizeCustomAdapterRules(gameMeta.customAdapterRules).length > 0
                ? normalizeCustomAdapterRules(gameMeta.customAdapterRules)
                : game.customAdapterRules
            }
            : game
        );
        targetGame = games.value.find((game) => game.id === targetGame?.id) ?? targetGame;
      }

      activeGameId.value = targetGame.id;
      const tagColors = manifest.tagColors && typeof manifest.tagColors === "object"
        ? manifest.tagColors as Record<string, string>
        : {};
      settings.value = {
        ...settings.value,
        tagColors: {
          ...settings.value.tagColors,
          ...tagColors
        }
      };
      const oldGameMods = mods.value.filter((mod) => mod.gameId === targetGame.id);
      for (const mod of oldGameMods) {
        if (mod.rootPath && await window.mayfly.exists(mod.rootPath)) {
          await window.mayfly.remove(mod.rootPath);
        }
      }

      const result = await window.mayfly.importGamePack({
        packagePath,
        storagePath: settings.value.storagePath,
        gameName: targetGame.name,
        overwrite: true,
        operationId
      });
      const adapter = adapterForGame(targetGame);
      const packedMods = Array.isArray(result.manifest.mods) ? result.manifest.mods as Array<Record<string, unknown>> : [];
      const restoredMods: LocalMod[] = result.mods.map((imported, index) => {
        const meta = packedMods.find((item) => String(item.folder) === imported.folder) ?? {};
        const now = Date.now();
        const modType = resolveStoredModType(
          adapter,
          targetGame.presetId,
          meta.modTypeId ?? meta.modType,
          meta.modTypeName,
          imported.files
        );

        return {
          id: createId("mod"),
          gameId: targetGame.id,
          sortIndex: Number(meta.sortIndex) || index,
          name: String(meta.name || imported.folder),
          sourcePath: String(meta.sourcePath || packagePath),
          rootPath: imported.rootPath,
          version: String(meta.version || ""),
          author: String(meta.author || ""),
          website: String(meta.website || ""),
          description: String(meta.description || ""),
          coverImage: imported.coverImage || String(meta.coverImage || ""),
          tags: stringList(meta.tags),
          requirements: stringList(meta.requirements),
          files: imported.files,
          modTypeId: modType.id,
          modTypeName: modType.name,
          installed: false,
          deployedFiles: [],
          updateSource: normalizeModUpdateSource(meta.updateSource),
          createdAt: now,
          updatedAt: now
        };
      });

      mods.value = [
        ...mods.value.filter((mod) => mod.gameId !== targetGame.id),
        ...restoredMods
      ];
      selectedModIds.value = [];
      await persist();
      await recordLog("info", "package", `已恢复游戏整合包：${packagePath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "恢复游戏整合包失败";
    } finally {
      busy.value = false;
      endPackageOperation(operationId);
    }
  }

  // ============================================================
  // HGMM 精选 mod(Phase 1B)actions
  // ============================================================

  /**
   * 加载当前激活游戏的精选 mod 列表
   *
   * 行为:
   *   - 游戏无 CDN 配置(CDN_SCHEMA_FILES 查不到)→ 清空状态,静默成功
   *   - fetch 失败 → error.value 设错,清空状态
   *   - 顶层 Enable:false → featuredGlobalEnabled=false(UI 显示灰度提示)
   *
   * 调用方:setActiveGame 末尾自动调,UI 也可手动重试
   */
  async function loadFeaturedMods() {
    if (!activeGame.value) {
      featuredMods.value = [];
      featuredDeleteRules.value = [];
      return;
    }
    // 关键:用 presetId,不用 id
    // game.id 是动态生成的 "game_xxx"(L1352 createId("game"))
    // game.presetId 才是 CDN_SCHEMA_FILES 的 key("palworld"/"blackwukong"/...)
    const gameId = activeGame.value.presetId || activeGame.value.id;
    // HGMM 3.2 调试:实时打印 gameId 解析 + CDN 命中情况
    console.log(
      `[hgmm] loadFeaturedMods: gameId="${gameId}" presetId="${activeGame.value.presetId}" activeGameId="${activeGame.value.id}" cdnKeyExists=${Boolean(CDN_SCHEMA_FILES[gameId])}`
    );
    if (!CDN_SCHEMA_FILES[gameId]) {
      // 该游戏不在 HGMM 7 款精选游戏列表中,正常情况
      // (自定义游戏 presetId 为空,会落到这里)
      featuredMods.value = [];
      featuredDeleteRules.value = [];
      featuredGlobalEnabled.value = true;
      return;
    }
    featuredLoading.value = true;
    error.value = "";
    try {
      const result: FeaturedFetchResult = await fetchHGMMFeatured(gameId);
      console.log(
        `[hgmm] loadFeaturedMods: CDN fetch ok gameId="${gameId}" modsCount=${result.mods.length}`
      );
      featuredMods.value = result.mods;
      featuredDeleteRules.value = result.deleteRules;
      featuredGlobalEnabled.value = result.globalEnabled;
      // HGMM Phase 5:精选列表加载后,刷新已存在的"原始文件名"mod 成友好名
      await migrateCustomModsToFeaturedNames();
      // BUG-016 round 3(2026-10-04):subFile 不再创建 LocalMod 记录,但 round 1+2
      //   期间创建的 subFile LocalMod 还残留在用户库里。启动加载 featured 后清理一次:
      //   updateSource.type="featured" 且 modId 在某个 FeaturedMod.subFiles 里的 → 删
      //   (deleteMod 是纯 LocalMod 记录清理,不调 uninstallMod、不删磁盘部署文件)
      await cleanupSubFileResidualLocalMods();
      await recordLog(
        "info",
        "library",
        `已加载精选 mod: ${activeGame.value.name} × ${result.mods.length}`
      );
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "加载精选 mod 失败";
      featuredMods.value = [];
      featuredDeleteRules.value = [];
      await recordLog("error", "library", error.value);
    } finally {
      featuredLoading.value = false;
    }
  }

  /** 切换 manager tab 内的 sub-tab */
  function setActiveSubTab(tab: "featured" | "library" | "nexus" | "bigmod" | "steamworkshop") {
    activeSubTab.value = tab;
    // 切走 Nexus 详情时关掉(详情跨 tab 没必要保留)
    if (tab !== "nexus") {
      selectedNexusMod.value = null;
    }
  }

  /**
   * 加载大型 mod 列表(bigmod.json)
   *
   * 行为:
   *   - 已 fetch 过(本会话)→ 直接复用,不再走网络
   *   - fetch 失败 → bigModError 设错,清空状态
   *   - 当前游戏不在 bigmod.json 收录范围 → activeBigMods 返回 []
   *
   * 调用方:initialize / addGame / setActiveGame 末尾自动调
   */
  async function loadBigMods() {
    // 已 fetch 过(本会话) → 直接复用,不再走网络
    if (Object.keys(bigMods.value).length > 0 || bigModError.value) {
      return;
    }
    if (!activeGame.value) {
      bigMods.value = {};
      return;
    }
    bigModLoading.value = true;
    bigModError.value = "";
    try {
      bigMods.value = await fetchBigMods();
      bigModLoadedAt.value = Date.now();
      const totalCount = Object.values(bigMods.value).reduce(
        (n, list) => n + list.length,
        0
      );
      await recordLog(
        "info",
        "library",
        `已加载大型 mod 列表: 共 ${totalCount} 项,覆盖 ${Object.keys(bigMods.value).length} 个游戏`
      );
    } catch (caught) {
      bigModError.value = caught instanceof Error ? caught.message : "加载大型 mod 失败";
      bigMods.value = {};
      await recordLog("error", "library", bigModError.value);
    } finally {
      bigModLoading.value = false;
    }
  }

  /** 强制刷新(用户手动重试) */
  async function refreshBigMods() {
    bigMods.value = {};
    bigModError.value = "";
    await loadBigMods();
  }

  /**
   * 切换互斥分组激活状态
   *
   * iGroupID(Array 字段)>0 时,同组的 mod 视为互斥
   * 业务层语义:激活一个 group 后,该 group 下其他 mod 在 UI 上标灰
   * 当前简化:仅记录激活集合,UI 自查 featuredGroupDisabled 决定是否禁用按钮
   */
  function toggleFeaturedGroup(groupId: number) {
    const next = new Set(featuredActiveGroupIds.value);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    featuredActiveGroupIds.value = next;
  }

  /**
   * 判定精选 mod 是否被同组其他 mod 禁用
   *
   * 规则(简化版 Phase 1B):
   *   - mod.groupId<=0 → 不禁用
   *   - 当前已激活的 group 中包含该 mod.groupId → 不禁用(自己已激活)
   *   - 同组其他 mod 已被加入 featuredActiveGroupIds → 禁用
   *
   * 注意:Phase 1B 暂不追踪"已下载/已安装",只看用户在 UI 上的互斥选择
   * Phase 2 接入完整状态后再扩展
   */
  function featuredGroupDisabled(mod: FeaturedMod): boolean {
    if (!mod.groupId || mod.groupId <= 0) return false;
    if (featuredActiveGroupIds.value.has(mod.groupId)) return false;
    // 同组其他 mod 已激活则禁用自己
    for (const other of featuredMods.value) {
      if (other.id === mod.id) continue;
      if (!other.groupId || other.groupId !== mod.groupId) continue;
      if (featuredActiveGroupIds.value.has(other.groupId)) return true;
    }
    return false;
  }

  /**
   * 一键下载精选 mod 到 downloads 目录
   *
   * 实现:复用 downloadCustomUrl(通用 URL 下载入口)
   * - fileName 用 mod.name + .zip 后缀
   * - 任务入 downloads.value,UI 切到 download tab 可看进度
   * - 用户下载完成后,在"本地 mod"tab 中手动安装
   *
   * 不绕过 mayfly,Modetype="absolute" 也走同一条路径(下载到本地,提示手动安装)
   */
  async function downloadFeaturedMod(mod: FeaturedMod) {
    if (!activeGame.value) return;
    const safeName = sanitizeFileName(mod.name) || "featured-mod";
    await downloadCustomUrl(mod.downloadUrl, `${safeName}.zip`);
    await recordLog(
      "info",
      "library",
      `精选 mod 已加入下载队列: ${mod.name}`
    );
  }

  /**
   * HGMM Phase 2.5:UE4SS 类 mod 类型(必须先装 UE4SS 加载器才能运行)
   * ue4ss / ue4ss-xinput / mods(ue4ss mod 列表)/ logicMods / scripts 都依赖 dwmapi.dll
   */
  function isUE4SSModType(modType: string): boolean {
    return ["ue4ss", "ue4ss-xinput", "mods", "logicMods", "scripts"].includes(modType);
  }

  /**
   * HGMM Phase 2.5:从 adapter modType 找 UE4SS 加载器安装目录
   * 例:Unreal adapter 的 "ue4ss" modType.installPath = "Pal/Binaries/Win64"
   * 返回 "<gamePath>\\Pal\\Binaries\\Win64",或 null 表示当前游戏无 UE4SS 加载器需求
   */
  function ue4ssTargetDir(game: ManagedGame, adapter: ReturnType<typeof adapterForGame>): string | null {
    const ue4ssType = adapter.modTypes.find((t) => t.id === "ue4ss");
    if (!ue4ssType) return null;
    const installPath = (ue4ssType.install as { installPath?: string }).installPath ?? "";
    if (!installPath) return null;
    return joinGameRelativePath(game.path, installPath);
  }

  /**
   * HGMM Phase 2.5:检测 UE4SS 是否已装(检查 dwmapi.dll)
   */
  async function isUE4SSInstalled(targetDir: string): Promise<boolean> {
    const dll = `${targetDir}\\dwmapi.dll`;
    return window.mayfly.exists(dll);
  }

  /**
   * HGMM 3.0:BepInEx 类 mod 类型(Unity 必须先装 BepInEx 加载器才能跑 plugin)
   * bepinex 整包 + plugins dll 都依赖 winhttp.dll(doorstop 注入器)
   */
  function isBepInExModType(modType: string): boolean {
    return ["bepinex", "plugins"].includes(modType);
  }

  /**
   * HGMM 3.0:从 adapter modType 找 BepInEx 加载器安装目录
   * Unity adapter 的 "bepinex" modType.installPath = ""(fileSibling,fileName="winhttp.dll"),
   * 语义是"winhttp.dll 与游戏 exe 同级",所以 installPath="" 时直接返回 game.path。
   * 直接走 joinGameRelativePath("") 会返回 ""(空字符串),isBepInExInstalled 检测
   * 会落到 Windows 系统根目录,永远 true,导致 BepInEx 自动加载器永远不触发。
   */
  function bepinexTargetDir(game: ManagedGame, adapter: ReturnType<typeof adapterForGame>): string | null {
    const bepinexType = adapter.modTypes.find((t) => t.id === "bepinex");
    if (!bepinexType) return null;
    const installPath = (bepinexType.install as { installPath?: string }).installPath ?? "";
    if (installPath === "") return game.path;
    return joinGameRelativePath(game.path, installPath);
  }

  /**
   * HGMM 3.0:检测 BepInEx 是否已装(检查 doorstop 注入器 winhttp.dll)
   */
  async function isBepInExInstalled(targetDir: string): Promise<boolean> {
    const dll = `${targetDir}\\winhttp.dll`;
    return window.mayfly.exists(dll);
  }

  /**
   * HGMM Phase 5.x:统一 UE4SS / BepInEx 加载器依赖检测
   * 原来只在 installFeaturedMod 硬编码两次;Nexus 下载、自定义导入、批量启用
   * 走的 installMod 路径不触发,导致 mod 装上但不工作。
   *
   * 行为:
   * - 检测到加载器缺失 → appConfirm 弹窗让用户同意自动装
   * - 用户同意 → 从 resources/{ue4ss|bepinex}/{presetId}.zip 解压到目标目录
   * - 用户取消 / 包未打包 → 设 error.value,返回 false
   * - 加载器已就位 → 直接返回 true(幂等,可重复调用)
   *
   * 返回值:
   * - true = 加载器已就位或刚装好,可继续后续步骤
   * - false = 用户取消或加载器缺失/未打包,调用方应中止
   */
  async function ensureModLoaderInstalled(
    modTypeId: string,
    modName: string,
    game: ManagedGame,
    adapter: ReturnType<typeof adapterForGame>,
  ): Promise<boolean> {
    // UE4SS 类(ue4ss / ue4ss-xinput / mods / logicMods / scripts)
    if (isUE4SSModType(modTypeId) && game.presetId) {
      const targetDir = ue4ssTargetDir(game, adapter);
      if (targetDir && !(await isUE4SSInstalled(targetDir))) {
        const pkg = await window.mayfly.getUE4SSPackage(game.presetId);
        if (!pkg.exists) {
          const msg = `${game.name} 的 UE4SS 加载器包未打包,无法自动装。请手动到游戏目录的 Binaries\\Win64 下放 dwmapi.dll。`;
          error.value = msg;
          await recordLog("error", "library", msg);
          return false;
        }
        const proceed = await appConfirm({
          title: "安装 UE4SS 加载器",
          message: `即将安装「${modName}」,需要先在游戏目录下安装 UE4SS 加载器(约 9 MB,只装一次)。\n` +
          `安装位置:${targetDir}\n\n是否继续?`,
          danger: false,
          confirmText: "继续安装"
        });
        if (!proceed) return false;
        try {
          await recordLog("info", "library", `正在安装 UE4SS 依赖: ${game.name} → ${targetDir}`);
          await window.mayfly.extractArchive({
            archivePath: pkg.archivePath,
            targetPath: targetDir,
            allowedRoot: game.path
          });
          await recordLog("info", "library", `UE4SS 依赖已安装: ${game.name}`);
        } catch (caught) {
          const msg = caught instanceof Error ? caught.message : "安装 UE4SS 依赖失败";
          error.value = msg;
          await recordLog("error", "library", msg);
          return false;
        }
      }
    }

    // BepInEx 类(bepinex 整包 / plugins dll)— Unity 游戏镜像 UE4SS 模式
    if (isBepInExModType(modTypeId) && game.presetId) {
      const targetDir = game.path;
      if (!(await isBepInExInstalled(targetDir))) {
        const pkg = await window.mayfly.getBepInExPackage(game.presetId);
        if (!pkg.exists) {
          const msg = `${game.name} 的 BepInEx 加载器包未打包,无法自动装。请手动到游戏目录下放 winhttp.dll + BepInEx\\ 目录。`;
          error.value = msg;
          await recordLog("error", "library", msg);
          return false;
        }
        const proceed = await appConfirm({
          title: "安装 BepInEx 加载器",
          message: `即将安装「${modName}」,需要先在游戏目录下安装 BepInEx 加载器(约 600 KB,只装一次)。\n` +
          `安装位置:${targetDir}\n\n是否继续?`,
          danger: false,
          confirmText: "继续安装"
        });
        if (!proceed) return false;
        try {
          await recordLog("info", "library", `正在安装 BepInEx 依赖: ${game.name} → ${targetDir}`);
          await window.mayfly.extractArchive({
            archivePath: pkg.archivePath,
            targetPath: targetDir,
            allowedRoot: game.path
          });
          await recordLog("info", "library", `BepInEx 依赖已安装: ${game.name}`);
        } catch (caught) {
          const msg = caught instanceof Error ? caught.message : "安装 BepInEx 依赖失败";
          error.value = msg;
          await recordLog("error", "library", msg);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 一键安装精选 mod(Phase 2)
   *
   * 完整链路:download → import → install
   * - Modetype="absolute" → 仅下载到 downloads,提示手动(mayfly safeJoin 拒绝游戏根外路径)
   * - Modetype="unknown" → 拒绝(adapter 会兜底回 "root",会装到游戏根目录)
   * - 当前游戏 adapter 不支持该 modType → 拒绝(getModType 兜底回 modTypes[0]="pak" 会装错)
   * - pak/ue4ss → 复用 downloadCustomUrl(内部已串好 download+import),末尾调 installMod
   * - ue4ss 类 mod → 安装前检测并提示装 UE4SS 依赖(若缺失)
   *
   * 关键设计:
   * - 重用 mayfly 的 downloadCustomUrl(不重写 download/import 流程)
   * - 下载前先 removeMod 同名旧 mod,避免 importLocalModsFromPaths 触发 window.confirm
   * - 用 modsBefore/Set 定位新建的 LocalMod(importLocalModsFromPaths 返回 void)
   * - 改 modName/description 为 JSON 的 DisplayName/Description(import 默认用文件名)
   */

  /**
   * HGMM UI 反查 helper:按来源类型 + modId(+ 可选 fileId)查 LocalMod 是否已装
   *
   * 设计:UI 列表(FeaturedModList / NexusBrowse)想知道"这个 mod 是否已装"时,
   *       通过 updateSource 字段反查 — 不需要给 LocalMod 加专门的 featuredModId / nexusModId 字段。
   * - featured 路径:installAbsoluteFeatured / installOneFeatured 末尾会写 updateSource
   * - nexus 路径:importLocalModsFromPaths 下载完成时已经写 updateSource(不用动)
   *
   * fileId 可选:Nexus 一个 mod 有多个 file,列表卡片用 mod 级查(fileId 不传),
   *            详情页 file 行用 file 级查(fileId 传具体值)。
   */
  function isInstalledByOrigin(
    type: "featured" | "nexus",
    modId: string,
    fileId?: string,
  ): boolean {
    return mods.value.some((m) => {
      if (m.updateSource?.type !== type) return false;
      if (m.updateSource.modId !== modId) return false;
      if (fileId !== undefined && m.updateSource.fileId !== fileId) return false;
      return true;
    });
  }

  /**
   * HGMM absolute 类型精选 mod 一键安装
   *
   * 流程:
   *   1. validateAbsoluteInstallPath:installPath 必须在 game.path 内
   *   2. 清理同名旧 LocalMod
   *   3. URL 推断扩展名 + 下载(直调 IPC downloadFile,不走 downloadCustomUrl 避免触发 import)
   *   4. cleanDirectory(installPath):重复安装不留旧内容
   *   5. extractArchive(archivePath, installPath):解压到目标路径
   *   6. 创建 LocalMod 记录(modTypeId="absolute", files=清单, installed=true, installedPath=路径)
   *   7. subFiles:attachSubFileToAbsoluteTarget 下载 + 解压(若有)
   *
   * 不走 installMod(已直接到位,无部署记录)。
   * 不走 downloadCustomUrl → 避免 importLocalModsFromPaths 在 storagePath 下创建未用的 modRoot。
   */

  /**
   * 互斥组自动卸载(2026-09-22)
   *
   * 当 target.groupId > 0,自动找已安装且同 groupId 的其他精选 mod 卸载。
   * 例:"更快的钓鱼 x2/x4/x10" 同 groupId,装 x4 时自动卸 x2。
   *
   * 反查链路:已装的 LocalMod.updateSource.type === "featured" + updateSource.modId
   *          → 跟 featuredMods[].id 对应,反查这个 mod 的 groupId。
   *
   * 不影响 groupId<=0 的 mod(没互斥需求),也不影响非精选来源(nexus / steam / 自定义导入)。
   */
  async function uninstallGroupConflicts(
    target: FeaturedMod,
    game: ManagedGame,
  ): Promise<void> {
    if (!target.groupId || target.groupId <= 0) return;

    const conflicts = mods.value.filter((m) => {
      if (m.gameId !== game.id) return false;
      if (!m.installed) return false;
      if (m.updateSource?.type !== "featured") return false;
      // modId 跟 target.id 不同 → 确实是"同组其他 mod"(避免卸自己)
      if (m.updateSource?.modId === target.id) return false;
      // 反查这个 LocalMod 对应的 FeaturedMod 的 groupId
      const featuredMod = featuredMods.value.find(
        (f) => f.id === m.updateSource!.modId,
      );
      return featuredMod?.groupId === target.groupId;
    });

    for (const old of conflicts) {
      await recordLog(
        "info",
        "library",
        `互斥组 ${target.groupId}: 卸载 ${old.name}(安装新 mod: ${target.name})`,
      );
      await removeMod(old);
    }
  }

  async function installAbsoluteFeatured(mod: FeaturedMod, game: ManagedGame): Promise<void> {
    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      await recordLog("error", "library", error.value);
      return;
    }

    // 互斥组自动处理(2026-09-22,跟 installFeaturedMod 同一逻辑)
    await uninstallGroupConflicts(mod, game);

    // 1. 安全校验
    const safeTarget = validateAbsoluteInstallPath(mod.installPath, game.path);

    // 2. 清理同名旧 mod(避免冲突)
    const sameNameMods = mods.value.filter(
      (m) =>
        m.gameId === game.id &&
        sanitizeFileName(m.name).toLowerCase() ===
          sanitizeFileName(mod.name).toLowerCase()
    );
    for (const old of sameNameMods) {
      await removeMod(old);
    }

    // 3. URL 推断扩展名
    const urlExtMatch = mod.downloadUrl.match(/\.([a-z0-9]+)(?:\?[^/]*)?$/iu);
    const urlExt = urlExtMatch ? urlExtMatch[1].toLowerCase() : "";
    const archiveExt = ["zip", "7z", "rar"].includes(urlExt) ? urlExt : "zip";
    const fileName = `${sanitizeFileName(mod.name)}.${archiveExt}`;
    const archivePath = `${settings.value.storagePath}\\downloads\\custom\\${fileName}`;

    if (!/^https?:\/\//i.test(mod.downloadUrl.trim())) {
      error.value = `下载 URL 无效: ${mod.downloadUrl}`;
      await recordLog("error", "library", error.value);
      return;
    }

    // 4. 主流程
    busy.value = true;
    installingFeaturedId.value = mod.id;
    error.value = "";
    // FEATURE-020(2026-10-08):缓存复用判断(updatedAt 一致 + .zip 还在 → 跳过下载)
    //   任一不满足 → 走 downloadFile(跟老逻辑一致)
    const reuseArchive = await shouldReuseFeaturedArchive(mod);
    const featuredAbsoluteTaskId = `featured-absolute-${mod.id}`;
    if (!reuseArchive) {
      // BUG-022 修复:精选 mod absolute 类型下载也进 downloads 池,UI 看得到进度
      const featuredAbsoluteTask: DownloadTask = {
        id: featuredAbsoluteTaskId,
        gameId: game.id,
        gameName: game.name,
        source: "Custom",
        modId: String(mod.id),
        modName: mod.name,
        fileId: "",
        fileName,
        url: mod.downloadUrl.trim(),
        outputPath: archivePath,
        status: "downloading",
        receivedBytes: 0,
        totalBytes: 0,
        error: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      downloads.value = [featuredAbsoluteTask, ...downloads.value];
      await persist();
    }
    try {
      if (reuseArchive) {
        await recordLog(
          "info",
          "library",
          `[FEATURE-020] 复用本地精选 mod 缓存: ${mod.name} → ${archivePath}`
        );
      } else {
        await window.mayfly.downloadFile({
          taskId: featuredAbsoluteTaskId,
          url: mod.downloadUrl.trim(),
          outputPath: archivePath,
          resume: false,
          proxyUrl: activeProxyUrl(),
          engine: settings.value.downloadEngine,
          aria2ExecutablePath: settings.value.aria2ExecutablePath,
          aria2MaxConnections: settings.value.aria2MaxConnections
        });
        updateDownloadTask(featuredAbsoluteTaskId, { status: "completed" });
      }
      // FEATURE-020:写回缓存(下载成功 OR 复用成功都写,保证下次还能复用)
      if (mod.updatedAt) {
        setFeaturedCacheUpdatedAt(mod.id, mod.updatedAt);
      }

      // 5. 清空 installPath
      await window.mayfly.cleanDirectory({ targetPath: safeTarget });

      // 6. 解压到 installPath
      const { files: extractedFiles } = await window.mayfly.extractArchive({
        archivePath,
        targetPath: safeTarget
      });

      // 7. 创建 LocalMod 记录
      const now = Date.now();
      const id = createId("mod");
      const nextSortIndex = Math.max(
        -1,
        ...mods.value.filter((m) => m.gameId === game.id).map((m) => m.sortIndex)
      ) + 1;

      const newMod: LocalMod = {
        id,
        gameId: game.id,
        sortIndex: nextSortIndex,
        name: mod.name,
        sourcePath: archivePath,
        rootPath: "",
        version: "",
        author: "",
        website: "",
        description: mod.description ?? "",
        coverImage: mod.coverUrl ?? "",
        tags: appendOriginTag([], "featured"),
        // 怀沙:补 updateSource 让 UI 反查"已安装"(不走 importLocalModsFromPaths 不会自动写)
        updateSource: {
          type: "featured",
          gameDomain: "",
          gameName: game.name,
          modId: mod.id,
          fileId: mod.id,
          fileName,
          fileVersion: "",
          modVersion: "",
          categoryName: "",
          modPageUrl: "",
          filePageUrl: "",
          coverImage: mod.coverUrl ?? "",
          downloadedAt: now,
        },
        requirements: [],
        files: extractedFiles,
        modTypeId: "absolute",
        modTypeName: "绝对路径安装",
        installed: true,
        installedPath: safeTarget,
        deployedFiles: [],
        createdAt: now,
        updatedAt: now
      };

      mods.value = [newMod, ...mods.value];
      await persist();

      // 8. subFiles:下载 + 解压到 installPath
      if (mod.subFiles && mod.subFiles.length > 0) {
        for (const sub of mod.subFiles) {
          await attachSubFileToAbsoluteTarget(sub, id, safeTarget);
        }
      }

      await recordLog(
        "info",
        "library",
        `absolute 精选 mod 安装完成: ${mod.name} → ${safeTarget}`
      );
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      error.value = msg;
      await recordLog("error", "library", msg);
    } finally {
      busy.value = false;
      installingFeaturedId.value = null;
    }
  }

  /**
   * HGMM absolute mod:子文件下载 + 解压到主 mod 的 installPath
   * (BUG-014 之前有 attachSubFileToParent 对比,已删;absolute 类型仍按 installPath 解压)
   */
  async function attachSubFileToAbsoluteTarget(
    sub: FeaturedMod,
    parentModId: string,
    targetPath: string
  ): Promise<void> {
    if (!settings.value.storagePath) {
      throw new Error("请先在设置里选择 Mod 存储路径。");
    }
    if (!/^https?:\/\//i.test(sub.downloadUrl.trim())) {
      throw new Error(`子文件下载 URL 无效: ${sub.downloadUrl}`);
    }

    const urlExtMatch = sub.downloadUrl.match(/\.([a-z0-9]+)(?:\?[^/]*)?$/iu);
    const urlExt = urlExtMatch ? urlExtMatch[1].toLowerCase() : "";
    const archiveExt = ["zip", "7z", "rar"].includes(urlExt) ? urlExt : "zip";
    const subFileName = `${sanitizeFileName(sub.name)}.${archiveExt}`;
    const archivePath = `${settings.value.storagePath}\\downloads\\custom\\${subFileName}`;

    await recordLog(
      "info",
      "library",
      `下载 absolute 子文件: ${sub.name} → ${parentModId}`
    );

    // BUG-022 修复:absolute subFile 下载也进 downloads 池
    const subFileAbsoluteTaskId = `subfile-absolute-${parentModId}-${sanitizeFileName(sub.name)}`;
    const subFileAbsoluteTask: DownloadTask = {
      id: subFileAbsoluteTaskId,
      gameId: activeGame.value?.id ?? "",
      gameName: activeGame.value?.name ?? "未知游戏",
      source: "Custom",
      modId: String(sub.id),
      modName: sub.name,
      fileId: "",
      fileName: subFileName,
      url: sub.downloadUrl.trim(),
      outputPath: archivePath,
      status: "downloading",
      receivedBytes: 0,
      totalBytes: 0,
      error: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    downloads.value = [subFileAbsoluteTask, ...downloads.value];
    await persist();

    await window.mayfly.downloadFile({
      taskId: subFileAbsoluteTaskId,
      url: sub.downloadUrl.trim(),
      outputPath: archivePath,
      resume: false,
      proxyUrl: activeProxyUrl(),
      engine: settings.value.downloadEngine,
      aria2ExecutablePath: settings.value.aria2ExecutablePath,
      aria2MaxConnections: settings.value.aria2MaxConnections
    });
    updateDownloadTask(subFileAbsoluteTaskId, { status: "completed" });

    const { files: extractedFiles } = await window.mayfly.extractArchive({
      archivePath,
      targetPath
    });

    const parent = mods.value.find((m) => m.id === parentModId);
    if (!parent) return;
    const mergedFiles = [...new Set([...parent.files, ...extractedFiles])];
    if (mergedFiles.length !== parent.files.length) {
      await updateMod(parentModId, { files: mergedFiles });
      await recordLog(
        "info",
        "library",
        `absolute 主 mod 新增 ${mergedFiles.length - parent.files.length} 个文件: ${sub.name}`
      );
    }
  }

  /**
   * HGMM absolute mod:基础合法性校验
   *
   * JSON installPath 是用户(我)自己维护的配置,可信,所以:
   * - 不强制 startsWith game.path(用户可能把游戏装在非默认盘,
   *   如 SteamLibrary 在 H 盘,而 installPath 是历史 HGMM 默认 C:\Palworld\...)
   * - 但拒绝路径穿越标记 `..`(JSON 写错时主动拒绝,跳出游戏目录)
   * - 必须 Windows 绝对路径(盘符开头)
   */
  function validateAbsoluteInstallPath(target: string, _gamePath: string): string {
    // 1. 拒绝路径穿越
    if (/(\.\.[/\\])/u.test(target)) {
      throw new Error(`目标路径 ${target} 包含相对路径标记 (..),拒绝安装`);
    }

    // 2. 必须 Windows 绝对路径(盘符开头)
    if (!/^[a-zA-Z]:[\\\/]/u.test(target)) {
      throw new Error(`目标路径 ${target} 不是 Windows 绝对路径`);
    }

    return target;
  }

  async function installFeaturedMod(mod: FeaturedMod) {
    if (!activeGame.value) return;
    const game = activeGame.value;

    // ===== 互斥组自动处理(2026-09-22)=====
    // groupId > 0 时,同 groupId 已安装的 mod 自动卸载后再装新的
    // 例:"更快的钓鱼x2/x4/x10" 同组互斥,装 x4 时先卸 x2
    await uninstallGroupConflicts(mod, game);

    // ===== 前置校验 =====
    // HGMM absolute 类型分流:不走 installMod 框架,自己下载 + 解压到 installPath
    if (mod.modType === "absolute") {
      await installAbsoluteFeatured(mod, game);
      return;
    }
    if (mod.modType === "unknown") {
      const msg = `无法识别 mod 类型: ${mod.name}(Modetype 字段异常)`;
      error.value = msg;
      await recordLog("error", "library", msg);
      return;
    }
    // 关键:FeaturedMod.modType 不等于 adapter.modTypeId,需校验
    // 例:"absolute" 在 Unreal adapter 里没有对应项,getModType 会静默回 "pak" 装错
    // BUG-010:对巫师 3 这类 adapter 用数字 id("1"/"2")但 inferModType 兜底返回 "root" 的情况,
    //   严格校验会全部拒绝 → fallback:按 InstallLocation 路径前缀推断 modTypeId
    //   (InstallLocation 里 "\dlc\" → adapter.modTypes[1];"\mods\" 或其它 → modTypes[0])
    //   兜底只对 inferModType 没匹配 + InstallLocation 有路径信息时触发,不会覆盖其它已知类型
    const adapter = adapterForGame(game);
    let resolvedModType: string = mod.modType;
    if (!adapter.modTypes.some((t) => t.id === resolvedModType)) {
      const locLower = (mod.installPath ?? "").toLowerCase().replace(/\//g, "\\");
      const hasDlcPath = /\\dlc\\/u.test(locLower) || /\\dlc$/u.test(locLower);
      const fallbackIdx = hasDlcPath && adapter.modTypes.length >= 2 ? 1 : 0;
      const fallback = adapter.modTypes[fallbackIdx]?.id;
      if (!fallback) {
        const msg = `当前游戏(${game.name})不支持 mod 类型 "${mod.modType}",无法自动安装`;
        error.value = msg;
        await recordLog("error", "library", msg);
        return;
      }
      await recordLog(
        "warn",
        "library",
        `[BUG-010 兜底] ${mod.name} modType "${mod.modType}" 不在 ${game.name} adapter 中,` +
          `按 InstallLocation="${mod.installPath}" 推断为 "${fallback}"(inferModType 兜底为 root 的修法)`,
      );
      resolvedModType = fallback;
    }

    // ===== HGMM Phase 5.x:统一加载器依赖检测 =====
    // 抽到 ensureModLoaderInstalled 共用:Nexus 下载、自定义导入、批量启用都走这里
    // 放在下载前 → UE4SS 包未打包能早失败,不浪费下载流量
    // BUG-010:用 mod.modType(FeaturedModType)而非 resolvedModType(可能是 adapter id="1"/"2")
    //   ensureModLoaderInstalled 只关心"是否需要 UE4SS/BepInEx 加载器",用 FeaturedModType 准
    //   巫师 3 既不是 UE4SS 也不是 BepInEx,直接 return true 不影响行为
    const loaderOk = await ensureModLoaderInstalled(mod.modType, mod.name, game, adapter);
    if (!loaderOk) return;

    // ===== 主流程 =====
    // HGMM Phase 3.6:把"下载+导入+安装单个 mod"提取为内部函数,
    // 主 mod 和 subFiles(data[] 子文件)各跑一次,共用本函数外的
    // BepInEx/UE4SS 检测结果(已装就不重复弹窗)。
    // subFiles 在 JSON 里是独立 downloadUrl 的子文件(如 HKSilksong 的
    // "Texture" 主 mod + "Silksong_HealthBar.dll" 子 mod),Phase 2 漏处理
    // 导致子文件永远不会被下载/安装。
    installingFeaturedId.value = mod.id;
    busy.value = true;
    error.value = "";
    try {
      // 单个 mod 的下载+导入+安装流程(主 mod 和 subFiles 都走这条)
      // BUG-014(2026-10-04):subFiles 不再 attach 到主 modRoot,改为独立 installOneFeatured。
      //   每个 subFile 创建独立 LocalMod + 独立 installPath(走 BUG-009 overrideInstallPath),
      //   装到 JSON 配置的各自 InstallLocation。
      // 关键:每次入口 snapshot 当前 mods.id 集合,用于定位本次下载产生的新 mod
      // (如果用外层 modsBefore,第一个 mod 安装完后集合就被覆盖了,后续找不到新增 mod)
      // HGMM Phase 5.x:返回安装后的 LocalMod 引用,供后续 subFile 流程独立安装
      // BUG-010:接受 modTypeOverride 参数,让 installFeaturedMod 入口计算的 resolvedModType
      //   透传到 metaPatch(modTypeId 字段)
      // BUG-014:subFile 也会被独立调用,modTypeOverride 由 resolveSubFileModTypeOverride 计算
      // BUG-016 round 3(2026-10-04):subFile 不再创建 LocalMod 记录,只部署磁盘文件。
      //   老方案(parentModId 折叠)用户实测无效 → round 1+2 推翻。
      //   用户决策:UI 上只看到 1 条主 mod,subFile 是主 mod 的一部分,跟着主 mod 装/卸。
      //   skipRecord=true 时:
      //     - 完整跑 下载 → 解压 → installMod 部署(磁盘文件正常写入)
      //     - **最后从 mods.value 直接 filter 掉新建的 LocalMod**,不调 uninstallMod
      //       (磁盘部署已发生,不需要回滚),不调 removeMod(它会删 rootPath 解压目录
      //       且 uninstallMod 删磁盘部署文件 — 都不要做)
      //   subFile 调用方:installFeaturedMod 的 subFile 循环传 { skipRecord: true, subModTypeOverride }
      //   主 mod 调用方:不传 skipRecord,走原路径(主 mod 自己需要 LocalMod)
      //   parentModId 参数保留但不再使用(老 installOneFeatured 调用栈兼容,后续 cleanup)
      async function installOneFeatured(
        target: FeaturedMod,
        modTypeOverride?: string,
        parentModId?: string,
        opts?: { skipRecord?: boolean },
      ): Promise<LocalMod | null> {
        const effectiveModType = modTypeOverride ?? target.modType;
        const localModsBefore = new Set(mods.value.map((m) => m.id));

        // 1. 清理同名旧 mod(避免 importLocalModsFromPaths 触发 window.confirm)
        //    removeMod 仅删 LocalMod 记录,不卸载已部署文件(已部署文件下次 scan 会自动找回)
        const sameNameMods = mods.value.filter(
          (m) =>
            m.gameId === game.id &&
            sanitizeFileName(m.name).toLowerCase() ===
              sanitizeFileName(target.name).toLowerCase()
        );
        for (const old of sameNameMods) {
          await removeMod(old);
        }

        // 2. URL 扩展名推断(JSON 里 .zip / .7z / .rar 混用)
        const urlExtMatch = target.downloadUrl.match(/\.([a-z0-9]+)(?:\?[^/]*)?$/iu);
        const urlExt = urlExtMatch ? urlExtMatch[1].toLowerCase() : "";
        const archiveExt = ["zip", "7z", "rar"].includes(urlExt) ? urlExt : "zip";
        const fileName = `${sanitizeFileName(target.name)}.${archiveExt}`;
        const expectedSourcePath = settings.value.storagePath
          ? `${settings.value.storagePath}\\downloads\\custom\\${fileName}`
          : "";

        // 3. FEATURE-020(2026-10-08):缓存复用判断(updatedAt 一致 + .zip 还在 → 跳过下载)
        //   任一不满足 → 走 downloadCustomUrl(跟老逻辑一致)
        //   复用路径直接跳过 downloadCustomUrl,后续 importLocalModsFromPaths 用现有 .zip
        const reuseArchive = await shouldReuseFeaturedArchive(target);
        let importError = "";
        if (reuseArchive) {
          await recordLog(
            "info",
            "library",
            `[FEATURE-020] 复用本地精选 mod 缓存: ${target.name} → ${expectedSourcePath}`
          );
          // BUG-023 修复(2026-10-08):downloadCustomUrl 内部隐式调
          //   importLocalModsFromPaths 创建 LocalMod 记录,reuse 路径跳过
          //   downloadCustomUrl 会导致 mod 永远不被创建,step 4 找不到 → 报错。
          //   这里手动补一次 import(reuse .zip,不下载)。
          //   切 activeGameId 跟 importCompletedDownload 对齐(它用 activeGame.value 找 game)。
          const previousActiveGameId = activeGameId.value;
          activeGameId.value = game.id;
          await importLocalModsFromPaths([expectedSourcePath], "", {}, "featured");
          activeGameId.value = previousActiveGameId;
        } else {
          // 3. 捕获 importLocalModsFromPaths 内部设置的真实错误信息
          //    (它会 swallow 异常,只设 error.value,我们要读到它)
          const errorBefore = error.value;
          await downloadCustomUrl(target.downloadUrl, fileName);
          importError = error.value !== errorBefore ? error.value : "";
        }

        // 4. 定位新建的 LocalMod:优先用 sourcePath(跨重启稳定),退回按 id
        const importedMod =
          (expectedSourcePath
            ? mods.value.find(
                (m) =>
                  normalizeText(m.sourcePath) === normalizeText(expectedSourcePath) &&
                  m.gameId === game.id,
              )
            : undefined) ??
          mods.value.find(
            (m) => !localModsBefore.has(m.id) && m.gameId === game.id,
          );
        if (!importedMod) {
          const sameGameMods = mods.value
            .filter((m) => m.gameId === game.id)
            .map((m) => `${m.name} ← ${m.sourcePath}`)
            .join("; ");
          const detail =
            importError ||
            `找不到 sourcePath=${expectedSourcePath} 的 mod;现有 mods: ${sameGameMods || "(空)"}`;
          throw new Error(`下载完成但未找到导入的 mod: ${target.name}。${detail}`);
        }

        // FEATURE-020(2026-10-08):导入成功(下载 OR 复用)→ 写回缓存,下次装还能复用
        if (target.updatedAt) {
          setFeaturedCacheUpdatedAt(target.id, target.updatedAt);
        }

        // 5. 用 JSON 字段覆盖文件名来源的初值(name / description / modTypeId)
        //    HGMM Phase 3.7 关键修复:target.modType 来自 inferModType(按 InstallLocation
        //    路径前缀分类),已经过 installFeaturedMod 顶部"adapter.modTypes 校验",
        //    一定合法;而 importedMod.modTypeId 是 import 时由 checkModType 按 modRoot
        //    文件结构推断(Unity adapter 仅认 winhttp.dll/plugins/dll,其它 fallback "root")
        //    ——Texture 这种纯资源 mod(无 dll)会被错识为 "root",install 后内容铺到
        //    游戏根目录。target.modType="plugins"(JSON InstallLocation=BepInEx\\plugins)
        //    才是用户期望,必须强制覆盖。
        const metaPatch: { name: string; description: string; modTypeId: string } = {
          name: target.name,
          description: target.description ?? importedMod.description,
          modTypeId: effectiveModType,
        };
        const needsUpdate =
          importedMod.name !== metaPatch.name ||
          (target.description && importedMod.description !== metaPatch.description) ||
          importedMod.modTypeId !== metaPatch.modTypeId;
        if (needsUpdate) {
          await updateMod(importedMod.id, metaPatch);
          await recordLog(
            "info",
            "library",
            `覆盖 modTypeId: ${importedMod.modTypeId} → ${metaPatch.modTypeId} (${target.name})`,
          );
        }

        // HGMM Phase 5:始终追加"精选" tag(无论 needsUpdate 与否,确保 tag 一定写入)
        //   单独 updateMod 调用,因为上面 if 分支只更新 metaPatch,没覆盖 tags。
        const tagMerged = appendOriginTag(importedMod.tags, "featured");
        if (tagMerged.length !== importedMod.tags?.length || !importedMod.tags?.includes(MOD_ORIGIN_TAGS.featured)) {
          await updateMod(importedMod.id, { tags: tagMerged });
        }

        // HGMM Phase 3.7.1 关键修复:updateMod 内部用 `mods.value = mods.value.map(...)`
        // 替换整个数组,旧 importedMod 引用的 modTypeId 还是更新前的值。
        // 必须从新数组重新 find 拿到最新引用,否则 installMod 仍用旧 modTypeId。
        const refreshedMod = mods.value.find((m) => m.id === importedMod.id);
        if (!refreshedMod) {
          throw new Error(`updateMod 后找不到 mod: ${target.name}(id=${importedMod.id})`);
        }

        // 6. 自动安装(mayfly pipeline:createInstallPlan → applyModStrategy)
        // BUG-009:精选 mod 走 JSON 配置路径,overrideInstallPath 优先于 adapter.installPath
        await installMod(refreshedMod, { overrideInstallPath: target.installPath });

        // 7. 怀沙:补 updateSource 让 UI 反查"已安装"
        //    importLocalModsFromPaths 不会给精选 mod 写 updateSource(只有 nexus 路径才会),
        //    必须显写,FeaturedModList 才能识别"已安装"并禁灰按钮。
        // BUG-009:同时持久化 featuredInstallPath,让重装/更新路径也能找到 JSON 路径
        // BUG-016 round 3(2026-10-04):subFile 不再走 LocalMod 记录,parentModId 字段整体废弃,
        //   不再写入 updateSource(主 mod 自己也不写)
        await updateMod(refreshedMod.id, {
          updateSource: {
            type: "featured",
            gameDomain: "",
            gameName: game.name,
            modId: target.id,
            fileId: target.id,
            fileName,
            fileVersion: "",
            modVersion: "",
            categoryName: "",
            modPageUrl: "",
            filePageUrl: "",
            coverImage: target.coverUrl ?? "",
            downloadedAt: Date.now(),
            featuredInstallPath: target.installPath,
          },
        });

        // BUG-016 round 3(2026-10-04):subFile 跳过 LocalMod 记录。
        //   流程已经跑完(磁盘文件已部署),直接从 mods.value 移除新建的 LocalMod,
        //   **不调 uninstallMod**(磁盘部署保留)+ **不调 removeMod**(它会删 rootPath 解压目录
        //   和 uninstallMod 磁盘,都和我们的意图相反)。
        //   只删 LocalMod 记录本身,让 UI 看不到这条 subFile。
        //   rootPath 解压目录保留(下次重装主 mod 时,如果 subFile 7z 内容相同,
        //   downloadCustomUrl 会复用缓存 7z,importLocalModsFromPaths 会跳过重复 import
        //   — 见 existingSourcePaths 检查;我们的手动 filter 是双保险)。
        if (opts?.skipRecord) {
          mods.value = mods.value.filter((m) => m.id !== refreshedMod.id);
          selectedModIds.value = selectedModIds.value.filter((id) => id !== refreshedMod.id);
          await recordLog(
            "info",
            "library",
            `[BUG-016 round 3] subFile 已部署到磁盘但不创建 LocalMod 记录: ${target.name}`,
          );
          return null;
        }

        await recordLog("info", "library", `精选 mod 安装完成: ${target.name}`);
        return refreshedMod;
      }

      /**
       * BUG-022(2026-10-05):精选 mod subFile 平铺部署
       *
       * 用户原话:"这个模组 3 个文件,每一个文件我都配置了 url 地址,以及安装路径,
       *   就一个下载解压到指定路径,这很难么?"
       *
       * 旧实现(BUG-014 / BUG-016):subFile 走 installOneFeatured → installMod,
       *   installMod 用 folderRoot 策略做 targetFolderName 探测 ——
       *   7z 顶层叫 "CustomNanosuitSystem/" 就把 target 命名成 CustomNanosuitSystem,
       *   JSON 写的 ModName="DekCNS_P.pak" 完全没用上,装到错的子目录。
       *
       * 新实现:跳过 installOneFeatured 整套(LocalMod 记录 / installMod / updateSource
       *   全不要),直接走"下载 → 解压到临时目录 → 平铺 cp 到游戏目录的 InstallLocation":
       *   1. downloadCustomUrl 下载 7z 到 storage/downloads/custom/<sanitize(name)>.<ext>
       *   2. importModFolder 解压到 storage/mods/<gameName>/<folderId>/
       *   3. flattenDeploy 把解压目录平铺 cp 到 <effectiveGamePath>/<sub.installPath>/
       *
       * UI 完全不可见(没 LocalMod 记录),跟着主 mod 一起装/卸 ——
       * 主 mod 卸载时不会清 subFile 部署的文件(BUG-016 round 3 的遗留缺陷,
       *   subFile 文件无人追踪),但这是另一个独立的 BUG,不在本 BUG-022 修复范围。
       *
       * folderId 从 storage/mods/<gameName>/ 下所有数字目录名 max+1 算 ——
       * 比 installLocalModsFromPaths 的"从 mods.value 算"更稳,能避免 skipRecord
       *   删除 LocalMod 后 max 重算撞目录的问题(原先 BUG-016 round 3 的次生 bug)。
       */
      async function installOneSubFile(sub: FeaturedMod): Promise<void> {
        if (!settings.value.storagePath) {
          throw new Error("请先在设置里选择 Mod 存储路径。");
        }
        if (!sub.downloadUrl || !/^https?:\/\//i.test(sub.downloadUrl.trim())) {
          throw new Error(`subFile ${sub.name} 的 downloadUrl 无效: ${sub.downloadUrl ?? "(空)"}`);
        }
        if (!sub.installPath) {
          throw new Error(`subFile ${sub.name} 的 installPath 为空`);
        }

        // 1. 算 7z 文件名 + 下载路径
        const urlExtMatch = sub.downloadUrl.match(/\.([a-z0-9]+)(?:\?[^/]*)?$/iu);
        const urlExt = urlExtMatch ? urlExtMatch[1].toLowerCase() : "";
        const archiveExt = ["zip", "7z", "rar"].includes(urlExt) ? urlExt : "zip";
        const safeSubName = sanitizeFileName(sub.name);
        const archiveFileName = `${safeSubName}.${archiveExt}`;
        const archivePath = `${settings.value.storagePath}\\downloads\\custom\\${archiveFileName}`;

        // 2. 下载 7z
        await recordLog(
          "info",
          "library",
          `[BUG-022] 下载 subFile: ${sub.name} → ${archivePath}`,
        );
        // BUG-022 修复:subFile 平铺部署下载也进 downloads 池
        const subFileFlatTaskId = `subfile-${safeSubName}`;
        const subFileFlatTask: DownloadTask = {
          id: subFileFlatTaskId,
          gameId: game.id,
          gameName: game.name,
          source: "Custom",
          modId: String(sub.id),
          modName: sub.name,
          fileId: "",
          fileName: archiveFileName,
          url: sub.downloadUrl.trim(),
          outputPath: archivePath,
          status: "downloading",
          receivedBytes: 0,
          totalBytes: 0,
          error: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        downloads.value = [subFileFlatTask, ...downloads.value];
        await persist();

        await window.mayfly.downloadFile({
          taskId: subFileFlatTaskId,
          url: sub.downloadUrl.trim(),
          outputPath: archivePath,
          resume: false,
          proxyUrl: activeProxyUrl(),
          engine: settings.value.downloadEngine,
          aria2ExecutablePath: settings.value.aria2ExecutablePath,
          aria2MaxConnections: settings.value.aria2MaxConnections,
        });
        updateDownloadTask(subFileFlatTaskId, { status: "completed" });

        // 3. 算 folderId(从磁盘扫数字目录,避免跟现有解压目录撞)
        const gameFolderName = sanitizeFileName(game.name);
        const gameModsRoot = `${settings.value.storagePath}\\mods\\${gameFolderName}`;
        const existingEntries = await window.mayfly.readDirTopLevel({ path: gameModsRoot });
        const numericIds = existingEntries
          .filter((e) => e.isDirectory)
          .map((e) => Number(e.name))
          .filter((n) => Number.isFinite(n) && n >= 0);
        const folderId = (numericIds.length > 0 ? Math.max(...numericIds) : -1) + 1;
        const folderIdStr = String(folderId);

        // 4. 解压到 storage/mods/<gameName>/<folderId>/
        const importResult = await window.mayfly.importModFolder({
          sourcePath: archivePath,
          storagePath: settings.value.storagePath,
          gameId: game.id,
          gameName: game.name,
          modId: folderIdStr,
        });

        // 5. 算 effectiveGamePath(配合 preset.gameBasePath)
        const subGameBasePath = resolveGameBasePath(game);
        const effectiveGamePath = subGameBasePath
          ? await window.mayfly.resolveGamePath({
              gamePath: game.path,
              prefix: subGameBasePath,
            })
          : game.path;

        // 6. 平铺部署到 <effectiveGamePath>/<installPath>/
        const flattenResult = await window.mayfly.flattenDeploy({
          modRoot: importResult.rootPath,
          effectiveGamePath,
          installPath: sub.installPath,
        });

        await recordLog(
          "info",
          "library",
          `[BUG-022] subFile 部署完成: ${sub.name} → ${flattenResult.targetDir}(来自 ${flattenResult.deployedFrom})`,
        );
      }

      // BUG-014(2026-10-04):subFiles 独立安装到各自 InstallLocation,不再合并到主 modRoot。
      // 之前 attachSubFileToParent 把所有 subFile 解压到主 modRoot,然后用主 mod 的 installPath
      //   一次性部署。JSON 设计上 subFile 有独立 InstallLocation(如巫师 3 声望系统的
      //   `bin\config\r4game\user_config_matrix\pc` / `dlc\`),被全部装到主 mod 的
      //   `<root>/mods/<主 modName>/` 是错的。
      // 现在:每个 subFile 走完整 installOneFeatured(下载+解压+installMod 部署磁盘),
      //   走 BUG-009 的 overrideInstallPath 机制装到 JSON 配置的 InstallLocation。
      //
      // BUG-016 round 3(2026-10-04):subFile 传 skipRecord=true,**不创建 LocalMod 记录**。
      //   老 round 1+2(parentModId 折叠)用户实测无效,推翻。
      //   用户决策:UI 只显示主 mod,subFile 是主 mod 的一部分,跟着主 mod 装/卸。
      //   副作用:用户不能单独选中 subFile(本来也不应该单独管理)。
      //
      // BUG-014 边界:subFile.modType 来自 inferModType(可能 "root" 不在 adapter.modTypes 里),
      //   复用主 mod 的兜底逻辑 — InstallLocation 含 `\dlc\` → modTypes[1],其它 → modTypes[0]。
      //   兜底后的 modTypeId 让 installMod 拿到一个合法的 strategy,再被 overrideInstallPath
      //   覆盖成 subFile 自己的 InstallLocation。
      function resolveSubFileModTypeOverride(sub: FeaturedMod): string | undefined {
        if (!adapter.modTypes.some((t) => t.id === sub.modType)) {
          const locLower = (sub.installPath ?? "").toLowerCase().replace(/\//g, "\\");
          const hasDlcPath = /\\dlc\\/u.test(locLower) || /\\dlc$/u.test(locLower);
          const fallbackIdx = hasDlcPath && adapter.modTypes.length >= 2 ? 1 : 0;
          return adapter.modTypes[fallbackIdx]?.id;
        }
        return undefined;  // adapter 已支持,不用兜底
      }

      // 主 mod 先装(走 installOneFeatured)
      // BUG-010:resolvedModType 透传,让 metaPatch.modTypeId 用兜底后的 id
      const installedMainMod = await installOneFeatured(mod, resolvedModType);

      // subFiles 平铺部署(BUG-022):不走 installOneFeatured(它会做 installMod 的
      //   folderRoot + targetFolderName 探测,跟 subFile "下载解压到指定路径" 的语义冲突),
      //   改成直接调 installOneSubFile:下载 + 解压 + 平铺 cp 到 JSON InstallLocation。
      // UI 完全不可见(没 LocalMod 记录),跟着主 mod 一起装/卸。
      if (installedMainMod && mod.subFiles && mod.subFiles.length > 0) {
        await recordLog(
          "info",
          "library",
          `主 mod 完成,开始平铺部署 ${mod.subFiles.length} 个子文件到各自 InstallLocation(BUG-022 直装)`,
        );
        for (const sub of mod.subFiles) {
          await installOneSubFile(sub);
        }
        await recordLog(
          "info",
          "library",
          `已部署 ${mod.subFiles.length} 个子文件到各自 InstallLocation(UI 不可见)`,
        );
      }

      await recordLog("info", "library", `精选 mod 全套安装完成: ${mod.name}`);
    } catch (caught) {
      error.value =
        caught instanceof Error ? caught.message : "安装精选 mod 失败";
      await recordLog("error", "library", error.value);
    } finally {
      installingFeaturedId.value = null;
      busy.value = false;
    }
  }

  /**
   * BUG-009:精选 mod 的 installPath 校验。
   * JSON InstallLocation 是用户(我)自己维护的配置,路径必须:
   *   - 非空
   *   - 相对路径(不以盘符开头)— 相对 game.path
   *   - 不含 `..`(防路径穿越)
   * 校验失败 → throw 让 installMod catch 抛 error.value,前端能看到。
   */
  function validateFeaturedInstallPath(target: string): string {
    const trimmed = target.trim();
    if (trimmed === "") {
      throw new Error("精选 mod 的安装路径为空,请检查 JSON InstallLocation 配置。");
    }
    if (/^[a-zA-Z]:[\\\/]/u.test(trimmed)) {
      throw new Error(
        `精选 mod 的安装路径必须是相对路径(相对游戏根目录),不能是绝对路径: ${target}`,
      );
    }
    if (/(\.\.[/\\])/u.test(trimmed)) {
      throw new Error(`精选 mod 的安装路径包含相对路径标记 (..),拒绝安装: ${target}`);
    }
    return trimmed;
  }

  async function installMod(
    mod: LocalMod,
    opts?: { overrideInstallPath?: string; targetFolderName?: string },
  ) {
    if (!activeGame.value) return;

    busy.value = true;
    error.value = "";

    try {
      const adapter = adapterForGame(activeGame.value);
      const modType = getModType(adapter, mod.modTypeId);

      // BUG-010(2026-10-03):exe 在子目录的游戏(巫师 3 witcher3.exe 在 bin/x64_dx12/)
      //   preset.gameBasePath 偏移后取 effectiveGamePath,这样 joinGameRelativePath / plan / apply
      //   都用真正的游戏根,installPath="mods" 解析到 <real game root>/mods/ 而不是 <exe dir>/mods/
      // BUG-010 round 5 老游戏兼容:ManagedGame 入库时拷的 gameBasePath 可能为 undefined
      //   (用户在 gameBasePath 字段加进 preset 之前就添加了游戏),需要 fallback 到 preset.gameBasePath
      const gameBasePath = resolveGameBasePath(activeGame.value);
      const effectiveGamePath = gameBasePath
        ? await window.mayfly.resolveGamePath({
            gamePath: activeGame.value.path,
            prefix: gameBasePath,
          })
        : activeGame.value.path;

      // HGMM Phase 5.x:统一加载器依赖检测(覆盖 Nexus 下载、自定义导入等所有路径)
      // 之前只有 installFeaturedMod 调,Nexus 路径漏检 → mod 装上但不工作
      const loaderOk = await ensureModLoaderInstalled(
        mod.modTypeId,
        mod.name,
        activeGame.value,
        adapter,
      );
      if (!loaderOk) {
        // helper 已经设了 error.value + 记日志;抛出让外层 catch 捕获,中止后续步骤
        throw new Error(error.value || "加载器依赖未满足,安装中止");
      }

      // BUG-009:精选 mod 走 JSON InstallLocation,完全脱离 adapter.installPath
      // 解析优先级:opts.overrideInstallPath(首次安装的 FeaturedMod.installPath)
      //   > updateSource.featuredInstallPath(重装/更新时从持久化数据恢复)
      const featuredPath =
        opts?.overrideInstallPath ??
        (mod.updateSource?.type === "featured"
          ? mod.updateSource.featuredInstallPath
          : undefined);
      const overrideInstallPath = featuredPath
        ? validateFeaturedInstallPath(featuredPath)
        : undefined;

      // BUG-009:精选 mod 走 JSON InstallLocation,完全脱离 adapter.installPath
      // 但仅对 kind !== "manual" 的 modType 有效(manual 意味着让用户手动安装,不走自动覆盖)
      // 守卫后 TS 才能窄化 InstallStrategy 联合类型,让 installPath 字段访问合法
      if (modType.install.kind === "manual") {
        throw new Error(
          `精选 mod "${mod.name}" 的 modType "${mod.modTypeId}" 是 manual 类型,无法自动安装。` +
            `(${modType.install.reason})`,
        );
      }

      // 克隆 strategy,只覆盖 installPath(其他字段保留 adapter 的,kind/folderName 等)
      // BUG-014 补充:下面可能改 strategy.kind(folderRoot → fileOnly),用 let 而非 const
      let strategy: InstallStrategy = toPlain(modType.install);
      if (overrideInstallPath) {
        await recordLog(
          "info",
          "library",
          `[BUG-009] 精选 mod 走 JSON 配置路径: ${mod.name} → ${overrideInstallPath}` +
            ` (覆盖 adapter.installPath=${modType.install.installPath})`,
        );
        strategy.installPath = overrideInstallPath;
      }

      // BUG-010(2026-10-03):自动探测 modRoot 顶层唯一目录作 targetFolderName
      //   7z 解压目录典型结构 <ModName>/<content>,顶层唯一目录就是 <ModName>(英文)
      //   装到 <gamePath>/installPath/<ModName> 比 mod.name 中文 DisplayName 更符合预期
      //   优先级:opts.targetFolderName(显式) > 顶层唯一目录 > mod.name(原 fallback)
      //
      // BUG-010 round 5 嵌套修复:modRoot = <storage>/1/(顶层 1 个目录 = ModName)
      //   时,autoTopDir=ModName 会被用作 targetFolderName,但 applyFolderRootStrategy
      //   是 cp(modRoot, target),源里还包一层 ModName → target/ModName/<content> 嵌套
      //   修复:探测到顶层唯一目录时,把 modRoot 钻进去(cp 源 = <ModName>/<content> 平铺),
      //   targetFolderName 仍用 autoTopDir,装到 <installPath>/<ModName>/<content> 单层
      //
      // BUG-014 补充(2026-10-04):modRoot 顶层只有 1 个文件(如巫师 3 声望系统 subFile
      //   modFlorenEconomySystem.xml 是单 xml,installPath=bin\config\r4game\user_config_matrix\pc)
      //   时,顶层唯一目录分支不进 → autoTopDir=undefined → targetFolderName=mod.name=文件名,
      //   folderRoot cp 时把 xml 当目录内容拷到 <installPath>/<fileName>/<fileName>,多一层
      //   修复:探测到顶层只有 1 个文件(没目录)时,strategy 从 folderRoot 改成 fileOnly
      //   (installPath 保留原 InstallLocation = pc 目录,fileName = 文件名),apply 时直接
      //   cp(modRoot/<file>, <installPath>/<file>),xml 装到 pc 目录下不再多一层
      let autoTopDir: string | undefined;
      let effectiveModRoot = mod.rootPath;
      let strategyRewritten: string | undefined;  // 记录 strategy 改造,诊断日志里能看见
      try {
        const topEntries = await window.mayfly.readDirTopLevel({
          path: mod.rootPath,
        });
        const topLevelDirs = topEntries
          .filter((e) => e.isDirectory)
          .map((e) => e.name);
        const topLevelFiles = topEntries
          .filter((e) => !e.isDirectory)  // readDirTopLevel 只返 isDirectory,!isDirectory = 文件
          .map((e) => e.name);
        if (topLevelDirs.length === 1) {
          autoTopDir = topLevelDirs[0];
          // 嵌套修复:把 modRoot 钻进去,后端 cp 时源是平铺的(<ModName>/<content>)
          // renderer 无 Node path.join,手动拼接(去尾斜杠 + \\ 分隔)
          effectiveModRoot = `${mod.rootPath.replace(/[\\/]+$/u, "")}\\${autoTopDir}`;
        } else if (topLevelDirs.length === 0 && topLevelFiles.length === 1) {
          // BUG-014 补充:顶层只有 1 个文件(如 subFile 单 xml),folderRoot 会装出嵌套
          //   改成 fileOnly,installPath 保留(用户配置的 InstallLocation),fileName 直接拷贝
          const singleFile = topLevelFiles[0];
          autoTopDir = undefined;
          effectiveModRoot = mod.rootPath;
          if (strategy.kind === "folderRoot") {
            strategy = {
              kind: "fileOnly",
              installPath: strategy.installPath,
              fileName: singleFile,
              isExtname: false,
            };
            strategyRewritten = `folderRoot → fileOnly(fileName=${singleFile})`;
          }
        }
      } catch {
        // 探测失败(权限/不存在等)→ fallback 到 mod.name
      }
      const targetFolderName =
        opts?.targetFolderName ?? autoTopDir ?? mod.name;

      // BUG-010 诊断日志:让用户能直接定位 target 算错/没建文件夹原因
      await recordLog(
        "info",
        "library",
        `[BUG-010 诊断] ${mod.name} modType=${mod.modTypeId} ` +
          `rootPath=${mod.rootPath} → installPath=${strategy.installPath} ` +
          `effectiveModRoot=${effectiveModRoot} ` +
          `targetFolderName=${targetFolderName} (探测=${autoTopDir ?? "无"},fallback=${mod.name}) ` +
          `strategy=${strategyRewritten ?? strategy.kind} ` +
          `gamePath=${activeGame.value.path} ` +
          `effectiveGamePath=${effectiveGamePath} ` +
          `gameBasePath=${gameBasePath ?? "无"} ` +
          `(managed=${activeGame.value.gameBasePath ?? "无"},preset=${getPresetGameBasePath(activeGame.value.presetId) ?? "无"})`,
      );

      // BUG-010(2026-10-03):mod 已经在 gamePath/installPath 下的 noop 检测
      //   场景:扫描出来的 mod(scan 时 modRoot 已经是游戏目录里的 <gamePath>/mods/<ModName>),
      //   点"安装"会把 modRoot 内容拷到自己所在位置 → 原地覆盖,看起来"装了但没变化"。
      //   这种情况下应该直接标 installed=true,不调 applyModStrategy(避免 cp src===dst 抛错或误删)
      //   用 effectiveGamePath 判定(配合 preset.gameBasePath)
      const normalizedRoot = mod.rootPath.replace(/[\\/]+$/u, "").toLowerCase();
      const normalizedGame = effectiveGamePath.replace(/[\\/]+$/u, "").toLowerCase();
      const installPathPrefix = strategy.installPath.replace(/[\\/]+$/u, "");
      const expectedRootPrefix = normalizedGame + "\\" + installPathPrefix.toLowerCase();
      const isAlreadyInTarget = normalizedRoot === expectedRootPrefix ||
        normalizedRoot.startsWith(expectedRootPrefix + "\\");
      if (isAlreadyInTarget) {
        await recordLog(
          "info",
          "library",
          `[BUG-010 noop] ${mod.name} modRoot 已在目标位置(<gamePath>/${installPathPrefix} 下),跳过 apply`,
        );
        await updateMod(mod.id, {
          installed: true,
          deployedFiles: [strategy.installPath.replace(/\\/g, "/") + "/" + targetFolderName],
          updatedAt: Date.now(),
        });
        return;
      }

      const managedToolCandidates = managedToolCandidatesForStrategy(modType.install);

      // BUG-010 round 5(2026-10-03):createInstallPlan / applyModStrategy 由后端做权威 resolve,
      //   renderer 只传原 game.path + gamePathPrefix,避免双 resolve 上溯过头。
      // BUG-010 round 5 嵌套修复:探测到 modRoot 顶层唯一目录时,effectiveModRoot 已钻进去
      //   (cp 源 = <ModName>/<content> 平铺),避免 folderRoot 装出 <target>/<ModName>/<content> 嵌套
      const plan = await window.mayfly.createInstallPlan({
        modRoot: effectiveModRoot,
        gamePath: activeGame.value.path,
        gamePathPrefix: gameBasePath,
        targetFolderName,
        strategy,
        useSymlink: settings.value.useSymlinkInstall // 读设置项,默认拷贝
      });

      if (plan.conflicts.length > 0) {
        // FEATURE-014:用户点安装即为最高授权,跳过"覆盖阻止"预检,后端 throwing 同步放开
        // 记录日志便于后续排查(用户原话:"用户点安装就是最大的操作权限,不用提示")
        await recordLog("info", "library",
          `${mod.name} 安装将覆盖 ${plan.conflicts.length} 个已存在文件(用户授权)`);
      }

      const result = await window.mayfly.applyModStrategy({
        modRoot: effectiveModRoot,
        gamePath: activeGame.value.path,
        gamePathPrefix: gameBasePath,
        targetFolderName,
        strategy,
        isInstall: true,
        useSymlink: settings.value.useSymlinkInstall, // 读设置项,默认拷贝
        managedToolCandidates
      });

      // BUG-009:deployedFiles=0 告警。原本"装了个寂寞"前端无感知,
      // 现在记 warn 日志 + 设 error.value,用户能看到"装了但没装上"。
      // 不 throw:部分 mod 本身就没文件(脚本 mod 等),记日志便于排查。
      if (result.deployedFiles.length === 0) {
        const warnMsg =
          `安装未复制任何文件: ${mod.name} (modType=${mod.modTypeId}, ` +
          `installPath=${strategy.installPath})。mod 包结构可能不被识别。`;
        await recordLog("warn", "library", warnMsg);
        error.value = warnMsg;
      }

      await updateMod(mod.id, {
        installed: true,
        deployedFiles: result.deployedFiles,
        updatedAt: Date.now()
      });
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "安装 Mod 失败";
    } finally {
      busy.value = false;
    }
  }

  async function previewInstallPlan(mod: LocalMod) {
    if (!activeGame.value) return null;

    busy.value = true;
    error.value = "";

    try {
      const adapter = adapterForGame(activeGame.value);
      const modType = getModType(adapter, mod.modTypeId);
      // BUG-010 round 5(2026-10-03):createInstallPlan 由后端做权威 resolve,
      //   renderer 只传原 game.path + gamePathPrefix,避免双 resolve 上溯过头。
      // BUG-010 round 5 老游戏兼容:ManagedGame.gameBasePath 可能 undefined,
      //   fallback 到 preset.gameBasePath(用户游戏入库早于 gameBasePath 字段加入 preset)
      const previewGameBasePath = resolveGameBasePath(activeGame.value);
      const plan = await window.mayfly.createInstallPlan({
        modRoot: mod.rootPath,
        gamePath: activeGame.value.path,
        gamePathPrefix: previewGameBasePath,
        targetFolderName: mod.name,
        strategy: toPlain(modType.install),
        useSymlink: settings.value.useSymlinkInstall // 读设置项,默认拷贝
      });

      installPlans.value = {
        ...installPlans.value,
        [mod.id]: plan
      };
      return plan;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "生成安装计划失败";
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function installSelectedMods() {
    for (const mod of [...selectedMods.value].sort(compareGameInstallOrder)) {
      if (!mod.installed) {
        await installMod(mod);
      }
    }
  }

  async function removeDeployedFilesWithFallback(gamePath: string, deployedFiles: string[]) {
    const files = [...deployedFiles]
      .map((file) => file.trim())
      .filter(Boolean)
      .sort((left, right) => right.replace(/\\/g, "/").split("/").length - left.replace(/\\/g, "/").split("/").length);

    try {
      await window.mayfly.removeDeployedFiles({
        gamePath,
        deployedFiles: files
      });
      return;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);

      if (!/EISDIR|directory|目录/iu.test(message)) {
        throw caught;
      }

      await recordLog("info", "mods", "卸载时遇到目录记录，已切换递归清理。", message);
    }

    for (const file of files) {
      const targetPath = joinGameRelativePath(gamePath, file);
      if (!targetPath) continue;
      await window.mayfly.remove(targetPath);
    }
  }

  async function uninstallMod(mod: LocalMod) {
    if (!activeGame.value) return false;

    busy.value = true;
    error.value = "";

    try {
      // BUG-013(2026-10-04):卸载也要用 effectiveGamePath(配合 preset.gameBasePath)
      //   之前用 activeGame.value.path(exe 目录),exe 在子目录时卸载路径算错,
      //   joinGameRelativePath 拼出 <exe dir>/<installPath>/<targetFolderName>
      //   而不是 <real game root>/<installPath>/<targetFolderName>,rm 找不到目录
      //   沉默 no-op,用户看到"卸载成功"但文件夹还在。
      // BUG-013 老游戏兼容:runtime fallback 到 preset.gameBasePath(ManagedGame 可能没拷贝)
      const uninstallGameBasePath = resolveGameBasePath(activeGame.value);
      const effectiveGamePath = uninstallGameBasePath
        ? await window.mayfly.resolveGamePath({
            gamePath: activeGame.value.path,
            prefix: uninstallGameBasePath,
          })
        : activeGame.value.path;

      const adapter = adapterForGame(activeGame.value);
      const modType = getModType(adapter, mod.modTypeId);
      const strategy = modType.uninstall ?? modType.install;
      const managedToolCandidates = managedToolCandidatesForStrategy(strategy);

      if (mod.deployedFiles.length > 0 && !strategyNeedsManagedUninstall(strategy.kind)) {
        await removeDeployedFilesWithFallback(effectiveGamePath, mod.deployedFiles);
      } else {
        await window.mayfly.applyModStrategy({
          modRoot: mod.rootPath,
          gamePath: effectiveGamePath,
          gamePathPrefix: uninstallGameBasePath,
          targetFolderName: mod.name,
          strategy: toPlain(strategy),
          isInstall: false,
          useSymlink: settings.value.useSymlinkInstall, // 读设置项,默认拷贝
          managedToolCandidates
        });
      }

      await updateMod(mod.id, {
        installed: false,
        deployedFiles: [],
        updatedAt: Date.now()
      });
      return true;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "卸载 Mod 失败";
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function uninstallSelectedMods() {
    for (const mod of [...selectedMods.value].sort((left, right) => compareGameInstallOrder(right, left))) {
      if (mod.installed) {
        await uninstallMod(mod);
      }
    }
  }

  async function updateMod(modId: string, patch: Partial<LocalMod>) {
    mods.value = mods.value.map((mod) =>
      mod.id === modId ? { ...mod, ...patch } : mod
    );
    await persist();
  }

  async function updateSelectedMods(patch: Partial<LocalMod> & { appendTags?: string[] }) {
    const selectedIds = new Set(selectedMods.value.map((mod) => mod.id));
    const now = Date.now();

    mods.value = mods.value.map((mod) => {
      if (!selectedIds.has(mod.id)) return mod;

      const nextTags = patch.appendTags
        ? [...new Set([...mod.tags, ...patch.appendTags])]
        : (patch.tags ?? mod.tags);

      return {
        ...mod,
        ...patch,
        tags: nextTags,
        updatedAt: now
      };
    });
    await persist();
  }

  function currentProfileSnapshot(gameId: string) {
    const gameMods = mods.value
      .filter((mod) => mod.gameId === gameId)
      .sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt);

    return {
      enabledModIds: gameMods.filter((mod) => mod.installed).map((mod) => mod.id),
      modOrder: gameMods.map((mod) => mod.id)
    };
  }

  async function createModProfile(nameInput: string) {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return null;
    }

    const name = nameInput.trim();
    if (!name) {
      error.value = "请输入配置档案名称。";
      return null;
    }

    if (activeProfiles.value.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
      error.value = "当前游戏已经有同名配置档案。";
      return null;
    }

    const snapshot = currentProfileSnapshot(activeGame.value.id);
    const now = Date.now();
    const profile: ModProfile = {
      id: createId("profile"),
      gameId: activeGame.value.id,
      name,
      enabledModIds: selectedModIds.value.length > 0 ? [...selectedModIds.value] : snapshot.enabledModIds,
      modOrder: snapshot.modOrder,
      createdAt: now,
      updatedAt: now
    };
    modProfiles.value = [...modProfiles.value, profile];
    await persist();
    return profile;
  }

  async function saveModProfile(profileId: string) {
    if (!activeGame.value) return false;
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;

    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId
        ? {
          ...item,
          enabledModIds: selectedModIds.value.length > 0 ? [...selectedModIds.value] : currentProfileSnapshot(activeGame.value!.id).enabledModIds,
          modOrder: currentProfileSnapshot(activeGame.value!.id).modOrder,
          updatedAt: Date.now()
        }
        : item
    );
    await persist();
    return true;
  }

  async function addSelectedModsToProfile(profileId: string) {
    if (!activeGame.value || selectedModIds.value.length === 0) return false;
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;

    const newIds = [...new Set([...profile.enabledModIds, ...selectedModIds.value])];
    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId ? { ...item, enabledModIds: newIds, updatedAt: Date.now() } : item
    );
    await persist();
    clearSelection();
    return true;
  }

  async function removeSelectedModsFromProfile(profileId: string) {
    if (!activeGame.value || selectedModIds.value.length === 0) return false;
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;

    const idsToRemove = new Set(selectedModIds.value);
    const newIds = profile.enabledModIds.filter(id => !idsToRemove.has(id));

    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId ? { ...item, enabledModIds: newIds, updatedAt: Date.now() } : item
    );
    await persist();
    clearSelection();
    return true;
  }

  async function renameModProfile(profileId: string, nameInput: string) {
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    const name = nameInput.trim();
    if (!profile || !name) return false;

    if (activeProfiles.value.some((item) =>
      item.id !== profileId && item.name.toLowerCase() === name.toLowerCase()
    )) {
      error.value = "当前游戏已经有同名配置档案。";
      return false;
    }

    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId ? { ...item, name, updatedAt: Date.now() } : item
    );
    await persist();
    return true;
  }

  async function removeModProfile(profileId: string) {
    if (!activeProfiles.value.some((profile) => profile.id === profileId)) return false;

    modProfiles.value = modProfiles.value.filter((profile) => profile.id !== profileId);
    await persist();
    return true;
  }

  async function applyModProfile(profileId: string) {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return false;
    }

    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;
    if (profileApplying.value) return false;

    const gameMods = mods.value.filter((mod) => mod.gameId === activeGame.value?.id);
    const modMap = new Map(gameMods.map((mod) => [mod.id, mod]));
    const desiredIds = new Set(profile.enabledModIds.filter((id) => modMap.has(id)));
    const orderIndex = new Map(profile.modOrder.map((id, index) => [id, index]));
    const desiredOrder = gameMods
      .filter((mod) => desiredIds.has(mod.id))
      .sort((left, right) =>
        (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
    const toUninstall = gameMods.filter((mod) => mod.installed && !desiredIds.has(mod.id));
    const toInstall = desiredOrder.filter((mod) => !mod.installed);

    profileApplying.value = true;
    error.value = "";

    try {
      for (const mod of [...toUninstall].sort((left, right) => right.sortIndex - left.sortIndex)) {
        const success = await uninstallMod(mod);
        if (!success) {
          throw new Error(error.value || `卸载 Mod 失败：${mod.name}`);
        }
      }

      for (const mod of toInstall) {
        await installMod(mod);
        const latest = mods.value.find((item) => item.id === mod.id);
        if (!latest?.installed) {
          throw new Error(error.value || `安装 Mod 失败：${mod.name}`);
        }
      }

      const orderedIds = [
        ...profile.modOrder.filter((id) => modMap.has(id)),
        ...gameMods.map((mod) => mod.id).filter((id) => !profile.modOrder.includes(id))
      ];
      const sortMap = new Map(orderedIds.map((id, index) => [id, index]));
      mods.value = mods.value.map((mod) =>
        mod.gameId === activeGame.value?.id && sortMap.has(mod.id)
          ? { ...mod, sortIndex: sortMap.get(mod.id) ?? mod.sortIndex, updatedAt: Date.now() }
          : mod
      );
      await persist();
      return true;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "应用配置档案失败";
      return false;
    } finally {
      profileApplying.value = false;
    }
  }

  async function setTagColor(tag: string, color: string) {
    settings.value.tagColors = {
      ...settings.value.tagColors,
      [tag]: color
    };
    await persist();
  }

  async function updateSettings(patch: Partial<typeof settings.value>) {
    if (typeof patch.launchAtStartup === "boolean") {
      patch.launchAtStartup = await window.mayfly.setLaunchAtStartup(patch.launchAtStartup);
    }

    settings.value = {
      ...settings.value,
      ...patch
    };
    await persist();
  }

  async function removeMod(mod: LocalMod) {
    // HGMM absolute 类型不走 uninstallMod 框架,自己按 files 清单删 + 删 installedPath
    if (mod.modTypeId === "absolute" && mod.installedPath) {
      const base = mod.installedPath;
      for (const file of mod.files ?? []) {
        try {
          const fullPath = `${base}\\${file}`.replace(/\\+/g, "\\");
          await window.mayfly.remove(fullPath);
        } catch {
          // 静默:文件可能本来就不存在
        }
      }
      try {
        await window.mayfly.remove(mod.installedPath);
      } catch {
        await recordLog(
          "error",
          "library",
          `清理 installPath 失败: ${mod.installedPath}(可能权限不足或非空)`
        );
      }
    } else if (mod.installed) {
      const uninstalled = await uninstallMod(mod);
      if (!uninstalled) return;
    }

    await window.mayfly.remove(mod.rootPath);
    mods.value = mods.value.filter((item) => item.id !== mod.id);
    selectedModIds.value = selectedModIds.value.filter((id) => id !== mod.id);

    // HGMM Phase 5.x:同时清理属于这个 mod 的下载任务
    // 关键:Nexus 下载 task 持久化在 downloads.value,LocalMod 删除后 task 还在
    // 用户重新下载时 downloadNexusFile dedup 报"队列里已经有"
    // 通过 updateSource.modId + fileId 反向匹配 Nexus task
    // (Custom / featured 下载 task 的 modId 字段为空,无法反向匹配,会保留到下载面板让用户手动清)
    if (mod.updateSource?.type === "nexus") {
      const { modId: nexusModId, fileId: nexusFileId } = mod.updateSource;
      const beforeCount = downloads.value.length;
      downloads.value = downloads.value.filter((task) => {
        if (task.source !== "NexusMods") return true;
        if (
          task.updateSource?.modId === nexusModId &&
          task.updateSource?.fileId === nexusFileId
        ) {
          return false;
        }
        return true;
      });
      const removed = beforeCount - downloads.value.length;
      if (removed > 0) {
        await recordLog(
          "info",
          "library",
          `删除 mod 时清理 ${removed} 个对应 Nexus 下载任务 (${mod.name})`,
        );
      }
    }

    await persist();
  }

  async function removeSelectedMods() {
    for (const mod of [...selectedMods.value]) {
      await removeMod(mod);
    }
  }

  function toggleModSelection(modId: string, selected?: boolean) {
    const nextSelected = selected ?? !selectedModIds.value.includes(modId);

    selectedModIds.value = nextSelected
      ? [...new Set([...selectedModIds.value, modId])]
      : selectedModIds.value.filter((id) => id !== modId);
  }

  function selectAllVisibleMods() {
    selectedModIds.value = [...new Set([...selectedModIds.value, ...activeMods.value.map((mod) => mod.id)])];
  }

  function clearSelection() {
    selectedModIds.value = [];
  }

  async function reorderActiveMods(draggedId: string, targetId: string) {
    if (!activeGame.value || draggedId === targetId) return false;

    if (!canReorderMods.value) {
      error.value = "拖拽排序前请先清空搜索、类型和标签筛选。";
      return false;
    }

    const orderedIds = activeMods.value.map((mod) => mod.id);
    const fromIndex = orderedIds.indexOf(draggedId);
    const toIndex = orderedIds.indexOf(targetId);

    if (fromIndex < 0 || toIndex < 0) return false;

    const [movedId] = orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, movedId);
    const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
    const now = Date.now();

    sortMode.value = "custom";
    mods.value = mods.value.map((mod) =>
      mod.gameId === activeGame.value?.id && orderMap.has(mod.id)
        ? { ...mod, sortIndex: orderMap.get(mod.id) ?? mod.sortIndex, updatedAt: now }
        : mod
    );
    await persist();
    return true;
  }

  function sortMods(list: LocalMod[]) {
    const next = [...list];

    switch (sortMode.value) {
      case "custom":
        return next.sort((a, b) => a.sortIndex - b.sortIndex || compareGameInstallOrder(a, b));
      case "createdAsc":
        return next.sort((a, b) => a.createdAt - b.createdAt);
      case "nameAsc":
        return next.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      case "nameDesc":
        return next.sort((a, b) => b.name.localeCompare(a.name, "zh-Hans-CN"));
      case "installedFirst":
        return next.sort((a, b) => Number(b.installed) - Number(a.installed) || b.updatedAt - a.updatedAt);
      case "createdDesc":
      default:
        return next.sort((a, b) => b.createdAt - a.createdAt);
    }
  }

  function setError(message: string) {
    error.value = message;
  }

  let lastLoggedError = "";
  watch(error, (message) => {
    const normalized = message.trim();
    if (!normalized || normalized === lastLoggedError) return;
    lastLoggedError = normalized;
    void recordLog("error", "library", normalized);
  });

  return {
    initialized,
    busy,
    error,
    settings,
    games,
    activeGameId,
    activeGame,
    nexusPresetId,
    nexusPreset,
    nexusPresets,
    activeAdapter,
    presetSearch,
    presetList,
    presetCount,
    mods,
    downloads,
    logs,
    backups,
    backupContents,
    search,
    selectedTypeId,
    selectedTag,
    sortMode,
    selectedModIds,
    profileApplying,
    installPlans,
    nexusSearch,
    nexusPage,
    nexusPageSize,
    nexusSort,
    nexusCategory,
    nexusLanguage,
    nexusTag,
    nexusFacets,
    nexusMods,
    nexusTotalCount,
    nexusTotalPages,
    nexusLoading,
    nexusDetailLoading,
    nexusLoginLoading,
    nexusTranslationLoading,
    nexusTranslationVisible,
    nexusTranslationError,
    nexusTranslatedSummary,
    nexusTranslatedDescription,
    selectedNexusMod,
    // HGMM 精选 mod(Phase 1B)
    featuredMods,
    featuredDeleteRules,
    featuredGlobalEnabled,
    featuredLoading,
    featuredActiveGroupIds,
    installingFeaturedId,
    activeSubTab,
    // HGMM 大型 mod(Phase 4)
    bigMods,
    bigModLoading,
    bigModError,
    activeBigMods,
    nexusAuthorized,
    tagPalette,
    selectedProfileId,
    activeMods,
    activeTags,
    activeProfiles,
    installedCount,
    canReorderMods,
    selectedMods,
    activeUpdateAvailableCount,
    activeDownloads,
    packageProgress,
    updateBatchProgress,
    updateCheckResult,
    checkModUpdate,
    updateCheckingIds,
    appUpdateChecking,
    appUpdateDialogVisible,
    appUpdateInfo,
    appUpdateCurrentVersion,
    appUpdateMessage,
    initialize,
    chooseStoragePath,
    addGame,
    addCustomGameFromInput,
    openActiveGameModFolder,
    setActiveGame,
    setNexusPreset,
    updateGame,
    addCustomAdapterRule,
    removeCustomAdapterRule,
    chooseActiveGamePath,
    chooseActiveGameExecutable,
    locateActiveGameFromSteam,
    launchActiveGame,
    repairActiveGame,
    scanActiveGameMods,
    removeGame,
    importLocalMods,
    chooseModCoverImage,
    importLocalModsFromPaths,
    saveNexusApiKey,
    loginNexusWithBrowser,
    validateNexusApiKey,
    clearNexusAuth,
    recordLog,
    clearLogs,
    checkAppUpdate,
    closeAppUpdateDialog,
    openAppUpdateDownload,
    loadNexusMods,
    openNexusModDetail,
    openNexusUrl,
    translateSelectedNexusMod,
    showOriginalNexusText,
    handleNxmUrl,
    downloadNexusFile,
    checkActiveGameUpdates,
    updateNexusMod,
    updateAllAvailableMods,
    downloadCustomUrl,
    openDownloadFile,
    openDownloadFolder,
    removeDownloadTask,
    removeDownloadTasks,
    pauseDownloadTask,
    resumeDownloadTask,
    pauseDownloadTasks,
    resumeDownloadTasks,
    createActiveGameBackup,
    createActiveSaveBackup,
    restoreBackup,
    removeBackup,
    renameBackup,
    importBackupFile,
    loadBackupContents,
    openBackupFolder,
    exportData,
    importData,
    exportModsToPackage,
    exportActiveGamePack,
    restoreActiveGamePack,
    installMod,
    previewInstallPlan,
    installSelectedMods,
    uninstallMod,
    uninstallSelectedMods,
    updateMod,
    updateSelectedMods,
    createModProfile,
    saveModProfile,
    addSelectedModsToProfile,
    removeSelectedModsFromProfile,
    renameModProfile,
    removeModProfile,
    applyModProfile,
    setTagColor,
    updateSettings,
    removeMod,
    removeSelectedMods,
    toggleModSelection,
    selectAllVisibleMods,
    clearSelection,
    reorderActiveMods,
    setError,
    translateTextCached,
    // HGMM 精选 mod(Phase 1B)
    loadFeaturedMods,
    setActiveSubTab,
    toggleFeaturedGroup,
    featuredGroupDisabled,
    downloadFeaturedMod,
    installFeaturedMod,
    isInstalledByOrigin,
    // HGMM 大型 mod(Phase 4)
    loadBigMods,
    refreshBigMods
  };
});
