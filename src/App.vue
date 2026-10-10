<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  Archive,
  ArrowDownToLine,
  CheckCircle2,
  FolderOpen,
  Gamepad2,
  Globe,
  GripVertical,
  HardDrive,
  Info,
  LayoutGrid,
  LoaderCircle,
  List,
  ListTree,
  ScrollText,
  PackageOpen,
  PackagePlus,
  Pause,
  Play,
  RotateCcw,
  ScanSearch,
  Search,
  Settings,
  ShoppingBag,
  SquarePen,
  Trash2,
  Wrench,
  X,
  XCircle,
  ChevronDown,
  ChevronUp,
  Languages,
  Plus,
  User,
  Download,
  Calendar,
  ArrowRight,
  AlertTriangle,
  Folder,
  File,
  BookmarkPlus,
  BookmarkMinus,
  Bookmark,
  Boxes,
  Tags,
  ArrowDownUp,
  Sparkles
} from "lucide-vue-next";
import { useLibraryStore } from "@/stores/library";
import {
  appAlert,
  appConfirm,
  appPrompt,
  closeAlert,
  closeConfirm,
  closePrompt,
  dialogState
} from "@/services/dialog";
import type { CustomAdapterRule, LocalMod, ModUpdateSource } from "@/types/domain";
import FeaturedModList from "@/components/manager/FeaturedModList.vue";
import NexusBrowse from "@/components/manager/NexusBrowse.vue";
import BigModList from "@/components/manager/BigModList.vue";
import HelpView from "@/views/HelpView.vue";
import gamePresetsFromJson from "@/data/game-presets.json";

function getGameName(item: { presetId?: string; id?: string; name: string }) {
  const key = item.presetId || item.id || "";
  const preset = gamePresetsFromJson.find((p: any) => p.id === key);
  return preset?.zhName || item.name;
}

function getGameEnglishName(item: { presetId?: string; id?: string; name: string }) {
  const key = item.presetId || item.id || "";
  const preset = gamePresetsFromJson.find((p: any) => p.id === key);
  return preset?.name || item.name;
}

const library = useLibraryStore();
type AppTab = "games" | "manager" | "download" | "logs" | "backup" | "settings" | "help" | "about";

const activeTab = ref<AppTab>("manager");
const showAddGameModal = ref(false);
// HGMM 减法 Phase 2:高级设置默认折叠,普通用户不展开
const showAdvancedSettings = ref(false);
const showGameInfoModal = ref(false);
const showGameSettingsModal = ref(false);
const showCustomRulesModal = ref(false);
const contextMenu = ref({ visible: false, x: 0, y: 0, gameId: "" });
const draggingModId = ref("");
const dragOverModId = ref("");
const previewImage = ref({ visible: false, url: "", title: "" });
const selectedNexusImageIndex = ref(0);
const modViewMode = ref<"list" | "grid">("grid");
const openDevTools = () => window.mayfly.openDevTools();

const showGameContextMenu = (e: MouseEvent, gameId: string) => {
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    gameId
  };
};

async function selectContextGame() {
  if (!contextMenu.value.gameId) return false;
  await chooseGame(contextMenu.value.gameId);
  contextMenu.value.visible = false;
  return true;
}

async function openContextGameInfo() {
  if (await selectContextGame()) {
    showGameInfoModal.value = true;
  }
}

async function openContextGameSettings() {
  if (await selectContextGame()) {
    showGameSettingsModal.value = true;
  }
}

async function openContextGameCustomRules() {
  if (await selectContextGame()) {
    showCustomRulesModal.value = true;
  }
}

async function launchContextGame() {
  if (await selectContextGame()) {
    await library.launchActiveGame();
  }
}

async function confirmRepair() {
  showRepairModal.value = false;
  await library.repairActiveGame();
}

// HGMM Phase 5:扫描游戏目录,发现用户手动丢入的 mod(打"自定义" tag)
async function scanActiveGameMods() {
  const discovered = await library.scanActiveGameMods();
  if (discovered > 0) {
    showToast(`扫描发现 ${discovered} 个新 mod`, 3000);
  } else {
    showToast("未发现新 mod", 2400);
  }
}

async function openContextGameFolder() {
  if (await selectContextGame()) {
    await openActiveGamePath();
  }
}

const deleteContextGame = async () => {
  const game = library.games.find((item) => item.id === contextMenu.value.gameId);
  if (!game) return;

  if (await appConfirm({
    title: "删除游戏",
    message: `确定要删除游戏“${getGameName(game)}”吗？`
  })) {
    await library.removeGame(game.id);
  }

  contextMenu.value.visible = false;
};

onMounted(() => {
  window.addEventListener("click", () => {
    if (contextMenu.value.visible) {
      contextMenu.value.visible = false;
    }
    openDropdownId.value = "";
  });
});
const editingInstallPath = ref("");
const showPresetPicker = ref(false);
const dragActive = ref(false);
const expandedModId = ref("");
const openDropdownId = ref("");
const editingModId = ref("");
const showModEditModal = ref(false);
const coverUrls = ref<Record<string, string>>({});
const gameCoverUrls = ref<Record<string, string>>({});
// BUG-016 round 1+2(2026-10-04):parentModId 折叠方案,被 round 3 推翻。
//   round 3 让 subFile 不创建 LocalMod 记录 → 根本不需要 UI 折叠。
//   groupedActiveMods computed 保留 export 名(暂无引用可删),但不再有业务用途。
//   模板恢复 v-for="mod in library.activeMods"(round 1+2 改的 nested v-for 也回滚)。
type ModWithChildren = { main: typeof library.activeMods[number]; children: typeof library.activeMods };
const groupedActiveMods = computed<ModWithChildren[]>(() => {
  return library.activeMods.map((main) => ({ main, children: [] }));
});
const showBatchEdit = ref(false);
const showPackageExport = ref(false);
const showCustomGameForm = ref(false);
const selectedDownloadIds = ref<string[]>([]);
const showDownloadDeleteModal = ref(false);
const showDownloadSettingsModal = ref(false);
const batchTypeId = ref("");
const batchVersion = ref("");
const batchAuthor = ref("");
const batchWebsite = ref("");
const batchTags = ref("");
const quickTagName = ref("");
// selectedProfileId moved to library store
const showProfileInput = ref(false);
const newProfileName = ref("");
const packageNameInput = ref("");
const packageAuthorInput = ref("");
const packageVersionInput = ref("");
const packageDescriptionInput = ref("");
const customGameName = ref("");
const customGamePath = ref("");
const customGameExeNames = ref("");
const customGameInstallPath = ref("");
const customGameLaunchArgs = ref("");
const customGameCoverUrl = ref("");
const nexusApiKeyInput = ref("");
const showNexusAuthModal = ref(false);
const showRepairModal = ref(false);
const toastMessage = ref("");

// HGMM 主题对话框状态(服务模块统一管理)
// store / 组件都通过 appConfirm / appPrompt / appAlert 调用,App.vue 负责渲染
const confirmDialog = computed(() => dialogState.value.confirm);
const promptDialog = computed(() => dialogState.value.prompt);
const alertDialog = computed(() => dialogState.value.alert);

const promptInputRef = ref<HTMLInputElement | null>(null);
watch(
  () => promptDialog.value.open,
  (open) => {
    if (open) {
      void nextTick(() => {
        promptInputRef.value?.focus();
        promptInputRef.value?.select();
      });
    }
  }
);

let toastTimer: number | undefined;
const customDownloadUrl = ref("");
const customDownloadName = ref("");
const backupName = ref("");
const customRuleName = ref("");
const customRuleDetectKind = ref<CustomAdapterRule["detect"]["kind"]>("always");
const customRuleDetectValue = ref("");
const customRuleInstallKind = ref<"general" | "folderRoot" | "folder" | "file" | "fileSibling" | "manual">("general");
const customRuleInstallPath = ref("");
const customRuleInstallName = ref("");
const customRuleKeepPath = ref(true);
const customRulePreviewSource = ref("");
const customRulePreviewFiles = ref<string[]>([]);
const customRulePreviewLoading = ref(false);
// HGMM(2026-09-29):app 版本号 — 关于页面顶部展示,主进程 IPC 拿
const appVersion = ref("");
const aboutNotice = ref({
  loading: false,
  error: "",
  title: "关于 怀沙模组管理器",
  html: "",
  fetchedAt: 0
});

const storageLabel = computed(
  () => library.settings.storagePath || "还没有选择 Mod 存储路径"
);

const editingMod = computed(() =>
  library.mods.find((mod) => mod.id === editingModId.value) ?? null
);

function previewBaseName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "示例 Mod";
}

const customRulePreview = computed(() => {
  const sourceRoot = previewBaseName(customRulePreviewSource.value);
  const sourceFiles = customRulePreviewFiles.value.length > 0
    ? customRulePreviewFiles.value.slice(0, 80)
    : ["Example.pak", "plugins/example.dll", "textures/example.dds", "README.md"];
  const installPath = customRuleInstallPath.value.trim().replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  const installName = customRuleInstallName.value.trim() || customRuleDetectValue.value.trim() || customRuleName.value.trim() || "匹配目录";
  const cleanFiles = sourceFiles.filter((file) => !/^(README|LICENSE|manifest)\.md$/iu.test(file));
  const targetRoot = installPath || "游戏根目录";
  let targetFiles: string[] = [];
  let strategyText = "复制全部内容";
  let matchedText = customRuleDetectKind.value === "always"
    ? "始终匹配"
    : `${detectKindLabel(customRuleDetectKind.value)}：${customRuleDetectValue.value.trim() || "未填写"}`;

  switch (customRuleInstallKind.value) {
    case "folderRoot":
      strategyText = "复制文件夹根内容";
      targetFiles = cleanFiles.map((file) => `${targetRoot}/${sourceRoot}/${file}`);
      break;
    case "folder":
      strategyText = `匹配文件夹：${installName}`;
      targetFiles = cleanFiles.map((file) => `${targetRoot}/${installName}/${file}`);
      break;
    case "file":
      strategyText = `匹配文件：${installName}`;
      targetFiles = cleanFiles.map((file) => `${targetRoot}/${previewBaseName(file)}`);
      break;
    case "fileSibling":
      strategyText = `匹配文件同级：${installName}`;
      targetFiles = cleanFiles.map((file) => `${targetRoot}/${file}`);
      break;
    case "manual":
      strategyText = "手动安装";
      targetFiles = [];
      break;
    case "general":
    default:
      strategyText = customRuleKeepPath.value ? "复制全部内容并保留目录结构" : "复制全部内容并平铺文件";
      targetFiles = cleanFiles.map((file) =>
        customRuleKeepPath.value ? `${targetRoot}/${file}` : `${targetRoot}/${previewBaseName(file)}`
      );
      break;
  }

  return {
    sourceRoot,
    sourceFiles,
    targetRoot,
    targetFiles,
    strategyText,
    matchedText,
    hasFiles: customRulePreviewFiles.value.length > 0,
    manual: customRuleInstallKind.value === "manual"
  };
});

function toggleDropdown(id: string) {
  openDropdownId.value = openDropdownId.value === id ? "" : id;
}

function closeDropdown() {
  openDropdownId.value = "";
}

function typeFilterLabel() {
  if (library.selectedTypeId === "all") return "全部类型";
  return library.activeAdapter?.modTypes.find((type) => type.id === library.selectedTypeId)?.name ?? "全部类型";
}

function tagFilterLabel() {
  return library.selectedTag === "all" ? "全部标签" : library.selectedTag;
}

function sortLabel() {
  const labels = {
    custom: "自定义排序",
    createdDesc: "最近导入",
    createdAsc: "最早导入",
    nameAsc: "名称 A-Z",
    nameDesc: "名称 Z-A",
    installedFirst: "已安装优先"
  };

  return labels[library.sortMode];
}

function modTypeLabel(mod: LocalMod) {
  return library.activeAdapter?.modTypes.find((type) => type.id === mod.modTypeId)?.name ?? mod.modTypeName;
}

function modUpdateLabel(mod: LocalMod) {
  if (library.updateCheckingIds.includes(mod.id)) return "检查中";
  const source = mod.updateSource;
  if (!source) return "本地";

  switch (source.check?.status) {
    case "available":
      return "有更新";
    case "latest":
      return "最新";
    case "failed":
      return "失败";
    case "unsupported":
      return "无法检查";
    default:
      return "可检查";
  }
}

function modUpdateTitle(mod: LocalMod) {
  const source = mod.updateSource;
  if (!source) return "本地导入的 Mod 暂不支持自动检查更新";
  if (library.updateCheckingIds.includes(mod.id)) return "正在检查 Nexus 更新";

  return source.check?.message || `Nexus ${source.gameDomain} / Mod ${source.modId}${source.fileId ? ` / File ${source.fileId}` : ""}`;
}

function modUpdateClass(mod: LocalMod) {
  if (library.updateCheckingIds.includes(mod.id)) return "checking";
  return mod.updateSource?.check?.status ?? "unknown";
}

function buildNexusModUrl(gameDomain: string, modId: string, fileId = "") {
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

function parseNexusModUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const match = url.pathname.match(/^\/([^/]+)\/mods\/(\d+)/iu);
    if (!/nexusmods\.com$/iu.test(url.hostname) || !match) return null;

    return {
      gameDomain: match[1],
      modId: match[2],
      fileId: url.searchParams.get("file_id") ?? ""
    };
  } catch {
    return null;
  }
}

function activeNexusGameName(gameDomain: string) {
  return library.nexusPresets.find((preset) => preset.nexusDomain === gameDomain)?.name ??
    library.activeGame?.name ??
    gameDomain;
}

function buildUpdateSourceFromWebsite(mod: LocalMod, website: string, version = mod.version) {
  const parsed = parseNexusModUrl(website);
  if (!parsed) return undefined;

  const currentVersion = version.trim();

  return {
    type: "nexus",
    gameDomain: parsed.gameDomain,
    gameName: activeNexusGameName(parsed.gameDomain),
    modId: parsed.modId,
    fileId: parsed.fileId || mod.updateSource?.fileId || "",
    fileName: mod.updateSource?.fileName || mod.name,
    fileVersion: currentVersion,
    modVersion: currentVersion,
    categoryName: mod.updateSource?.categoryName || "",
    modPageUrl: buildNexusModUrl(parsed.gameDomain, parsed.modId),
    filePageUrl: buildNexusModUrl(parsed.gameDomain, parsed.modId, parsed.fileId || mod.updateSource?.fileId || ""),
    coverImage: mod.coverImage || mod.updateSource?.coverImage,
    downloadedAt: mod.updateSource?.downloadedAt || Date.now()
  } satisfies ModUpdateSource;
}

async function updateModWebsiteFromInput(mod: LocalMod, value: string) {
  const website = value.trim();
  const updateSource = buildUpdateSourceFromWebsite(mod, website);

  await library.updateMod(mod.id, {
    website,
    updateSource,
    updatedAt: Date.now()
  });
}

async function finishModEdit(mod: LocalMod) {
  const updateSource = buildUpdateSourceFromWebsite(mod, mod.website);
  await library.updateMod(mod.id, {
    updateSource,
    updatedAt: Date.now()
  });
  showModEditModal.value = false;
}

async function handleModUpdateClick(mod: LocalMod) {
  if (mod.updateSource?.check?.status === "available") {
    await library.updateNexusMod(mod);
    return;
  }

  await library.checkModUpdate(mod);
}

function detectKindLabel(kind: CustomAdapterRule["detect"]["kind"]) {
  const labels = {
    always: "默认",
    fileName: "文件名",
    extension: "扩展名",
    pathPart: "路径片段"
  };

  return labels[kind];
}

function installKindText(kind: string) {
  const labels: Record<string, string> = {
    general: "复制全部内容",
    folderRoot: "复制文件夹根内容",
    folder: "匹配文件夹",
    file: "匹配文件",
    fileSibling: "匹配文件同级",
    manual: "手动安装"
  };
  return labels[kind] || kind;
}

function installStrategyLabel(strategy: CustomAdapterRule["install"]) {
  switch (strategy.kind) {
    case "folder":
      return `匹配文件夹 ${Array.isArray(strategy.folderName) ? strategy.folderName.join(", ") : strategy.folderName} -> ${strategy.installPath || "游戏根目录"}`;
    case "folderRoot":
      return `文件夹根内容 -> ${strategy.installPath || "游戏根目录"}`;
    case "file":
      return `匹配文件 ${strategy.fileName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "fileSibling":
      return `匹配文件同级 -> ${strategy.installPath || "游戏根目录"}`;
    case "fileOnly":
      return `仅匹配文件 ${strategy.fileName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "folderParent":
      return `匹配父文件夹 ${strategy.folderName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "fileMap":
      return `按字典 ${strategy.dictionaryFile || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "fileIntoParentFolder":
      return `匹配文件进父目录 ${strategy.fileName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "legendPortraits":
      return `头像目录软链 -> ${strategy.installPath || "游戏根目录"}`;
    case "manual":
      return strategy.reason;
    case "general":
      return `全部内容 -> ${strategy.installPath || "游戏根目录"}${strategy.keepPath === false ? "，不保留路径" : ""}`;
    default:
      return "内置安装规则";
  }
}

function customRuleSummary(rule: CustomAdapterRule) {
  const detectValue = rule.detect.kind === "always" ? "" : ` ${rule.detect.value || "*"}`;
  return `${detectKindLabel(rule.detect.kind)}${detectValue} / ${installStrategyLabel(rule.install)}`;
}

function resetCustomRuleForm() {
  customRuleName.value = "";
  customRuleDetectKind.value = "always";
  customRuleDetectValue.value = "";
  customRuleInstallKind.value = "general";
  customRuleInstallPath.value = "";
  customRuleInstallName.value = "";
  customRuleKeepPath.value = true;
  customRulePreviewSource.value = "";
  customRulePreviewFiles.value = [];
}

async function chooseCustomRulePreviewFolder() {
  const selected = await window.mayfly.openDirectory();
  if (!selected) return;

  customRulePreviewLoading.value = true;
  try {
    customRulePreviewSource.value = selected;
    customRulePreviewFiles.value = await window.mayfly.listFiles(selected);
  } catch (caught) {
    library.setError(caught instanceof Error ? caught.message : "读取预览文件夹失败");
    customRulePreviewSource.value = "";
    customRulePreviewFiles.value = [];
  } finally {
    customRulePreviewLoading.value = false;
  }
}

function clearCustomRulePreviewFolder() {
  customRulePreviewSource.value = "";
  customRulePreviewFiles.value = [];
}

async function saveCustomAdapterRule() {
  if (customRuleDetectKind.value !== "always" && !customRuleDetectValue.value.trim()) {
    library.setError("请填写识别值。");
    return;
  }

  await library.addCustomAdapterRule({
    name: customRuleName.value,
    detectKind: customRuleDetectKind.value,
    detectValue: customRuleDetectValue.value,
    installKind: customRuleInstallKind.value,
    installPath: customRuleInstallPath.value,
    installName: customRuleInstallName.value,
    keepPath: customRuleKeepPath.value
  });

  if (!library.error) {
    resetCustomRuleForm();
  }
}

function openModEdit(mod: LocalMod) {
  editingModId.value = mod.id;
  showModEditModal.value = true;
}

async function chooseAria2Executable() {
  const selected = await window.mayfly.openExecutable();
  if (selected) {
    await library.updateSettings({ aria2ExecutablePath: selected });
  }
}

function showToast(message: string, duration = 2600) {
  toastMessage.value = message;
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    toastMessage.value = "";
    toastTimer = undefined;
  }, duration);
}

watch(
  () => library.error,
  (message) => {
    if (!message) return;
    showToast(message, 3800);
  }
);

watch(
  [() => library.activeSubTab, () => library.nexusPresetId],
  async ([tab, presetId], [oldTab, oldPresetId]) => {
    if (tab === "nexus" && presetId) {
      if (presetId !== oldPresetId || library.nexusMods.length === 0) {
        await library.loadNexusMods(1);
      }
    }
  }
);

watch(
  () => activeTab.value,
  (tab) => {
    if (tab === "about") {
      void loadAboutNotice();
    }
  }
);

onMounted(async () => {
  await library.initialize();
  // HGMM(2026-09-29):异步拉 app 版本号(关于页面顶部展示),失败不阻塞启动
  void window.mayfly.getAppVersion()
    .then((v) => { appVersion.value = v; })
    .catch((err: unknown) => {
      console.warn("[app] getAppVersion failed:", err);
      appVersion.value = "unknown";
    });
  activeTab.value = library.settings.defaultTab === "backup" || library.settings.defaultTab === "nexus"
    ? "manager"
    : library.settings.defaultTab;
  editingInstallPath.value = library.activeGame?.installPath ?? "";
  nexusApiKeyInput.value = library.settings.nexusApiKey;
  if (activeTab.value === "about") {
    void loadAboutNotice();
  }
  window.mayfly.onNxmOpen((url) => {
    activeTab.value = "manager";
    library.setActiveSubTab("nexus");
    void library.handleNxmUrl(url);
  });

  window.addEventListener("error", (event) => {
    void library.recordLog(
      "error",
      "renderer",
      event.message || "前端运行错误",
      `${event.filename || ""}:${event.lineno || 0}:${event.colno || 0}\n${event.error?.stack || ""}`.trim()
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error
      ? `${event.reason.message}\n${event.reason.stack || ""}`
      : String(event.reason || "");
    void library.recordLog("error", "promise", "未处理的异步错误", reason);
  });
});

watch(
  () => library.activeMods.map((mod) => [mod.id, mod.rootPath, mod.coverImage].join("|")),
  async () => {
    const nextCoverUrls: Record<string, string> = {};

    for (const mod of library.activeMods) {
      const coverImage = mod.coverImage.trim();
      if (!coverImage) continue;

      if (/^https?:\/\//iu.test(coverImage)) {
        nextCoverUrls[mod.id] = coverImage;
        continue;
      }

      try {
        nextCoverUrls[mod.id] = await window.mayfly.fileUrl(
          `${mod.rootPath}\\${coverImage.replace(/[\\/]+/gu, "\\")}`
        );
      } catch {
        // Keep the Mod row usable when an old local preview file is missing.
      }
    }

    coverUrls.value = nextCoverUrls;
  },
  { immediate: true }
);

watch(
  () => library.games.map((game) => [game.id, game.coverUrl].join("|")),
  async () => {
    for (const game of library.games) {
      if (!game.coverUrl || gameCoverUrls.value[game.id]) continue;

      gameCoverUrls.value = {
        ...gameCoverUrls.value,
        [game.id]: /^https?:\/\//i.test(game.coverUrl)
          ? game.coverUrl
          : await window.mayfly.fileUrl(game.coverUrl)
      };
    }
  },
  { immediate: true }
);

watch(
  () => library.settings.nexusApiKey,
  (apiKey) => {
    nexusApiKeyInput.value = apiKey;
  }
);

async function chooseGame(gameId: string) {
  await library.setActiveGame(gameId);
  editingInstallPath.value = library.activeGame?.installPath ?? "";
}

async function addCustomGame() {
  showCustomGameForm.value = !showCustomGameForm.value;
  showPresetPicker.value = false;
}

async function saveInstallPath() {
  if (!library.activeGame) return;
  await library.updateGame(library.activeGame.id, {
    installPath: editingInstallPath.value.trim()
  });
}

async function openActiveGamePath() {
  if (!library.activeGame) return;
  await window.mayfly.openPath(library.activeGame.path);
}

async function openGamePath(path: string) {
  if (!path) return;
  await window.mayfly.openPath(path);
}

async function openStoragePath() {
  if (!library.settings.storagePath) return;
  await window.mayfly.openPath(library.settings.storagePath);
}

function formatFiles(mod: LocalMod) {
  if (mod.files.length === 0) return "没有扫描到文件";
  if (mod.files.length === 1) return mod.files[0];
  return `${mod.files[0]} 等 ${mod.files.length} 个文件`;
}

async function changeModType(mod: LocalMod, typeId: string) {
  if (mod.modTypeId === typeId) return;
  if (library.busy) return;
  
  const type = library.activeAdapter?.modTypes.find((item) => item.id === typeId);
  try {
    if (mod.installed) {
      await library.uninstallMod(mod);
      await library.updateMod(mod.id, {
        modTypeId: typeId,
        modTypeName: type?.name ?? mod.modTypeName,
        updatedAt: Date.now()
      });
      const updatedMod = library.mods.find((m) => m.id === mod.id);
      if (updatedMod) {
        await library.installMod(updatedMod);
      }
    } else {
      await library.updateMod(mod.id, {
        modTypeId: typeId,
        modTypeName: type?.name ?? mod.modTypeName,
        updatedAt: Date.now()
      });
    }
  } catch (err: any) {
    showToast(err.message || "切换类型失败");
  }
}

function splitTags(value: string) {
  return value
    .split(/[,，\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCommaList(value: string) {
  return value
    .split(/[,，\n\r]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeInlineStyle(styleText: string) {
  if (/url\s*\(|expression\s*\(|javascript:|behavior\s*:|@import/iu.test(styleText)) {
    return "";
  }

  const allowed = new Set([
    "color",
    "background",
    "background-color",
    "font-weight",
    "font-style",
    "text-decoration",
    "text-align",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border",
    "border-radius",
    "box-shadow",
    "display",
    "font-size",
    "letter-spacing",
    "line-height"
  ]);

  return styleText
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const [name] = part.split(":");
      return allowed.has((name || "").trim().toLowerCase());
    })
    .join("; ");
}

function isAllowedExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeRemoteHtml(html: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return "";

  const allowedTags = new Set([
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul"
  ]);

  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();

    if (["script", "style", "iframe", "object", "embed", "form", "input", "button", "meta", "link"].includes(tagName)) {
      element.remove();
      continue;
    }

    if (!allowedTags.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (tagName === "a" && name === "href" && isAllowedExternalUrl(value)) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noreferrer noopener");
        continue;
      }

      if (tagName === "img" && name === "src" && /^https?:\/\//iu.test(value)) {
        continue;
      }

      if (["alt", "title"].includes(name)) {
        continue;
      }

      if (name === "style") {
        const nextStyle = sanitizeInlineStyle(value);
        if (nextStyle) {
          element.setAttribute("style", nextStyle);
        } else {
          element.removeAttribute("style");
        }
        continue;
      }

      element.removeAttribute(attribute.name);
    }
  }

  return root.innerHTML.trim();
}

async function loadAboutNotice(force = false) {
  if (aboutNotice.value.loading) return;
  if (!force && aboutNotice.value.html && Date.now() - aboutNotice.value.fetchedAt < 10 * 60 * 1000) {
    return;
  }

  aboutNotice.value = {
    ...aboutNotice.value,
    loading: true,
    error: ""
  };

  try {
    // 怀沙:从远程拉取关于页面公告 HTML(main 端 fetch,免去 asar 路径分裂)
    const rawHtml = await window.mayfly.getAboutNotice();
    const html = sanitizeRemoteHtml(rawHtml);

    aboutNotice.value = {
      loading: false,
      error: html ? "" : "本地公告内容为空。",
      title: "关于 怀沙模组管理器",
      html,
      fetchedAt: Date.now()
    };
  } catch (caught) {
    aboutNotice.value = {
      ...aboutNotice.value,
      loading: false,
      error: caught instanceof Error ? caught.message : "读取本地公告失败"
    };
  }
}

async function handleAboutContentClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[href]") as HTMLAnchorElement | null;
  if (!link) return;

  const href = link.getAttribute("href") || "";
  if (!isAllowedExternalUrl(href)) return;

  event.preventDefault();
  await window.mayfly.openExternal(href);
}

function dirName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  const prefix = /^[a-z]:/i.test(parts[0] ?? "") ? "" : "/";
  return `${prefix}${parts.join("/")}`.replace(/\//g, "\\");
}

function tagColor(tag: string) {
  return library.settings.tagColors[tag] || "var(--c-accent)";
}

async function chooseCustomGamePath() {
  const selected = await window.mayfly.openDirectory();
  if (!selected) return;

  customGamePath.value = selected;
  if (!customGameName.value.trim()) {
    customGameName.value = selected.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  }
}

async function chooseCustomGameExe() {
  const selected = await window.mayfly.openExecutable();
  if (!selected) return;

  const exeName = selected.replace(/\\/g, "/").split("/").pop() ?? "";
  customGamePath.value = dirName(selected);
  customGameExeNames.value = [...new Set([...splitCommaList(customGameExeNames.value), exeName])].join(", ");

  if (!customGameName.value.trim()) {
    customGameName.value = exeName.replace(/\.exe$/i, "");
  }
}

async function chooseCustomGameCover() {
  const selected = await window.mayfly.openImage();
  if (!selected) return;
  customGameCoverUrl.value = selected;
}

async function chooseActiveGameCover() {
  if (!library.activeGame) return;
  const selected = await window.mayfly.openImage();
  if (!selected) return;

  gameCoverUrls.value = {
    ...gameCoverUrls.value,
    [library.activeGame.id]: await window.mayfly.fileUrl(selected)
  };
  await library.updateGame(library.activeGame.id, { coverUrl: selected });
}

async function createCustomGameFromForm() {
  if (!customGamePath.value.trim()) {
    library.setError("请先选择自定义游戏目录或 exe。");
    return;
  }

  await library.addCustomGameFromInput({
    name: customGameName.value,
    path: customGamePath.value,
    exeNames: splitCommaList(customGameExeNames.value),
    installPath: customGameInstallPath.value,
    launchArgs: customGameLaunchArgs.value,
    coverUrl: customGameCoverUrl.value
  });
  editingInstallPath.value = library.activeGame?.installPath ?? "";
  customGameName.value = "";
  customGamePath.value = "";
  customGameExeNames.value = "";
  customGameInstallPath.value = "";
  customGameLaunchArgs.value = "";
  customGameCoverUrl.value = "";
  showCustomGameForm.value = false;
}

async function applyBatchEdit() {
  const patch: Parameters<typeof library.updateSelectedMods>[0] = {};

  if (batchTypeId.value) {
    const type = library.activeAdapter?.modTypes.find((item) => item.id === batchTypeId.value);
    patch.modTypeId = batchTypeId.value;
    patch.modTypeName = type?.name ?? batchTypeId.value;
  }

  if (batchVersion.value.trim()) patch.version = batchVersion.value.trim();
  if (batchAuthor.value.trim()) patch.author = batchAuthor.value.trim();
  if (batchWebsite.value.trim()) patch.website = batchWebsite.value.trim();
  if (batchTags.value.trim()) patch.appendTags = splitTags(batchTags.value);

  await library.updateSelectedMods(patch);
  batchTypeId.value = "";
  batchVersion.value = "";
  batchAuthor.value = "";
  batchWebsite.value = "";
  batchTags.value = "";
  showBatchEdit.value = false;
}

async function handleCreateProfileFromBatch() {
  const name = newProfileName.value.trim();
  if (!name) return;
  
  const count = library.selectedMods.length;
  const profile = await library.createModProfile(name);
  if (profile) {
    showToast(`成功创建方案 "${profile.name}" 并存入 ${count} 个 Mod`);
    library.clearSelection();
  }
  newProfileName.value = "";
}

async function handleAddToProfile(profileId: string, profileName: string) {
  const count = library.selectedMods.length;
  const success = await library.addSelectedModsToProfile(profileId);
  if (success) {
    showToast(`成功将 ${count} 个 Mod 存入方案 "${profileName}"`);
  }
  closeDropdown();
}

async function handleRemoveFromProfile(profileId: string) {
  const profile = library.activeProfiles.find((item) => item.id === profileId);
  const profileName = profile ? profile.name : "";
  const count = library.selectedMods.length;
  const success = await library.removeSelectedModsFromProfile(profileId);
  if (success) {
    showToast(`已将 ${count} 个 Mod 从方案 "${profileName}" 中移出`);
  }
}

async function addQuickTagToSelected() {
  const tags = splitTags(quickTagName.value);
  if (tags.length === 0) return;

  if (library.selectedMods.length === 0) {
    library.setError("请先勾选要添加分类标签的 Mod。");
    return;
  }

  const count = library.selectedMods.length;
  await library.updateSelectedMods({ appendTags: tags });
  showToast(`成功为 ${count} 个 Mod 添加标签`);
  quickTagName.value = "";
}

async function exportSelectedPackage() {
  await library.exportModsToPackage({
    targetMods: library.selectedMods,
    name: packageNameInput.value,
    author: packageAuthorInput.value,
    version: packageVersionInput.value,
    description: packageDescriptionInput.value
  });

  if (!library.error) {
    showPackageExport.value = false;
    packageNameInput.value = "";
    packageAuthorInput.value = "";
    packageVersionInput.value = "";
    packageDescriptionInput.value = "";
  }
}

function toggleModDetails(modId: string) {
  expandedModId.value = expandedModId.value === modId ? "" : modId;
}

function visibleDeployedFiles(mod: LocalMod) {
  return mod.deployedFiles.slice(0, 80);
}

function visiblePlanFiles(mod: LocalMod) {
  return (library.installPlans[mod.id]?.targetFiles ?? []).slice(0, 80);
}

function formatBytes(size: number | undefined) {
  if (!size) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function formatDate(value: string | number) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN");
}

function visibleBackupTreeEntries(backupId: string) {
  const entries = library.backupContents[backupId] ?? [];
  const folders = new Set<string>();

  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();

    for (let index = 1; index <= parts.length; index += 1) {
      folders.add(parts.slice(0, index).join("/"));
    }
  }

  const folderEntries = [...folders].map((path) => ({
    path,
    isDirectory: true,
    size: 0
  }));
  const allEntries = [...folderEntries, ...entries]
    .sort((left, right) => {
      const leftParts = left.path.split("/");
      const rightParts = right.path.split("/");
      const parentCompare = leftParts.slice(0, -1).join("/").localeCompare(rightParts.slice(0, -1).join("/"), "zh-CN");
      if (parentCompare !== 0) return parentCompare;
      if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
      return leftParts.at(-1)!.localeCompare(rightParts.at(-1)!, "zh-CN");
    })
    .map((entry) => {
      const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
      return {
        ...entry,
        name: parts.at(-1) ?? entry.path,
        depth: Math.max(0, parts.length - 1)
      };
    });

  return allEntries.slice(0, 200);
}

function sanitizeNexusHtml(html: string) {
  if (!html) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, form").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on") || value.startsWith("javascript:")) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return doc.body.innerHTML;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeLink(url: string) {
  const normalized = url.replace(/&amp;/g, "&").trim();
  return /^https?:\/\//i.test(normalized) ? escapeHtml(normalized) : "";
}

function renderNexusBbCode(value: string) {
  let html = escapeHtml(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br />")
    .replace(/&lt;\/?(?:p|div)&gt;/gi, "<br />")
    .replace(/\[\/?(?:size|font|center|left|right|color|quote)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[(?:br|hr)\s*\/?\]/gi, "<br />")
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<span class=\"bbUnderline\">$1</span>")
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_match, url: string) => {
      const href = safeLink(url);
      return href ? `<img src="${href}" alt="" />` : "";
    })
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url: string, label: string) => {
      const href = safeLink(url);
      return href ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : label;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_match, url: string) => {
      const href = safeLink(url);
      return href ? `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>` : url;
    })
    .replace(/\[\*\]/g, "<br />• ")
    .replace(/\[\/?list(?:=[^\]]*)?\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n/g, "<br />");

  html = html.replace(/(?:<br \/>){3,}/g, "<br /><br />");
  return sanitizeNexusHtml(html);
}

function renderNexusDescription(value: string, format: string) {
  if (!value) return "暂无说明。";
  return /\[[a-z*]+(?:=[^\]]+)?\]/i.test(value)
    ? renderNexusBbCode(value)
    : sanitizeNexusHtml(format === "html" ? value : escapeHtml(value).replace(/\n/g, "<br />"));
}

function openPreviewImage(url: string, title: string) {
  if (!url) return;
  previewImage.value = { visible: true, url, title };
}

function beginModDrag(mod: LocalMod) {
  if (!library.canReorderMods) {
    library.setError("拖拽排序前请先清空搜索、类型和标签筛选。");
    return;
  }

  draggingModId.value = mod.id;
}

async function dropModOn(target: LocalMod) {
  if (!draggingModId.value) return;
  await library.reorderActiveMods(draggingModId.value, target.id);
  draggingModId.value = "";
  dragOverModId.value = "";
}

function downloadStatusText(status: string) {
  const map: Record<string, string> = {
    queued: "排队中",
    downloading: "下载中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    external: "网页下载"
  };

  return map[status] ?? status;
}

function logTime(value: number) {
  return new Date(value).toLocaleString("zh-CN");
}

async function saveAndValidateNexusApiKey() {
  await library.saveNexusApiKey(nexusApiKeyInput.value);
  const user = await library.validateNexusApiKey();
  if (user) {
    showToast(`Nexus API Key 已校验：${user.name || "已授权"}`);
  }
}

async function confirmCreateProfile() {
  if (!newProfileName.value.trim()) return;
  const profile = await library.createModProfile(newProfileName.value.trim());
  if (profile) {
    library.selectedProfileId = profile.id;
  }
  showProfileInput.value = false;
  newProfileName.value = "";
}

async function saveCurrentModProfile() {
  if (!library.selectedProfileId) return;
  await library.saveModProfile(library.selectedProfileId);
}

async function applySelectedModProfile() {
  const profile = library.activeProfiles.find((item) => item.id === library.selectedProfileId);
  if (!profile) return;

  if (await appConfirm({
    title: "应用配置档案",
    message: `确定应用“${profile.name}”吗？当前启用状态会切换为该档案。`,
    danger: false,
    confirmText: "应用"
  })) {
    await library.applyModProfile(profile.id);
  }
}

async function renameSelectedModProfile() {
  const profile = library.activeProfiles.find((item) => item.id === library.selectedProfileId);
  if (!profile) return;

  const name = await appPrompt({
    title: "重命名配置档案",
    message: "请输入新的配置档案名称",
    defaultValue: profile.name,
    confirmText: "重命名"
  });
  if (name === null) return;
  const trimmed = name.trim();
  if (trimmed && trimmed !== profile.name) {
    await library.renameModProfile(profile.id, trimmed);
  }
}

async function removeSelectedModProfile() {
  const profile = library.activeProfiles.find((item) => item.id === library.selectedProfileId);
  if (!profile) return;

  if (await appConfirm({
    title: "删除配置档案",
    message: `确定删除配置档案“${profile.name}”吗？不会删除 Mod。`
  })) {
    await library.removeModProfile(profile.id);
    library.selectedProfileId = "";
  }
}

async function loginNexusWithBrowser() {
  const user = await library.loginNexusWithBrowser();
  if (user) {
    showToast(`Nexus 网页登录成功：${user.name || "已授权"}`);
  }
}

async function startCustomDownload() {
  await library.downloadCustomUrl(customDownloadUrl.value, customDownloadName.value);
  if (!library.error) {
    customDownloadUrl.value = "";
    customDownloadName.value = "";
    showToast("已成功创建自定义下载任务");
  }
}

async function createBackup() {
  await library.createActiveGameBackup(backupName.value);
  if (!library.error) {
    backupName.value = "";
  }
}

async function confirmRestoreBackup(backup: (typeof library.backups)[number]) {
  const confirmed = await appConfirm({
    title: "恢复备份",
    message: `确定恢复备份“${backup.name}”吗？这会把备份内容写回游戏目录。`,
    danger: false,
    confirmText: "恢复"
  });
  if (!confirmed) return;
  await library.restoreBackup(backup);
}

async function confirmRemoveBackup(backup: (typeof library.backups)[number]) {
  const removeFile = await appConfirm({
    title: "删除备份记录",
    message: `删除备份记录“${backup.name}”吗？点击“确定”会同时删除 zip 文件。`,
    confirmText: "删除并删除文件"
  });
  await library.removeBackup(backup, removeFile);
}

function conflictCount(mod: LocalMod) {
  return library.installPlans[mod.id]?.conflicts.length ?? 0;
}

async function previewModInstallPlan(mod: LocalMod) {
  expandedModId.value = mod.id;
  await library.previewInstallPlan(mod);
}

async function dropLocalMods(event: DragEvent) {
  dragActive.value = false;
  if (draggingModId.value) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  const paths = files.map((file) => window.mayfly.getPathForFile(file)).filter(Boolean);

  if (paths.length === 0) {
    library.setError("没有读取到拖拽文件路径，请改用“导入 Mod”按钮选择文件或文件夹。");
    return;
  }

  await library.importLocalModsFromPaths(paths);
}

async function confirmRemoveActiveGame() {
  if (!library.activeGame) return;

  const confirmed = await appConfirm({
    title: "移除游戏",
    message: `确定移除游戏“${getGameName(library.activeGame)}”吗？这会同时移除该游戏的本地 Mod 记录。`
  });
  if (!confirmed) return;

  await library.removeGame(library.activeGame.id);
}

async function confirmRemoveMod(mod: LocalMod) {
  const message = mod.installed
    ? `确定删除“${mod.name}”吗？它当前已安装，会先卸载游戏目录里的部署文件，再删除本地缓存。`
    : `确定删除“${mod.name}”的本地缓存和记录吗？`;

  if (!await appConfirm({
    title: "删除 Mod",
    message,
    confirmText: "删除"
  })) return;
  await library.removeMod(mod);
}

async function confirmUninstallMod(mod: LocalMod) {
  if (mod.deployedFiles.length === 0) {
    const confirmed = await appConfirm({
      title: "卸载 Mod",
      message: `“${mod.name}”没有部署文件记录，将按当前安装规则匹配并删除文件。确定继续卸载吗？`,
      confirmText: "卸载"
    });
    if (!confirmed) return;
  }

  await library.uninstallMod(mod);
}

async function confirmUninstallSelectedMods() {
  const legacyCount = library.selectedMods.filter(
    (mod) => mod.installed && mod.deployedFiles.length === 0
  ).length;

  if (legacyCount > 0) {
    const confirmed = await appConfirm({
      title: "批量卸载 Mod",
      message: `选中的 Mod 中有 ${legacyCount} 个没有部署文件记录，将按当前安装规则卸载。确定继续吗？`,
      confirmText: "卸载"
    });
    if (!confirmed) return;
  }

  await library.uninstallSelectedMods();
}

async function openModCache(mod: LocalMod) {
  await window.mayfly.openPath(mod.rootPath);
}

async function confirmRemoveSelectedMods() {
  const installedCount = library.selectedMods.filter((mod) => mod.installed).length;
  const suffix = installedCount > 0
    ? `其中 ${installedCount} 个已安装，会先卸载部署文件。`
    : "这会删除它们的本地缓存和记录。";

  if (!await appConfirm({
    title: "批量删除 Mod",
    message: `确定批量删除 ${library.selectedMods.length} 个 Mod 吗？${suffix}`,
    confirmText: "删除"
  })) return;
  await library.removeSelectedMods();
}

const selectedDownloads = computed(() =>
  library.activeDownloads.filter((task) => selectedDownloadIds.value.includes(task.id))
);

function toggleDownloadSelection(taskId: string) {
  selectedDownloadIds.value = selectedDownloadIds.value.includes(taskId)
    ? selectedDownloadIds.value.filter((id) => id !== taskId)
    : [...selectedDownloadIds.value, taskId];
}

function toggleAllDownloads() {
  const taskIds = library.activeDownloads.map((task) => task.id);
  selectedDownloadIds.value = selectedDownloadIds.value.length === taskIds.length
    ? []
    : taskIds;
}

function requestRemoveDownloads(taskIds: string[]) {
  const validIds = taskIds.filter((id) => library.activeDownloads.some((task) => task.id === id));
  if (validIds.length === 0) return;

  selectedDownloadIds.value = [...new Set(validIds)];
  showDownloadDeleteModal.value = true;
}

async function confirmRemoveDownloads(removeFiles: boolean) {
  const ids = [...selectedDownloadIds.value];
  showDownloadDeleteModal.value = false;
  selectedDownloadIds.value = [];
  await library.removeDownloadTasks(ids, removeFiles);
}

function batchDownloadIds() {
  return selectedDownloadIds.value.length > 0
    ? [...selectedDownloadIds.value]
    : library.activeDownloads.map((task) => task.id);
}

async function pauseDownloadBatch() {
  await library.pauseDownloadTasks(batchDownloadIds());
}

async function resumeDownloadBatch() {
  await library.resumeDownloadTasks(batchDownloadIds());
}
</script>

<template>
  <div class="shell" :class="`theme-${library.settings.theme}`">
    <div class="steam-toast-container">
      <div v-if="toastMessage" class="steam-toast info">
        <Info :size="16" class="toast-icon" />
        <div class="toast-content">
          <span>{{ toastMessage }}</span>
        </div>
      </div>
      <div v-if="library.error" class="steam-toast error">
        <XCircle :size="16" class="toast-icon" />
        <div class="toast-content">
          <span>{{ library.error }}</span>
          <button v-if="library.error.includes('设置里')" class="secondary toast-action" @click="library.error = ''; activeTab = 'settings'">
            去设置
          </button>
        </div>
        <button class="toast-close" @click="library.error = ''"><X :size="16" /></button>
      </div>
    </div>

    <div v-if="previewImage.visible" class="steam-modal-overlay imagePreviewOverlay" @click.self="previewImage.visible = false">
      <div class="imagePreviewModal">
        <div class="steam-modal-header">
          <span>{{ previewImage.title || "预览图" }}</span>
          <button class="close-btn" @click="previewImage.visible = false">
            <X :size="16" />
          </button>
        </div>
        <img :src="previewImage.url" alt="" />
      </div>
    </div>

    <!-- Steam Style Modal for Nexus Auth -->
    <div v-if="showNexusAuthModal" class="steam-modal-overlay" @click.self="showNexusAuthModal = false">
      <div class="steam-modal">
        <div class="steam-modal-header">
          <span>NexusMods 账户</span>
        </div>
        <div class="steam-modal-content" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <button class="primary" :disabled="library.nexusLoginLoading" @click="loginNexusWithBrowser" style="width: 100%; justify-content: center;">
              {{ library.nexusLoginLoading ? "等待浏览器授权..." : "网页登录 NexusMods" }}
            </button>
            <p style="margin: 8px 0 0; color: var(--c-text-secondary); font-size: 12px;">
              点击后会打开 NexusMods 登录页，授权完成后自动回到软件。
            </p>
            <p style="margin: 4px 0 0; color: var(--c-text-secondary); font-size: 12px;">
              授权 Access Token 有效期约 6 小时，过期后需重新登录。
            </p>
          </div>
          <!-- HGMM 减法 Phase 4:NexusMods 已废弃 Personal API Key 自助申请(2025 后需邮件 support@nexusmods.com 审批),UI 隐藏 -->
          <template v-if="false">
          <div>
            <label style="display: block; margin-bottom: 8px; color: var(--c-text-strong); font-size: 13px; font-weight: 700;">备用 API Key</label>
            <div class="pathPicker" style="display: flex; gap: 8px;">
              <input v-model="nexusApiKeyInput" type="password" placeholder="网页登录失败时再填写" style="flex: 1;" />
              <button class="primary" :disabled="library.busy" @click="saveAndValidateNexusApiKey" style="padding: 0 12px; height: 38px;">保存并校验</button>
              <button class="secondary" :disabled="!library.nexusAuthorized" @click="library.clearNexusAuth" style="padding: 0 12px; height: 38px;">清除</button>
            </div>
          </div>
          </template>
          <div class="nexusUserBox" style="display: grid; gap: 6px; border: 1px solid var(--c-border-subtle); border-radius: 7px; background: var(--c-bg-inset-deep); padding: 10px;">
            <strong style="color: var(--c-text-on-accent);">{{ library.settings.nexusUser?.name || "未登录 NexusMods" }}</strong>
            <span v-if="library.settings.nexusUser" style="color: var(--c-text-secondary); font-size: 12px;">
              {{ library.settings.nexusUser.isPremium ? "Premium" : "Free" }}
              · {{ library.settings.nexusUser.email || "无邮箱信息" }}
            </span>
            <span v-else style="color: var(--c-text-secondary); font-size: 12px;">网页登录成功后即可浏览和下载 NexusMods 内容。</span>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button class="primary" @click="showNexusAuthModal = false">完成</button>
        </div>
      </div>
    </div>

    <div v-if="showRepairModal" class="steam-modal-overlay" @click.self="showRepairModal = false">
      <div class="steam-modal repairModal">
        <div class="steam-modal-header">
          <Wrench :size="16" />
          <span>一键修复</span>
          <button class="close-btn" @click="showRepairModal = false">
            <X :size="18" />
          </button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <p class="repairModalText">
            一键修复会删除当前游戏的所有 mod,包括:游戏目录里的部署文件、前置依赖(UE4SS / BepInEx),以及本地缓存里的 mod 包,清空该游戏的 mod 库记录。修复完成后请去 Steam 验证游戏完整性。
          </p>
          <p class="repairModalHint">
            请先关闭游戏和 Steam,否则正在运行的 mod 文件无法删除。操作不可逆,如需保留某个 mod 请先取消并单独备份。
          </p>
        </div>
        <div class="steam-modal-footer">
          <button class="secondary" :disabled="library.busy" @click="showRepairModal = false">取消</button>
          <button class="dangerAction" :disabled="library.busy" @click="confirmRepair">确认修复</button>
        </div>
      </div>
    </div>

    <div
      v-if="library.appUpdateDialogVisible && library.appUpdateInfo"
      class="steam-modal-overlay"
      @click.self="library.closeAppUpdateDialog"
    >
      <div class="steam-modal appUpdateModal">
        <div class="steam-modal-header">
          <Download :size="16" />
          <span>发现应用更新</span>
          <button
            v-if="!library.appUpdateInfo.forceUpdate"
            class="close-btn"
            @click="library.closeAppUpdateDialog"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <div class="appUpdateVersion">
            <span>当前版本 {{ library.appUpdateCurrentVersion || "未知" }}</span>
            <strong>新版本 {{ library.appUpdateInfo.versionName }}</strong>
          </div>
          <div v-if="library.appUpdateInfo.forceUpdate" class="appUpdateForce">
            这是强制更新版本，需要下载新版后继续使用。
          </div>
          <div class="appUpdateLog">
            <label>更新内容</label>
            <p>{{ library.appUpdateInfo.updateLog || "暂无更新说明。" }}</p>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button
            v-if="!library.appUpdateInfo.forceUpdate"
            class="secondary"
            @click="library.closeAppUpdateDialog"
          >
            稍后
          </button>
          <button class="primary" @click="library.openAppUpdateDownload">
            立即更新
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDownloadDeleteModal" class="steam-modal-overlay" @click.self="showDownloadDeleteModal = false">
      <div class="steam-modal downloadDeleteModal">
        <div class="steam-modal-header">
          <Trash2 :size="16" />
          <span>删除下载任务</span>
          <button class="close-btn" @click="showDownloadDeleteModal = false">
            <X :size="18" />
          </button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <p class="downloadDeleteSummary">
            已选择 <strong>{{ selectedDownloads.length }}</strong> 个下载任务。
            请选择要删除的内容：
          </p>
          <div class="downloadDeleteOptions">
            <button class="secondary" @click="confirmRemoveDownloads(false)">
              <X :size="15" />
              只删除记录
            </button>
            <button class="dangerAction" @click="confirmRemoveDownloads(true)">
              <Trash2 :size="15" />
              删除记录和本地文件
            </button>
          </div>
          <small class="modalHint">删除本地文件只会删除下载任务对应的文件，不会删除已经导入的 Mod 缓存。</small>
        </div>
      </div>
    </div>

    <!-- 怀沙减法 Phase 5(FEATURE-019,2026-10-07):aria2 引擎配置入口已隐藏 — 内置下载够用,把 false 改 true 即可恢复 -->
    <template v-if="false">
      <div v-if="showDownloadSettingsModal" class="steam-modal-overlay" @click.self="showDownloadSettingsModal = false">
        <div class="steam-modal downloadSettingsModal">
          <div class="steam-modal-header">
            <Settings :size="16" />
            <span>下载设置</span>
            <button class="close-btn" @click="showDownloadSettingsModal = false">
              <X :size="18" />
            </button>
          </div>
          <div class="steam-modal-content gameModalContent">
            <label class="modalField">
              下载引擎
              <select
                class="steamSelectBox"
                :value="library.settings.downloadEngine"
                @change="library.updateSettings({ downloadEngine: ($event.target as HTMLSelectElement).value as 'builtin' | 'aria2' })"
              >
                <option value="builtin">内置下载</option>
                <option value="aria2">aria2</option>
              </select>
            </label>

            <template v-if="library.settings.downloadEngine === 'aria2'">
              <label class="modalField">
                aria2c.exe 路径
                <span class="modalHint">不填写时会尝试查找项目资源目录或系统 PATH。</span>
                <div class="pathPicker">
                  <input
                    class="steamInput"
                    :value="library.settings.aria2ExecutablePath"
                    placeholder="请选择 aria2c.exe"
                    @change="library.updateSettings({ aria2ExecutablePath: ($event.target as HTMLInputElement).value.trim() })"
                  />
                  <button class="secondary" @click="chooseAria2Executable">选择</button>
                </div>
              </label>
              <label class="modalField">
                最大连接数
                <span class="modalHint">范围 1 到 16，默认 4；多个任务会进入 aria2 队列并按连接数下载。</span>
                <input
                  class="steamInput"
                  type="number"
                  min="1"
                  max="16"
                  step="1"
                  :value="library.settings.aria2MaxConnections"
                  @change="library.updateSettings({ aria2MaxConnections: Math.max(1, Math.min(16, Number(($event.target as HTMLInputElement).value) || 4)) })"
                />
              </label>
            </template>

            <div class="downloadSettingsNote">
              <Info :size="15" />
              <span>修改后只影响新启动的下载任务，正在下载的任务会继续使用原来的下载引擎。</span>
            </div>
          </div>
          <div class="steam-modal-footer">
            <button class="primary" @click="showDownloadSettingsModal = false">完成</button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="showGameInfoModal && library.activeGame" class="steam-modal-overlay" @click.self="showGameInfoModal = false">
      <div class="steam-modal">
        <div class="steam-modal-header">
          <Info :size="16" />
          <span>游戏信息</span>
          <button class="close-btn" @click="showGameInfoModal = false"><X :size="18" /></button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <div class="gameModalHero">
            <img v-if="gameCoverUrls[library.activeGame.id]" :src="gameCoverUrls[library.activeGame.id]" alt="" />
            <Gamepad2 v-else :size="30" />
            <input
              class="gameNameInput"
              :value="getGameName(library.activeGame)"
              @change="library.updateGame(library.activeGame.id, { name: ($event.target as HTMLInputElement).value.trim() || getGameName(library.activeGame) })"
            />
          </div>
          <div class="gameInfoGrid">
            <label>
              游戏目录
              <span>{{ library.activeGame.path || "未设置" }}</span>
            </label>
            <label>
              EXE
              <span>{{ library.activeGame.exeNames.length ? library.activeGame.exeNames.join(", ") : "未设置" }}</span>
            </label>
            <label>
              Steam
              <span>{{ library.activeGame.steamAppId || "无" }}</span>
            </label>
            <label>
              Nexus
              <span>{{ library.activeGame.nexusDomain || "无" }}</span>
            </label>
            <label>
              适配
              <span>{{ library.activeGame.adapterStatus === "implemented" ? "已接入安装规则" : library.activeGame.adapterStatus === "custom" ? "自定义通用规则" : "通用规则" }}</span>
            </label>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button class="secondary" @click="openActiveGamePath">打开目录</button>
          <button class="primary" @click="showGameInfoModal = false">完成</button>
        </div>
      </div>
    </div>

    <div v-if="showGameSettingsModal && library.activeGame" class="steam-modal-overlay" @click.self="showGameSettingsModal = false">
      <div class="steam-modal">
        <div class="steam-modal-header">
          <Settings :size="16" />
          <span>高级设置</span>
          <button class="close-btn" @click="showGameSettingsModal = false"><X :size="18" /></button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <div class="gameActionGrid">
            <button class="secondary" :disabled="library.busy" @click="library.chooseActiveGamePath">
              <SquarePen :size="16" />
              游戏目录
              <small style="display: block; font-weight: 400; opacity: 0.6; font-size: 11px; margin-top: 2px;">手动指定游戏安装路径</small>
            </button>
            <button class="secondary" :disabled="library.busy" @click="library.chooseActiveGameExecutable">
              选择 exe
              <small style="display: block; font-weight: 400; opacity: 0.6; font-size: 11px; margin-top: 2px;">指定游戏主程序文件</small>
            </button>
          </div>
          <label class="modalField">
            封面图片
            <small style="font-weight: 400; opacity: 0.6; margin-left: 6px;">粘贴网址或选择本地图片</small>
            <div style="display: flex; gap: 8px;">
              <input
                :value="library.activeGame.coverUrl"
                placeholder="输入网络图片地址 (如 http://...)"
                @change="library.updateGame(library.activeGame.id, { coverUrl: ($event.target as HTMLInputElement).value })"
                style="flex: 1;"
              />
              <button class="secondary" :disabled="library.busy" @click="chooseActiveGameCover" style="white-space: nowrap; padding: 0 16px;">
                选择图片
              </button>
            </div>
          </label>
          <label class="modalField">
            启动参数
            <small style="font-weight: 400; opacity: 0.6; margin-left: 6px;">启动游戏时附加的命令行参数</small>
            <input
              :value="library.activeGame.launchArgs"
              placeholder="例如 -windowed 或 --skip-launcher"
              @change="library.updateGame(library.activeGame.id, { launchArgs: ($event.target as HTMLInputElement).value })"
            />
          </label>
          
          <div v-if="library.settings.debugMode" class="typeStrip">
            <span v-for="type in library.activeAdapter?.modTypes ?? []" :key="type.id">
              {{ type.name }}
            </span>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button class="primary" @click="showGameSettingsModal = false">完成</button>
        </div>
    </div>
    </div>

    <div v-if="showCustomRulesModal && library.activeGame" class="steam-modal-overlay" @click.self="showCustomRulesModal = false">
      <div class="steam-modal" style="width: 760px; max-width: 95vw;">
        <div class="steam-modal-header">
          <Wrench :size="16" />
          <span>自定义适配规则</span>
          <button class="close-btn" @click="showCustomRulesModal = false"><X :size="18" /></button>
        </div>
        <div class="steam-modal-content gameModalContent" style="padding-top: 16px;">
          <div class="customAdapterPanel">
            <div class="customAdapterHeader">
              <strong>自定义 adapter</strong>
              <span>{{ library.activeGame.customAdapterRules.length }} 条规则</span>
            </div>
            <div v-if="library.activeGame.customAdapterRules.length === 0" class="customAdapterEmpty">
              当前使用内置规则。
            </div>
            <div v-else class="customAdapterRuleList">
              <article
                v-for="rule in library.activeGame.customAdapterRules"
                :key="rule.id"
                class="customAdapterRuleItem"
              >
                <div>
                  <strong>{{ rule.name }}</strong>
                  <span>{{ customRuleSummary(rule) }}</span>
                </div>
                <button class="danger iconOnly" :disabled="library.busy" title="删除规则" @click="library.removeCustomAdapterRule(rule.id)">
                  <Trash2 :size="14" />
                </button>
              </article>
            </div>
            <div class="customAdapterForm">
              <div class="customAdapterHelp" style="background: rgba(102, 192, 244, 0.1); border-left: 3px solid var(--c-accent); padding: 10px 14px; margin-bottom: 16px; font-size: 12.5px; color: var(--c-text-secondary); line-height: 1.6; border-radius: 0 4px 4px 0;">
                <strong style="color: var(--c-text-on-accent); margin-bottom: 4px; display: block;">🤔 如何使用自定义规则？</strong>
                当管理器内置规则无法正确安装某些特殊 Mod 时，你可以自己编写规则。<br>
                比如：当 Mod 包含 <code style="background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px; color: var(--c-text-strong);">.pak</code> 文件时，指定把它复制到 <code style="background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px; color: var(--c-text-strong);">Mods/</code> 目录下。<br>
                你可以点击下方的 <b>选择示例 Mod 文件夹</b>，选中一个下载好的解压后的 Mod，管理器会自动在下方预览该规则将会如何搬运文件，确认无误后再点击添加。
              </div>
              <div class="modalTwoCols">
                <label class="modalField">
                  类型名称
                  <input v-model="customRuleName" placeholder="例如 PAK / BepInEx / Mods" />
                </label>
                <label class="modalField">
                  安装目录
                  <input v-model="customRuleInstallPath" placeholder="相对游戏根目录，留空为根目录" />
                </label>
              </div>
              <div class="modalTwoCols">
                <label class="modalField">
                  识别方式
                  <div class="steamSelect" @click.stop style="position: relative; width: 100%;">
                    <button
                      class="secondary"
                      @click="toggleDropdown('modal-detect-kind')"
                      style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; color: var(--c-text-strong); font-size: 13px;"
                    >
                      <span>{{ detectKindLabel(customRuleDetectKind) }}</span>
                      <ChevronDown :size="14" style="opacity: 0.7;" />
                    </button>
                    <div v-if="openDropdownId === 'modal-detect-kind'" class="steamSelectMenu" style="width: 100%; top: calc(100% + 4px); padding: 4px; z-index: 10; background: var(--c-border-strong); border: 1px solid #000; box-shadow: 0 4px 16px rgba(0,0,0,0.5); box-sizing: border-box;">
                      <button v-for="(label, key) in { always: '默认', fileName: '文件名', extension: '扩展名', pathPart: '路径片段' }" :key="key" @click="customRuleDetectKind = key; closeDropdown()" style="text-align: left; padding: 8px 12px; border-radius: 4px; width: 100%;">
                        {{ label }}
                      </button>
                    </div>
                  </div>
                </label>
                <label class="modalField">
                  识别值
                  <input v-model="customRuleDetectValue" :disabled="customRuleDetectKind === 'always'" placeholder="pak / BepInEx / winhttp.dll" />
                </label>
              </div>
              <div class="modalTwoCols">
                <label class="modalField">
                  安装方式
                  <div class="steamSelect" @click.stop style="position: relative; width: 100%;">
                    <button
                      class="secondary"
                      @click="toggleDropdown('modal-install-kind')"
                      style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; color: var(--c-text-strong); font-size: 13px;"
                    >
                      <span>{{ installKindText(customRuleInstallKind) }}</span>
                      <ChevronDown :size="14" style="opacity: 0.7;" />
                    </button>
                    <div v-if="openDropdownId === 'modal-install-kind'" class="steamSelectMenu" style="width: 100%; top: calc(100% + 4px); padding: 4px; z-index: 10; background: var(--c-border-strong); border: 1px solid #000; box-shadow: 0 4px 16px rgba(0,0,0,0.5); box-sizing: border-box;">
                      <button v-for="(label, key) in { general: '复制全部内容', folderRoot: '复制文件夹根内容', folder: '匹配文件夹', file: '匹配文件', fileSibling: '匹配文件同级', manual: '手动安装' }" :key="key" @click="customRuleInstallKind = key; closeDropdown()" style="text-align: left; padding: 8px 12px; border-radius: 4px; width: 100%;">
                        {{ label }}
                      </button>
                    </div>
                  </div>
                </label>
                <label class="modalField">
                  匹配名称
                  <input v-model="customRuleInstallName" :disabled="customRuleInstallKind === 'general' || customRuleInstallKind === 'folderRoot' || customRuleInstallKind === 'manual'" placeholder="默认使用识别值" />
                </label>
              </div>
              <div class="customAdapterFooter">
                <label class="inlineCheck">
                  <input v-model="customRuleKeepPath" type="checkbox" :disabled="customRuleInstallKind !== 'general'" />
                  保留原目录结构
                </label>
                <button class="primary" :disabled="library.busy" @click="saveCustomAdapterRule">
                  添加规则
                </button>
              </div>
            </div>
            <div class="ruleSimulator">
              <div class="ruleSimulatorHeader">
                <div>
                  <strong>规则模拟预览</strong>
                  <span>只在界面模拟文件落位，不会修改游戏文件</span>
                </div>
                <div class="compactActions">
                  <button class="secondary" :disabled="customRulePreviewLoading" @click="chooseCustomRulePreviewFolder">
                    <FolderOpen :size="14" />
                    {{ customRulePreviewLoading ? "读取中..." : "选择示例 Mod 文件夹" }}
                  </button>
                  <button v-if="customRulePreviewFiles.length > 0" class="secondary" @click="clearCustomRulePreviewFolder">
                    清除示例
                  </button>
                </div>
              </div>
              <div class="ruleSimulatorFlow">
                <section class="ruleFolderPane">
                  <div class="rulePaneTitle">
                    <Folder :size="15" />
                    <span>Mod 文件夹</span>
                  </div>
                  <strong class="ruleFolderName">{{ customRulePreview.sourceRoot }}</strong>
                  <div class="ruleFileTree">
                    <div v-for="file in customRulePreview.sourceFiles" :key="`source-${file}`" class="ruleFileRow">
                      <File :size="13" />
                      <span>{{ file }}</span>
                    </div>
                  </div>
                  <small v-if="!customRulePreview.hasFiles">当前显示的是示例文件，选择文件夹后会替换为实际文件名。</small>
                </section>
                <div class="ruleSimulatorArrow">
                  <ArrowRight :size="22" />
                  <span>按规则处理</span>
                </div>
                <section class="ruleFolderPane ruleTargetPane">
                  <div class="rulePaneTitle">
                    <FolderOpen :size="15" />
                    <span>游戏目录</span>
                  </div>
                  <strong class="ruleFolderName">{{ customRulePreview.targetRoot }}</strong>
                  <div class="ruleFileTree">
                    <div v-if="customRulePreview.manual" class="ruleManualState">
                      该规则不会自动复制文件，需要手动安装。
                    </div>
                    <div v-for="file in customRulePreview.targetFiles" :key="`target-${file}`" class="ruleFileRow">
                      <File :size="13" />
                      <span>{{ file }}</span>
                    </div>
                  </div>
                  <small v-if="!customRulePreview.manual">这些是预计创建或覆盖的目标路径。</small>
                </section>
              </div>
              <div class="ruleSimulationSummary">
                <div>
                  <span>识别条件</span>
                  <strong>{{ customRulePreview.matchedText }}</strong>
                </div>
                <div>
                  <span>识别类型</span>
                  <strong>{{ customRuleName.trim() || "未填写类型名称" }}</strong>
                </div>
                <div>
                  <span>安装方式</span>
                  <strong>{{ customRulePreview.strategyText }}</strong>
                </div>
                <div class="ruleConflictHint">
                  <AlertTriangle :size="15" />
                  <span>模拟模式不会读取游戏现有文件，实际安装前仍会再次检查覆盖冲突。</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button class="primary" @click="showCustomRulesModal = false">完成</button>
        </div>
      </div>
    </div>

    <div v-if="showModEditModal && editingMod" class="steam-modal-overlay" @click.self="showModEditModal = false">
      <div class="steam-modal modEditModal">
        <div class="steam-modal-header">
          <SquarePen :size="16" />
          <span>编辑 Mod</span>
          <button class="close-btn" @click="showModEditModal = false"><X :size="18" /></button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <label class="modalField">
            备注
            <input
              :value="editingMod.name"
              @change="library.updateMod(editingMod.id, { name: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
            />
          </label>
          <!--
            BUG-011(2026-10-03):精选 mod 的 website 是 HGMM 1.0 打包工具塞的私有 CDN URL
              (格式 "ModName::https://download.hs2049.cn/..."),不是用户可访问的页面。
              只对 updateSource.type === "nexus" 显示来源网址输入框 + Nexus hint;
              featured 来源整体隐藏(精选 CDN URL 是私有,不该让用户看到)。
              数据保留在 LocalMod.website,用户切换游戏 / 重新识别后可恢复。
          -->
          <label v-if="editingMod.updateSource?.type !== 'featured'" class="modalField">
            来源网址
            <input
              :value="editingMod.website"
              placeholder="Nexus 页面地址或普通来源网址"
              @change="updateModWebsiteFromInput(editingMod, ($event.target as HTMLInputElement).value)"
            />
            <small class="modalHint">
              {{ editingMod.updateSource ? `已识别 Nexus：${editingMod.updateSource.gameDomain} / ${editingMod.updateSource.modId}` : "粘贴 Nexus 页面地址后会自动用于更新检查。" }}
            </small>
          </label>
          <small v-else class="modalHint">精选 mod,来源为私有 CDN,不展示网址</small>
          <label class="modalField">
            描述
            <textarea
              :value="editingMod.description"
              placeholder="安装说明、备注或来源说明"
              @change="library.updateMod(editingMod.id, { description: ($event.target as HTMLTextAreaElement).value, updatedAt: Date.now() })"
            />
          </label>
        </div>
        <div class="steam-modal-footer">
          <button class="secondary" @click="openModCache(editingMod)">打开下载目录</button>
          <button class="primary" @click="finishModEdit(editingMod)">完成</button>
        </div>
      </div>
    </div>

    <!-- 怀沙:通用确认弹窗(替换 window.confirm) -->
    <div
      v-if="confirmDialog.open"
      class="steam-modal-overlay"
      @click.self="closeConfirm(false)"
    >
      <div class="steam-modal confirmModal">
        <div class="steam-modal-header">
          <component :is="confirmDialog.danger ? Trash2 : Info" :size="16" />
          <span>{{ confirmDialog.title ?? "确认操作" }}</span>
          <button class="close-btn" @click="closeConfirm(false)">
            <X :size="18" />
          </button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <p class="confirmModalText">{{ confirmDialog.message }}</p>
        </div>
        <div class="steam-modal-footer">
          <button class="secondary" @click="closeConfirm(false)">
            {{ confirmDialog.cancelText ?? "取消" }}
          </button>
          <button
            :class="confirmDialog.danger ? 'dangerAction' : 'primary'"
            @click="closeConfirm(true)"
          >
            {{ confirmDialog.confirmText ?? "确定" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 怀沙:通用输入弹窗(替换 window.prompt) -->
    <div
      v-if="promptDialog.open"
      class="steam-modal-overlay"
      @click.self="closePrompt(null)"
    >
      <div class="steam-modal promptModal">
        <div class="steam-modal-header">
          <SquarePen :size="16" />
          <span>{{ promptDialog.title ?? "请输入" }}</span>
          <button class="close-btn" @click="closePrompt(null)">
            <X :size="18" />
          </button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <p v-if="promptDialog.message" class="promptModalMessage">
            {{ promptDialog.message }}
          </p>
          <input
            ref="promptInputRef"
            class="steamInput promptModalInput"
            :value="promptDialog.value"
            :placeholder="promptDialog.placeholder ?? ''"
            @input="promptDialog.value = ($event.target as HTMLInputElement).value"
            @keydown.enter.prevent="closePrompt(promptDialog.value)"
          />
        </div>
        <div class="steam-modal-footer">
          <button class="secondary" @click="closePrompt(null)">
            {{ promptDialog.cancelText ?? "取消" }}
          </button>
          <button class="primary" @click="closePrompt(promptDialog.value)">
            {{ promptDialog.confirmText ?? "确定" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 怀沙:通用提示弹窗(替换 window.alert / Electron showAlert) -->
    <div
      v-if="alertDialog.open"
      class="steam-modal-overlay"
      @click.self="closeAlert()"
    >
      <div class="steam-modal alertModal">
        <div class="steam-modal-header">
          <Info :size="16" />
          <span>{{ alertDialog.title ?? "提示" }}</span>
          <button class="close-btn" @click="closeAlert()">
            <X :size="18" />
          </button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <p class="alertModalText">{{ alertDialog.message }}</p>
        </div>
        <div class="steam-modal-footer">
          <button class="primary" @click="closeAlert()">
            {{ alertDialog.confirmText ?? "确定" }}
          </button>
        </div>
      </div>
    </div>

    <header class="topbar">
      <nav class="nav">
        <button :class="{ active: activeTab === 'manager' }" @click="activeTab = 'manager'">
          首页
        </button>
        <!-- HGMM 减法 Phase 1:暂时隐藏"日志"tab 按钮(代码保留待恢复,把 false 改 true 即可) -->
        <button v-if="false" :class="{ active: activeTab === 'logs' }" @click="activeTab = 'logs'">
          日志
        </button>
        <button :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          设置
        </button>
        <!-- 怀沙减法 Phase 5(FEATURE-019 round 2,2026-10-07):下载管理 tab 位置调整 — 放在"设置"后面、"帮助"前面,跟次级 tab 成一组 -->
        <button :class="{ active: activeTab === 'download' }" @click="activeTab = 'download'">
          下载管理
        </button>
        <button :class="{ active: activeTab === 'help' }" @click="activeTab = 'help'">
          帮助
        </button>
        <button :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">
          关于
        </button>
      </nav>

      <div class="topbarFooter" style="display: flex; align-items: center; gap: 16px;">
        <div style="font-size: 12px; color: var(--c-text-tertiary);">
          <span>模组下载路径:</span>
          <strong style="color: var(--c-text-on-accent); margin-left: 4px;">{{ storageLabel }}</strong>
        </div>
        <button class="nexus-profile-btn" @click="showNexusAuthModal = true" style="background: transparent; border: none; cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--c-text-strong); font-size: 13px;">
          <img v-if="library.settings.nexusUser?.avatar" :src="library.settings.nexusUser.avatar" style="width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--c-border-strong);" />
          <div v-else style="width: 28px; height: 28px; border-radius: 4px; background: var(--c-bg-elevated); display: flex; align-items: center; justify-content: center; border: 1px solid var(--c-border-strong);"><User :size="16" /></div>
          <span style="font-weight: 600;">{{ library.settings.nexusUser?.name || "未登录 Nexus" }}</span>
        </button>
      </div>
    </header>

    <main class="content">

      <section v-if="activeTab === 'manager'" class="page" style="padding: 0; height: 100%;">


        <div class="workspaceGrid">
          <section class="panel gamePanel">
            <div class="panelHeader" style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h2>游戏库</h2>
                <span>{{ library.games.length }} 个游戏</span>
              </div>
              <button class="iconButton" @click="showAddGameModal = true" title="添加游戏" style="color: var(--c-accent);">
                <Plus :size="18" />
              </button>
            </div>

            <!-- 添加游戏弹窗 -->
            <div v-if="showAddGameModal" class="steam-modal-overlay">
              <div class="steam-modal" style="width: 720px; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="steam-modal-header">
                  <div>
                    <h3>添加游戏</h3>
                    <p class="steam-modal-subtitle">怀沙模组管理器当前支持 {{ library.presetCount }} 款游戏，点击封面并按照提示选中游戏安装目录下<span style="color: var(--c-accent); font-weight: 600;">的主程序</span>即可完成游戏的添加。</p>
                  </div>
                  <button class="close-btn" @click="showAddGameModal = false"><X :size="20" /></button>
                </div>

                <div class="steam-modal-body" style="overflow-y: auto; padding: 20px 24px;">
                  <div v-if="!showCustomGameForm">
                    <div class="steamSearchBox" style="margin-bottom: 16px; min-width: 0;">
                      <input v-model="library.presetSearch" placeholder="搜索支持游戏、中文名、英文名、Steam ID 或 exe" />
                      <div class="searchBtn" style="pointer-events: none;"><Search :size="15" /></div>
                    </div>

                    <!-- 预设卡片网格(2-3 列自适应) -->
                    <div class="presetCardGrid">
                      <div v-if="library.presetList.length === 0" class="presetCardEmpty">
                        <Search :size="32" style="margin-bottom: 12px; opacity: 0.5;" />
                        <span>未找到匹配的游戏</span>
                      </div>
                      <button
                        v-for="preset in library.presetList"
                        :key="preset.id"
                        class="presetCard"
                        @click="library.addGame(preset); showAddGameModal = false;"
                        :title="`添加 ${getGameName(preset)}`"
                      >
                        <div class="presetCardCover">
                          <img v-if="preset.coverUrl" :src="preset.coverUrl" alt="" />
                          <Gamepad2 v-else :size="36" />
                          <span v-if="preset.steamAppId" class="presetCardBadge">Steam</span>
                        </div>
                        <div class="presetCardBody">
                          <strong class="presetCardTitle">{{ getGameName(preset) }}</strong>
                          <span class="presetCardMeta">
                            <template v-if="preset.exeNames?.length">进程名：{{ preset.exeNames.join(', ') }}</template>
                            <template v-else>未配置可执行文件</template>
                          </span>
                        </div>
                      </button>
                    </div>
                  </div>

                  <!-- HGMM 隐藏功能 #12:自定义游戏表单(2026-09-23 隐藏,详见 docs/hidden-features.md) -->
                  <div v-if="false" class="customGameForm" style="border: none; padding: 0;">
                    <input class="steamInput" v-model="customGameName" placeholder="游戏名称" style="margin-bottom: 8px;" />
                    <div class="pathPicker" style="margin-bottom: 8px; display: flex; gap: 8px;">
                      <input class="steamInput" v-model="customGamePath" placeholder="游戏目录" />
                      <button class="secondary" @click="chooseCustomGamePath">选择目录</button>
                    </div>
                    <div class="pathPicker" style="margin-bottom: 8px; display: flex; gap: 8px;">
                      <input class="steamInput" v-model="customGameExeNames" placeholder="exe 名称，逗号分隔" />
                      <button class="secondary" @click="chooseCustomGameExe">选择 exe</button>
                    </div>
                    <input class="steamInput" v-model="customGameInstallPath" placeholder="安装相对路径(空为根目录)" style="margin-bottom: 8px;" />
                    <input class="steamInput" v-model="customGameLaunchArgs" placeholder="启动参数" style="margin-bottom: 8px;" />
                    <div class="pathPicker" style="margin-bottom: 8px; display: flex; gap: 8px;">
                      <input class="steamInput" v-model="customGameCoverUrl" placeholder="封面图片路径(可选)" />
                      <button class="secondary" @click="chooseCustomGameCover">选择封面</button>
                    </div>
                    <button class="primary fullWidth" @click="createCustomGameFromForm(); showAddGameModal = false;">保存自定义游戏</button>
                  </div>
                </div>

                <div class="steam-modal-footer">
                  <!-- HGMM 隐藏功能 #12:手动添加游戏入口(2026-09-23 隐藏,详见 docs/hidden-features.md) -->
                  <button v-if="false" class="link-btn" @click="showCustomGameForm = true">
                    游戏不在列表里？手动添加 →
                  </button>
                  <button v-if="false" class="link-btn" @click="showCustomGameForm = false">
                    ← 返回预设列表
                  </button>
                  <button class="secondary" @click="showAddGameModal = false">取消</button>
                </div>
              </div>
            </div>

            <div v-if="library.games.length === 0" class="steamEmptyStateSide">
              <Gamepad2 :size="32" />
              <p>还没有添加游戏<br>点击右上角 + 立即添加</p>
            </div>

            <button
              v-for="game in library.games"
              :key="game.id"
              class="gameItem"
              :class="{ selected: game.id === library.activeGameId }"
              @click="chooseGame(game.id)"
              @contextmenu.prevent="showGameContextMenu($event, game.id)"
            >
              <img v-if="gameCoverUrls[game.id]" :src="gameCoverUrls[game.id]" alt="" />
              <Gamepad2 v-else :size="18" />
              <span>
                {{ getGameName(game) }}
                <small>{{ getGameEnglishName(game) }}</small>
              </span>
            </button>
          </section>

          <section
            class="panel managerPanel"
            :class="{ dragging: dragActive }"
            @dragenter.prevent="dragActive = !draggingModId"
            @dragover.prevent="dragActive = !draggingModId"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="dropLocalMods"
          >
            <div v-if="library.activeGame" class="steamHeroBanner">
              <div class="heroBg" :style="gameCoverUrls[library.activeGame.id] ? { backgroundImage: `url('${gameCoverUrls[library.activeGame.id]}')` } : {}"></div>
              <div class="heroGradientBottom"></div>
              <div class="heroGradientLeft"></div>
              
              <div v-if="library.busy || library.updateBatchProgress.visible || library.updateCheckResult.visible" class="heroUpdateProgress" style="position: fixed; top: 76px; right: 32px; display: flex; align-items: center; gap: 12px; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(12px); padding: 14px 20px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.6); z-index: 9999; transition: all 0.3s ease;">
                <LoaderCircle v-if="library.busy || library.updateBatchProgress.visible" :size="20" class="spin" style="color: var(--c-accent);" />
                <CheckCircle2 v-else :size="20" style="color: var(--c-success);" />
                <div style="display: flex; flex-direction: column;">
                  <template v-if="library.updateCheckResult.visible && !library.busy">
                    <span style="color: var(--c-text-strong); font-size: 13px; font-weight: 500;">检查完毕</span>
                    <span style="color: var(--c-text-secondary); font-size: 12px; margin-top: 2px;">发现 {{ library.updateCheckResult.available }} 个更新，失败 {{ library.updateCheckResult.failed }} 个</span>
                  </template>
                  <template v-else-if="library.updateBatchProgress.visible">
                    <span style="color: var(--c-text-strong); font-size: 13px; font-weight: 500;">{{ library.updateBatchProgress.message }}</span>
                    <span style="color: var(--c-text-secondary); font-size: 12px; margin-top: 2px;">{{ library.updateBatchProgress.current }} / {{ library.updateBatchProgress.total }}</span>
                  </template>
                  <template v-else>
                    <span style="color: var(--c-text-strong); font-size: 13px; font-weight: 500;">正在处理...</span>
                  </template>
                </div>
              </div>
              <div class="heroContent">
                <div class="heroMain">
                  <h1 class="heroTitle">{{ getGameName(library.activeGame) }}</h1>
                  <div class="heroActions">
                    <button class="steamPlayBtn" @click="library.launchActiveGame()">
                      <Play :size="20" fill="currentColor" />
                      启动游戏
                    </button>
                    <button
                      class="heroRepairBtn"
                      :disabled="!library.activeGame || library.busy"
                      title="一键修复:删除所有已安装的 mod 和前置依赖"
                      @click="showRepairModal = true"
                    >
                      <Wrench :size="16" />
                      一键修复
                    </button>
                  </div>
                </div>
                <div class="heroSummary">
                  <div class="heroSummaryCard">
                    <span>已启用 Mod</span>
                    <strong>{{ library.installedCount }}</strong>
                  </div>
                  <div class="heroSummaryCard">
                    <span>全部 Mod</span>
                    <strong>{{ library.activeMods.length }}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="dragActive" class="dropOverlay">
              <PackagePlus :size="24" />
              松开导入到当前游戏
            </div>

            <!-- HGMM Phase 4.x:5 个 sub-tab 切换(已安装 mod / 精选 mod / Nexusmods / 模组整合包 / Steam 创意工坊)
                 已安装 mod 排第一(高频动作:管理已装的 mod);精选/Nexus 排后面(偶发:找新 mod) -->
            <div class="subTabSwitcher">
              <button
                class="subTabBtn"
                :class="{ active: library.activeSubTab === 'library' }"
                @click="library.setActiveSubTab('library')"
                data-subtab="library"
              >
                <Boxes :size="14" />
                已安装 mod
                <span class="subTabCount">{{ library.activeMods.length }}</span>
              </button>
              <button
                class="subTabBtn"
                :class="{ active: library.activeSubTab === 'featured' }"
                @click="library.setActiveSubTab('featured')"
                data-subtab="featured"
              >
                <Sparkles :size="14" />
                精选 mod
              </button>
              <button
                class="subTabBtn"
                :class="{ active: library.activeSubTab === 'nexus' }"
                @click="library.setActiveSubTab('nexus')"
                data-subtab="nexus"
              >
                <Globe :size="14" />
                Nexusmods
                <span v-if="library.nexusTotalCount > 0" class="subTabCount">
                  {{ library.nexusTotalCount }}
                </span>
              </button>
              <button
                class="subTabBtn"
                :class="{ active: library.activeSubTab === 'bigmod' }"
                @click="library.setActiveSubTab('bigmod')"
                data-subtab="bigmod"
              >
                <PackageOpen :size="14" />
                模组整合包
                <span v-if="library.activeBigMods.length > 0" class="subTabCount">
                  {{ library.activeBigMods.length }}
                </span>
              </button>
              <button
                class="subTabBtn"
                :class="{ active: library.activeSubTab === 'steamworkshop' }"
                @click="library.setActiveSubTab('steamworkshop')"
                data-subtab="steamworkshop"
              >
                <ShoppingBag :size="14" />
                Steam 创意工坊
              </button>
            </div>

            <!-- sub-tab dispatch:5 个分支互斥 -->
            <FeaturedModList v-if="library.activeSubTab === 'featured'" />
            <NexusBrowse v-else-if="library.activeSubTab === 'nexus'" />
            <div v-else-if="library.activeSubTab === 'steamworkshop'" class="placeholderPanel">
              <ShoppingBag :size="48" />
              <h3>Steam 创意工坊</h3>
              <p>即将推出。先用 Nexusmods / 模组整合包 安装来源。</p>
            </div>
            <BigModList v-else-if="library.activeSubTab === 'bigmod'" />

            <div v-show="library.activeSubTab === 'library'" class="managerContent">
              <section v-if="library.activeGame" class="packageToolsProgress">
                <div v-if="library.packageProgress.visible" class="packageProgress">
                  <div class="packageProgressMeta">
                    <span>
                      <LoaderCircle :size="15" class="spin" />
                      {{ library.packageProgress.message || "正在处理整合包..." }}
                    </span>
                    <strong>
                      {{
                        library.packageProgress.total > 0
                          ? `${Math.min(100, Math.round((library.packageProgress.current / library.packageProgress.total) * 100))}%`
                          : "处理中"
                      }}
                    </strong>
                  </div>
                  <div class="taskProgressBar">
                    <div
                      class="progressFill"
                      :class="{ indeterminate: library.packageProgress.total === 0 }"
                      :style="library.packageProgress.total > 0
                        ? { width: `${Math.min(100, Math.round((library.packageProgress.current / library.packageProgress.total) * 100))}%` }
                        : {}"
                    ></div>
                  </div>
                  <small>{{ library.packageProgress.phase }}</small>
                </div>
              </section>

              <div class="stickyFilters">
                <div class="toolsRow">
                  <div class="toolsGroup">
                    <div class="steamSearchBox">
                      <input v-model="library.search" placeholder="搜索 Mod..." />
                      <div class="searchBtn" style="pointer-events: none;"><Search :size="15" /></div>
                    </div>
                  </div>
                  <div class="toolsGroup" style="gap: 8px;">
                    <button class="primary" style="height: 36px; border-radius: 6px; padding: 0 16px; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: bold; background: linear-gradient(180deg, var(--c-accent) 0%, var(--c-accent-hover) 100%); box-shadow: 0 2px 8px rgba(102, 192, 244, 0.25); border: 1px solid var(--c-accent-hover);" :disabled="library.busy" @click="library.importLocalMods">
                      <PackagePlus :size="16" />
                      导入 Mod
                    </button>
                    <button class="secondary" style="height: 36px; padding: 0 12px; border-radius: 6px; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 6px;" title="扫描游戏目录里用户手动丢入的 mod,打自定义 tag" :disabled="library.busy || !library.activeGame" @click="scanActiveGameMods">
                      <ScanSearch :size="15" />
                      扫描游戏目录
                    </button>
                    <button class="secondary" style="position: relative; height: 36px; padding: 0 12px; border-radius: 6px; font-size: 13px; font-weight: bold;" title="检查更新" :disabled="library.busy || !library.activeGame" @click="library.checkActiveGameUpdates()">
                      <RotateCcw :size="15" />
                      检查
                      <span v-if="library.activeUpdateAvailableCount > 0" style="position: absolute; top: -6px; right: -6px; background: var(--c-danger); color: white; border-radius: 10px; padding: 2px 6px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid var(--c-danger);">{{ library.activeUpdateAvailableCount }}</span>
                    </button>
                    <button class="secondary" style="height: 36px; padding: 0 12px; border-radius: 6px; font-size: 13px; font-weight: bold;" title="更新全部" :disabled="library.busy || library.activeUpdateAvailableCount === 0" @click="library.updateAllAvailableMods">
                      <ArrowDownToLine :size="15" />
                      更新
                    </button>
                    <!-- HGMM Phase X:导出/导入整合包属于"加分项",默认隐藏,以后想恢复把 v-if 改成 true 即可 -->
                    <template v-if="false">
                    <div style="width: 1px; height: 18px; background: rgba(255,255,255,0.1); margin: 0 4px;"></div>
                    <button class="secondary" style="height: 36px; padding: 0 12px; border-radius: 6px; font-size: 13px; font-weight: bold;" title="导出全量整合包" :disabled="library.busy || library.packageProgress.visible" @click="library.exportActiveGamePack()">
                      <Archive :size="15" />
                      导出
                    </button>
                    <button class="secondary" style="height: 36px; padding: 0 12px; border-radius: 6px; font-size: 13px; font-weight: bold;" title="导入整合包" :disabled="library.busy || library.packageProgress.visible || !library.settings.storagePath" @click="library.restoreActiveGamePack">
                      <FolderOpen :size="15" />
                      导入
                    </button>
                    </template>
                  </div>
                </div>

                <div v-if="library.selectedMods.length > 0" class="filterRow batchBar" style="border-top: none; padding-top: 2px;">
                  <label class="rowCheck" style="margin-right: 8px;" title="全选 / 取消全选">
                    <input
                      type="checkbox"
                      :checked="library.activeMods.length > 0 && library.selectedMods.length === library.activeMods.length"
                      @change="($event.target as HTMLInputElement).checked ? library.selectAllVisibleMods() : library.clearSelection()"
                    />
                  </label>
                  <span style="font-size: 13px; font-weight: bold; color: var(--c-text-on-accent); padding-right: 8px;">已选择 {{ library.selectedMods.length }} 个</span>
                  <button class="iconButton" title="清空选择" @click="library.clearSelection">
                    <X :size="16" />
                  </button>
                  <div style="width: 1px; height: 16px; background: var(--c-border-strong); margin: 0 4px;"></div>
                  
                  <div class="steamSelect" @click.stop v-if="!library.selectedProfileId">
                    <button @click="toggleDropdown('batch-add-to-profile')" title="添加选中的 Mod 到某方案" style="height: 30px; padding: 0 8px; font-size: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 3px; cursor: pointer; display: flex; align-items: center; color: var(--c-text-strong);">
                      <BookmarkPlus :size="14" style="margin-right: 4px;" />
                      加入方案...
                      <ChevronDown :size="12" style="margin-left: 4px;" />
                    </button>
                    <div v-if="openDropdownId === 'batch-add-to-profile'" class="steamSelectMenu" style="top: 100%; right: auto; left: 0; padding: 6px; min-width: 140px; display: flex; flex-direction: column; gap: 4px;">
                      <div style="display: flex; gap: 4px;">
                        <input
                          v-model="newProfileName"
                          class="steamInput"
                          style="flex: 1; width: 0; min-height: 26px; font-size: 12px; padding: 0 6px; user-select: text; -webkit-user-select: text;"
                          placeholder="输入新方案名..."
                          @click.stop
                          @mousedown.stop
                          @keyup.enter="handleCreateProfileFromBatch(); closeDropdown()"
                        />
                        <button class="iconButton" style="width: 26px; height: 26px; min-height: 26px; padding: 0;" :disabled="!newProfileName.trim()" @click="handleCreateProfileFromBatch(); closeDropdown()">
                          <CheckCircle2 :size="14" />
                        </button>
                      </div>
                      <div v-if="library.activeProfiles.length > 0" style="height: 1px; background: var(--c-border-strong); margin: 4px 0;"></div>
                      <button
                        v-for="profile in library.activeProfiles"
                        :key="profile.id"
                        @click.stop="handleAddToProfile(profile.id, profile.name)"
                      >
                        {{ profile.name }}
                      </button>
                    </div>
                  </div>
                  <button v-else class="iconButton danger" title="从当前方案中移出" @click="handleRemoveFromProfile(library.selectedProfileId)">
                    <BookmarkMinus :size="16" />
                  </button>
                  <div style="width: 1px; height: 16px; background: var(--c-border-strong); margin: 0 4px;"></div>

                  <div class="steamSelect" @click.stop>
                    <button @click="toggleDropdown('batch-add-tag')" title="添加标签到选中的 Mod" style="height: 30px; padding: 0 8px; font-size: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 3px; cursor: pointer; display: flex; align-items: center; color: var(--c-text-strong);">
                      <Plus :size="14" style="margin-right: 4px;" />
                      添加标签...
                      <ChevronDown :size="12" style="margin-left: 4px;" />
                    </button>
                    <div v-if="openDropdownId === 'batch-add-tag'" class="steamSelectMenu" style="top: 100%; right: auto; left: 0; padding: 6px; min-width: 140px; display: flex; flex-direction: column; gap: 4px;">
                      <div style="display: flex; gap: 4px;">
                        <input
                          v-model="quickTagName"
                          class="steamInput"
                          style="flex: 1; width: 0; min-height: 26px; font-size: 12px; padding: 0 6px; user-select: text; -webkit-user-select: text;"
                          placeholder="输入新标签..."
                          @click.stop
                          @mousedown.stop
                          @keyup.enter="addQuickTagToSelected(); closeDropdown()"
                        />
                        <button class="iconButton" style="width: 26px; height: 26px; min-height: 26px; padding: 0;" :disabled="!quickTagName.trim()" @click="addQuickTagToSelected(); closeDropdown()">
                          <CheckCircle2 :size="14" />
                        </button>
                      </div>
                      <div v-if="library.activeTags.length > 0" style="height: 1px; background: var(--c-border-strong); margin: 4px 0;"></div>
                      <button
                        v-for="tag in library.activeTags"
                        :key="tag"
                        @click="quickTagName = tag; addQuickTagToSelected(); closeDropdown()"
                      >
                        {{ tag }}
                      </button>
                    </div>
                  </div>
                  <div style="width: 1px; height: 16px; background: var(--c-border-strong); margin: 0 4px;"></div>

                  <button class="iconButton primary" title="批量安装" :disabled="library.busy" @click="library.installSelectedMods" style="display: flex; align-items: center; gap: 4px; padding: 0 10px; width: auto; font-size: 13px;">
                    <Play :size="14" fill="currentColor" /> 安装
                  </button>
                  <button class="iconButton" title="批量卸载" :disabled="library.busy" @click="confirmUninstallSelectedMods" style="display: flex; align-items: center; gap: 4px; padding: 0 10px; width: auto; font-size: 13px;">
                    <Pause :size="14" fill="currentColor" /> 卸载
                  </button>
                  <button class="iconButton danger" title="批量删除" :disabled="library.busy" @click="confirmRemoveSelectedMods" style="display: flex; align-items: center; gap: 4px; padding: 0 10px; width: auto; font-size: 13px;">
                    <Trash2 :size="14" /> 删除
                  </button>
                </div>
                
                <div v-else class="filterRow">
                  <div class="steamSelect" @click.stop>
                    <button @click="toggleDropdown('mod-profile-filter')" :style="{ color: library.selectedProfileId ? 'var(--c-accent)' : 'var(--c-text-strong)' }" style="display: flex; align-items: center;">
                      <Bookmark :size="14" style="margin-right: 6px; opacity: 0.7;" />
                      {{ library.selectedProfileId ? (library.activeProfiles.find(p => p.id === library.selectedProfileId)?.name || '全部方案') : '全部方案' }}
                      <ChevronDown :size="13" style="margin-left: 4px;" />
                    </button>
                    <div v-if="openDropdownId === 'mod-profile-filter'" class="steamSelectMenu">
                      <button @click="library.selectedProfileId = ''; closeDropdown()">全部方案</button>
                      <button
                        v-for="profile in library.activeProfiles"
                        :key="profile.id"
                        @click="library.selectedProfileId = profile.id; closeDropdown()"
                      >
                        {{ profile.name }}
                      </button>
                    </div>
                  </div>
                  <button v-if="library.selectedProfileId" class="iconButton danger" title="删除该方案" style="margin-left: -4px;" @click="removeSelectedModProfile">
                    <Trash2 :size="16" />
                  </button>

                  <div class="steamSelect" @click.stop>
                    <button @click="toggleDropdown('mod-type-filter')" style="display: flex; align-items: center;">
                      <Layers :size="14" style="margin-right: 6px; opacity: 0.7;" />
                      {{ typeFilterLabel() }}
                      <ChevronDown :size="13" style="margin-left: 4px;" />
                    </button>
                    <div v-if="openDropdownId === 'mod-type-filter'" class="steamSelectMenu">
                      <button @click="library.selectedTypeId = 'all'; closeDropdown()">全部类型</button>
                      <button
                        v-for="type in library.activeAdapter?.modTypes ?? []"
                        :key="type.id"
                        @click="library.selectedTypeId = type.id; closeDropdown()"
                      >
                        {{ type.name }}
                      </button>
                    </div>
                  </div>


                  <div class="steamSelect" @click.stop>
                    <button @click="toggleDropdown('mod-tag-filter')" style="display: flex; align-items: center;">
                      <Tags :size="14" style="margin-right: 6px; opacity: 0.7;" />
                      {{ tagFilterLabel() }}
                      <ChevronDown :size="13" style="margin-left: 4px;" />
                    </button>
                    <div v-if="openDropdownId === 'mod-tag-filter'" class="steamSelectMenu">
                      <button @click="library.selectedTag = 'all'; closeDropdown()">全部标签</button>
                      <button
                        v-for="tag in library.activeTags"
                        :key="tag"
                        @click="library.selectedTag = tag; closeDropdown()"
                      >
                        {{ tag }}
                      </button>
                    </div>
                  </div>
                  <div class="steamSelect" @click.stop>
                    <button @click="toggleDropdown('mod-sort-filter')" style="display: flex; align-items: center;">
                      <ArrowDownUp :size="14" style="margin-right: 6px; opacity: 0.7;" />
                      {{ sortLabel() }}
                      <ChevronDown :size="13" style="margin-left: 4px;" />
                    </button>
                    <div v-if="openDropdownId === 'mod-sort-filter'" class="steamSelectMenu">
                      <button @click="library.sortMode = 'custom'; closeDropdown()">自定义排序</button>
                      <button @click="library.sortMode = 'createdDesc'; closeDropdown()">最近导入</button>
                      <button @click="library.sortMode = 'createdAsc'; closeDropdown()">最早导入</button>
                      <button @click="library.sortMode = 'nameAsc'; closeDropdown()">名称 A-Z</button>
                      <button @click="library.sortMode = 'nameDesc'; closeDropdown()">名称 Z-A</button>
                      <button @click="library.sortMode = 'installedFirst'; closeDropdown()">已安装优先</button>
                    </div>
                  </div>
                  <div class="viewSwitch" style="margin-left: auto;">
                    <button
                      class="iconButton"
                      :class="{ active: modViewMode === 'list' }"
                      title="列表视图"
                      @click="modViewMode = 'list'"
                    >
                      <List :size="16" />
                    </button>
                    <button
                      class="iconButton"
                      :class="{ active: modViewMode === 'grid' }"
                      title="网格视图"
                      @click="modViewMode = 'grid'"
                    >
                      <LayoutGrid :size="16" />
                    </button>
                  </div>
                </div>


            </div> <!-- end of stickyFilters -->



            <div v-if="showBatchEdit" class="batchEditPanel">
              <select v-model="batchTypeId">
                <option value="">不改类型</option>
                <option
                  v-for="type in library.activeAdapter?.modTypes ?? []"
                  :key="type.id"
                  :value="type.id"
                >
                  {{ type.name }}
                </option>
              </select>
              <input v-model="batchVersion" placeholder="统一版本，留空不改" />
              <input v-model="batchAuthor" placeholder="统一作者，留空不改" />
              <input v-model="batchWebsite" placeholder="统一来源网址，留空不改" />
              <input v-model="batchTags" placeholder="追加标签，空格或逗号分隔" />
              <button class="primary" :disabled="library.busy" @click="applyBatchEdit">
                应用
              </button>
            </div>

            <div v-if="showPackageExport" class="batchEditPanel packageExportPanel">
              <input v-model="packageNameInput" placeholder="包名，留空用 Mod 名称" />
              <input v-model="packageAuthorInput" placeholder="作者" />
              <input v-model="packageVersionInput" placeholder="版本" />
              <input v-model="packageDescriptionInput" placeholder="描述" />
              <button class="primary" :disabled="library.busy || library.selectedMods.length === 0" @click="exportSelectedPackage">
                导出
              </button>
            </div>



            <div v-if="library.activeMods.length === 0" class="steamEmptyStateMain">
              <Sparkles :size="48" />
              <h3>当前游戏还未安装MOD</h3>
              <p>可在上方的精选模组页面选择安装，也可以切换到Nexusmods选择安装模组，或者下载模组整合包导入</p>
            </div>

            <div v-else-if="modViewMode === 'list'" class="steamModTable">
              <div class="steamModHeader">
                <label class="rowCheck">
                  <input
                    type="checkbox"
                    :checked="library.activeMods.length > 0 && library.selectedMods.length === library.activeMods.length"
                    @change="($event.target as HTMLInputElement).checked ? library.selectAllVisibleMods() : library.clearSelection()"
                  />
                </label>
                <span></span>
                <span>预览</span>
                <span>名称</span>
                <span>标签</span>
                <span style="text-align: center;">版本 / 更新</span>
                <span style="text-align: center;">类型</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              <article
                v-for="mod in library.activeMods"
                :key="mod.id"
                class="steamModRow"
                :class="{
                  dragging: draggingModId === mod.id,
                  dragOver: dragOverModId === mod.id
                }"
                :draggable="library.canReorderMods && !library.busy"
                  @dragstart="beginModDrag(mod)"
                  @dragover.prevent="dragOverModId = mod.id"
                  @dragleave="dragOverModId === mod.id && (dragOverModId = '')"
                  @drop.prevent="dropModOn(mod)"
                  @dragend="draggingModId = ''; dragOverModId = ''"
                >
                  <label class="rowCheck">
                    <input
                      type="checkbox"
                      :checked="library.selectedModIds.includes(mod.id)"
                      @change="library.toggleModSelection(mod.id, ($event.target as HTMLInputElement).checked)"
                    />
                  </label>
                  <button class="dragHandle" :disabled="!library.canReorderMods || library.busy" title="拖拽排序">
                    <GripVertical :size="16" />
                  </button>
                  <div class="modPreviewCell">
                    <button
                      v-if="coverUrls[mod.id]"
                      class="modThumbButton"
                      :title="`查看预览图：${mod.name}`"
                      @click="openPreviewImage(coverUrls[mod.id], mod.name)"
                    >
                      <img :src="coverUrls[mod.id]" alt="" />
                    </button>
                    <button
                      v-else
                      class="iconButton"
                      :disabled="library.busy"
                      :title="mod.installed ? '查看部署文件' : '预览安装计划'"
                      @click="mod.installed ? toggleModDetails(mod.id) : previewModInstallPlan(mod)"
                    >
                      <ListTree :size="16" />
                    </button>
                  </div>
                  <div class="steamModName">
                    <strong :title="mod.name">{{ mod.name }}</strong>
                  </div>
                  <div class="steamModTags" style="display: flex; gap: 6px; overflow: hidden;">
                    <span v-for="tag in mod.tags.slice(0, 1)" :key="tag" class="tagBadge" :style="{ borderColor: tagColor(tag), color: tagColor(tag) }">
                      {{ tag }}
                    </span>
                  </div>
                  
                  <div class="modVersionCell" style="display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px; overflow: hidden; min-width: 0;">
                    <span class="steamModVersion" style="white-space: nowrap; flex: none;">{{ mod.version || "1.0.0" }}</span>
                    <button
                      v-if="modUpdateLabel(mod)"
                      class="iconButton updateIcon"
                      :class="modUpdateClass(mod)"
                      :disabled="library.busy || !mod.updateSource"
                      :title="modUpdateTitle(mod) + (modUpdateClass(mod) !== 'checking' ? ' - 点击检查更新' : '')"
                      @click="handleModUpdateClick(mod)"
                      style="width: 22px; height: 22px; min-height: 22px; padding: 0; flex: none; background: transparent; border: none; outline: none;"
                    >
                      <LoaderCircle v-if="modUpdateClass(mod) === 'checking'" :size="14" class="spin" />
                      <CheckCircle2 v-else-if="modUpdateClass(mod) === 'latest'" :size="14" />
                      <RotateCcw v-else-if="modUpdateClass(mod) === 'available'" :size="14" />
                      <AlertTriangle v-else-if="modUpdateClass(mod) === 'failed' || modUpdateClass(mod) === 'unsupported'" :size="14" />
                      <Info v-else :size="14" />
                    </button>
                  </div>

                  <div class="steamSelect steamSelectCompact" @click.stop style="display: flex; justify-content: center; position: relative;">
                    <button
                      @click="toggleDropdown('row-type-' + mod.id)"
                      :disabled="library.busy"
                      style="display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100px; padding: 4px 8px; font-size: 12px; border-radius: 4px; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.08); color: var(--c-text-strong);"
                    >
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">{{ modTypeLabel(mod) }}</span>
                      <ChevronDown :size="12" style="flex: none; opacity: 0.7;" />
                    </button>
                    <div v-if="openDropdownId === 'row-type-' + mod.id" class="steamSelectMenu" style="width: 100px; min-width: 100px; top: calc(100% + 2px); box-sizing: border-box; padding: 4px;">
                      <button
                        v-for="type in library.activeAdapter?.modTypes ?? []"
                        :key="type.id"
                        @click="changeModType(mod, type.id); closeDropdown()"
                        style="text-align: left; padding: 6px 8px; font-size: 12px; border-radius: 4px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                      >
                        {{ type.name }}
                      </button>
                    </div>
                  </div>

                  <button
                    class="steamToggleCell"
                    :class="{ active: mod.installed }"
                    :disabled="library.busy"
                    :title="mod.installed ? '已安装' : '未安装'"
                    @click="mod.installed ? confirmUninstallMod(mod) : library.installMod(mod)"
                  >
                    <span class="steamToggle"><span /></span>
                  </button>
                  <div class="steamRowActions">
                    <button class="secondary" :disabled="library.busy" @click="openModEdit(mod)">
                      编辑
                    </button>
                    <button class="iconButton danger" :disabled="library.busy" title="删除本地 Mod" @click="confirmRemoveMod(mod)">
                      <Trash2 :size="16" />
                    </button>
                  </div>
                  <div v-if="expandedModId === mod.id" class="modDetails steamModDetails">
                    <template v-if="mod.installed">
                      <strong>部署文件</strong>
                      <p v-if="mod.deployedFiles.length === 0">当前还没有部署记录，旧记录卸载会回退到安装策略匹配。</p>
                      <ul v-else>
                        <li v-for="file in visibleDeployedFiles(mod)" :key="file">{{ file }}</li>
                      </ul>
                      <p v-if="mod.deployedFiles.length > 80">
                        仅显示前 80 个，共 {{ mod.deployedFiles.length }} 个文件。
                      </p>
                    </template>
                    <template v-else>
                      <strong>安装计划</strong>
                      <p v-if="!library.installPlans[mod.id]">点击计划按钮后会显示准备写入游戏目录的相对路径。</p>
                      <p v-else-if="visiblePlanFiles(mod).length === 0">没有匹配到可自动安装的文件。</p>
                      <p v-else-if="conflictCount(mod) > 0" class="conflictText">
                        检测到 {{ conflictCount(mod) }} 个冲突文件，直接安装会被阻止。
                      </p>
                      <ul v-if="visiblePlanFiles(mod).length > 0">
                        <li
                          v-for="file in visiblePlanFiles(mod)"
                          :key="file"
                          :class="{ conflict: library.installPlans[mod.id]?.conflicts.includes(file) }"
                        >
                          {{ file }}
                        </li>
                      </ul>
                      <p v-if="(library.installPlans[mod.id]?.targetFiles.length ?? 0) > 80">
                        仅显示前 80 个，共 {{ library.installPlans[mod.id]?.targetFiles.length }} 个文件。
                      </p>
                    </template>
                  </div>
                </article>
            </div>
            <div v-else class="steamModGrid">
              <article
                v-for="mod in library.activeMods"
                :key="mod.id"
                class="steamModCard"
                :class="{
                  installed: mod.installed,
                  selected: library.selectedModIds.includes(mod.id),
                  dragging: draggingModId === mod.id,
                  dragOver: dragOverModId === mod.id
                }"
                :draggable="library.canReorderMods && !library.busy"
                @dragstart="beginModDrag(mod)"
                @dragover.prevent="dragOverModId = mod.id"
                @dragleave="dragOverModId === mod.id && (dragOverModId = '')"
                @drop.prevent="dropModOn(mod)"
                @dragend="draggingModId = ''; dragOverModId = ''"
              >
                <div class="modCardCover">
                  <img v-if="coverUrls[mod.id]" :src="coverUrls[mod.id]" alt="" @click="openPreviewImage(coverUrls[mod.id], mod.name)" />
                  <Sparkles v-else :size="40" />
                  <label class="modCardCheck">
                    <input
                      type="checkbox"
                      :checked="library.selectedModIds.includes(mod.id)"
                      @change="library.toggleModSelection(mod.id, ($event.target as HTMLInputElement).checked)"
                    />
                  </label>
                  <button class="modCardDrag" :disabled="!library.canReorderMods || library.busy" title="拖拽排序">
                    <GripVertical :size="16" />
                  </button>
                </div>

                <div class="modCardBody" style="display: flex; flex-direction: column; gap: 8px; padding: 12px; flex: 1;">
                  <h3 :title="mod.name" style="margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-text-on-accent); font-size: 14px;">
                    {{ mod.name }}
                  </h3>
                  
                  <div class="modCardMeta" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; align-items: center;">
                    <span style="background: rgba(255,255,255,0.06); color: var(--c-text-secondary); font-size: 11px; padding: 2px 6px; border-radius: 4px;">{{ mod.version || "1.0.0" }}</span>
                    <span style="background: rgba(255,255,255,0.06); color: var(--c-text-secondary); font-size: 11px; padding: 2px 6px; border-radius: 4px;">{{ modTypeLabel(mod) }}</span>
                    <span v-for="tag in mod.tags.slice(0, 3)" :key="tag" class="tagBadge" :style="{ borderColor: tagColor(tag), color: tagColor(tag), padding: '2px 6px', fontSize: '11px', borderRadius: '4px', background: 'var(--c-surface-glass)' }">
                      {{ tag }}
                    </span>
                  </div>
                </div>

                <div class="modCardActions" style="display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: rgba(0,0,0,0.25); border-top: 1px solid rgba(255,255,255,0.05);">
                  <button
                    class="steamToggleCell"
                    :class="{ active: mod.installed }"
                    :disabled="library.busy"
                    style="flex: none; height: 32px; border-radius: 6px; background: rgba(255,255,255,0.05); justify-content: center; border: 1px solid rgba(255,255,255,0.05); padding: 0 10px;"
                    @click="mod.installed ? confirmUninstallMod(mod) : library.installMod(mod)"
                  >
                    <span class="steamToggle"><span /></span>
                    <span style="font-size: 12px; font-weight: bold; margin-left: 6px;">{{ mod.installed ? "已安装" : "未安装" }}</span>
                  </button>

                  <div style="flex: 1; display: flex; align-items: center; justify-content: flex-start; overflow: hidden; padding-left: 4px;">
                    <button
                      v-if="modUpdateLabel(mod)"
                      class="modUpdateBadge gridUpdateBadge"
                      :class="modUpdateClass(mod)"
                      :disabled="library.busy || !mod.updateSource"
                      :title="modUpdateTitle(mod)"
                      @click.stop="handleModUpdateClick(mod)"
                    >
                      <LoaderCircle v-if="library.updateCheckingIds.includes(mod.id)" :size="10" class="spin" />
                      <RotateCcw v-else :size="10" style="opacity: 0.7;" />
                      <span>{{ modUpdateLabel(mod) }}</span>
                    </button>
                  </div>


                  <button class="iconButton" style="width: 32px; height: 32px; min-height: 32px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); flex: none;" :disabled="library.busy" title="编辑" @click="openModEdit(mod)">
                    <SquarePen :size="14" />
                  </button>
                  <button class="iconButton danger" style="width: 32px; height: 32px; min-height: 32px; border-radius: 6px; background: rgba(255,94,94,0.1); border: 1px solid rgba(255,94,94,0.2); color: var(--c-danger); flex: none;" :disabled="library.busy" title="删除本地 Mod" @click="confirmRemoveMod(mod)">
                    <Trash2 :size="14" />
                  </button>
                </div>

                <div v-if="expandedModId === mod.id" class="modDetails steamModDetails modCardDetails">
                  <template v-if="mod.installed">
                    <strong>部署文件</strong>
                    <p v-if="mod.deployedFiles.length === 0">当前还没有部署记录，旧记录卸载会回退到安装策略匹配。</p>
                    <ul v-else>
                      <li v-for="file in visibleDeployedFiles(mod)" :key="file">{{ file }}</li>
                    </ul>
                    <p v-if="mod.deployedFiles.length > 80">
                      仅显示前 80 个，共 {{ mod.deployedFiles.length }} 个文件。
                    </p>
                  </template>
                  <template v-else>
                    <strong>安装计划</strong>
                    <p v-if="!library.installPlans[mod.id]">点击计划按钮后会显示准备写入游戏目录的相对路径。</p>
                    <p v-else-if="visiblePlanFiles(mod).length === 0">没有匹配到可自动安装的文件。</p>
                    <p v-else-if="conflictCount(mod) > 0" class="conflictText">
                      检测到 {{ conflictCount(mod) }} 个冲突文件，直接安装会被阻止。
                    </p>
                    <ul v-if="visiblePlanFiles(mod).length > 0">
                      <li
                        v-for="file in visiblePlanFiles(mod)"
                        :key="file"
                        :class="{ conflict: library.installPlans[mod.id]?.conflicts.includes(file) }"
                      >
                        {{ file }}
                      </li>
                    </ul>
                    <p v-if="(library.installPlans[mod.id]?.targetFiles.length ?? 0) > 80">
                      仅显示前 80 个，共 {{ library.installPlans[mod.id]?.targetFiles.length }} 个文件。
                    </p>
                  </template>
                </div>
              </article>
            </div>
            </div>
          </section>
        </div>
      </section>


      <!-- 怀沙减法 Phase 5(FEATURE-019,2026-10-07):下载管理 tab 内容 — 之前 Phase 1 隐藏,因部分 mod 体积大需要看下载进度,故放出。aria2 引擎选项同时隐藏 -->
      <section v-else-if="activeTab === 'download'" class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader">
            <div class="steamDownloadsTitle">
              <h2>下载管理 <span>({{ library.activeDownloads.length }})</span></h2>
              <!-- FEATURE-019:删除原"当前引擎:aria2/内置下载"子标题 — aria2 已隐藏,子标题无意义 -->
            </div>
            
            <div class="steamCustomDownloadRow">
              <!-- 怀沙减法 Phase 5(FEATURE-019):下载设置按钮已隐藏 — 内置下载够用,以后想恢复把下方 false 改 true 即可 -->
              <template v-if="false">
                <button class="secondary downloadSettingsButton" title="下载设置" @click="showDownloadSettingsModal = true">
                  <Settings :size="15" />
                  下载设置
                </button>
              </template>
              <button class="primary" :disabled="!customDownloadUrl.trim() || library.busy" @click="startCustomDownload">
                <ArrowDownToLine :size="14" />
                添加任务
              </button>
            </div>
          </div>

          <div v-if="library.activeDownloads.length > 0" class="downloadBulkToolbar">
            <label class="downloadSelectAll">
              <input
                type="checkbox"
                :checked="selectedDownloads.length === library.activeDownloads.length"
                @change="toggleAllDownloads"
              />
              <span>全选</span>
            </label>
            <span class="downloadSelectionCount">
              {{ selectedDownloads.length ? `已选 ${selectedDownloads.length} 个` : '可多选任务' }}
            </span>
            <button
              class="secondary"
              :disabled="!library.activeDownloads.some((task) => ['downloading'].includes(task.status))"
              @click="pauseDownloadBatch"
            >
              <Pause :size="14" />
              {{ selectedDownloads.length ? '暂停选中' : '暂停全部' }}
            </button>
            <button
              class="secondary"
              :disabled="!library.activeDownloads.some((task) => ['paused', 'failed', 'queued'].includes(task.status) && task.url)"
              @click="resumeDownloadBatch"
            >
              <RotateCcw :size="14" />
              {{ selectedDownloads.length ? '继续选中' : '继续全部' }}
            </button>
            <button
              class="secondary"
              :disabled="selectedDownloads.length === 0"
              @click="requestRemoveDownloads(selectedDownloads.map((task) => task.id))"
            >
              <Trash2 :size="14" />
              删除选中
            </button>
          </div>

          <div class="steamDownloadsList">
            <div v-if="library.activeDownloads.length === 0" class="empty">
              当前没有任何下载任务。
            </div>
            
            <article
              v-for="task in library.activeDownloads"
              :key="task.id"
              class="steamDownloadTask"
              :class="{ selected: selectedDownloadIds.includes(task.id) }"
            >
              <label class="downloadTaskSelect" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedDownloadIds.includes(task.id)"
                  @change="toggleDownloadSelection(task.id)"
                />
              </label>
              <div class="taskIconWrapper">
                <HardDrive :size="28" v-if="task.source === 'Custom'" class="taskIcon" />
                <Archive :size="28" v-else class="taskIcon" />
              </div>
              
              <div class="taskMain">
                <div class="taskTitleRow">
                  <h3 :title="task.modName || task.fileName">{{ task.modName || task.fileName }}</h3>
                  <span class="taskStatusBadge" :class="{ ok: task.status === 'completed', error: task.status === 'failed', active: task.status === 'downloading', paused: task.status === 'paused' }">
                    {{ downloadStatusText(task.status) }}
                  </span>
                </div>
                
                <p class="taskFileName" :title="task.fileName">{{ task.fileName }}</p>
                <p v-if="task.error" class="taskError">{{ task.error }}</p>

                <div class="taskMetaRow">
                  <span class="metaItem"><Gamepad2 :size="12" /> {{ task.gameName || '未知游戏' }}</span>
                  <span class="metaItem"><ListTree :size="12" /> {{ task.source === 'NexusMods' ? 'NexusMods' : '自定义链接' }}</span>
                  
                  <span class="metaItem progressText" v-if="task.totalBytes > 0">
                    <span v-if="task.status === 'downloading' && task.speed">{{ formatBytes(task.speed) }}/s • </span>{{ formatBytes(task.receivedBytes) }} / {{ formatBytes(task.totalBytes) }}
                  </span>
                  <span class="metaItem progressText" v-else>
                    <span v-if="task.status === 'downloading' && task.speed">{{ formatBytes(task.speed) }}/s • </span>{{ formatBytes(task.receivedBytes) }} 已下载
                  </span>
                </div>
                
                <div class="taskProgressBar" v-if="['downloading', 'paused'].includes(task.status)">
                  <div class="progressFill" :style="{ width: task.totalBytes > 0 ? `${Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100))}%` : '100%' }" :class="{ indeterminate: task.totalBytes === 0 }"></div>
                </div>
              </div>
              
              <div class="taskActionsRight">
                <button v-if="task.status === 'downloading'" class="secondary" title="暂停下载" @click="library.pauseDownloadTask(task.id)">
                  <Pause :size="16" />
                </button>
                <button
                  v-else-if="['paused', 'failed', 'queued'].includes(task.status)"
                  class="secondary"
                  title="继续下载"
                  :disabled="!task.url"
                  @click="library.resumeDownloadTask(task.id)"
                >
                  <RotateCcw :size="16" />
                </button>
                <button class="secondary" title="打开文件位置" :disabled="!task.outputPath" @click="library.openDownloadFolder(task)">
                  <FolderOpen :size="16" />
                </button>
                <button class="secondary" title="执行文件" :disabled="!task.outputPath && !task.url" @click="library.openDownloadFile(task)">
                  <Play :size="16" />
                </button>
                <button class="iconButton danger" title="删除任务" @click="requestRemoveDownloads([task.id])">
                  <X :size="16" />
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>
      <!-- ↑↑↑ 下载管理 tab 结束 ↑↑↑ -->

      <!-- HGMM 减法 Phase 1 v2:整段 HTML 注释包裹(恢复时:取消下方注释 + 改 v-else-if="activeTab === 'logs'")
      <section v-else-if="activeTab === 'logs'" class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader">
            <h2>运行日志</h2>
            
            <div class="steamCustomDownloadRow">
              <button class="secondary" :disabled="library.logs.length === 0" @click="library.clearLogs">
                <Trash2 :size="14" /> 清空日志
              </button>
            </div>
          </div>

          <div class="steamDownloadsList">
            <div v-if="library.logs.length === 0" class="empty">
              还没有日志。
            </div>
            <article v-for="entry in [...library.logs].reverse()" :key="entry.id" class="steamDownloadTask">
              <div class="taskIconWrapper" :style="{ color: entry.level === 'error' ? 'var(--c-danger)' : 'var(--c-success)' }">
                <Info :size="24" v-if="entry.level === 'info'" />
                <XCircle :size="24" v-else />
              </div>
              <div class="taskMain">
                <div class="taskTitleRow">
                  <h3 :style="{ color: entry.level === 'error' ? 'var(--c-danger)' : 'var(--c-text-on-accent)' }">{{ entry.message }}</h3>
                </div>
                <div class="taskMetaRow" style="margin-bottom: 0;">
                  <span class="metaItem">{{ logTime(entry.createdAt) }}</span>
                  <span class="metaItem">[{{ entry.source }}]</span>
                </div>
                <pre v-if="entry.detail" class="logDetailBox">{{ entry.detail }}</pre>
              </div>
            </article>
          </div>
        </div>
      </section>--><!-- ↑↑↑ 日志 tab 隐藏结束 ↑↑↑ -->

      <section v-else-if="activeTab === 'settings'" class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader" style="justify-content: center;">
            <h2>系统设置</h2>
          </div>
          
          <div class="steamDownloadsList" style="align-items: center;">
            <div class="steamSettingsContainer">

              <div class="steamSettingsBlock">
                <h3>常用</h3>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>MOD保存路径</label>
                    <span>下载或导入的Mod会复制到此目录下的 mods/&lt;gameId&gt;。</span>
                  </div>
                  <div class="settingControl pathPicker" style="min-width: 320px;">
                    <input :value="library.settings.storagePath" readonly placeholder="请选择一个目录" class="steamInput" />
                    <button class="secondary" @click="library.chooseStoragePath">选择</button>
                    <button class="secondary" :disabled="!library.settings.storagePath" title="打开" @click="openStoragePath">
                      <FolderOpen :size="17" />
                    </button>
                  </div>
                </div>

                <!-- HGMM 减法 Phase 2:数据导入/导出暂时隐藏,代码保留待恢复 -->
                <template v-if="false">
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>数据导入 / 导出</label>
                    <span>备份或迁移您的所有应用配置数据。</span>
                  </div>
                  <div class="settingControl" style="display: flex; gap: 8px;">
                    <button class="secondary" @click="library.exportData">导出数据</button>
                    <button class="secondary" @click="library.importData">导入数据</button>
                  </div>
                </div>
                </template>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>NexusMods 账号</label>
                    <span v-if="library.settings.nexusUser">
                      已登录:<strong>{{ library.settings.nexusUser.name }}</strong>
                      · {{ library.settings.nexusUser.isPremium ? "Premium" : "Free" }}
                    </span>
                    <span v-else>未登录 · 浏览 Nexusmods 时可匿名下载免费 mod,订阅 mod 需登录账号。</span>
                  </div>
                  <div class="settingControl" style="display: flex; gap: 8px;">
                    <button class="secondary" @click="showNexusAuthModal = true">
                      {{ library.settings.nexusUser ? "管理授权" : "登录 NexusMods" }}
                    </button>
                    <button
                      v-if="library.settings.nexusUser"
                      class="secondary"
                      @click="library.clearNexusAuth"
                    >
                      登出
                    </button>
                  </div>
                </div>
              </div>

              <!-- HGMM 减法 Phase 2:删应用偏好 block,开机自启移到高级设置 -->
              <div class="steamSettingsBlock collapsible" :class="{ expanded: showAdvancedSettings }">
                <h3
                  class="collapsibleHeader"
                  @click="showAdvancedSettings = !showAdvancedSettings"
                  style="cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between;"
                >
                  <span>高级设置</span>
                  <ChevronDown v-if="!showAdvancedSettings" :size="16" style="opacity: 0.7;" />
                  <ChevronUp v-else :size="16" style="opacity: 0.7;" />
                </h3>

                <div v-show="showAdvancedSettings">

                <h4>体验</h4>
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>开机自启</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamSwitch">
                      <input type="checkbox" :checked="library.settings.launchAtStartup" @change="library.updateSettings({ launchAtStartup: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <!-- HGMM 减法 Phase 2:软链设置强制开启(担心用户误关),UI 暂时隐藏 -->
                <template v-if="false">
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>使用软链安装文件</label>
                    <span>把游戏目录目标文件创建为指向 Mod 的链接；权限不足请关闭。</span>
                  </div>
                  <div class="settingControl">
                    <label class="steamSwitch">
                      <input type="checkbox" :checked="library.settings.useSymlinkInstall" @change="library.updateSettings({ useSymlinkInstall: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
                </template>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>优先通过目录选择游戏</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamSwitch">
                      <input type="checkbox" :checked="library.settings.preferDirectoryGamePicker" @change="library.updateSettings({ preferDirectoryGamePicker: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>允许游戏运行时修改 Mod</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamSwitch">
                      <input type="checkbox" :checked="library.settings.allowGameRunningChanges" @change="library.updateSettings({ allowGameRunningChanges: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <h4>下载</h4>
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>下载完成后自动导入</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamSwitch">
                      <input type="checkbox" :checked="library.settings.autoImportAfterDownload" @change="library.updateSettings({ autoImportAfterDownload: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <!-- 怀沙减法 Phase 5(FEATURE-019):下载引擎与连接数设置行已隐藏 — aria2 选项不再开放,内置下载够用 -->
                <template v-if="false">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>下载引擎与连接数</label>
                      <span>默认内置下载；多任务并发可切到 aria2。</span>
                    </div>
                    <div class="settingControl">
                      <button class="secondary" @click="showDownloadSettingsModal = true">下载设置</button>
                    </div>
                  </div>
                </template>

                <h4>网络</h4>
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>联网请求使用代理</label>
                    <span>Nexus 浏览、API Key 校验、下载直链和普通下载都会使用此代理。</span>
                  </div>
                  <div class="settingControl">
                    <label class="steamSwitch">
                      <input type="checkbox" :checked="library.settings.proxyEnabled" @change="library.updateSettings({ proxyEnabled: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>代理地址</label>
                    <span>例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890。</span>
                  </div>
                  <div class="settingControl" style="min-width: 320px;">
                    <input
                      class="steamInput"
                      :value="library.settings.proxyUrl"
                      placeholder="127.0.0.1:7890"
                      @change="library.updateSettings({ proxyUrl: ($event.target as HTMLInputElement).value })"
                    />
                  </div>
                </div>

                <!-- HGMM 减法 Phase 1:翻译功能(5 个 provider)整段暂时隐藏,代码保留待恢复 -->
                <template v-if="false">
                <h4>翻译</h4>
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>Nexus 内容翻译</label>
                    <span>实验性免费源可能限流或失效；译文会缓存在本地，不覆盖原文。</span>
                  </div>
                  <div class="settingControl">
                    <select
                      class="steamSelectBox"
                      :value="library.settings.translationProvider"
                      @change="library.updateSettings({ translationProvider: ($event.target as HTMLSelectElement).value as typeof library.settings.translationProvider })"
                    >
                      <option value="off">关闭</option>
                      <option value="google-gtx">Google 免费接口</option>
                      <option value="baidu">百度翻译开放平台</option>
                      <option value="youdao">有道智云翻译</option>
                      <option value="tencent">腾讯云机器翻译</option>
                      <option value="volcengine">火山引擎机器翻译</option>
                      <option value="ollama">Ollama 本地模型</option>
                    </select>
                  </div>
                </div>

                <template v-if="library.settings.translationProvider === 'baidu'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>百度翻译 AppID</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.baiduTranslateAppId" @change="library.updateSettings({ baiduTranslateAppId: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>百度翻译密钥</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.baiduTranslateSecret" @change="library.updateSettings({ baiduTranslateSecret: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <template v-if="library.settings.translationProvider === 'youdao'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>有道智云应用 ID</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.youdaoTranslateAppKey" @change="library.updateSettings({ youdaoTranslateAppKey: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>有道智云应用密钥</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.youdaoTranslateSecret" @change="library.updateSettings({ youdaoTranslateSecret: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <template v-if="library.settings.translationProvider === 'tencent'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>腾讯云 SecretId</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.tencentTranslateSecretId" @change="library.updateSettings({ tencentTranslateSecretId: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>腾讯云 SecretKey</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.tencentTranslateSecretKey" @change="library.updateSettings({ tencentTranslateSecretKey: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>腾讯云地域</label>
                      <span>默认 ap-guangzhou。</span>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.tencentTranslateRegion" @change="library.updateSettings({ tencentTranslateRegion: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <template v-if="library.settings.translationProvider === 'volcengine'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>火山引擎 AccessKey ID</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.volcengineTranslateAccessKeyId" @change="library.updateSettings({ volcengineTranslateAccessKeyId: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>火山引擎 Secret AccessKey</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.volcengineTranslateSecretAccessKey" @change="library.updateSettings({ volcengineTranslateSecretAccessKey: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>火山引擎地域</label>
                      <span>默认 cn-north-1。</span>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.volcengineTranslateRegion" @change="library.updateSettings({ volcengineTranslateRegion: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <template v-if="library.settings.translationProvider === 'ollama'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>Ollama 地址</label>
                      <span>本地默认地址是 http://127.0.0.1:11434。</span>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input
                        class="steamInput"
                        :value="library.settings.ollamaTranslateBaseUrl"
                        placeholder="http://127.0.0.1:11434"
                        @change="library.updateSettings({ ollamaTranslateBaseUrl: ($event.target as HTMLInputElement).value.trim() || 'http://127.0.0.1:11434' })"
                      />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>Ollama 模型名</label>
                      <span>例如 qwen2.5:7b、qwen3:8b，需先在 Ollama 里拉取好。</span>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input
                        class="steamInput"
                        :value="library.settings.ollamaTranslateModel"
                        placeholder="qwen2.5:7b"
                        @change="library.updateSettings({ ollamaTranslateModel: ($event.target as HTMLInputElement).value.trim() })"
                      />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>Ollama 超时时间</label>
                      <span>单位毫秒；本地大模型首次加载较慢，默认 120000。</span>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input
                        class="steamInput"
                        type="number"
                        min="10000"
                        step="1000"
                        :value="library.settings.ollamaTranslateTimeoutMs"
                        @change="library.updateSettings({ ollamaTranslateTimeoutMs: Math.max(10000, Number(($event.target as HTMLInputElement).value) || 120000) })"
                      />
                    </div>
                  </div>
                </template>
                </template>
                <!-- HGMM 减法 Phase 1:翻译功能块结束 -->

                <h4>调试</h4>
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>开发者工具 (DevTools)</label>
                    <span>用于调试网络请求和界面问题，适合进阶用户。</span>
                  </div>
                  <div class="settingControl">
                    <button class="secondary" @click="openDevTools()">
                      打开调试工具
                    </button>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>显示调试信息 / 调试模式</label>
                  </div>
                  <div class="settingControl" style="display: flex; gap: 12px;">
                    <label class="steamSwitch" title="调试模式">
                      <input type="checkbox" :checked="library.settings.debugMode" @change="library.updateSettings({ debugMode: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                    <label class="steamSwitch" title="显示调试信息">
                      <input type="checkbox" :checked="library.settings.showDebugInfo" @change="library.updateSettings({ showDebugInfo: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'help'" class="page helpPage">
        <HelpView />
      </section>

      <section v-else class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader" style="justify-content: center; flex-direction: column; gap: 4px;">
            <h2>{{ aboutNotice.title || "关于 怀沙模组管理器" }}</h2>
            <!-- HGMM(2026-09-29):显示当前 app 版本号,主进程 IPC 拿 -->
            <span class="aboutVersion">v{{ appVersion || "—" }}</span>
          </div>
          <div class="steamDownloadsList" style="align-items: center;">
            <div class="steamSettingsContainer">
              <div class="steamSettingsBlock aboutRemoteBlock">
                <div v-if="aboutNotice.loading" class="aboutNoticeState">
                  <LoaderCircle :size="18" class="spin" />
                  <span>正在读取远程内容...</span>
                </div>
                <div v-else-if="aboutNotice.error" class="aboutNoticeState error">
                  <AlertTriangle :size="18" />
                  <div>
                    <strong>远程内容读取失败</strong>
                    <span>{{ aboutNotice.error }}</span>
                  </div>
                  <button class="secondary" @click="loadAboutNotice(true)">重试</button>
                </div>
                <div
                  v-else-if="aboutNotice.html"
                  class="aboutRichText"
                  @click="handleAboutContentClick"
                  v-html="aboutNotice.html"
                ></div>
                <div v-else class="aboutNoticeState">
                  <span>{{ aboutNotice.error || "暂无公告内容。" }}</span>
                  <button class="secondary" @click="loadAboutNotice(true)">重试</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- 游戏右键菜单 -->
    <div
      v-if="contextMenu.visible"
      class="steamContextMenu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
    >
      <!-- HGMM 减法 Phase 3:右键菜单精简(已有大启动按钮 + 游戏信息 modal 入口未用) -->
      <template v-if="false">
      <button @click.stop="openContextGameInfo">
        <Info :size="14" /> 游戏信息
      </button>
      </template>
      <button @click.stop="openContextGameSettings">
        <Settings :size="14" /> 高级设置
      </button>
      <button @click.stop="openContextGameCustomRules">
        <Wrench :size="14" /> 定制规则
      </button>
      <template v-if="false">
      <button @click.stop="launchContextGame">
        <Play :size="14" /> 启动游戏
      </button>
      </template>
      <button @click.stop="openContextGameFolder">
        <FolderOpen :size="14" /> 打开目录
      </button>
      <button @click.stop="deleteContextGame">
        <Trash2 :size="14" style="color: var(--c-danger);" /> 删除游戏
      </button>
    </div>
  </div>
</template>
