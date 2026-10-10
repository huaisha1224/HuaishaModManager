// HGMM 精选 mod CDN 数据源
//
// 数据来源:download.hs2049.cn(原 HGMM 团队维护,7 款游戏各自一份 JSON)
// 数据采集:2026-09-15 从 GameConfig::sCdnConfigUrl 验证,7 个 URL 全可达
// 文件清单见 docs/02-phase1-design.md 第 3 节
//
// 本模块负责:
//   1. 从 CDN 拉取某个游戏的精选 mod JSON
//   2. 归一化为 FeaturedMod(主 mod + subFiles 子文件)
//   3. 推断 modType(blackwukong 99% 缺 Modetype 字段,按 InstallLocation 路径前缀推断)
//   4. 过滤黑名单(InstallLocation="" 表示 HGMM 升级配置,不当 mod)
//   5. 返回 Delete 清理规则(供 store 层应用)
//
// 注意:MayFly 没有"安装前清理"概念,本模块只提供数据,不执行文件操作。

import type { CustomAdapterRule, InstallStrategy } from "@/types/domain";

// ============================================================
// 原始 JSON 类型(与 CDN 文件结构一致)
// ============================================================

/**
 * Platform 数组中的单个精选 mod
 *
 * Modetype / Array / ModThumbnail / Type / data 都是可选
 * 因为不同游戏的字段覆盖率差异巨大(blackwukong 99% 缺 Modetype)
 */
export interface RawFeaturedMod {
  Enable: boolean;
  Modetype?: "1" | "2" | "5" | string;
  ModName: string;
  DisplayName: string;
  Description: string;
  DownloadUrl: string;
  InstallLocation: string;
  ModThumbnail?: string;
  /** HGMM 2.0 专属:N 网封面 URL(从 Nexus 抓的 og:image)。
   *  优先级高于 ModThumbnail。HGMM 1.0 忽略这个字段,JSON 文件可双向兼容。 */
  hgmm2_cover_url?: string;
  Type?: number;
  Array?: number;
  data?: RawFeaturedSubMod[];
  // FEATURE-020(2026-10-08):精选 mod 更新日期(ISO 8601 date,YYYY-MM-DD)
  //  客户端用来判断"是否复用本地 .zip 缓存"。缺失/格式不对 → 降级每次都下(baseline)
  //  2026-10-08 实测:7 款游戏(stellarblade / palworld / slaythespire2 / silksong /
  //  blackwukong / expedition33 / howtofish)老 HGMM 2.0 客户端全兼容
  updatedAt?: string;
}

/** Platform.data[] 子文件元素(主 mod 包含多个独立文件) */
export interface RawFeaturedSubMod {
  ModName: string;
  DownloadUrl: string;
  InstallLocation: string;
}

/** 顶层 Delete[] 元素(安装前的清理规则) */
export interface RawCleanupRule {
  Description: string;
  Directory: string;
  type: "1" | "2";
}

/** 整个 JSON 文件的 schema(顶层 keys) */
export interface RawHGMMFeaturedFile {
  Enable: boolean;
  Delete: RawCleanupRule[];
  Platform: RawFeaturedMod[];
  // 顶层其他 key(如 "300113" 推广位)由 TypeScript 自动忽略
}

// ============================================================
// 归一化后的 FeaturedMod(store / UI 层使用)
// ============================================================

/** 精选 mod 类型分类(用于 UI 显示 + InstallStrategy 选择) */
export type FeaturedModType =
  | "pak"
  | "logicMods"
  | "ue4ss"
  | "mods"
  | "scripts"
  | "bepinex"
  | "plugins"
  | "absolute"
  | "root"
  | "unknown";

/** 归一化后的精选 mod */
export interface FeaturedMod {
  /** 用 ModName + url 做稳定 hash(主 mod 用原 url,子文件用主 url + 子 ModName) */
  id: string;
  name: string;
  description: string;
  /** ModThumbnail,缺失用空字符串(前端用占位图 fallback) */
  coverUrl: string;
  downloadUrl: string;
  /** 直接来自 JSON 的 InstallLocation,不要自己拼 basePath */
  installPath: string;
  modType: FeaturedModType;
  enabled: boolean;
  /** Array(iGroupID)互斥分组,>0 时与同组其他 mod 互斥(业务层) */
  groupId?: number;
  /** data[] 子文件列表(展开后) */
  subFiles?: FeaturedMod[];
  // FEATURE-020(2026-10-08):原 JSON 透传,客户端用来判断缓存复用
  updatedAt?: string;
}

/** fetchHGMMFeatured 返回值 */
export interface FeaturedFetchResult {
  mods: FeaturedMod[];
  deleteRules: RawCleanupRule[];
  /** 顶层 Enable:false 表示全局灰度关闭,UI 应提示 */
  globalEnabled: boolean;
}

// ============================================================
// CDN URL 映射
// ============================================================

/**
 * 7 款游戏的 CDN JSON URL(来源 GameConfig::sCdnConfigUrl)
 *
 * 路径变更:2026-09-22 从 /config/ 改成 /hgmm2/。同文件名 / 不同路径,
 * 这样 HGMM 2.0 调整 JSON 不影响 HGMM 1.0 老用户,两边可独立演进。
 *
 * 关键注意:
 *   - sGameId 大小写必须跟原 HGMM 一致,尤其是 "How to Fish"(首字母大写+空格)
 *   - 文件名完全不规律(Expedition.json 去掉 33,blackwukong.json 全小写,HKSilksong.json HK 大写)
 *   - 不要尝试推断统一命名规则
 */
export const CDN_SCHEMA_FILES: Record<string, string> = {
  stellarblade: "https://download.hs2049.cn/hgmm2/StellarBlade.json",
  palworld: "https://download.hs2049.cn/hgmm2/PalSchema.json",
  slaythespire2: "https://download.hs2049.cn/hgmm2/SlayTheSpire2.json",
  // HGMM 3.2 修复:Phase 1B 时 key 用 HGMM 1.0 的 sGameId "hksilksong",
  // 但 game-presets.json preset.id="silksong"(Phase 1A 迁移时把 HK 前缀去掉了)。
  // 两边 key 不一致 → loadFeaturedMods 拿不到精选。改 key 对齐 presetId。
  silksong: "https://download.hs2049.cn/hgmm2/HKSilksong.json",
  blackwukong: "https://download.hs2049.cn/hgmm2/blackwukong.json",
  expedition33: "https://download.hs2049.cn/hgmm2/Expedition.json",
  "How to Fish": "https://download.hs2049.cn/hgmm2/HowtoFish.json",
  // FEATURE-015(2026-10-03):巫师 3 CDN URL 预注册。当前 Witcher3.json 还未生成(404),
  // fetch 失败被 installFeaturedMod 顶层 try/catch 捕获 → 仅精选 tab 为空,
  // 游戏本体 + Nexus 下载 mod 正常用。出 JSON 时确认文件名是否真是 "Witcher3.json",
  // CDN 文件名命名不规律(见上方 122-124 注释),用户出 JSON 时需对齐。
  thewitcher3: "https://download.hs2049.cn/hgmm2/Witcher3.json",
};

// ============================================================
// 核心逻辑:modType 推断(兼容 blackwukong 99% 无 Modetype 字段)
// ============================================================

/** 返回 null 表示该条目不是 mod(如 blackwukong 的 HGMM 升级配置) */
export type InferResult = FeaturedModType | null;

/**
 * 推断 mod 的类型
 *
 * HGMM 3.0 改造:完全改用路径前缀推断(放弃 Modetype="1"/"2" 硬编码)。
 * 原因:Phase 1B 时代的 modetype="2" → "ue4ss" 在 Unity 游戏(hksilksong)下错把
 * BepInEx\\plugins 推断成 ue4ss,导致 Phase 3.0 BepInEx 自动加载器永远不触发。
 *
 * 优先级:
 *   1. InstallLocation 空字符串 → null(HGMM 升级配置,跳过)
 *   2. 绝对 Windows 盘符 → "absolute"
 *   3. BepInEx 路径(优先于 UE4SS,因为 UE4SS 没 \BepInEx 前缀)
 *      - \\BepInEx\\core → "bepinex"(加载器整包)
 *      - \\BepInEx\\plugins → "plugins"(BepInEx plugin dll)
 *   4. UE4SS 路径 → "ue4ss"
 *      - \\Binaries\\Win64\\ue4ss(luau mod 等)
 *   5. Unreal pak 路径 → "pak"
 *      - \\Content\\Paks\\~mods / \\Content\\Paks\\LogicMods
 *   6. modetype="5" 兜底为 absolute(部分 JSON InstallLocation 缺失)
 *   7. 其他 → "root"(Unity 游戏根目录 / Unreal 根目录 / 自定义 mod 目录如 slaythespire2 \mods)
 *
 * @example
 * inferModType("BepInEx\\plugins", "1") → "plugins"(hksilksong mod)
 * inferModType("BepInEx\\core", "1") → "bepinex"(hksilksong 整包)
 * inferModType("Hollow Knight Silksong_Data", "1") → "root"
 * inferModType("\\mods", "2") → "root"(slaythespire2 自定义 mod 目录)
 * inferModType("b1\\Content\\Paks\\~mods\\xxx.pak", undefined) → "pak"
 * inferModType("Pal\\Content\\Paks\\~mods", "1") → "pak"
 * inferModType("C:\\Palworld\\flyy_Palworld", "5") → "absolute"
 * inferModType("", undefined) → null
 */
export function inferModType(
  installPath: string,
  modetype: string | undefined,
): InferResult {
  // 1. InstallLocation 为空 → 不是 mod(blackwukong 第一个元素的特例)
  if (!installPath || installPath.trim() === "") return null;

  // 2. 路径前缀推断(归一化:统一用 \\,统一小写)
  const normalized = installPath.toLowerCase().replace(/\//g, "\\");

  // 2a. 绝对路径(Windows 盘符开头,如 C:\\ 或 D:\\)
  if (/^[a-z]:\\/u.test(normalized)) return "absolute";

  // 2b. BepInEx 路径(优先于 UE4SS 匹配,避免被通用前缀误抓)
  // 注:必须用 regex 的 \b word boundary,而非 string.includes(后者 "\b" 是退格字符 0x08,永远匹配不上)
  // 前导用 \b(而非 \\b)允许 normalized 开头就是 bepinex(如 "BepInEx\\plugins");
  // 后置 lookahead (?=\\|\b|$) 防止 "OtherBepInEx\\plugins" 这种单词内子串误匹配。
  if (/\bbepinex\\core(?=\\|\b|$)/u.test(normalized)) return "bepinex";
  if (/\bbepinex\\plugins(?=\\|\b|$)/u.test(normalized)) return "plugins";

  // 2c. UE4SS 子目录(优先于通用 UE4SS 路径,因 mods/scripts 是 ue4ss\ 下的子目录)
  // Unreal adapter 里有独立 modType:mods(folderParent,Enabled.txt)/ scripts(folderParent,Scripts)
  // 之前错误合并为 "ue4ss",installPath 错位到 Binaries\Win64(ue4ss 整包位置)
  if (/\\binaries\\win64\\ue4ss\\mods(?=\\|\b|$)/u.test(normalized)) return "mods";
  if (/\\binaries\\win64\\ue4ss\\scripts(?=\\|\b|$)/u.test(normalized)) return "scripts";

  // 2d. UE4SS 整包路径(不含 Mods/Scripts 子目录)
  if (/\\binaries\\win64\\ue4ss(?=\\|\b|$)/u.test(normalized)) return "ue4ss";

  // 2e. Unreal pak(~mods 跟 LogicMods 必须分开,adapter 有不同 modType)
  if (/\\content\\paks\\~mods(?=\\|\b|$)/u.test(normalized)) return "pak";
  if (/\\content\\paks\\logicmods(?=\\|\b|$)/u.test(normalized)) return "logicMods";

  // 3. modetype="5" 兜底为 absolute(部分 JSON InstallLocation 缺失但仍是绝对路径)
  if (modetype === "5") return "absolute";

  // 4. 其他 → "root"(Unity 游戏根目录 / Unreal 游戏根目录 / 自定义 mod 目录)
  return "root";
}

// ============================================================
// 主入口:从 CDN 拉取并归一化
// ============================================================

/**
 * 拉取某个游戏的精选 mod JSON 并归一化为 FeaturedMod[]
 *
 * 步骤:
 *   1. 按 gameId 查 CDN URL(查不到直接抛错)
 *   2. fetch 拉 JSON(失败抛错)
 *   3. 过滤 Enable=false 和 InstallLocation="" 的条目
 *   4. 归一化每个 mod(inferModType + iGroupID)
 *   5. 展开 data[] 子文件(每个子文件独立 FeaturedMod,继承 groupId)
 *   6. 返回 {mods, deleteRules, globalEnabled}
 *
 * @throws gameId 不在 CDN_SCHEMA_FILES 中
 * @throws fetch 失败(HTTP 非 2xx)
 */
export async function fetchHGMMFeatured(
  gameId: string,
): Promise<FeaturedFetchResult> {
  const url = CDN_SCHEMA_FILES[gameId];
  if (!url) {
    throw new Error(
      `No CDN schema for gameId: "${gameId}". ` +
      `Known: ${Object.keys(CDN_SCHEMA_FILES).join(", ")}`,
    );
  }

  // 走 mayfly main process 的 net:fetchJson,绕开渲染进程 CORS/SSL 限制
  // (renderer 直接 fetch 会撞 CORS,Failed to fetch)
  const data = (await window.mayfly.fetchRemoteJson({ url })) as unknown as RawHGMMFeaturedFile;

  const mods: FeaturedMod[] = [];
  for (const raw of data.Platform ?? []) {
    // 过滤 1:Enable=false(灰度关闭)
    if (!raw.Enable) continue;

    // 过滤 2:InstallLocation 为空(blackwukong 第一个元素是 HGMM 升级配置)
    if (!raw.InstallLocation || raw.InstallLocation.trim() === "") continue;

    // 推断 modType(null 表示不是 mod,跳过)
    const modType = inferModType(raw.InstallLocation, raw.Modetype);
    if (modType === null) continue;

    // 展开子文件(直接循环 + 过滤 null,避免 type predicate 类型不匹配)
    // BUG-027(2026-10-08):id 计算改用 raw.DisplayName,不再用 raw.ModName
    //   CDN JSON 所有 mod 条目都没有 ModName 字段,只有 DisplayName。ModName 在
    //   运行期是 undefined,模板字符串会拼出 "undefined::..."。本仓库 7 款精选
    //   JSON 已确认都是这种结构(用户原话:"服务器上所有的json里面都是这个值,
    //   没有ModName的字段,都是用DisplayName的")。
    //   主 mod id 同改(下方 mods.push 处)。子文件 id 加 fallback 防 ModName 也缺失:
    //   sub.ModName || sub.DownloadUrl 文件 stem || 空串。
    let subFiles: FeaturedMod[] | undefined;
    if (raw.data && raw.data.length > 0) {
      const subMods: FeaturedMod[] = [];
      for (const sub of raw.data) {
        const subModType = inferModType(sub.InstallLocation, undefined);
        if (subModType === null) continue;
        // BUG-027:id fallback 链:sub.ModName(若 JSON 有) → 文件 stem → 空串
        const subNameKey =
          sub.ModName?.trim() ||
          sub.DownloadUrl.split("/").pop()?.replace(/\.[^.]+$/u, "") ||
          "";
        subMods.push({
          id: `${raw.DisplayName}::${subNameKey}`,
          name: sub.ModName || subNameKey,
          description: raw.Description,
          coverUrl: "",
          downloadUrl: sub.DownloadUrl,
          installPath: sub.InstallLocation,
          modType: subModType,
          enabled: true,
          // 子文件继承主文件的互斥分组
          groupId: raw.Array,
        });
      }
      if (subMods.length > 0) subFiles = subMods;
    }

    mods.push({
      // BUG-027(2026-10-08):id 改用 raw.DisplayName,不再用 raw.ModName
      //   理由同上(子文件处注释)。主 mod 的 id 用作 featuredCache key(在
      //   installAbsoluteFeatured / installOneFeatured 里 setFeaturedCacheUpdatedAt),
      //   是 FEATURE-020 缓存复用的依据,key 不可读等于失去 debug 价值。
      //   RawFeaturedMod 类型上 ModName: string 标了必填,但运行期 JSON 缺这个
      //   key 就是 undefined,TS 类型保不了运行期安全。
      id: `${raw.DisplayName}::${raw.DownloadUrl}`,
      name: raw.DisplayName,
      description: raw.Description,
      // 封面优先级:hgmm2_cover_url (N 网) > ModThumbnail (HGMM 原 CDN) > 空
      // 这样没 N 网图的 mod 仍走 HGMM 原 CDN 兜底
      coverUrl: raw.hgmm2_cover_url?.trim() || raw.ModThumbnail?.trim() || "",
      downloadUrl: raw.DownloadUrl,
      installPath: raw.InstallLocation,
      modType,
      enabled: raw.Enable,
      groupId: raw.Array,
      subFiles,
      // FEATURE-020(2026-10-08):透传 updatedAt,客户端用来判断缓存复用
      //   真值判断(undefined 时降级走下载)
      updatedAt: raw.updatedAt,
    });
  }

  return {
    mods,
    deleteRules: data.Delete ?? [],
    globalEnabled: data.Enable ?? true,
  };
}

// ====== HGMM 大型 mod(Phase 4) ======
// 整个文件是所有游戏的列表,key 是 HGMM 1.0 老 sGameId 命名,需要 alias 映射
// 2026-09-22 路径变更:/config/ → /hgmm2/(跟 7 款游戏精选 JSON 一致)
export const BIGMOD_URL = "https://download.hs2049.cn/hgmm2/bigmod.json";

/** bigmod.json 顶层 key → game-presets.json preset.id
 *  大多数 key 直接同名,仅 hksilksong / Expedition33 跟 preset.id 不一致 */
export const BIGMOD_KEY_ALIAS: Record<string, string> = {
  stellarblade: "stellarblade",
  palworld: "palworld",
  slaythespire2: "slaythespire2",
  thewitcher3: "thewitcher3",
  hksilksong: "silksong",
  blackwukong: "blackwukong",
  Expedition33: "expedition33",
};

export interface RawBigModItem {
  id: string;
  name: string;
  size: string;
  Author: string;
  NexusID: string;
  url: string;
  description: string;
}

export interface RawBigModFile {
  version: number;
  items: RawBigModItem[];
}

export type RawBigModRoot = Record<string, RawBigModFile>;

/** 归一化后的大型 mod(只用展示,不安装) */
export interface BigMod {
  id: string;
  name: string;
  author: string;
  size: string;
  nexusId: string;
  panUrl: string;
  description: string;
}

/** 拉整个 bigmod.json,按 alias 映射成 Record<presetId, BigMod[]>。
 *  一次拉取,内存索引;切换游戏时不需要重新拉网络。 */
export async function fetchBigMods(): Promise<Record<string, BigMod[]>> {
  const raw = (await window.mayfly.fetchRemoteJson({ url: BIGMOD_URL })) as RawBigModRoot;
  const out: Record<string, BigMod[]> = {};
  for (const [topKey, file] of Object.entries(raw)) {
    const presetId = BIGMOD_KEY_ALIAS[topKey];
    if (!presetId) continue; // 未知 key 静默跳过(未来扩展)
    if (!file?.items || !Array.isArray(file.items)) continue;
    out[presetId] = file.items.map((it) => ({
      id: String(it.id),
      name: it.name,
      author: it.Author,
      size: it.size,
      nexusId: it.NexusID,
      panUrl: it.url,
      description: it.description,
    }));
  }
  return out;
}