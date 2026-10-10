import * as electron from "electron";
import AdmZip from "adm-zip";
import * as yauzl from "yauzl";
import { ProxyAgent } from "undici";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { rename as renameAsync } from "node:fs/promises";
import { createHash, createHmac, randomUUID } from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, rmSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { path7za } from "7zip-bin";

// 怀沙:7-Zip 探测三层优先级
// 1. 资源内置(resources/win-x64/7zip/7z.exe)—— 7-Zip 26.03 x64,LGPL 自带兜底,用户机器无需装 7-Zip
// 2. 系统安装(系统 7-Zip 通常 >= 22.01 带完整 RAR5 解码)
// 3. npm 7zip-bin 5.2.0(7-Zip 21.07,某些 RAR5 变种不能解)
//
// 重要:必须用 7z.exe (GUI launcher) + 7z.dll,不是 7za.exe (standalone CLI)
// 7-Zip 26.x 起 7za.exe 不再含 RAR 编解码,只有 7z.exe + 7z.dll 才有
//
// 返回 { exe, cwd } — 7z.exe 需要 cwd 指向同目录才能加载 7z.dll
// Windows 的 spawn 不会自动去 exe 同目录找依赖,这是常见 gotcha
let cached7za: { exe: string; cwd: string | null; source: string } | null = null;
function resolve7zaExecutable(): { exe: string; cwd: string | null; source: string } {
  if (cached7za !== null) return cached7za;

  // Helper:给定 exe 绝对路径,返回 { exe, cwd, source }
  const build = (exe: string, source: string) => {
    const cwd = dirname(exe);
    return { exe, cwd, source };
  };

  if (process.platform === "win32") {
    // 1. 资源内置(由 electron-builder extraResources 打到 process.resourcesPath)
    try {
      const bundledExe = getResourcePath("win-x64/7zip/7z.exe");
      if (existsSync(bundledExe)) {
        cached7za = build(bundledExe, "bundled 7-Zip (resources/win-x64/7zip)");
        console.log("[hgmm] extractWith7za: using", cached7za.source, cached7za.exe);
        return cached7za;
      }
    } catch {
      // getResourcePath / existsSync 异常时继续探测下一层
    }

    // 2. 系统安装(用户机器已装 7-Zip)
    const systemCandidates = [
      "C:/Program Files/7-Zip/7z.exe",
      "C:/Program Files (x86)/7-Zip/7z.exe"
    ];
    for (const candidate of systemCandidates) {
      try {
        if (existsSync(candidate)) {
          cached7za = build(candidate, "system 7-Zip");
          console.log("[hgmm] extractWith7za: using", cached7za.source, cached7za.exe);
          return cached7za;
        }
      } catch {
        // 探测失败继续尝试下一个
      }
    }
  }

  // 3. npm 包兜底(7-Zip 21.07)
  cached7za = build(path7za, "7zip-bin 21.07 (fallback)");
  console.log("[hgmm] extractWith7za: using", cached7za.source, cached7za.exe);
  return cached7za;
}
import {
  cp,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  stat,
  writeFile
} from "node:fs/promises";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const PASS_FILE_NAMES = new Set([
  "readme.md",
  "manifest.json",
  "icon.png",
  "changelog.md",
  "license"
]);
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
const MOD_PREVIEW_FOLDER = "mod-preview";
const LEGACY_PACKAGE_EXTENSION = ["g", "m", "m"].join("");
const ARCHIVE_EXTENSIONS = ["zip", "mmp", LEGACY_PACKAGE_EXTENSION];
const STEAM_LIBRARY_KEY = "HKEY_CURRENT_USER\\Software\\Valve\\Steam";
const NEXUS_GRAPHQL_URL = "https://api-router.nexusmods.com/graphql";
const NEXUS_API_URL = "https://api.nexusmods.com";
const NEXUS_OAUTH_URL = "https://users.nexusmods.com/oauth";
const NEXUS_OAUTH_CLIENT_ID = "vortex_loopback";
const NXM_PROTOCOL = "nxm";
// 怀沙:关于页面公告 HTML 远程拉取(取代本地 resources/about-notice.html,避免 asar/extraResources 路径分裂)
const ABOUT_NOTICE_URL = "https://hgmm.hs2049.cn/about.html";
let mainWindow: electron.BrowserWindow | null = null;
const pendingNxmUrls: string[] = [];
const downloadControllers = new Map<string, AbortController>();
const proxyAgents = new Map<string, ProxyAgent>();
const aria2Tasks = new Map<string, {
  gid: string;
  cancelled: boolean;
}>();
let aria2Runtime: {
  process: ReturnType<typeof spawn>;
  port: number;
  secret: string;
  executablePath: string;
} | null = null;
let translationQueue = Promise.resolve();
let activeNexusOAuth:
  | {
      finish: (error?: Error, result?: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        user: {
          key: string;
          name: string;
          email: string;
          profileUrl: string;
          avatar?: string;
          isPremium: boolean;
          isSupporter: boolean;
        };
      }) => void;
    }
  | null = null;

function normalizeProxyUrl(proxyUrl = "") {
  const value = proxyUrl.trim();
  if (!value) return "";

  if (/^(http|https|socks|socks4|socks5):\/\//iu.test(value)) {
    return value;
  }

  return `http://${value}`;
}

function proxyAgent(proxyUrl = "") {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return undefined;

  const existing = proxyAgents.get(normalized);
  if (existing) return existing;

  const agent = new ProxyAgent(normalized);
  proxyAgents.set(normalized, agent);
  return agent;
}

function fetchWithProxy(input: Parameters<typeof fetch>[0], init: RequestInit & { proxyUrl?: string } = {}) {
  const { proxyUrl, ...requestInit } = init;
  const dispatcher = proxyAgent(proxyUrl);

  return fetch(input, {
    ...requestInit,
    ...(dispatcher ? { dispatcher } : {})
  } as RequestInit & { dispatcher?: ProxyAgent });
}

function findAria2Executable(configuredPath = "") {
  const configured = configuredPath.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`aria2c.exe 不存在：${configured}`);
    }
    return configured;
  }

  const bundledPath = getResourcePath("aria2/aria2c.exe");
  if (existsSync(bundledPath)) return bundledPath;

  return "aria2c";
}

async function findFreePort() {
  const server = net.createServer();

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));

  if (!port) {
    throw new Error("无法为 aria2 分配本地 RPC 端口。");
  }

  return port;
}

async function aria2Rpc<T>(runtime: {
  port: number;
  secret: string;
}, method: string, parameters: unknown[] = []) {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/jsonrpc`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: [`token:${runtime.secret}`, ...parameters]
    })
  });
  const payload = await response.json().catch(() => ({})) as {
    result?: T;
    error?: {
      code?: number;
      message?: string;
    };
  };

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `aria2 请求失败：HTTP ${response.status}`);
  }

  return payload.result as T;
}

async function ensureAria2Runtime(configuredPath = "", maxConnections = 4) {
  const executablePath = findAria2Executable(configuredPath);
  if (
    aria2Runtime &&
    aria2Runtime.executablePath === executablePath &&
    !aria2Runtime.process.killed
  ) {
    return aria2Runtime;
  }

  aria2Runtime?.process.kill();
  const port = await findFreePort();
  const secret = randomUUID().replace(/-/gu, "");
  const child = spawn(executablePath, [
    "--enable-rpc=true",
    "--rpc-listen-all=false",
    "--rpc-listen-port", String(port),
    "--rpc-secret", secret,
    "--console-log-level=warn",
    "--auto-file-renaming=false",
    "--allow-overwrite=true",
    "--max-concurrent-downloads", String(Math.max(1, Math.min(16, Number(maxConnections) || 4)))
  ], {
    windowsHide: true,
    stdio: "ignore"
  });

  const runtime = {
    process: child,
    port,
    secret,
    executablePath
  };
  aria2Runtime = runtime;

  child.once("exit", () => {
    if (aria2Runtime?.process === child) {
      aria2Runtime = null;
    }
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await aria2Rpc(runtime, "aria2.getVersion");
      return runtime;
    } catch (caught) {
      lastError = caught;
      await sleep(100);
    }
  }

  child.kill();
  aria2Runtime = null;
  throw new Error(
    `无法启动 aria2，请确认 aria2c.exe 可执行。${lastError instanceof Error ? ` ${lastError.message}` : ""}`
  );
}

function abortDownloadError() {
  const error = new Error("下载已暂停");
  error.name = "AbortError";
  return error;
}

async function downloadWithAria2(options: {
  taskId?: string;
  url: string;
  outputPath: string;
  resume?: boolean;
  aria2ExecutablePath?: string;
  aria2MaxConnections?: number;
}) {
  const taskId = options.taskId?.trim();
  const runtime = await ensureAria2Runtime(
    options.aria2ExecutablePath,
    options.aria2MaxConnections
  );

  await mkdir(dirname(options.outputPath), { recursive: true });
  const gid = await aria2Rpc<string>(runtime, "aria2.addUri", [[options.url], {
    dir: dirname(options.outputPath),
    out: basename(options.outputPath),
    continue: options.resume ? "true" : "false",
    "allow-overwrite": "true",
    "auto-file-renaming": "false",
    "file-allocation": "none",
    split: String(Math.max(1, Math.min(16, Number(options.aria2MaxConnections) || 4))),
    "max-connection-per-server": String(Math.max(1, Math.min(16, Number(options.aria2MaxConnections) || 4))),
    "user-agent": "HuaishaGameModManager",
    "summary-interval": "1"
  }]);
  const taskState = { gid, cancelled: false };

  if (taskId) {
    aria2Tasks.set(taskId, taskState);
  }

  try {
    while (true) {
      if (taskState.cancelled) {
        throw abortDownloadError();
      }

      const status = await aria2Rpc<{
        status?: string;
        completedLength?: string;
        totalLength?: string;
        downloadSpeed?: string;
        errorCode?: string;
        errorMessage?: string;
      }>(runtime, "aria2.tellStatus", [gid, [
        "status",
        "completedLength",
        "totalLength",
        "downloadSpeed",
        "errorCode",
        "errorMessage"
      ]]);
      const receivedBytes = Number(status.completedLength) || 0;
      const totalBytes = Number(status.totalLength) || receivedBytes;

      if (taskId && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("downloads:progress", {
          taskId,
          receivedBytes,
          totalBytes
        });
      }

      if (status.status === "complete") {
        await aria2Rpc(runtime, "aria2.removeDownloadResult", [gid]).catch(() => undefined);
        return {
          outputPath: options.outputPath,
          receivedBytes,
          totalBytes
        };
      }

      if (status.status === "error" || status.status === "removed") {
        throw new Error(
          status.errorMessage ||
          `aria2 下载失败${status.errorCode ? `（错误码 ${status.errorCode}）` : ""}`
        );
      }

      await sleep(500);
    }
  } catch (caught) {
    if (taskState.cancelled) {
      throw abortDownloadError();
    }
    throw caught;
  } finally {
    if (taskId && aria2Tasks.get(taskId) === taskState) {
      aria2Tasks.delete(taskId);
    }
  }
}

function getResourcePath(fileName: string) {
  return isDev
    ? join(electron.app.getAppPath(), "resources", fileName)
    : join(process.resourcesPath, "resources", fileName);
}

function readWindowState() {
  const fallback = {
    width: 1200,
    height: 800
  };
  const filePath = join(electron.app.getPath("userData"), "window-state.json");

  try {
    const saved = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<Electron.Rectangle>;

    return {
      width: Math.max(1024, Number(saved.width) || fallback.width),
      height: Math.max(768, Number(saved.height) || fallback.height),
      x: typeof saved.x === "number" ? saved.x : undefined,
      y: typeof saved.y === "number" ? saved.y : undefined
    };
  } catch {
    return fallback;
  }
}

function saveWindowState(win: electron.BrowserWindow) {
  if (win.isDestroyed() || win.isMinimized()) return;

  const bounds = win.getBounds();
  const filePath = join(electron.app.getPath("userData"), "window-state.json");

  void mkdir(dirname(filePath), { recursive: true })
    .then(() => writeFile(filePath, JSON.stringify(bounds, null, 2), "utf-8"));
}

function createWindow() {
  const windowState = readWindowState();
  const win = new electron.BrowserWindow({
    ...windowState,
    minWidth: 1024,
    minHeight: 768,
    title: "怀沙模组管理器",
    icon: getResourcePath("icon.ico"),
    backgroundColor: "#0f1216",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  win.webContents.on("did-finish-load", () => {
    while (pendingNxmUrls.length > 0) {
      win.webContents.send("nxm:open", pendingNxmUrls.shift());
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  win.on("close", () => saveWindowState(win));
}

function findNxmUrl(argv: string[]) {
  return argv.find((arg) => /^nxm:\/\//i.test(arg)) ?? "";
}

function dispatchNxmUrl(url: string) {
  if (!url) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();

    if (!mainWindow.webContents.isLoadingMainFrame()) {
      mainWindow.webContents.send("nxm:open", url);
      return;
    }
  }

  pendingNxmUrls.push(url);
}

function registerNxmProtocol() {
  if (isDev || process.defaultApp) {
    const appPath = electron.app.getAppPath() || process.argv[1];

    if (appPath) {
      electron.app.setAsDefaultProtocolClient(NXM_PROTOCOL, process.execPath, [
        resolve(appPath)
      ]);
      return;
    }
  }

  electron.app.setAsDefaultProtocolClient(NXM_PROTOCOL);
}

async function ensureJsonFile<T>(fileName: string, fallback: T) {
  const appData = join(electron.app.getPath("userData"), "data");
  const filePath = join(appData, fileName);
  await mkdir(appData, { recursive: true });

  // 2026-10-05 重命名迁移:mayfly 基座时代(2026-09-23 复制)的数据文件叫
  //   mayfly-library.json,跟现在"怀沙模组管理器"产品名不一致。每次 ensureJsonFile
  //   都检查一次:旧文件存在 + 新文件不存在 → rename 迁移。新文件不存在就建 fallback。
  //   新文件已存在(用户已经在新版跑过、丢了旧文件后又找回来等场景)就跳过迁移,避免覆盖新数据。
  if (fileName === "huaisha-library.json") {
    const legacyPath = join(appData, "mayfly-library.json");
    if (existsSync(legacyPath) && !existsSync(filePath)) {
      await renameAsync(legacyPath, filePath);
    }
  }

  if (!existsSync(filePath)) {
    await writeFile(filePath, JSON.stringify(fallback, null, 2), "utf-8");
  }

  return filePath;
}

/**
 * BUG-020 自愈:store JSON 文件被截断/拼接多个对象时,定位第一个完整顶层对象并截断。
 *
 * 触发场景:`store:write` 用 writeFile 非原子写,崩溃窗口(V8 OOM / 进程被 SIGKILL / 系统断电)
 * 落在 writeFile 完成前 → 文件含部分新内容,可能尾部还拼着旧内容的尾部
 * (因 writeFile 实际是 open(O_TRUNC) + write,可能产生 "新内容前段 + 旧内容尾部" 拼接)。
 *
 * 修复策略:
 * 1. 扫描大括号深度,找第一个真正闭合的顶层对象边界
 * 2. 验证截断后 JSON 合规
 * 3. 自愈后立即重写回盘(下次启动正常 read)
 *
 * 返回:
 * - `parsed object` — 自愈成功,返回解析后的对象
 * - `undefined` — 无法自愈(文件更严重损坏),调用方应返回 fallback
 */
async function tryRepairStoreFile(filePath: string, raw: string, originalError: Error): Promise<unknown | undefined> {
  const start = raw.indexOf("{");
  if (start < 0) return undefined;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  let i = start;
  while (i < raw.length) {
    const c = raw[i];
    if (esc) {
      esc = false;
    } else if (c === "\\") {
      esc = true;
    } else if (c === '"') {
      inStr = !inStr;
    } else if (!inStr) {
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    i += 1;
  }

  if (end <= 0) return undefined;

  const candidate = raw.slice(start, end);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }

  // 自愈成功:备份坏文件 + 重写干净版本(同样用原子写)
  const dropped = raw.length - end;
  const backupPath = filePath + ".corrupted-" + Date.now() + ".bak";
  try {
    await writeFile(backupPath, raw, "utf-8");
    const tmpPath = filePath + ".tmp";
    await writeFile(tmpPath, candidate, "utf-8");
    await renameAsync(tmpPath, filePath);
    console.warn(
      `[store:read 自愈] ${basename(filePath)} 解析失败 (${originalError.message}),` +
        `裁掉尾部 ${dropped} 字节冗余,坏文件已备份到 ${basename(backupPath)}`,
    );
  } catch (repairErr) {
    // 自愈写盘失败 — 仍然返回解析结果给本次调用(内存中可用),下次启动再试
    console.error(
      `[store:read 自愈] ${basename(filePath)} 解析成功但写盘失败: ${(repairErr as Error).message}`,
    );
  }

  return parsed;
}

async function listFiles(rootPath: string, currentPath = rootPath): Promise<string[]> {
  try {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const nextPath = join(currentPath, entry.name);

        if (entry.isDirectory()) {
          return listFiles(rootPath, nextPath);
        }

        return [relative(rootPath, nextPath).replace(/\\/g, "/")];
      })
    );

    return files.flat();
  } catch (caught) {
    // BUG-025(2026-10-07):卸载/清理场景下,rootPath 可能已被清理或不存在(BUG-022
    //   引入的 subFile 平铺部署会让 mod.rootPath 指向临时解压目录,卸载时若临时目录
    //   已被删,readdir 抛 ENOENT)。目录不存在 = 0 个文件可处理,直接返回空数组。
    // 解压校验场景(main.ts:1129)目标路径由 cleanDirectory 先保底,此分支几乎不会触发;
    //   若触发,extracted.length === 0 的下游校验会兜底报"解压后无文件",语义合理。
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw caught;
  }
}

type PackageProgressPayload = {
  operationId: string;
  operation: "import" | "export";
  phase: string;
  current: number;
  total: number;
  message: string;
};

function sendPackageProgress(sender: electron.WebContents, payload: PackageProgressPayload) {
  if (!sender.isDestroyed()) {
    sender.send("package:progress", payload);
  }
}

function yieldToRenderer() {
  return new Promise<void>((resolveNext) => {
    setImmediate(resolveNext);
  });
}

function isPathInside(rootPath: string, targetPath: string) {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const rel = relative(root, target);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertPathInside(rootPath: string, targetPath: string, label = "目标路径") {
  if (!isPathInside(rootPath, targetPath)) {
    throw new Error(`${label} 超出允许目录：${targetPath}`);
  }
}

function safeJoin(rootPath: string, ...paths: string[]) {
  const target = join(rootPath, ...paths);
  assertPathInside(rootPath, target);
  return target;
}

type InstallTargetScope = "game" | "documents" | "appData";

function normalizeTargetScope(scope: unknown): InstallTargetScope {
  return scope === "documents" || scope === "appData" ? scope : "game";
}

function getTargetScopeRoot(gamePath: string, scope: InstallTargetScope) {
  switch (scope) {
    case "documents":
      return electron.app.getPath("documents");
    case "appData":
      return dirname(electron.app.getPath("appData"));
    case "game":
    default:
      return gamePath;
  }
}

function formatScopedFile(scope: InstallTargetScope, file: string) {
  return scope === "game" ? file : `${scope}:${file}`;
}

function parseScopedFile(file: string): { scope: InstallTargetScope; path: string } {
  const match = file.match(/^(documents|appData):(.+)$/u);
  return match
    ? { scope: match[1] as InstallTargetScope, path: match[2] }
    : { scope: "game", path: file };
}

function runProcess(command: string, args: string[], options: { cwd?: string } = {}) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...(options.cwd ? { cwd: options.cwd } : {})
    });
    const output: string[] = [];
    const errors: string[] = [];

    child.stdout.on("data", (chunk) => output.push(String(chunk)));
    child.stderr.on("data", (chunk) => errors.push(String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveOutput(output.join(""));
      } else {
        reject(new Error(errors.join("") || output.join("") || `进程退出码：${code}`));
      }
    });
  });
}

function toPowerShellLiteral(value: string) {
  return `'${value.replace(/'/gu, "''")}'`;
}

async function invokeManagedTool<T = unknown>(options: {
  assemblyPath: string;
  typeName: string;
  methodName: string;
  payload?: unknown;
}) {
  if (process.platform !== "win32") {
    throw new Error("当前仅支持在 Windows 环境下调用 .NET 工具。");
  }

  if (!existsSync(options.assemblyPath)) {
    throw new Error(`未找到托管工具：${options.assemblyPath}`);
  }

  const hasPayload = "payload" in options;
  const payloadText = JSON.stringify(hasPayload ? options.payload : null);
  const jsonBridgeTypeDefinition = [
    "using System;",
    "using System.Collections;",
    "using System.Collections.Generic;",
    "using System.Dynamic;",
    "using System.Web.Script.Serialization;",
    "public static class MayflyDynamicJsonBridge {",
    "    public static object Parse(string json) {",
    "        if (String.IsNullOrWhiteSpace(json)) return null;",
    "        var serializer = new JavaScriptSerializer();",
    "        return ToDynamic(serializer.DeserializeObject(json));",
    "    }",
    "    private static object ToDynamic(object value) {",
    "        var dictionary = value as IDictionary<string, object>;",
    "        if (dictionary != null) {",
    "            IDictionary<string, object> expando = new ExpandoObject();",
    "            foreach (var pair in dictionary) expando[pair.Key] = ToDynamic(pair.Value);",
    "            return (ExpandoObject)expando;",
    "        }",
    "        var list = value as ArrayList;",
    "        if (list != null) {",
    "            var result = new List<object>();",
    "            foreach (var item in list) result.Add(ToDynamic(item));",
    "            return result;",
    "        }",
    "        return value;",
    "    }",
    "}"
  ].join("\n");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$assemblyPath = ${toPowerShellLiteral(options.assemblyPath)}`,
    `$typeName = ${toPowerShellLiteral(options.typeName)}`,
    `$methodName = ${toPowerShellLiteral(options.methodName)}`,
    `$payloadText = ${toPowerShellLiteral(payloadText)}`,
    `$hasPayload = ${toPowerShellLiteral(hasPayload ? "1" : "0")}`,
    `$jsonBridgeTypeDefinition = ${toPowerShellLiteral(jsonBridgeTypeDefinition)}`,
    "if (-not ('MayflyDynamicJsonBridge' -as [type])) { Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition $jsonBridgeTypeDefinition }",
    "$assembly = [Reflection.Assembly]::LoadFrom($assemblyPath)",
    "$type = $assembly.GetType($typeName, $true)",
    "$bindingFlags = [Reflection.BindingFlags]'Public, NonPublic, Instance, Static, DeclaredOnly'",
    "$expectedParameterCount = if ($hasPayload -eq '1') { 1 } else { 0 }",
    "$methodCandidates = $type.GetMethods($bindingFlags) | Where-Object { $_.Name -eq $methodName }",
    "$method = $methodCandidates | Where-Object { $_.GetParameters().Length -eq $expectedParameterCount } | Select-Object -First 1",
    "if ($null -eq $method -and $expectedParameterCount -eq 0) { $method = $methodCandidates | Where-Object { $_.GetParameters().Length -eq 1 } | Select-Object -First 1 }",
    "if ($null -eq $method) { throw \"未找到方法: $typeName::$methodName\" }",
    "$payload = $null",
    "if ($hasPayload -eq '1') { $payload = [MayflyDynamicJsonBridge]::Parse($payloadText) }",
    "$instance = if ($method.IsStatic) { $null } else { [Activator]::CreateInstance($type, $true) }",
    "$parameterCount = $method.GetParameters().Length",
    "if ($parameterCount -gt 1) { throw \"暂不支持调用多参数方法: $typeName::$methodName\" }",
    "$parameters = New-Object object[] $parameterCount",
    "if ($parameterCount -eq 1) { $parameters[0] = $payload }",
    "$result = $method.Invoke($instance, $parameters)",
    "if ($result -is [System.Threading.Tasks.Task]) { $result.GetAwaiter().GetResult() | Out-Null; $resultType = $result.GetType(); if ($resultType.IsGenericType) { $result = $resultType.GetProperty('Result').GetValue($result) } else { $result = $null } }",
    "[Console]::Write((ConvertTo-Json -Depth 100 -Compress -InputObject $result))"
  ].join("\n");
  const raw = await runProcess("powershell", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ]);

  return (raw.trim() ? JSON.parse(raw) : null) as T;
}

/**
 * HGMM marker mod 清单(2026-10-04)+ INI 风格 `key=value` 行格式:
 *
 *   HGMM-MOD-MANIFEST
 *   game=<presetId>
 *   version=<number>
 *   created=<date string>
 *
 * - 首行必须严格等于 `HGMM-MOD-MANIFEST`(哨兵)
 * - 后续每行 `key=value`,value 不引号(避免 escape 麻烦)
 * - `game` 必填,must 匹配当前游戏的 presetId(否则拒绝解压,避免装错游戏)
 * - `version` 当前仅记录不校验(预留 schema 演迁)
 * - `created` 仅展示用,不参与逻辑
 *
 * 用户打包教程:在压缩包根目录放一个 `.hgmm_mod` / `HGMM-MOD-MANIFEST`
 *   文件,内容如上 4 行。客户端检测到 game 匹配就跳过"导入到 storagePath",
 *   直接解压到游戏根目录(走 effectiveGamePath 考虑 gameBasePath 偏移),
 *   **不创建 LocalMod 记录**(跟 BUG-016 round 3 subFile 一致)。
 */
const MARKER_MOD_SENTINEL = "HGMM-MOD-MANIFEST";
const MARKER_MOD_FILENAMES = new Set([
  ".hgmm_mod",
  "HGMM-MOD-MANIFEST",
  ".hgmm-mod-manifest",
]);

interface MarkerModManifest {
  game: string;
  version: string;
  created: string;
}

function parseMarkerModContent(raw: string): MarkerModManifest | null {
  // 容忍 BOM 和 CRLF/LF
  const cleaned = raw.replace(/^﻿/, "").replace(/\r\n?/gu, "\n");
  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  if (lines[0] !== MARKER_MOD_SENTINEL) return null;

  const fields: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    // 跳过注释(# / // 开头)
    if (line.startsWith("#") || line.startsWith("//")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // 没 = 或 = 在开头都跳过
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key) fields[key] = val;
  }
  if (!fields.game) return null;
  return {
    game: fields.game,
    version: fields.version ?? "",
    created: fields.created ?? "",
  };
}

/**
 * 不展开整个压缩包,只嗅探是否存在 marker manifest,解析其 game 字段。
 * 用于 importLocalModsFromPaths 主循环里快速判断"应该走 marker 分支"。
 *
 * 返回:
 * - `{ kind: "marker", manifest }` — 找到 marker 且 game 匹配
 * - `{ kind: "wrong-game", manifest }` — 找到 marker 但 game 不匹配(抛错给 UI)
 * - `null` — 没有 marker,走原导入路径
 */
async function peekMarkerModInArchive(
  sourcePath: string,
  expectedGame: string,
): Promise<{ kind: "marker" | "wrong-game"; manifest: MarkerModManifest } | null> {
  const stat = await fsp.stat(sourcePath);
  if (stat.isDirectory()) return null;

  const format = await detectArchiveFormat(sourcePath);
  if (format === "unknown") return null;

  let content: string | null = null;

  if (format === "zip") {
    // zip: yauzl 流式读 — **不**用 AdmZip(它 readFileSync 整个文件到内存,大 zip 会爆 buffer)
    // yauzl 只读中央目录(末尾几百字节),entry 内容流式 inflate,内存占用 < 1MB
    try {
      content = await new Promise<string | null>((resolve) => {
        yauzl.open(sourcePath, { lazyEntries: true }, (err, zipfile) => {
          if (err || !zipfile) { resolve(null); return; }
          zipfile.on("entry", (entry) => {
            const name = entry.fileName.split("/").pop() ?? entry.fileName;
            const baseName = name.trim();
            if (MARKER_MOD_FILENAMES.has(baseName) || MARKER_MOD_FILENAMES.has(entry.fileName)) {
              // 命中 marker,流式读 entry 数据(只 inflate 这一个 entry)
              zipfile.openReadStream(entry, (rsErr, stream) => {
                if (rsErr || !stream) { zipfile.close(); resolve(null); return; }
                const chunks: Buffer[] = [];
                stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                stream.on("end", () => {
                  zipfile.close();
                  resolve(Buffer.concat(chunks).toString("utf-8"));
                });
                stream.on("error", () => { zipfile.close(); resolve(null); });
              });
            } else {
              // 不命中 → 读下一个 entry
              zipfile.readEntry();
            }
          });
          zipfile.on("error", () => resolve(null));
          zipfile.on("end", () => resolve(null));
          zipfile.readEntry();
        });
      });
    } catch {
      content = null;
    }
  } else if (format === "7z" || format === "rar") {
    // 7z/rar:marker mod 包可能很大(整合包 800MB+),"7za e 整包解到 tmpDir 再读 marker" 会爆内存/磁盘。
    // 修复:对每个候选 marker 文件名试抽到空 tmpDir(7za e <archive> <fname> 只抽单文件),
    //   失败(文件不在包里)→ 抛错被 inner catch 吞,试下一个;成功 → 读内容。
    // 抽完即删 tmpDir,不影响 gameRoot,也不占额外空间(只占 marker 文件本身,几百字节)。
    const tmpDir = await fsp.mkdtemp(join(tmpdir(), "hgmm-marker-"));
    try {
      const sevenZip = resolve7zaExecutable();
      for (const fname of MARKER_MOD_FILENAMES) {
        try {
          await runProcess(
            sevenZip.exe,
            ["e", "-y", `-o${tmpDir}`, sourcePath, fname],
            { cwd: sevenZip.cwd ?? undefined },
          );
          const candidate = join(tmpDir, fname);
          if (existsSync(candidate)) {
            content = await readFile(candidate, "utf-8");
            // 抽到目标后立刻删,避免下个候选抽同名文件时被覆盖前误导
            await rm(candidate, { force: true });
            if (content) break;
          }
        } catch {
          // 这个候选不在包里,试下一个
          continue;
        }
      }
    } catch {
      content = null;
    } finally {
      // 清理临时目录
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // 静默
      }
    }
  }

  if (!content) return null;
  const manifest = parseMarkerModContent(content);
  if (!manifest) return null;
  return {
    kind: manifest.game === expectedGame ? "marker" : "wrong-game",
    manifest,
  };
}

/**
 * 解压 marker mod 到 effectiveGamePath(直接到游戏根目录)。
 *
 * 复用 extractWith7z 流程(清空目录 → 解压)但路径换成 gameRoot 而非 storagePath。
 * 返回 { extractedTo: effectiveGamePath } 给前端做提示。
 */
async function deployMarkerModToGameRoot(
  sourcePath: string,
  effectiveGamePath: string,
): Promise<{ extractedTo: string; manifest: MarkerModManifest }> {
  // 安全校验:effectiveGamePath 必须是已解析的绝对路径
  // (importLocalModsFromPaths 上层已经 resolveGamePath 拿到,我们信任)
  const stat = await fsp.stat(sourcePath);
  if (stat.size === 0) {
    throw new Error(`文件为空:${basename(sourcePath)}。可能是下载中断,请重新下载。`);
  }

  // 注意:不解空游戏根(会删 bin/dlc/等)
  // 7za x -y 与 AdmZip 都是"覆盖同名文件,不删其它文件",符合 mod 部署语义
  // 残留旧文件问题留作后续 FEATURE,如需清理由 modType="absolute" 路径单独做

  const format = await detectArchiveFormat(sourcePath);
  if (format === "zip" || (ARCHIVE_EXTENSIONS.includes(getPathExtension(sourcePath)) && format === "unknown")) {
    // zip 路径 + 兜底(扩展名是 zip 但嗅探失败 — 走 validateArchiveFile)
    if (format === "unknown") await validateArchiveFile(sourcePath);
    // **BUG-019 round 3 修复**:`new AdmZip(path)` 会 readFileSync 整个 zip 到内存(adm-zip.js:72),
    // 800MB+ 整合包会再次触发 "Array buffer allocation failed"。
    // 改用 yauzl 流式 inflate:每个 entry 单独 openReadStream → pipe 到磁盘 writeFile,
    // 内存峰值只占单个 entry(几 MB)。yauzl 只读中央目录(末尾几百字节)即可枚举所有 entry。
    let extractedCount = 0;
    await new Promise<void>((resolve, reject) => {
      yauzl.open(sourcePath, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) { reject(err ?? new Error("无法打开 zip")); return; }
        zipfile.on("entry", (entry) => {
          // marker manifest 自身不解到游戏目录(避免污染)
          const entryBaseName = (entry.fileName.split(/[\\/]/u).pop() ?? entry.fileName).trim();
          if (MARKER_MOD_FILENAMES.has(entryBaseName) || MARKER_MOD_FILENAMES.has(entry.fileName)) {
            zipfile.readEntry();
            return;
          }
          // 安全校验:entry 不含 `..`(防 zip slip)
          if (entry.fileName.includes("..")) {
            zipfile.close();
            reject(new Error(`zip entry 含非法路径: ${entry.fileName}`));
            return;
          }
          const entryTarget = join(effectiveGamePath, entry.fileName.replace(/^[\\/]+/u, ""));
          // /0x8000 = directory bit flag;yauzl 不一定标记目录,需要 entry.fileName 末尾是否带 /
          const isDirectory = /\/$/u.test(entry.fileName);
          if (isDirectory) {
            mkdir(entryTarget, { recursive: true })
              .then(() => zipfile.readEntry())
              .catch((mkErr) => { zipfile.close(); reject(mkErr); });
          } else {
            mkdir(dirname(entryTarget), { recursive: true })
              .then(() => zipfile.openReadStream(entry, (rsErr, stream) => {
                if (rsErr || !stream) { zipfile.close(); reject(rsErr ?? new Error("无法打开 entry 流")); return; }
                const out = createWriteStream(entryTarget);
                stream.on("error", (sErr) => { out.destroy(); zipfile.close(); reject(sErr); });
                out.on("error", (wErr: NodeJS.ErrnoException) => { zipfile.close(); reject(wErr); });
                out.on("finish", () => {
                  extractedCount += 1;
                  zipfile.readEntry();
                });
                stream.pipe(out);
              }))
              .catch((mkErr) => { zipfile.close(); reject(mkErr); });
          }
        });
        zipfile.on("error", (zErr) => reject(zErr));
        zipfile.on("end", () => resolve());
        zipfile.readEntry();
      });
    });
    // 兜底:解压后没有任何文件落到 gameRoot → 报错(整合包不能装"空")
    if (extractedCount === 0) {
      throw new Error(
        `zip marker mod 解压后 ${effectiveGamePath} 下没有任何文件(可能存档结构异常),请检查 ${sourcePath}`
      );
    }
  } else if (format === "7z" || format === "rar") {
    // 7z/rar 路径:7za 解到游戏根,随后删除 marker 文件(避免污染游戏目录)
    const sevenZip = resolve7zaExecutable();
    await runProcess(sevenZip.exe, ["x", "-y", `-o${effectiveGamePath}`, sourcePath], { cwd: sevenZip.cwd ?? undefined });
    // 删除 marker manifest 文件(7z 解到游戏根后会有这个文件,不删会污染)
    for (const fname of MARKER_MOD_FILENAMES) {
      const candidate = join(effectiveGamePath, fname);
      if (existsSync(candidate)) {
        await rm(candidate, { force: true });
      }
    }
  } else {
    throw new Error(`不支持的压缩包格式:${basename(sourcePath)}`);
  }

  return { extractedTo: effectiveGamePath, manifest: { game: "", version: "", created: "" } };
}

async function extractWith7za(sourcePath: string, targetPath: string) {
  // HGMM Phase 5.x:把 7-Zip 的内部错误("Is not archive" / "Cannot open")包装成人话
  // 触发场景:文件魔数看起来对(前 8 字节匹配 RAR/7z),但内容已损坏或不完整下载
  try {
    const sevenZip = resolve7zaExecutable();
    const listing = await runProcess(sevenZip.exe, ["l", "-slt", sourcePath], { cwd: sevenZip.cwd ?? undefined });
    const paths = listing
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("Path = "))
      .map((line) => line.slice("Path = ".length).trim())
      .filter((entryPath) => entryPath && entryPath !== sourcePath);

    // HGMM Phase 2 修复:7z 存档若用绝对 Windows 路径创建,7za l 列出的就是绝对路径,
    // 原 safeJoin(targetPath, absPath) 必触发 "超出允许目录"(因为 join 后变成
    // "targetPath\\H:\\Kali\\..." 看起来越界,即使绝对路径其实在 storage 内)。
    // 跳过 safeJoin 校验,直接让 7za 用 -o{targetPath} 提取(7za 会把 entry 的绝对
    // 路径相对于 -o 重写,产物实际落在 targetPath 下)。解压后用 listFiles 校验:
    // 如果 modRoot 下无文件,说明存档有恶意/损坏路径,抛错给上层。
    if (paths.some((p) => /^[a-z]:[\\/]/iu.test(p))) {
      console.warn(
        "[hgmm] extractWith7za: archive contains absolute Windows paths," +
        " skipping safeJoin pre-check (mayfly safeJoin is overly strict for 7z)",
        { sourcePath, targetPath }
      );
    } else {
      for (const entryPath of paths) {
        safeJoin(targetPath, entryPath);
      }
    }

    await runProcess(sevenZip.exe, ["x", "-y", `-o${targetPath}`, sourcePath], { cwd: sevenZip.cwd ?? undefined });
  } catch (caught) {
    if (caught instanceof Error && /Is not archive|Cannot open/i.test(caught.message)) {
      const fileStat = await stat(sourcePath);
      throw new Error(
        `7-Zip 无法识别该文件为压缩包(${basename(sourcePath)},${fileStat.size} 字节)。` +
        `可能是文件损坏 / 下载不完整。请到 Nexus 验证文件状态后重新下载。`,
      );
    }
    throw caught;
  }

  // 解压后校验:必须真的有文件落到 modRoot(说明 7za -o 生效)
  const extracted = await listFiles(targetPath);
  if (extracted.length === 0) {
    throw new Error(
      `解压后 ${targetPath} 下没有任何文件,可能存档损坏或路径异常,请检查 ${sourcePath}`
    );
  }
}

function parseVdfStringValue(raw: string, key: string) {
  const match = raw.match(new RegExp(`"${key}"\\s+"([^"]+)"`, "i"));
  return match?.[1]?.replace(/\\\\/g, "\\") ?? "";
}

async function getSteamInstallPath() {
  if (process.platform !== "win32") return "";

  try {
    const output = await runProcess("reg", ["query", STEAM_LIBRARY_KEY, "/v", "SteamPath"]);
    const match = output.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    return match?.[1]?.trim().replace(/\//g, "\\") ?? "";
  } catch {
    return "";
  }
}

async function findSteamGamePath(steamAppId: number) {
  if (!steamAppId) return "";

  const steamPath = await getSteamInstallPath();
  if (!steamPath) return "";

  const libraryFile = join(steamPath, "steamapps", "libraryfolders.vdf");
  const libraryRoots = [steamPath];

  try {
    const raw = await readFile(libraryFile, "utf-8");
    const pathMatches = raw.matchAll(/"path"\s+"([^"]+)"/gi);

    for (const match of pathMatches) {
      const libraryPath = match[1]?.replace(/\\\\/g, "\\");
      if (libraryPath && !libraryRoots.includes(libraryPath)) {
        libraryRoots.push(libraryPath);
      }
    }
  } catch {
    // Steam 旧版或文件缺失时只使用 Steam 主目录。
  }

  for (const root of libraryRoots) {
    const manifestPath = join(root, "steamapps", `appmanifest_${steamAppId}.acf`);
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = await readFile(manifestPath, "utf-8");
      const installDir = parseVdfStringValue(raw, "installdir");
      if (!installDir) continue;

      const gamePath = join(root, "steamapps", "common", installDir);
      if (existsSync(gamePath)) return gamePath;
    } catch {
      continue;
    }
  }

  return "";
}


function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function normalizeNexusText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nexusHeaders(options: {
  apiKey?: string;
  accessToken?: string;
}, requireAuthorization = false) {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const normalizedApiKey = options.apiKey?.trim() ?? "";
  const normalizedAccessToken = options.accessToken?.trim() ?? "";

  if (normalizedApiKey) {
    headers.apikey = normalizedApiKey;
  }

  if (normalizedAccessToken) {
    headers.Authorization = `Bearer ${normalizedAccessToken}`;
  }

  if (requireAuthorization && !normalizedApiKey && !normalizedAccessToken) {
    throw new Error("请先登录 NexusMods。");
  }

  return headers;
}

function buildNexusWebsite(gameDomain: string, modId: string, fileId?: string) {
  const url = new URL(`https://www.nexusmods.com/${gameDomain}/mods/${modId}`);

  if (fileId) {
    url.searchParams.set("tab", "files");
    url.searchParams.set("file_id", fileId);
    url.searchParams.set("nmm", "1");
  }

  return url.toString();
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as T & { message?: string, errors?: Array<{message?: string}> };

  if (!response.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }

  if (payload?.errors && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message || fallbackMessage);
  }

  return payload as T;
}

function parseVersion(version: string) {
  return String(version || "")
    .trim()
    .split(".")
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? item : 0));
}

function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function normalizeUpdatePayload(payload: Record<string, unknown> = {}) {
  return {
    versionName: String(payload.versionName || payload.version || payload.Version || ""),
    downloadUrl: String(payload.downloadUrl || payload.DownloadUrl || ""),
    updateLog: String(payload.updateLog || payload.Description || ""),
    forceUpdate:
      payload.forceUpdate === true ||
      payload.forceUpdate === 1 ||
      String(payload.forceUpdate || "").toLowerCase() === "true"
  };
}

async function checkAppUpdate(options: {
  updateUrl: string;
  currentVersion?: string;
  proxyUrl?: string;
}) {
  const updateUrl = String(options.updateUrl || "").trim();

  if (!updateUrl) {
    throw new Error("请先填写应用更新地址。");
  }

  // 怀沙:不附加 cache buster 时间戳,保留原始 URL 便于服务端按路径做统计
  // 缓存绕开依赖 fetch 的 cache: "no-store" + Cache-Control 头
  const response = await fetchWithProxy(updateUrl, {
    proxyUrl: options.proxyUrl,
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });
  const payload = await readJsonResponse<Record<string, unknown>>(response, "检查应用更新失败。");
  const remote = normalizeUpdatePayload(payload);
  const currentVersionName = String(options.currentVersion || electron.app.getVersion() || "");
  const versionCompare = remote.versionName
    ? compareVersions(remote.versionName, currentVersionName)
    : 0;

  return {
    hasUpdate: versionCompare > 0,
    versionCompare,
    currentVersionName,
    remote
  };
}

async function fetchRemoteJson(options: {
  url: string;
  proxyUrl?: string;
}) {
  const rawUrl = String(options.url || "").trim();
  if (!rawUrl) {
    throw new Error("远程内容地址不能为空。");
  }

  const remoteUrl = new URL(rawUrl);
  if (!["http:", "https:"].includes(remoteUrl.protocol)) {
    throw new Error("远程内容地址只支持 http/https。");
  }

  // 怀沙:不附加 cache buster 时间戳,保留原始 URL 便于服务端按路径做统计
  const response = await fetchWithProxy(remoteUrl.toString(), {
    proxyUrl: options.proxyUrl,
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": `HuaishaGameModManager/${electron.app.getVersion()}`
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`远程内容读取失败：HTTP ${response.status}`);
  }

  if (text.length > 1024 * 1024) {
    throw new Error("远程内容过大，已拒绝读取。");
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("远程内容不是有效 JSON。");
  }
}

function nexusOAuthPage(success: boolean, message: string) {
  const title = success ? "怀沙模组管理器 登录成功" : "怀沙模组管理器 登录失败";
  const color = success ? "#65d6ad" : "#ff7b86";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#10151c;color:#e8edf3;font-family:Segoe UI,sans-serif">
    <main style="max-width:520px;padding:32px;text-align:center">
      <h1 style="color:${color};font-size:24px">${title}</h1>
      <p style="color:#b7c0cc">${message}</p>
      <p style="color:#7f8b99;font-size:13px">可以关闭此页面并返回 怀沙模组管理器。</p>
    </main>
  </body>
</html>`;
}

async function startNexusOAuthLogin(proxyUrl = "") {
  activeNexusOAuth?.finish(new Error("网页登录已重新开始。"));

  const verifier = `${randomUUID()}${randomUUID()}`.replace(/-/gu, "");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "127.0.0.1"}`
      );

      if (requestUrl.pathname !== "/") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state") ?? "";
      const code = requestUrl.searchParams.get("code") ?? "";
      const oauthError = requestUrl.searchParams.get("error") ?? "";
      const oauthErrorDescription = requestUrl.searchParams.get("error_description") ?? "";

      if (returnedState !== state) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(false, "登录状态已失效，请重新开始网页登录。"));
        activeNexusOAuth?.finish(new Error("Nexus 登录状态校验失败。"));
        return;
      }

      if (oauthError || !code) {
        const message = oauthErrorDescription || "Nexus 没有返回授权结果。";
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(false, message));
        activeNexusOAuth?.finish(new Error(message));
        return;
      }

      try {
        const tokenResponse = await fetchWithProxy(`${NEXUS_OAUTH_URL}/token`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: NEXUS_OAUTH_CLIENT_ID,
            redirect_uri: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
            code,
            code_verifier: verifier
          }).toString(),
          proxyUrl
        });
        const token = await readJsonResponse<{
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        }>(tokenResponse, "Nexus OAuth 令牌交换失败。");

        const accessToken = String(token.access_token ?? "").trim();
        const refreshToken = String(token.refresh_token ?? "").trim();
        if (!accessToken) {
          throw new Error("Nexus 没有返回访问令牌。");
        }

        let userPayload: Record<string, unknown> = {};

        try {
          const userResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/users/validate.json`, {
            method: "GET",
            headers: nexusHeaders({ accessToken }, true),
            proxyUrl
          });
          userPayload = await readJsonResponse<Record<string, unknown>>(
            userResponse,
            "获取 Nexus 用户信息失败。"
          );
        } catch {
          const userResponse = await fetchWithProxy(`${NEXUS_OAUTH_URL}/userinfo`, {
            method: "GET",
            headers: nexusHeaders({ accessToken }, true),
            proxyUrl
          });
          userPayload = await readJsonResponse<Record<string, unknown>>(
            userResponse,
            "获取 Nexus 用户信息失败。"
          );
        }

        const result = {
          accessToken,
          refreshToken,
          // HGMM 隐藏功能(2026-09-29 / FEATURE-012):暂时强制 6 小时过期,不用 Nexus 返回的 expires_in(默认 1h)
          // 原因:Nexus OAuth 自动续期(refreshToken)长期有效 → 用户 30 天不重登 → 设备安全风险
          //      + 主动刷新可能撞 Nexus 反滥用边界(known-risks #1)
          // 当前行为:6 小时后 accessToken 过期 → renderer catch → clearNexusAuth → 用户重新 OAuth 登录
          // 启用自动续期时:恢复 `Number(token.expires_in) || 3600`
          expiresAt: Date.now() + 6 * 3600 * 1000,
          user: {
            key: "",
            name: firstString(
              userPayload.name,
              userPayload.username,
              userPayload.preferred_username,
              "Nexus 用户"
            ),
            email: firstString(userPayload.email),
            profileUrl: firstString(userPayload.profile_url, userPayload.profileUrl),
            avatar: firstString(userPayload.avatar_url, userPayload.avatar, userPayload.picture) || undefined,
            isPremium: Boolean(userPayload.is_premium ?? userPayload.isPremium),
            isSupporter: Boolean(userPayload.is_supporter ?? userPayload.isSupporter)
          }
        };

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(true, "Nexus 账户已经连接。"));
        activeNexusOAuth?.finish(undefined, result);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Nexus 登录失败。";
        response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(false, message));
        activeNexusOAuth?.finish(new Error(message));
      }
    })();
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法启动 Nexus 登录回调服务。");
  }

  const redirectUri = `http://127.0.0.1:${address.port}`;
  const authorizeUrl = new URL(`${NEXUS_OAUTH_URL}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    scope: "openid profile email",
    code_challenge_method: "S256",
    client_id: NEXUS_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge
  }).toString();

  return new Promise((resolveLogin, rejectLogin) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error("网页登录等待超时，请重试。"));
    }, 5 * 60 * 1000);

    const finish = (error?: Error, result?: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      user: {
        key: string;
        name: string;
        email: string;
        profileUrl: string;
        avatar?: string;
        isPremium: boolean;
        isSupporter: boolean;
      };
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (activeNexusOAuth?.finish === finish) {
        activeNexusOAuth = null;
      }
      server.close();
      if (error) {
        rejectLogin(error);
      } else if (result) {
        resolveLogin(result);
      } else {
        rejectLogin(new Error("Nexus 登录没有返回结果。"));
      }
    };

    activeNexusOAuth = { finish };
    void electron.shell.openExternal(authorizeUrl.toString()).catch((caught) => {
      finish(caught instanceof Error ? caught : new Error("无法打开 Nexus 登录页面。"));
    });
  });
}

electron.ipcMain.handle("nexus:refreshAccessToken", async (_event, options: {
  refreshToken: string;
  proxyUrl?: string;
}) => {
  const refreshToken = options.refreshToken?.trim() ?? "";
  if (!refreshToken) {
    throw new Error("缺少 refreshToken,无法刷新 Nexus 访问令牌。");
  }
  const response = await fetchWithProxy(`${NEXUS_OAUTH_URL}/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: NEXUS_OAUTH_CLIENT_ID,
      refresh_token: refreshToken
    }).toString(),
    proxyUrl: options.proxyUrl
  });
  const token = await readJsonResponse<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>(response, "Nexus OAuth 刷新失败,请重新登录。");
  const newAccessToken = String(token.access_token ?? "").trim();
  // Nexus 偶尔会换发新的 refresh_token,如果没给就保留旧的
  const newRefreshToken = String(token.refresh_token ?? "").trim() || refreshToken;
  if (!newAccessToken) {
    throw new Error("Nexus 刷新响应中没有访问令牌。");
  }
  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000
  };
});

function sleep(ms: number) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function splitTextForTranslation(text: string, maxLength = 1800) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let buffer = "";
  const parts = normalized.split(/(\n{2,}|[。！？.!?]\s+|\n)/u);

  for (const part of parts) {
    if (!part) continue;

    if ((buffer + part).length <= maxLength) {
      buffer += part;
      continue;
    }

    if (buffer.trim()) {
      chunks.push(buffer.trim());
      buffer = "";
    }

    if (part.length <= maxLength) {
      buffer = part;
      continue;
    }

    for (let index = 0; index < part.length; index += maxLength) {
      chunks.push(part.slice(index, index + maxLength).trim());
    }
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

function parseGoogleGtxPayload(payload: unknown) {
  if (!Array.isArray(payload)) return "";
  const sentences = Array.isArray(payload[0]) ? payload[0] : [];

  return sentences
    .map((item) => Array.isArray(item) && typeof item[0] === "string" ? item[0] : "")
    .join("")
    .trim();
}

function requireTranslationSecret(value: string | undefined, label: string) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`请先在设置里填写${label}。`);
  }

  return normalized;
}

async function translateGoogleGtxText(options: {
  text: string;
  targetLang: "zh-CN";
  sourceLang?: string;
  proxyUrl?: string;
}) {
  const chunks = splitTextForTranslation(options.text);
  if (chunks.length === 0) return "";

  const translated: string[] = [];

  for (const chunk of chunks) {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", options.sourceLang?.trim() || "auto");
    url.searchParams.set("tl", options.targetLang);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", chunk);

    const response = await fetchWithProxy(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      proxyUrl: options.proxyUrl
    });

    if (response.status === 429) {
      throw new Error("翻译请求过快，Google 免费接口返回 429，请稍后再试。");
    }

    if (!response.ok) {
      throw new Error(`Google 免费翻译接口请求失败：HTTP ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const text = parseGoogleGtxPayload(payload);

    if (!text) {
      throw new Error("Google 免费翻译接口没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

async function translateBaiduText(options: {
  text: string;
  appId?: string;
  secret?: string;
  proxyUrl?: string;
}) {
  const appId = requireTranslationSecret(options.appId, "百度翻译 AppID");
  const secret = requireTranslationSecret(options.secret, "百度翻译密钥");
  const chunks = splitTextForTranslation(options.text, 1500);
  const translated: string[] = [];

  for (const chunk of chunks) {
    const salt = randomUUID().replace(/-/g, "");
    const sign = createHash("md5").update(`${appId}${chunk}${salt}${secret}`).digest("hex");
    const body = new URLSearchParams({
      q: chunk,
      from: "auto",
      to: "zh",
      appid: appId,
      salt,
      sign
    });
    const response = await fetchWithProxy("https://api.fanyi.baidu.com/api/trans/vip/translate", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      proxyUrl: options.proxyUrl
    });
    const payload = await response.json().catch(() => ({})) as {
      error_code?: string;
      error_msg?: string;
      trans_result?: Array<{ dst?: string }>;
    };

    if (!response.ok || payload.error_code) {
      throw new Error(payload.error_msg || `百度翻译请求失败：${payload.error_code || response.status}`);
    }

    const text = payload.trans_result?.map((item) => item.dst || "").join("\n").trim();
    if (!text) {
      throw new Error("百度翻译没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

function truncateYoudaoText(text: string) {
  return text.length <= 20
    ? text
    : `${text.slice(0, 10)}${text.length}${text.slice(-10)}`;
}

async function translateYoudaoText(options: {
  text: string;
  appKey?: string;
  secret?: string;
  proxyUrl?: string;
}) {
  const appKey = requireTranslationSecret(options.appKey, "有道智云应用 ID");
  const secret = requireTranslationSecret(options.secret, "有道智云应用密钥");
  const chunks = splitTextForTranslation(options.text, 1500);
  const translated: string[] = [];

  for (const chunk of chunks) {
    const salt = randomUUID();
    const curtime = String(Math.floor(Date.now() / 1000));
    const signText = `${appKey}${truncateYoudaoText(chunk)}${salt}${curtime}${secret}`;
    const sign = createHash("sha256").update(signText).digest("hex");
    const body = new URLSearchParams({
      q: chunk,
      from: "auto",
      to: "zh-CHS",
      appKey,
      salt,
      sign,
      signType: "v3",
      curtime
    });
    const response = await fetchWithProxy("https://openapi.youdao.com/api", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      proxyUrl: options.proxyUrl
    });
    const payload = await response.json().catch(() => ({})) as {
      errorCode?: string;
      translation?: string[];
      l?: string;
    };

    if (!response.ok || payload.errorCode !== "0") {
      throw new Error(`有道翻译请求失败：${payload.errorCode || response.status}`);
    }

    const text = payload.translation?.join("\n").trim();
    if (!text) {
      throw new Error("有道翻译没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function tencentDate(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function volcengineXDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

function volcengineShortDate(xDate: string) {
  return xDate.slice(0, 8);
}

function volcengineCanonicalQuery(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function volcengineSigningKey(secretAccessKey: string, date: string, region: string, service: string) {
  const dateKey = hmacSha256(secretAccessKey, date);
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, service);
  return hmacSha256(serviceKey, "request");
}

function createVolcengineAuthorization(options: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  host: string;
  method: string;
  path: string;
  query: string;
  payload: string;
  xDate: string;
}) {
  const payloadHash = sha256Hex(options.payload);
  const shortDate = volcengineShortDate(options.xDate);
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${options.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${options.xDate}`
  ].join("\n") + "\n";
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    options.method,
    options.path,
    options.query,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${shortDate}/${options.region}/${options.service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    options.xDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = createHmac("sha256", volcengineSigningKey(
    options.secretAccessKey,
    shortDate,
    options.region,
    options.service
  )).update(stringToSign).digest("hex");

  return {
    authorization: `HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    payloadHash
  };
}

function groupVolcengineTextList(chunks: string[]) {
  const groups: string[][] = [];
  let group: string[] = [];
  let totalLength = 0;

  for (const chunk of chunks) {
    if (group.length >= 16 || totalLength + chunk.length > 4800) {
      groups.push(group);
      group = [];
      totalLength = 0;
    }

    group.push(chunk);
    totalLength += chunk.length;
  }

  if (group.length > 0) {
    groups.push(group);
  }

  return groups;
}

async function translateTencentText(options: {
  text: string;
  secretId?: string;
  secretKey?: string;
  region?: string;
  proxyUrl?: string;
}) {
  const secretId = requireTranslationSecret(options.secretId, "腾讯云 SecretId");
  const secretKey = requireTranslationSecret(options.secretKey, "腾讯云 SecretKey");
  const region = options.region?.trim() || "ap-guangzhou";
  const chunks = splitTextForTranslation(options.text, 1800);
  const translated: string[] = [];

  for (const chunk of chunks) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      SourceText: chunk,
      Source: "auto",
      Target: "zh",
      ProjectId: 0
    });
    const canonicalHeaders = "content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\n";
    const signedHeaders = "content-type;host";
    const canonicalRequest = [
      "POST",
      "/",
      "",
      canonicalHeaders,
      signedHeaders,
      sha256Hex(payload)
    ].join("\n");
    const date = tencentDate(timestamp);
    const credentialScope = `${date}/tmt/tc3_request`;
    const stringToSign = [
      "TC3-HMAC-SHA256",
      String(timestamp),
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join("\n");
    const secretDate = hmacSha256(`TC3${secretKey}`, date);
    const secretService = hmacSha256(secretDate, "tmt");
    const secretSigning = hmacSha256(secretService, "tc3_request");
    const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetchWithProxy("https://tmt.tencentcloudapi.com", {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json; charset=utf-8",
        Host: "tmt.tencentcloudapi.com",
        "X-TC-Action": "TextTranslate",
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": "2018-03-21",
        "X-TC-Region": region
      },
      body: payload,
      proxyUrl: options.proxyUrl
    });
    const result = await response.json().catch(() => ({})) as {
      Response?: {
        TargetText?: string;
        Error?: {
          Code?: string;
          Message?: string;
        };
      };
    };
    const error = result.Response?.Error;

    if (!response.ok || error) {
      throw new Error(error?.Message || `腾讯云翻译请求失败：${error?.Code || response.status}`);
    }

    const text = result.Response?.TargetText?.trim();
    if (!text) {
      throw new Error("腾讯云翻译没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

async function translateVolcengineText(options: {
  text: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  proxyUrl?: string;
}) {
  const accessKeyId = requireTranslationSecret(options.accessKeyId, "火山引擎 AccessKey ID");
  const secretAccessKey = requireTranslationSecret(options.secretAccessKey, "火山引擎 Secret AccessKey");
  const region = options.region?.trim() || "cn-north-1";
  const host = "translate.volcengineapi.com";
  const service = "translate";
  const query = volcengineCanonicalQuery({
    Action: "TranslateText",
    Version: "2020-06-01"
  });
  const chunks = splitTextForTranslation(options.text, 4500);
  const translated: string[] = [];

  for (const textList of groupVolcengineTextList(chunks)) {
    const payload = JSON.stringify({
      TargetLanguage: "zh",
      TextList: textList
    });
    const xDate = volcengineXDate();
    const signed = createVolcengineAuthorization({
      accessKeyId,
      secretAccessKey,
      region,
      service,
      host,
      method: "POST",
      path: "/",
      query,
      payload,
      xDate
    });
    const response = await fetchWithProxy(`https://${host}/?${query}`, {
      method: "POST",
      headers: {
        Authorization: signed.authorization,
        "Content-Type": "application/json",
        Host: host,
        "X-Content-Sha256": signed.payloadHash,
        "X-Date": xDate
      },
      body: payload,
      proxyUrl: options.proxyUrl
    });
    const result = await response.json().catch(() => ({})) as {
      TranslationList?: Array<{ Translation?: string; DetectedSourceLanguage?: string }>;
      ResponseMetadata?: { Error?: { Code?: string; Message?: string } };
      ResponseMetaData?: { Error?: { Code?: string; Message?: string } };
    };
    const error = result.ResponseMetadata?.Error ?? result.ResponseMetaData?.Error;

    if (!response.ok || error) {
      throw new Error(error?.Message || `火山引擎翻译请求失败：${error?.Code || response.status}`);
    }

    const texts = result.TranslationList?.map((item) => item.Translation?.trim() || "").filter(Boolean) ?? [];
    if (texts.length === 0) {
      throw new Error("火山引擎翻译没有返回有效译文。");
    }

    translated.push(...texts);
    await sleep(250);
  }

  return translated.join("\n\n");
}

function normalizeOllamaBaseUrl(baseUrl?: string) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/u, "");
  return normalized || "http://127.0.0.1:11434";
}

function ollamaPrompt(text: string) {
  return [
    "你是游戏 Mod 内容翻译助手。",
    "请把下面内容翻译成简体中文。",
    "保留 Mod 名称、文件名、路径、代码、版本号、工具名和专有名词。",
    "只输出译文，不要解释，不要添加额外说明。",
    "",
    "内容：",
    text
  ].join("\n");
}

async function translateOllamaText(options: {
  text: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  proxyUrl?: string;
}) {
  const model = requireTranslationSecret(options.model, "Ollama 模型名");
  const chunks = splitTextForTranslation(options.text, 2400);
  const translated: string[] = [];
  const endpoint = `${normalizeOllamaBaseUrl(options.baseUrl)}/api/generate`;
  const timeoutMs = Math.max(10000, Number(options.timeoutMs) || 120000);

  for (const chunk of chunks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchWithProxy(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          prompt: ollamaPrompt(chunk),
          stream: false,
          options: {
            temperature: 0.1
          }
        }),
        proxyUrl: options.proxyUrl,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({})) as {
        response?: string;
        error?: string;
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || `Ollama 翻译请求失败：HTTP ${response.status}`);
      }

      const text = String(payload.response || "").trim();
      if (!text) {
        throw new Error("Ollama 没有返回有效译文。");
      }

      translated.push(text);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        throw new Error("Ollama 翻译超时，请检查模型是否已启动或调大超时时间。");
      }
      throw caught;
    } finally {
      clearTimeout(timeout);
    }
  }

  return translated.join("\n\n");
}

async function translateTextByProvider(options: {
  text: string;
  provider?: string;
  targetLang: "zh-CN";
  sourceLang?: string;
  proxyUrl?: string;
  baiduAppId?: string;
  baiduSecret?: string;
  youdaoAppKey?: string;
  youdaoSecret?: string;
  tencentSecretId?: string;
  tencentSecretKey?: string;
  tencentRegion?: string;
  volcengineAccessKeyId?: string;
  volcengineSecretAccessKey?: string;
  volcengineRegion?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTimeoutMs?: number;
}) {
  switch (options.provider) {
    case "baidu":
      return translateBaiduText({
        text: options.text,
        appId: options.baiduAppId,
        secret: options.baiduSecret,
        proxyUrl: options.proxyUrl
      });
    case "youdao":
      return translateYoudaoText({
        text: options.text,
        appKey: options.youdaoAppKey,
        secret: options.youdaoSecret,
        proxyUrl: options.proxyUrl
      });
    case "tencent":
      return translateTencentText({
        text: options.text,
        secretId: options.tencentSecretId,
        secretKey: options.tencentSecretKey,
        region: options.tencentRegion,
        proxyUrl: options.proxyUrl
      });
    case "volcengine":
      return translateVolcengineText({
        text: options.text,
        accessKeyId: options.volcengineAccessKeyId,
        secretAccessKey: options.volcengineSecretAccessKey,
        region: options.volcengineRegion,
        proxyUrl: options.proxyUrl
      });
    case "ollama":
      return translateOllamaText({
        text: options.text,
        baseUrl: options.ollamaBaseUrl,
        model: options.ollamaModel,
        timeoutMs: options.ollamaTimeoutMs,
        proxyUrl: options.proxyUrl
      });
    case "google-gtx":
    default:
      return translateGoogleGtxText({
        text: options.text,
        targetLang: options.targetLang,
        sourceLang: options.sourceLang,
        proxyUrl: options.proxyUrl
      });
  }
}

function enqueueTranslation<T>(task: () => Promise<T>) {
  const queued = translationQueue.then(task, task);
  translationQueue = queued.then(
    () => undefined,
    () => undefined
  );

  return queued;
}

function normalizeNexusFile(file: Record<string, unknown>, gameDomain: string, modId: string) {
  const fileId = String(file.file_id ?? "");
  const sizeKb = Number(file.size_kb ?? 0);
  const sizeBytes = Number(file.size_in_bytes ?? 0);

  return {
    id: fileId,
    name: normalizeNexusText(file.name) || normalizeNexusText(file.file_name) || `file-${fileId}`,
    version: normalizeNexusText(file.version) || normalizeNexusText(file.mod_version),
    size: sizeBytes || sizeKb * 1024 || 0,
    createdAt: normalizeNexusText(file.uploaded_time),
    categoryName: normalizeNexusText(file.category_name),
    downloadUrl: buildNexusWebsite(gameDomain, modId, fileId),
    detailsUrl: buildNexusWebsite(gameDomain, modId, fileId)
  };
}

function normalizeNexusFiles(files: Array<Record<string, unknown>>, gameDomain: string, modId: string) {
  const prioritized = files.filter((file) =>
    ["MAIN", "OPTIONAL"].includes(normalizeNexusText(file.category_name))
  );
  const list = prioritized.length > 0 ? prioritized : files;
  const weight = (categoryName: string) => {
    if (categoryName === "MAIN") return 0;
    if (categoryName === "OPTIONAL") return 1;
    return 2;
  };

  return list
    .sort((left, right) =>
      weight(normalizeNexusText(left.category_name)) - weight(normalizeNexusText(right.category_name)) ||
      Number(right.uploaded_timestamp ?? 0) - Number(left.uploaded_timestamp ?? 0)
    )
    .map((file) => normalizeNexusFile(file, gameDomain, modId));
}

function normalizeNexusImage(image: Record<string, unknown>, index: number) {
  const imageId = String(image.id ?? image.image_id ?? index);
  const thumbnailUrl = firstString(
    image.thumbnail_url,
    image.thumbnail_uri,
    image.thumbnail,
    image.thumb,
    image.small_url,
    image.small_uri,
    image.url,
    image.uri
  );
  const imageUrl = firstString(
    image.original_url,
    image.original_uri,
    image.image_url,
    image.image_uri,
    image.large_url,
    image.large_uri,
    image.url,
    image.uri,
    thumbnailUrl
  );

  return {
    id: imageId,
    title: firstString(image.name, image.title, image.description) || `image-${imageId}`,
    thumbnailUrl,
    imageUrl
  };
}

function normalizeNexusImages(images: Array<Record<string, unknown>>) {
  return images
    .map((image, index) => normalizeNexusImage(image, index))
    .filter((image) => image.thumbnailUrl || image.imageUrl);
}

function normalizeNexusDetail(
  mod: Record<string, unknown>,
  files: Array<Record<string, unknown>>,
  images: Array<Record<string, unknown>>,
  gameDomain: string
) {
  const modId = String(mod.mod_id ?? "");
  const normalizedFiles = normalizeNexusFiles(files, gameDomain, modId);
  const normalizedImages = normalizeNexusImages(images);
  const user = mod.user && typeof mod.user === "object" ? mod.user as Record<string, unknown> : {};
  const cover = normalizeNexusText(mod.picture_url) || normalizedImages[0]?.imageUrl || normalizedImages[0]?.thumbnailUrl || "";
  const category = mod.category && typeof mod.category === "object" ? mod.category as Record<string, unknown> : {};
  const categories = [
    firstString(mod.category_name, mod.categoryName, category.name, category.category_name)
  ].filter(Boolean);

  return {
    id: modId,
    title: normalizeNexusText(mod.name),
    summary: normalizeNexusText(mod.summary),
    author: normalizeNexusText(mod.author) || normalizeNexusText(mod.uploaded_by) || normalizeNexusText(user.name),
    version: normalizeNexusText(mod.version),
    website: buildNexusWebsite(gameDomain, modId),
    cover,
    downloads: Math.max(0, Number(mod.mod_downloads ?? 0)),
    likes: Math.max(0, Number(mod.endorsement_count ?? 0)),
    categories,
    createdAt: normalizeNexusText(mod.created_time),
    updatedAt: normalizeNexusText(mod.updated_time),
    nsfw: Boolean(mod.contains_adult_content),
    filesCount: normalizedFiles.length,
    primaryFile: normalizedFiles[0] ?? null,
    description: normalizeNexusText(mod.description) || normalizeNexusText(mod.summary),
    descriptionFormat: normalizeNexusText(mod.description) ? "html" : "text",
    images: normalizedImages,
    files: normalizedFiles
  };
}

function sanitizeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-").trim() || "download.bin";
}

function normalizeNexusFacetOptions(source?: Record<string, number>) {
  return Object.entries(source ?? {})
    .map(([value, count]) => ({
      label: value,
      value,
      count: Math.max(0, Number(count) || 0)
    }))
    .filter((item) => item.value)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          return firstString(
            (item as Record<string, unknown>).name,
            (item as Record<string, unknown>).id,
            (item as Record<string, unknown>).modId
          );
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,，\n\r]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function smapiDependencyIds(value: unknown) {
  if (!Array.isArray(value)) {
    return stringArray(value);
  }

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();

      if (item && typeof item === "object") {
        const dependency = item as Record<string, unknown>;
        return firstString(dependency.UniqueID, dependency.uniqueId, dependency.id, dependency.name);
      }

      return "";
    })
    .filter(Boolean);
}

async function readManifest(rootPath: string, files: string[]) {
  const manifestPath = files.find((file) => basename(file).toLowerCase() === "manifest.json");
  if (!manifestPath) {
    return {};
  }

  try {
    const raw = await readFile(join(rootPath, manifestPath), "utf-8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const contentPackFor = manifest.ContentPackFor && typeof manifest.ContentPackFor === "object"
      ? manifest.ContentPackFor as Record<string, unknown>
      : manifest.contentPackFor && typeof manifest.contentPackFor === "object"
        ? manifest.contentPackFor as Record<string, unknown>
        : {};
    const contentPackForId = firstString(contentPackFor.UniqueID, contentPackFor.uniqueId, contentPackFor.id);
    const dependencies = smapiDependencyIds(manifest.Dependencies ?? manifest.dependencies);

    return {
      name: firstString(manifest.Name, manifest.name, manifest.title, manifest.modName, manifest.displayName),
      version: firstString(manifest.Version, manifest.version, manifest.modVersion),
      author: firstString(manifest.Author, manifest.author, manifest.authorName, manifest.creator, manifest.owner),
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
  } catch {
    return {};
  }
}

function findCoverImage(files: string[]) {
  return files.find((file) => COVER_FILE_NAMES.has(basename(file).toLowerCase())) ?? "";
}

/**
 * HGMM Phase 5.x:嗅探压缩包真实格式(基于前 8 字节魔数)
 *
 * 用途:Nexus 上传者经常给 RAR / 7z 文件挂 .zip 扩展名(比如
 * "Better Night Light V2.6.zip" 实际内容是 RAR)。如果只看扩展名会
 * 错路由到 AdmZip 路径 → "No END header" 错误。
 *
 * 返回:
 * - "zip" / "7z" / "rar":魔数匹配,文件可解压
 * - "unknown":魔数不符(HTML / JSON / 损坏),调用方应再调 validateArchiveFile 看具体原因
 */
async function detectArchiveFormat(filePath: string): Promise<"zip" | "7z" | "rar" | "unknown"> {
  const fileStat = await stat(filePath);
  if (fileStat.size < 6) return "unknown";

  const handle = await open(filePath, "r");
  const buffer = Buffer.alloc(8);
  let bytesRead = 0;
  try {
    const result = await handle.read(buffer, 0, 8, 0);
    bytesRead = result.bytesRead;
  } finally {
    await handle.close();
  }

  if (bytesRead < 4) return "unknown";

  // ZIP: PK\x03/05/07
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
    return "zip";
  }

  // 7z: 37 7A BC AF 27 1C
  if (bytesRead >= 6 &&
      buffer[0] === 0x37 && buffer[1] === 0x7A && buffer[2] === 0xBC && buffer[3] === 0xAF) {
    return "7z";
  }

  // RAR v4/v5: 52 61 72 21 1A 07 ...
  if (bytesRead >= 7 &&
      buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21) {
    return "rar";
  }

  return "unknown";
}

/**
 * 怀沙:Nexus 上传者经常把 RAR/7z 改名为 .zip — 嗅探真实格式,如果扩展名错就返回正确路径
 * 调用方需要自行 rename 文件(可能跨平台 / 失败时不想改原文件)
 * 例如:`xxx.zip`(实际 RAR)→ 返回 `xxx.rar`(同目录)
 */
async function correctArchiveExtension(filePath: string): Promise<string> {
  const currentExt = getPathExtension(filePath).toLowerCase();
  if (!ARCHIVE_EXTENSIONS.includes(currentExt) && !["7z", "rar"].includes(currentExt)) {
    return filePath; // 已经是正确扩展名或非压缩包,不动
  }
  let detected: "zip" | "7z" | "rar" | "unknown";
  try {
    detected = await detectArchiveFormat(filePath);
  } catch {
    return filePath;
  }
  if (detected === "unknown" || detected === currentExt) {
    return filePath; // 嗅不到或一致,不重命名
  }
  // 把 .zip 改成实际格式
  return filePath.slice(0, -(currentExt.length + 1)) + "." + detected;
}

/**
 * HGMM Phase 5.x:压缩包文件前置检测
 *
 * AdmZip 在构造时硬性要求合法 ZIP,否则抛 "No END header found"。
 * 这个错误对用户完全无语义(就是文件坏了吗?是 Nexus 返回 HTML?是后缀错?)。
 *
 * 先 sniff 魔数 + 大小,把常见失败模式变成人话:
 * - 0 字节 → 下载中断 / 引擎没写成功
 * - < 200 字节 → 几乎肯定是 Nexus 错误页或重定向
 * - HTML / XML → Nexus 返回错误页(登录失效 / 带宽超限 / 文件下架)
 * - JSON → Nexus API 错误响应
 * - 7z 魔数但扩展名是 .zip → Nexus 上传者标错扩展名
 * - RAR 魔数但扩展名是 .zip → 同上
 * - ZIP 魔数 → 放行(交回 AdmZip 处理后续,仍坏就让它抛原始错误)
 *
 * 不验证 .7z / .rar 路径,因为 extractWith7za 本身就是 7z 引擎不会出错。
 */
async function validateArchiveFile(filePath: string): Promise<void> {
  const fileName = basename(filePath);
  const fileStat = await stat(filePath);

  if (fileStat.size === 0) {
    throw new Error(
      `下载文件为空(0 字节):${fileName}。可能是网络中断或下载被取消,请重新下载。`,
    );
  }
  if (fileStat.size < 200) {
    throw new Error(
      `下载文件过小(${fileStat.size} 字节):${fileName}。` +
      `通常是 Nexus 返回的错误页面或重定向。请到 nexusmods.com 验证文件状态后重新下载。`,
    );
  }

  // 读前 16 字节做魔数检测
  const handle = await open(filePath, "r");
  const buffer = Buffer.alloc(16);
  let bytesRead = 0;
  try {
    const result = await handle.read(buffer, 0, 16, 0);
    bytesRead = result.bytesRead;
  } finally {
    await handle.close();
  }

  if (bytesRead < 4) {
    throw new Error(
      `下载文件过短无法识别格式:${fileName}。可能文件被截断,请重新下载。`,
    );
  }

  const head = buffer.subarray(0, bytesRead);

  // ZIP: PK\x03\x04 (本地文件头)、PK\x05\x06 (空 zip / 结束记录)、PK\x07\x08 (分卷)
  if (head[0] === 0x50 && head[1] === 0x4B && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
    return; // 是合法 ZIP 头,放行
  }

  // 7z: 37 7A BC AF 27 1C
  if (bytesRead >= 6 &&
      head[0] === 0x37 && head[1] === 0x7A && head[2] === 0xBC && head[3] === 0xAF) {
    throw new Error(
      `文件实际是 7z 格式但扩展名为 .zip:${fileName}。` +
      `可能 Nexus 上传者扩展名标错。请手动下载后改扩展名为 .7z 再导入。`,
    );
  }

  // RAR v4: 52 61 72 21 1A 07 00
  // RAR v5: 52 61 72 21 1A 07 01 00
  if (bytesRead >= 7 &&
      head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21) {
    throw new Error(
      `文件实际是 RAR 格式但扩展名为 .zip:${fileName}。` +
      `可能 Nexus 上传者扩展名标错。请手动下载后改扩展名为 .rar 再导入。`,
    );
  }

  // HTML / XML → Nexus 错误页
  const headText = head.toString("utf8").trim().toLowerCase();
  if (
    headText.startsWith("<!doctype") ||
    headText.startsWith("<html") ||
    headText.startsWith("<?xml") ||
    headText.startsWith("<!doctype html")
  ) {
    throw new Error(
      `下载文件是 HTML 页面而非 ZIP:${fileName}。` +
      `通常 Nexus 返回登录失效 / 带宽超限 / 文件已下架的错误页。请到 nexusmods.com 验证后重新下载。`,
    );
  }

  // JSON → Nexus API 错误响应
  if (headText.startsWith("{")) {
    throw new Error(
      `下载文件是 JSON 响应而非 ZIP:${fileName}。` +
      `通常 Nexus API 返回错误。请到 nexusmods.com 验证后重新下载。`,
    );
  }

  // 都不是 → 完全无法识别(可能是损坏的二进制流)
  const hex = Array.from(head.subarray(0, 4))
    .map((b) => `0x${b.toString(16).padStart(2, "0").toUpperCase()}`)
    .join(" ");
  throw new Error(
    `文件格式无法识别(首 4 字节:${hex}):${fileName}。可能是损坏的下载,请重新下载。`,
  );
}

async function findFileByName(rootPath: string, fileNames: string[], maxDepth = 5) {
  const targets = new Set(fileNames.map((fileName) => fileName.toLowerCase()));

  async function visit(currentPath: string, depth: number): Promise<string> {
    if (depth > maxDepth) return "";

    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = join(currentPath, entry.name);

      if (entry.isFile() && targets.has(entry.name.toLowerCase())) {
        return nextPath;
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const found = await visit(join(currentPath, entry.name), depth + 1);
      if (found) return found;
    }

    return "";
  }

  return visit(rootPath, 0);
}

async function isDirectoryEmpty(folderPath: string) {
  try {
    const entries = await readdir(folderPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function deleteEmptyParents(gamePath: string, startFolder: string) {
  let current = startFolder;

  while (isPathInside(gamePath, current) && resolve(current) !== resolve(gamePath)) {
    if (!(await isDirectoryEmpty(current))) {
      return;
    }

    await rm(current, { force: true, recursive: true });
    current = dirname(current);
  }
}

async function deleteRelativeFiles(gamePath: string, files: string[]) {
  const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))]
    .sort((left, right) => normalizePathParts(parseScopedFile(right).path).length - normalizePathParts(parseScopedFile(left).path).length);

  for (const file of uniqueFiles) {
    const scoped = parseScopedFile(file);
    const targetRoot = getTargetScopeRoot(gamePath, scoped.scope);
    const target = safeJoin(targetRoot, scoped.path);
    await rm(target, { force: true, recursive: true });
    await deleteEmptyParents(targetRoot, dirname(target));
  }
}

function isPassFile(filePath: string) {
  const parts = normalizePathParts(filePath);
  return PASS_FILE_NAMES.has(basename(filePath).toLowerCase()) ||
    parts.some((part) => [".mayfly", MOD_PREVIEW_FOLDER].includes(part.toLowerCase()));
}

function normalizePathParts(filePath: string) {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function getExtension(filePath: string) {
  const name = basename(filePath).toLowerCase();
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1);
}

function getPathExtension(filePath: string) {
  const name = basename(filePath).toLowerCase();
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1);
}

function compareFileName(filePath: string, fileName: string) {
  return basename(filePath).toLowerCase() === fileName.toLowerCase();
}

async function readFileMap(dictionaryFile: string) {
  const dictionaryPath = isAbsolute(dictionaryFile)
    ? dictionaryFile
    : [
        join(electron.app.getAppPath(), dictionaryFile),
        join(__dirname, "..", "..", dictionaryFile)
      ].find((candidate) => existsSync(candidate)) ?? join(electron.app.getAppPath(), dictionaryFile);
  const raw = await readFile(dictionaryPath, "utf-8");
  const rows = raw
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter((line) => line && !line.startsWith("#"));
  const map = new Map<string, string>();

  for (const row of rows) {
    const normalized = row.replace(/^\/+/, "");
    const key = basename(normalized).toLowerCase();

    if (key && !map.has(key)) {
      map.set(key, normalized);
    }
  }

  return map;
}

function getFolderFromPath(filePath: string, folderName: string, include = false) {
  const parts = normalizePathParts(filePath);
  const index = parts.findIndex((part) => part.toLowerCase() === folderName.toLowerCase());

  if (index === -1) {
    return "";
  }

  return parts.slice(include ? index : index + 1).join("/");
}

function getUniqueParentFolders(modRoot: string, files: string[]) {
  return [
    ...new Set(
      files.map((file) => join(modRoot, dirname(file))).filter((folder) => folder !== modRoot)
    )
  ];
}

function uniqueRelativeTargets(gamePath: string, targets: string[]) {
  return [
    ...new Set(
      targets
        .map((target) => {
          assertPathInside(gamePath, target);
          return target;
        })
        .map((target) => relative(gamePath, target).replace(/\\/g, "/"))
        .filter(Boolean)
    )
  ];
}

async function planGeneralStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  keepPath?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    files
      .filter((file) => !isPassFile(file))
      .map((file) => options.keepPath ? join(targetRoot, file) : join(targetRoot, basename(file)))
  );
}

async function planFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  include?: boolean;
  spare?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const folders = Array.isArray(options.folderName) ? options.folderName : [options.folderName];
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const targets: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    let relativeInstallPath = "";

    for (const folder of folders) {
      relativeInstallPath = getFolderFromPath(file, folder, options.include);
      if (relativeInstallPath) break;
    }

    if (!relativeInstallPath && options.spare) {
      relativeInstallPath = file;
    }

    if (relativeInstallPath) {
      targets.push(join(targetRoot, relativeInstallPath));
    }
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function planFolderRootStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  targetFolderName?: string;
}) {
  const targetRoot = safeJoin(
    options.gamePath,
    options.installPath || ".",
    sanitizeFileName(options.targetFolderName || basename(options.modRoot))
  );

  return uniqueRelativeTargets(options.gamePath, [targetRoot]);
}

async function planFileStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  useSymlink?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const folders = getUniqueParentFolders(options.modRoot, matched);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const targets: string[] = [];

  for (const folder of folders) {
    const target = join(targetRoot, basename(folder));
    if (options.useSymlink) {
      targets.push(target);
      continue;
    }

    targets.push(
      ...(await listFiles(folder))
        .filter((file) => !isPassFile(file))
        .map((file) => join(target, file))
    );
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function planFileSiblingStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  pass?: string[];
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );

  if (!matched) return [];

  const sourceFolder = join(options.modRoot, dirname(matched));
  const siblingFiles = await listFiles(sourceFolder);
  const pass = new Set((options.pass ?? []).map((item) => item.toLowerCase()));
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    siblingFiles
      .filter((file) => !pass.has(basename(file).toLowerCase()) && !isPassFile(file))
      .map((file) => join(targetRoot, file))
  );
}

async function planFileOnlyStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    matched
      .filter((file) => !isPassFile(file))
      .map((file) => join(targetRoot, basename(file)))
  );
}

async function planFolderParentStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  useSymlink?: boolean;
}) {
  const folderNames = (Array.isArray(options.folderName) ? options.folderName : [options.folderName])
    .map((folder) => folder.toLowerCase())
    .filter(Boolean);
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    normalizePathParts(file).some((part) => folderNames.includes(part.toLowerCase()))
  );

  if (!matched) {
    // BUG-009:plan 也走 fallback,跟 apply 行为一致 — 这样 UI 预览能看到完整文件列表,
    // 不会出现"plan 显示 0 个文件但实际装了 30 个"的诡异体验。
    console.warn(
      `[BUG-009 folderParent plan fallback] modRoot 缺少 ${folderNames.join(",")} 标记文件,` +
        `fallback 为 general+keepPath 行为: ${options.modRoot}`,
    );
    return planGeneralStrategy({
      modRoot: options.modRoot,
      gamePath: options.gamePath,
      installPath: options.installPath,
      keepPath: true,
    });
  }

  const parts = normalizePathParts(matched);
  const index = parts.findIndex((part) => folderNames.includes(part.toLowerCase()));
  const parent = parts.slice(0, Math.max(index, 0)).join("/");
  const sourceFolder = join(options.modRoot, parent);
  const target = safeJoin(options.gamePath, options.installPath || ".", basename(sourceFolder));

  if (options.useSymlink) {
    return uniqueRelativeTargets(options.gamePath, [target]);
  }

  return uniqueRelativeTargets(
    options.gamePath,
    (await listFiles(sourceFolder))
      .filter((file) => !isPassFile(file))
      .map((file) => join(target, file))
  );
}

async function planFileMapStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  dictionaryFile: string;
}) {
  const files = await listFiles(options.modRoot);
  const fileMap = await readFileMap(options.dictionaryFile);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    files
      .filter((file) => !isPassFile(file))
      .map((file) => {
        const mappedPath = fileMap.get(basename(file).toLowerCase());
        return mappedPath ? join(targetRoot, mappedPath) : "";
      })
      .filter(Boolean)
  );
}

async function planFileIntoParentFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  requireParent?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    matched
      .map((file) => {
        const parentName = basename(dirname(file));

        if (options.requireParent && (!parentName || parentName === ".")) {
          return "";
        }

        return join(targetRoot, parentName || "default", basename(file));
      })
      .filter(Boolean)
  );
}

async function copyOrRemoveFile(
  source: string,
  target: string,
  isInstall: boolean,
  gamePath: string,
  useSymlink = false
) {
  assertPathInside(gamePath, target);
  const deployedFile = relative(gamePath, target).replace(/\\/g, "/");

  if (isInstall) {
    // FEATURE-014:用户点安装即为最高授权,移除"目标文件已存在就阻止"二次校验
    // cp 已经在用 force:true,errorOnExist:false,真正覆盖语义保留
    await mkdir(dirname(target), { recursive: true });
    if (useSymlink) {
      await symlink(source, target, "file");
    } else {
      await cp(source, target, { force: true, errorOnExist: false });
    }
    return [deployedFile];
  } else {
    await rm(target, { force: true });
    await deleteEmptyParents(gamePath, dirname(target));
    return [];
  }
}

async function applyGeneralStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  keepPath?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    const source = join(options.modRoot, file);
    const target = options.keepPath
      ? join(targetRoot, file)
      : join(targetRoot, basename(file));
    deployedFiles.push(
      ...(await copyOrRemoveFile(source, target, options.isInstall, options.gamePath, options.useSymlink))
    );
  }

  return deployedFiles;
}

async function applyFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  include?: boolean;
  spare?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const folders = Array.isArray(options.folderName) ? options.folderName : [options.folderName];
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    let relativeInstallPath = "";

    for (const folder of folders) {
      relativeInstallPath = getFolderFromPath(file, folder, options.include);
      if (relativeInstallPath) break;
    }

    if (!relativeInstallPath && options.spare) {
      relativeInstallPath = file;
    }

    if (!relativeInstallPath) continue;

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, relativeInstallPath),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

async function applyFolderRootStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  targetFolderName?: string;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const target = safeJoin(
    options.gamePath,
    options.installPath || ".",
    sanitizeFileName(options.targetFolderName || basename(options.modRoot))
  );
  const deployedFolder = relative(options.gamePath, target).replace(/\\/g, "/");

  if (options.isInstall) {
    // FEATURE-014:用户点安装即为最高授权,目标目录已存在时直接 rm 再覆盖
    // (原本 useSymlink 分支已有 rm 逻辑,普通 cp 分支 throw 阻止 — 现统一放开)
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
    }

    await mkdir(dirname(target), { recursive: true });

    if (options.useSymlink) {
      await symlink(options.modRoot, target, process.platform === "win32" ? "junction" : "dir");
    } else {
      await cp(options.modRoot, target, {
        recursive: true,
        force: true,
        errorOnExist: false
      });
    }

    return [deployedFolder];
  }

  await rm(target, { recursive: true, force: true });
  await deleteEmptyParents(options.gamePath, dirname(target));
  return [];
}

async function applyFileStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  commonParent?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const folders = getUniqueParentFolders(options.modRoot, matched);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const folder of folders) {
    const target = join(targetRoot, basename(folder));

    if (options.isInstall) {
      // FEATURE-014:用户点安装即为最高授权,目标已存在先 rm 再继续
      if (existsSync(target)) {
        await rm(target, { recursive: true, force: true });
      }

      await mkdir(dirname(target), { recursive: true });

      if (options.useSymlink) {
        await symlink(folder, target, process.platform === "win32" ? "junction" : "dir");
        deployedFiles.push(relative(options.gamePath, target).replace(/\\/g, "/"));
      } else {
        await cp(folder, target, {
          recursive: true,
          force: true,
          errorOnExist: false
        });
        deployedFiles.push(
          ...(await listFiles(folder)).filter((file) => !isPassFile(file)).map((file) =>
            relative(options.gamePath, join(target, file)).replace(/\\/g, "/")
          )
        );
      }
    } else {
      await rm(target, { recursive: true, force: true });
      await deleteEmptyParents(options.gamePath, dirname(target));
    }
  }

  return deployedFiles;
}

async function applyFileSiblingStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  pass?: string[];
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );

  if (!matched) return [];

  const sourceFolder = join(options.modRoot, dirname(matched));
  const siblingFiles = await listFiles(sourceFolder);
  const pass = new Set((options.pass ?? []).map((item) => item.toLowerCase()));
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of siblingFiles) {
    if (pass.has(basename(file).toLowerCase()) || isPassFile(file)) continue;
    deployedFiles.push(...(await copyOrRemoveFile(
      join(sourceFolder, file),
      join(targetRoot, file),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

async function applyFileOnlyStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of matched) {
    if (isPassFile(file)) continue;

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, basename(file)),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

async function applyFolderParentStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const folderNames = (Array.isArray(options.folderName) ? options.folderName : [options.folderName])
    .map((folder) => folder.toLowerCase())
    .filter(Boolean);
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    normalizePathParts(file).some((part) => folderNames.includes(part.toLowerCase()))
  );

  if (!matched) {
    // BUG-009 fallback:modRoot 里没有 folderName 标记文件(如 PalSchema 数据 mod,
    // 纯 JSONC 配置,无 Enabled.txt)。原本静默 return [] 导致 mod 装了个寂寞。
    //
    // fallback 用 applyGeneralStrategy + keepPath=true,把 modRoot 内容原样
    // 铺到 installPath 下(保留 modRoot 内的目录结构,如 7z 包顶层目录
    // "<ModName>/blueprints/*.jsonc" 会装到 installPath/<ModName>/blueprints/*.jsonc)。
    //
    // 不用 applyFolderRootStrategy 是因为它会嵌套一层 modRoot basename(modRoot basename
    // 是递增数字 ID,例如 "6",装出 ".../PalSchema/mods/6/Complete Game Rebalance/",
    // 多出无意义的数字层)。
    //
    // main 进程无 recordLog IPC,前端感知走 deployedFiles=0 告警(见 library.ts installMod)。
    console.warn(
      `[BUG-009 folderParent fallback] modRoot 缺少 ${folderNames.join(",")} 标记文件,` +
        `fallback 为 general+keepPath 行为: ${options.modRoot} → ${options.installPath}`,
    );
    return await applyGeneralStrategy({
      modRoot: options.modRoot,
      gamePath: options.gamePath,
      installPath: options.installPath,
      keepPath: true,
      isInstall: options.isInstall,
      useSymlink: options.useSymlink,
    });
  }

  const parts = normalizePathParts(matched);
  const index = parts.findIndex((part) => folderNames.includes(part.toLowerCase()));
  const parent = parts.slice(0, Math.max(index, 0)).join("/");
  const sourceFolder = join(options.modRoot, parent);
  const target = safeJoin(options.gamePath, options.installPath || ".", basename(sourceFolder));

  if (options.isInstall) {
    // FEATURE-014:用户点安装即为最高授权,目标已存在先 rm 再继续
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
    }

    await mkdir(dirname(target), { recursive: true });

    if (options.useSymlink) {
      await symlink(sourceFolder, target, process.platform === "win32" ? "junction" : "dir");
      return [relative(options.gamePath, target).replace(/\\/g, "/")];
    }

    await cp(sourceFolder, target, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
    return (await listFiles(sourceFolder)).filter((file) => !isPassFile(file)).map((file) =>
      relative(options.gamePath, join(target, file)).replace(/\\/g, "/")
    );
  } else {
    await rm(target, { recursive: true, force: true });
    await deleteEmptyParents(options.gamePath, dirname(target));
    return [];
  }
}

async function applyFileMapStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  dictionaryFile: string;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const fileMap = await readFileMap(options.dictionaryFile);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    const mappedPath = fileMap.get(basename(file).toLowerCase());
    if (!mappedPath) continue;

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, mappedPath),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

async function applyFileIntoParentFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  requireParent?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of matched) {
    const parentName = basename(dirname(file));

    if (options.requireParent && (!parentName || parentName === ".")) {
      continue;
    }

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, parentName || "default", basename(file)),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

function localAppDataPath(...parts: string[]) {
  return join(dirname(electron.app.getPath("appData")), "Local", ...parts);
}

function documentsPath(...parts: string[]) {
  return join(electron.app.getPath("documents"), ...parts);
}

async function readTextFile(filePath: string, fallback = "") {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

async function writeTextFile(filePath: string, value: string) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf-8");
}

async function ensureArchiveIni(options: {
  documentsGameFolder: string;
  iniFileName: string;
}) {
  const iniPath = documentsPath("My Games", options.documentsGameFolder, options.iniFileName);
  const raw = await readTextFile(iniPath);
  const lines = raw.split(/\r?\n/u);
  const nextLines: string[] = [];
  let inArchive = false;
  let sawArchive = false;
  let sawInvalidate = false;
  let sawResourceDirs = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/u)?.[1]?.trim().toLowerCase();

    if (section) {
      if (inArchive) {
        if (!sawInvalidate) nextLines.push("bInvalidateOlderFiles=1");
        if (!sawResourceDirs) nextLines.push("sResourceDataDirsFinal=");
      }

      inArchive = section === "archive";
      sawArchive ||= inArchive;
      sawInvalidate = false;
      sawResourceDirs = false;
      nextLines.push(line);
      continue;
    }

    if (inArchive && /^\s*bInvalidateOlderFiles\s*=/iu.test(line)) {
      nextLines.push("bInvalidateOlderFiles=1");
      sawInvalidate = true;
      continue;
    }

    if (inArchive && /^\s*sResourceDataDirsFinal\s*=/iu.test(line)) {
      nextLines.push("sResourceDataDirsFinal=");
      sawResourceDirs = true;
      continue;
    }

    nextLines.push(line);
  }

  if (inArchive) {
    if (!sawInvalidate) nextLines.push("bInvalidateOlderFiles=1");
    if (!sawResourceDirs) nextLines.push("sResourceDataDirsFinal=");
  }

  if (!sawArchive) {
    if (nextLines.some((line) => line.trim())) nextLines.push("");
    nextLines.push("[Archive]", "bInvalidateOlderFiles=1", "sResourceDataDirsFinal=");
  }

  await writeTextFile(iniPath, nextLines.join("\n").trimEnd() + "\n");
}

function pluginFileNames(files: string[]) {
  return files
    .filter((file) => ["esp", "esm", "esl"].includes(getExtension(file)))
    .map((file) => basename(file));
}

async function updatePluginsTxt(options: {
  localAppDataGameFolder: string;
  files: string[];
  isInstall: boolean;
  header?: string;
  starPrefix?: boolean;
}) {
  const names = pluginFileNames(options.files);
  if (names.length === 0) return;

  const pluginsPath = localAppDataPath(options.localAppDataGameFolder, "plugins.txt");
  let entries = (await readTextFile(pluginsPath))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (options.header && entries[0] !== options.header) {
    entries = [options.header, ...entries.filter((line) => line !== options.header)];
  }

  for (const name of names) {
    const entry = `${options.starPrefix === false ? "" : "*"}${name}`;
    if (options.isInstall) {
      if (!entries.includes(entry)) entries.push(entry);
    } else {
      entries = entries.filter((line) => line !== entry && line !== name);
    }
  }

  await writeTextFile(pluginsPath, [...new Set(entries)].join("\n") + "\n");
}

async function updateStarfieldGeneralTestFiles(options: {
  documentsGameFolder: string;
  iniFileName: string;
  files: string[];
  isInstall: boolean;
}) {
  const espNames = options.files
    .filter((file) => getExtension(file) === "esp")
    .map((file) => basename(file));

  if (espNames.length === 0) return;

  const iniPath = documentsPath("My Games", options.documentsGameFolder, options.iniFileName);
  const raw = await readTextFile(iniPath);
  const lines = raw.split(/\r?\n/u);
  const nextLines: string[] = [];
  let inGeneral = false;
  let sawGeneral = false;
  let maxIndex = 0;
  const remainingNames = new Set(espNames);

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/u)?.[1]?.trim().toLowerCase();

    if (section) {
      inGeneral = section === "general";
      sawGeneral ||= inGeneral;
      nextLines.push(line);
      continue;
    }

    const testMatch = inGeneral ? line.match(/^\s*sTestFile(\d*)\s*=\s*(.+?)\s*$/iu) : null;
    if (testMatch) {
      const index = Number(testMatch[1] || 0);
      maxIndex = Math.max(maxIndex, index);
      const value = testMatch[2]?.trim() ?? "";

      if (!options.isInstall && remainingNames.has(value)) {
        remainingNames.delete(value);
        continue;
      }

      if (options.isInstall) {
        remainingNames.delete(value);
      }
    }

    nextLines.push(line);
  }

  if (options.isInstall && remainingNames.size > 0) {
    if (!sawGeneral) {
      if (nextLines.some((line) => line.trim())) nextLines.push("");
      nextLines.push("[General]");
    }

    for (const name of remainingNames) {
      maxIndex += 1;
      nextLines.push(`sTestFile${maxIndex}=${name}`);
    }
  }

  await writeTextFile(iniPath, nextLines.join("\n").trimEnd() + "\n");
}

async function planBethesdaDataStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
}) {
  return planFolderStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    folderName: options.folderName,
    spare: true
  });
}

async function applyBethesdaDataStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  documentsGameFolder: string;
  iniFileName: string;
  localAppDataGameFolder: string;
  pluginsHeader?: string;
  updateGeneralTestFiles?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = await listFiles(options.modRoot);

  if (options.isInstall) {
    await ensureArchiveIni({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName
    });
  }

  await updatePluginsTxt({
    localAppDataGameFolder: options.localAppDataGameFolder,
    files,
    isInstall: options.isInstall,
    header: options.pluginsHeader
  });

  if (options.updateGeneralTestFiles) {
    await updateStarfieldGeneralTestFiles({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName,
      files,
      isInstall: options.isInstall
    });
  }

  return applyFolderStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    folderName: options.folderName,
    spare: true,
    isInstall: options.isInstall,
    useSymlink: options.useSymlink
  });
}

async function planBethesdaPluginFilesStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) {
  const files = await listFiles(options.modRoot);
  const targets = files
    .filter((file) => ["esp", "esm", "esl"].includes(getExtension(file)))
    .map((file) => safeJoin(options.gamePath, options.installPath, basename(file)));

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyBethesdaPluginFilesStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  documentsGameFolder: string;
  iniFileName: string;
  localAppDataGameFolder: string;
  pluginsHeader?: string;
  updateGeneralTestFiles?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = await listFiles(options.modRoot);

  if (options.isInstall) {
    await ensureArchiveIni({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName
    });
  }

  await updatePluginsTxt({
    localAppDataGameFolder: options.localAppDataGameFolder,
    files,
    isInstall: options.isInstall,
    header: options.pluginsHeader
  });

  if (options.updateGeneralTestFiles) {
    await updateStarfieldGeneralTestFiles({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName,
      files,
      isInstall: options.isInstall
    });
  }

  return applyFileOnlyStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "esp",
    isExtname: true,
    isInstall: options.isInstall,
    useSymlink: options.useSymlink
  }).then(async (deployed) => [
    ...deployed,
    ...await applyFileOnlyStrategy({
      modRoot: options.modRoot,
      gamePath: options.gamePath,
      installPath: options.installPath,
      fileName: "esm",
      isExtname: true,
      isInstall: options.isInstall,
      useSymlink: options.useSymlink
    }),
    ...await applyFileOnlyStrategy({
      modRoot: options.modRoot,
      gamePath: options.gamePath,
      installPath: options.installPath,
      fileName: "esl",
      isExtname: true,
      isInstall: options.isInstall,
      useSymlink: options.useSymlink
    })
  ]);
}

async function planOblivionPluginsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) {
  return planFileSiblingStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "esp",
    isExtname: true
  });
}

async function updateOblivionPluginsTxt(options: {
  gamePath: string;
  installPath: string;
  files: string[];
  isInstall: boolean;
}) {
  const names = pluginFileNames(options.files).filter((name) => name.toLowerCase().endsWith(".esp"));
  if (names.length === 0) return;

  const pluginsPath = safeJoin(options.gamePath, options.installPath, "Plugins.txt");
  let entries = (await readTextFile(pluginsPath))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const name of names) {
    if (options.isInstall) {
      if (!entries.includes(name)) entries.push(name);
    } else {
      entries = entries.filter((line) => line !== name);
    }
  }

  await writeTextFile(pluginsPath, entries.join("\n") + "\n");
}

async function applyOblivionPluginsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  await updateOblivionPluginsTxt({
    gamePath: options.gamePath,
    installPath: options.installPath,
    files,
    isInstall: options.isInstall
  });

  return applyFileSiblingStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "esp",
    isExtname: true,
    isInstall: options.isInstall,
    useSymlink: options.useSymlink
  });
}

async function ensureNoMansSkyModsEnabled(gamePath: string) {
  const disabledFile = safeJoin(gamePath, "GAMEDATA", "PCBANKS", "DISABLEMODS.TXT");
  const backupFile = safeJoin(gamePath, "GAMEDATA", "PCBANKS", "DISABLEMODS.TXT.bak");

  if (existsSync(disabledFile)) {
    if (existsSync(backupFile)) {
      await rm(disabledFile, { force: true });
    } else {
      await rename(disabledFile, backupFile);
    }
  }
}

async function numberedRecordsPath(modRoot: string, listFileName: string) {
  return join(modRoot, listFileName);
}

async function readNumberedRecords(modRoot: string, listFileName: string): Promise<Array<[string, string]>> {
  return (await readTextFile(await numberedRecordsPath(modRoot, listFileName)))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|").slice(0, 2) as [string, string])
    .filter((record) => record[0] && record[1]);
}

async function writeNumberedRecords(modRoot: string, listFileName: string, records: Array<[string, string]>) {
  await writeTextFile(await numberedRecordsPath(modRoot, listFileName), records.map((record) => record.join("|")).join("\n"));
}

async function nextNumberedName(options: {
  gamePath: string;
  installPath: string;
  prefix: string;
  extension: string;
  startIndex: number;
  records: Array<[string, string]>;
}) {
  const targetRoot = safeJoin(options.gamePath, options.installPath);
  const existing = existsSync(targetRoot)
    ? (await readdir(targetRoot))
      .map((file) => {
        const match = file.match(new RegExp(`^${options.prefix}(\\d+)\\.${options.extension}$`, "iu"));
        return match ? Number(match[1]) : 0;
      })
    : [];
  const recordNumbers = options.records.map((record) => {
    const match = record[1].match(new RegExp(`^${options.prefix}(\\d+)\\.${options.extension}$`, "iu"));
    return match ? Number(match[1]) : 0;
  });
  const maxNumber = Math.max(options.startIndex - 1, ...existing, ...recordNumbers);

  return `${options.prefix}${maxNumber + 1}.${options.extension}`;
}

async function planNumberedPakStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  extension: string;
  prefix: string;
  startIndex: number;
  listFileName: string;
}) {
  const files = (await listFiles(options.modRoot)).filter((file) => getExtension(file) === options.extension);
  const records = await readNumberedRecords(options.modRoot, options.listFileName);
  const targets: string[] = [];

  for (const file of files) {
    const targetName = records.find((record) => record[0] === file)?.[1] ?? await nextNumberedName({
      gamePath: options.gamePath,
      installPath: options.installPath,
      prefix: options.prefix,
      extension: options.extension,
      startIndex: options.startIndex,
      records: [
        ...records,
        ...targets.map((target) => [file, basename(target)] as [string, string])
      ]
    });
    targets.push(safeJoin(options.gamePath, options.installPath, targetName));
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyNumberedPakStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  extension: string;
  prefix: string;
  startIndex: number;
  listFileName: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = (await listFiles(options.modRoot)).filter((file) => getExtension(file) === options.extension);
  let records = await readNumberedRecords(options.modRoot, options.listFileName);
  const deployed: string[] = [];

  for (const file of files) {
    let record = records.find((item) => item[0] === file);

    if (options.isInstall) {
      if (!record) {
        record = [file, await nextNumberedName({ ...options, records })];
        records.push(record);
      }

      deployed.push(...await copyOrRemoveFile(
        join(options.modRoot, file),
        safeJoin(options.gamePath, options.installPath, record[1]),
        true,
        options.gamePath,
        options.useSymlink
      ));
    } else if (record) {
      await rm(safeJoin(options.gamePath, options.installPath, record[1]), { force: true });
      records = records.filter((item) => item !== record);
    }
  }

  await writeNumberedRecords(options.modRoot, options.listFileName, records);
  return deployed;
}

async function readWatchDogsRecords(modRoot: string, listFileName: string): Promise<Array<[string, string, string]>> {
  return (await readTextFile(join(modRoot, listFileName)))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|").slice(0, 3) as [string, string, string])
    .filter((record) => record[0] && record[1] && record[2]);
}

async function writeWatchDogsRecords(modRoot: string, listFileName: string, records: Array<[string, string, string]>) {
  await writeTextFile(join(modRoot, listFileName), records.map((record) => record.join("|")).join("\n"));
}

async function nextWatchDogsPatchName(gamePath: string, installPath: string, records: Array<[string, string, string]>) {
  const targetRoot = safeJoin(gamePath, installPath);
  const existing = existsSync(targetRoot)
    ? (await readdir(targetRoot))
      .map((file) => Number(file.match(/^patch(\d+)\.dat$/iu)?.[1] ?? 0))
    : [];
  const recordNumbers = records.map((record) => Number(record[2].match(/^patch(\d+)\.(dat|fat)$/iu)?.[1] ?? 0));
  return `patch${Math.max(0, ...existing, ...recordNumbers) + 1}`;
}

async function planWatchDogsPatchStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  listFileName: string;
}) {
  const records = await readWatchDogsRecords(options.modRoot, options.listFileName);
  const files = (await listFiles(options.modRoot))
    .filter((file) => ["dat", "fat"].includes(getExtension(file)))
    .sort((left, right) => left.localeCompare(right));
  const targets: string[] = [];

  for (const file of files) {
    const existing = records.find((record) => record[0] === file)?.[2];
    const patchName = existing ?? `${await nextWatchDogsPatchName(options.gamePath, options.installPath, [
      ...records,
      ...targets.map((target) => ["", "", basename(target)] as [string, string, string])
    ])}.${getExtension(file)}`;
    targets.push(safeJoin(options.gamePath, options.installPath, patchName));
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyWatchDogsPatchStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  listFileName: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  let records = await readWatchDogsRecords(options.modRoot, options.listFileName);
  const files = (await listFiles(options.modRoot))
    .filter((file) => ["dat", "fat"].includes(getExtension(file)))
    .sort((left, right) => {
      const leftStem = basename(left).replace(/\.(dat|fat)$/iu, "");
      const rightStem = basename(right).replace(/\.(dat|fat)$/iu, "");
      return leftStem.localeCompare(rightStem) || getExtension(left).localeCompare(getExtension(right));
    });
  const patchByStem = new Map<string, string>();
  const deployed: string[] = [];

  for (const file of files) {
    const stem = basename(file).replace(/\.(dat|fat)$/iu, "");
    let record = records.find((item) => item[0] === file);

    if (options.isInstall) {
      if (!record) {
        const patchStem = patchByStem.get(stem) ?? await nextWatchDogsPatchName(options.gamePath, options.installPath, records);
        patchByStem.set(stem, patchStem);
        record = [file, basename(file), `${patchStem}.${getExtension(file)}`];
        records.push(record);
      }

      deployed.push(...await copyOrRemoveFile(
        join(options.modRoot, file),
        safeJoin(options.gamePath, options.installPath, record[2]),
        true,
        options.gamePath,
        options.useSymlink
      ));
    } else if (record) {
      await rm(safeJoin(options.gamePath, options.installPath, record[2]), { force: true });
      records = records.filter((item) => item !== record);
    }
  }

  await writeWatchDogsRecords(options.modRoot, options.listFileName, records);
  return deployed;
}

async function ensureMiChangShengModBin(gamePath: string) {
  const legacyTarget = safeJoin(gamePath, "本地Mod测试", ["G", "m", "m"].join(""), "Mod.bin");
  const target = safeJoin(gamePath, "本地Mod测试", "Mayfly", "Mod.bin");
  if (existsSync(legacyTarget)) return;
  if (existsSync(target)) return;

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from("0001000000ffffffff", "hex"));
}

async function planMiChangShengLinkedFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  rootFile: string;
}) {
  const files = await listFiles(options.modRoot);
  const folders = [...new Set(files
    .filter((file) => basename(file).toLowerCase() === options.rootFile.toLowerCase())
    .map((file) => dirname(file))
  )];

  return uniqueRelativeTargets(
    options.gamePath,
    folders.map((folder) => safeJoin(options.gamePath, options.installPath, basename(folder)))
  );
}

async function applyMiChangShengLinkedFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  rootFile: string;
  isInstall: boolean;
}) {
  await ensureMiChangShengModBin(options.gamePath);
  const files = await listFiles(options.modRoot);
  const folders = [...new Set(files
    .filter((file) => basename(file).toLowerCase() === options.rootFile.toLowerCase())
    .map((file) => dirname(file))
  )];
  const deployed: string[] = [];

  for (const folder of folders) {
    const source = join(options.modRoot, folder);
    const target = safeJoin(options.gamePath, options.installPath, basename(folder));
    const deployedFolder = relative(options.gamePath, target).replace(/\\/g, "/");

    if (options.isInstall) {
      // FEATURE-014:用户点安装即为最高授权,目标已存在先 rm 再继续
      if (existsSync(target)) {
        await rm(target, { recursive: true, force: true });
      }

      await mkdir(dirname(target), { recursive: true });
      await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
      deployed.push(deployedFolder);
    } else {
      await rm(target, { recursive: true, force: true });
      await deleteEmptyParents(options.gamePath, dirname(target));
    }
  }

  return deployed;
}

function findLegendPortraitSourceFolders(files: string[], portraitFolders: string[]) {
  const portraitFolderSet = new Set(portraitFolders.map((folder) => folder.toLowerCase()));
  const folders = new Set<string>();

  for (const file of files) {
    const parts = normalizePathParts(file);
    const index = parts.findIndex((part) => portraitFolderSet.has(part.toLowerCase()));

    if (index === -1) continue;

    folders.add(parts.slice(0, index).join("/"));
  }

  return [...folders].filter(Boolean);
}

async function planLegendPortraitsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  portraitFolders: string[];
}) {
  const files = await listFiles(options.modRoot);
  const folders = findLegendPortraitSourceFolders(files, options.portraitFolders);

  return uniqueRelativeTargets(
    options.gamePath,
    folders.map((folder) => safeJoin(options.gamePath, options.installPath, basename(folder)))
  );
}

async function applyLegendPortraitsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  portraitFolders: string[];
  isInstall: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const folders = findLegendPortraitSourceFolders(files, options.portraitFolders);
  const deployed: string[] = [];

  for (const folder of folders) {
    const source = join(options.modRoot, folder);
    const target = safeJoin(options.gamePath, options.installPath, basename(folder));
    const deployedFolder = relative(options.gamePath, target).replace(/\\/g, "/");

    if (options.isInstall) {
      // FEATURE-014:用户点安装即为最高授权,目标已存在先 rm 再继续
      if (existsSync(target)) {
        await rm(target, { recursive: true, force: true });
      }

      await mkdir(dirname(target), { recursive: true });
      await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
      deployed.push(deployedFolder);
    } else {
      await rm(target, { recursive: true, force: true });
      await deleteEmptyParents(options.gamePath, dirname(target));
    }
  }

  return deployed;
}

async function applyInzoiModKitStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  isInstall: boolean;
}) {
  if (options.isInstall) {
    const files = await listFiles(options.modRoot);
    for (const file of files) {
      if (basename(file) !== "mod_manifest.json") continue;
      const manifestPath = join(options.modRoot, file);
      const data = JSON.parse(await readTextFile(manifestPath, "{}")) as Record<string, unknown>;
      data.bEnable = true;
      await writeTextFile(manifestPath, JSON.stringify(data, null, 4));
    }
  }

  return applyFileStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "mod_manifest.json",
    commonParent: false,
    isInstall: options.isInstall
  });
}

function escapeXmlValue(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function unescapeXmlValue(value: string) {
  return value
    .replace(/&apos;/gu, "'")
    .replace(/&quot;/gu, "\"")
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

function readXmlChildText(xml: string, tagName: string) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = xml.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)</${escapedTag}>`, "iu"));
  return match ? unescapeXmlValue(match[1].trim()) : "";
}

function readXmlAttribute(xml: string, attributeName: string) {
  const escapedAttribute = attributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = xml.match(new RegExp(`\\b${escapedAttribute}\\s*=\\s*["']([^"']*)["']`, "iu"));
  return match ? unescapeXmlValue(match[1].trim()) : "";
}

interface Bg3ModuleAttribute {
  id: string;
  type: string;
  value: string;
}

const BG3_DEFAULT_MODSETTINGS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<save>
    <version major="4" minor="0" revision="9" build="331" />
    <region id="ModuleSettings">
        <node id="root">
            <children>
                <node id="ModOrder">
                    <children />
                </node>
                <node id="Mods">
                    <children>
                    </children>
                </node>
            </children>
        </node>
    </region>
</save>`;

function bg3ModsNodePattern() {
  return /(<node\b(?=[^>]*\bid=["']Mods["'])[^>]*>\s*<children>)([\s\S]*?)(<\/children>\s*<\/node>)/iu;
}

function normalizeBg3SelfClosingChildren(xml: string) {
  return xml.replace(
    /(<node\b(?=[^>]*\bid=["']Mods["'])[^>]*>\s*)<children\s*\/>(\s*<\/node>)/iu,
    "$1<children>\n                    </children>$2"
  );
}

function bg3ModuleShortDescNodePattern() {
  return /<node\b(?=[^>]*\bid=["']ModuleShortDesc["'])[^>]*>[\s\S]*?<\/node>/giu;
}

function bg3AttributeXml(attribute: Bg3ModuleAttribute) {
  return `                    <attribute id="${escapeXmlValue(attribute.id)}" type="${escapeXmlValue(attribute.type)}" value="${escapeXmlValue(attribute.value)}" />`;
}

function bg3ModuleShortDescXml(attributes: Bg3ModuleAttribute[]) {
  return [
    "                <node id=\"ModuleShortDesc\">",
    ...attributes.map(bg3AttributeXml),
    "                </node>"
  ].join("\n");
}

function parseBg3ModuleAttributes(xml: string) {
  const moduleInfo = xml.match(/<node\b(?=[^>]*\bid=["']ModuleInfo["'])[^>]*>([\s\S]*?)<\/node>/iu)?.[1] ?? xml;

  return Array.from(moduleInfo.matchAll(/<attribute\b([^>]*)\/?>/giu))
    .map((match) => ({
      id: readXmlAttribute(match[1] ?? "", "id"),
      type: readXmlAttribute(match[1] ?? "", "type"),
      value: readXmlAttribute(match[1] ?? "", "value")
    }))
    .filter((attribute) => attribute.id && attribute.type);
}

function removeBg3ModuleShortDescByUuid(childrenXml: string, uuid: string) {
  return childrenXml.replace(bg3ModuleShortDescNodePattern(), (nodeXml) =>
    parseBg3ModuleAttributes(nodeXml).find((attribute) => attribute.id === "UUID")?.value === uuid ? "" : nodeXml
  );
}

function upsertBg3Modsettings(options: {
  xml: string;
  attributes: Bg3ModuleAttribute[];
  isInstall: boolean;
}) {
  const uuid = options.attributes.find((attribute) => attribute.id === "UUID")?.value;
  if (!uuid) return options.xml;

  const normalizedXml = normalizeBg3SelfClosingChildren(options.xml);
  const sourceXml = bg3ModsNodePattern().test(normalizedXml)
    ? normalizedXml
    : BG3_DEFAULT_MODSETTINGS_XML;

  return sourceXml.replace(bg3ModsNodePattern(), (_match, open: string, children: string, close: string) => {
    const filteredChildren = removeBg3ModuleShortDescByUuid(children, uuid).trimEnd();
    const nextChildren = options.isInstall
      ? `${filteredChildren}${filteredChildren ? "\n" : "\n"}${bg3ModuleShortDescXml(options.attributes)}\n            `
      : `${filteredChildren}${filteredChildren ? "\n            " : ""}`;

    return `${open}${nextChildren}${close}`;
  });
}

function resolveManagedToolCandidate(candidates: string[] | undefined, fileName: string) {
  const normalizedFileName = fileName.toLowerCase();

  for (const candidate of candidates ?? []) {
    if (basename(candidate).toLowerCase() === normalizedFileName && existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function loadBg3ModDataFromPak(assemblyPath: string, pakPath: string) {
  const xml = await invokeManagedTool<string>({
    assemblyPath,
    typeName: "BaldursGate3.Program",
    methodName: "LoadModDataFromPakAsync",
    payload: pakPath
  });

  return parseBg3ModuleAttributes(String(xml || ""))
    .filter((attribute) => [
      "Folder",
      "MD5",
      "Name",
      "UUID",
      "Version64",
      "PublishHandle"
    ].includes(attribute.id));
}

async function applyBg3PakStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  managedToolFileName: string;
  managedToolCandidates?: string[];
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = (await listFiles(options.modRoot)).filter((file) => getExtension(file) === "pak");
  if (files.length === 0) return [];

  const toolPath = resolveManagedToolCandidate(options.managedToolCandidates, options.managedToolFileName);
  if (!toolPath) {
    throw new Error(`未找到博德之门3前置工具 ${options.managedToolFileName}，请先把该工具 Mod 导入当前游戏。`);
  }

  const modsettingsPath = safeJoin(
    options.gamePath,
    "Local",
    "Larian Studios",
    "Baldur's Gate 3",
    "PlayerProfiles",
    "Public",
    "modsettings.lsx"
  );
  let modsettingsXml = await readTextFile(modsettingsPath, BG3_DEFAULT_MODSETTINGS_XML);
  const deployed: string[] = [];

  for (const file of files) {
    const source = join(options.modRoot, file);
    const metadata = await loadBg3ModDataFromPak(toolPath, source);
    const uuid = metadata.find((attribute) => attribute.id === "UUID")?.value;

    if (!uuid) {
      throw new Error(`无法从 ${basename(file)} 读取 BG3 Mod UUID。`);
    }

    deployed.push(...await copyOrRemoveFile(
      source,
      safeJoin(options.gamePath, options.installPath, basename(file)),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    ));
    modsettingsXml = upsertBg3Modsettings({
      xml: modsettingsXml,
      attributes: metadata,
      isInstall: options.isInstall
    });
  }

  await writeTextFile(modsettingsPath, modsettingsXml.trimEnd() + "\n");
  return deployed;
}

function redDeadDefaultModsXml() {
  return "<ModsManager><Mods /><LoadOrder /></ModsManager>";
}

function parseRedDeadModsXml(raw: string) {
  const source = raw.trim() || redDeadDefaultModsXml();
  const modsBlock = source.match(/<Mods\b[^>]*>([\s\S]*?)<\/Mods>/iu)?.[1] ?? "";
  const loadOrderBlock = source.match(/<LoadOrder\b[^>]*>([\s\S]*?)<\/LoadOrder>/iu)?.[1] ?? "";
  const mods = new Map<string, {
    folder: string;
    name: string;
    enabled: string;
    overwrite: string;
    disabledGroups: string;
  }>();
  const modMatches = modsBlock.matchAll(/<Mod\b([^>]*)>([\s\S]*?)<\/Mod>/giu);

  for (const match of modMatches) {
    const folder = readXmlAttribute(match[1] ?? "", "folder");
    if (!folder) continue;

    const body = match[2] ?? "";
    mods.set(folder, {
      folder,
      name: readXmlChildText(body, "Name") || folder,
      enabled: readXmlChildText(body, "Enabled") || "false",
      overwrite: readXmlChildText(body, "Overwrite") || "false",
      disabledGroups: readXmlChildText(body, "DisabledGroups")
    });
  }

  const loadOrder = Array.from(loadOrderBlock.matchAll(/<Mod\b[^>]*>([\s\S]*?)<\/Mod>/giu))
    .map((match) => unescapeXmlValue((match[1] ?? "").trim()))
    .filter(Boolean);

  return { mods, loadOrder };
}

function serializeRedDeadModsXml(data: ReturnType<typeof parseRedDeadModsXml>) {
  const mods = Array.from(data.mods.values())
    .map((mod) => [
      `        <Mod folder="${escapeXmlValue(mod.folder)}">`,
      `            <Name>${escapeXmlValue(mod.name)}</Name>`,
      `            <Enabled>${escapeXmlValue(mod.enabled)}</Enabled>`,
      `            <Overwrite>${escapeXmlValue(mod.overwrite)}</Overwrite>`,
      `            <DisabledGroups>${escapeXmlValue(mod.disabledGroups)}</DisabledGroups>`,
      "        </Mod>"
    ].join("\n"))
    .join("\n");
  const loadOrder = [...new Set(data.loadOrder)]
    .map((folder) => `        <Mod>${escapeXmlValue(folder)}</Mod>`)
    .join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<ModsManager>",
    "    <Mods>",
    mods,
    "    </Mods>",
    "    <LoadOrder>",
    loadOrder,
    "    </LoadOrder>",
    "</ModsManager>"
  ].filter((line) => line !== "").join("\n") + "\n";
}

async function updateRedDeadInstallXml(options: {
  gamePath: string;
  installXmlPath: string;
  isInstall: boolean;
}) {
  const installXml = await readTextFile(options.installXmlPath);
  const folder = basename(dirname(options.installXmlPath));
  const name = readXmlChildText(installXml, "Name") || folder;
  const modsXmlPath = safeJoin(options.gamePath, "lml", "mods.xml");
  const modsXml = parseRedDeadModsXml(await readTextFile(modsXmlPath, redDeadDefaultModsXml()));
  const current = modsXml.mods.get(folder);

  modsXml.mods.set(folder, {
    folder,
    name: current?.name || name,
    enabled: String(options.isInstall),
    overwrite: current?.overwrite || "false",
    disabledGroups: current?.disabledGroups || ""
  });

  if (!modsXml.loadOrder.includes(folder)) {
    modsXml.loadOrder.push(folder);
  }

  await writeTextFile(modsXmlPath, serializeRedDeadModsXml(modsXml));
}

async function updateAllRedDeadInstallXml(options: {
  modRoot: string;
  gamePath: string;
  isInstall: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const installXmlFiles = files.filter((file) => basename(file).toLowerCase() === "install.xml");

  for (const file of installXmlFiles) {
    await updateRedDeadInstallXml({
      gamePath: options.gamePath,
      installXmlPath: join(options.modRoot, file),
      isInstall: options.isInstall
    });
  }

  return installXmlFiles;
}

function redDeadInstallXmlFolders(modRoot: string, installXmlFiles: string[]) {
  return [...new Set(installXmlFiles.map((file) => dirname(file) || "."))].map((folder) => ({
    relativeFolder: folder,
    sourceFolder: folder === "." ? modRoot : join(modRoot, folder),
    targetFolderName: folder === "." ? sanitizeFileName(basename(modRoot)) : basename(folder)
  }));
}

async function planRedDeadLmlStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) {
  const files = await listFiles(options.modRoot);
  const folders = redDeadInstallXmlFolders(
    options.modRoot,
    files.filter((file) => basename(file).toLowerCase() === "install.xml")
  );
  const targets: string[] = [];

  for (const folder of folders) {
    const folderFiles = await listFiles(folder.sourceFolder);
    for (const file of folderFiles) {
      if (isPassFile(file)) continue;
      targets.push(safeJoin(options.gamePath, options.installPath, folder.targetFolderName, file));
    }
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyRedDeadLmlStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const installXmlFiles = await updateAllRedDeadInstallXml({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    isInstall: options.isInstall
  });
  const folders = redDeadInstallXmlFolders(options.modRoot, installXmlFiles);
  const deployed: string[] = [];

  if (folders.length === 0) {
    throw new Error("未找到 RDR2 LML 需要的 install.xml。");
  }

  for (const folder of folders) {
    const folderFiles = await listFiles(folder.sourceFolder);
    for (const file of folderFiles) {
      if (isPassFile(file)) continue;
      deployed.push(...await copyOrRemoveFile(
        join(folder.sourceFolder, file),
        safeJoin(options.gamePath, options.installPath, folder.targetFolderName, file),
        options.isInstall,
        options.gamePath,
        options.useSymlink
      ));
    }
  }

  return deployed;
}

async function applyRedDeadAsiStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  await updateAllRedDeadInstallXml({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    isInstall: options.isInstall
  });

  return applyFileSiblingStrategy(options);
}

// 怀沙:showAlert IPC 已废弃,改用 src/services/dialog.ts 的 appAlert 主题弹窗
electron.ipcMain.handle("dialog:openDirectory", async (_event, options?: { title?: string }) => {
  const result = await electron.dialog.showOpenDialog({
    title: options?.title,
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:openExecutable", async (_event, options?: { title?: string }) => {
  const result = await electron.dialog.showOpenDialog({
    title: options?.title,
    properties: ["openFile"],
    filters: [
      { name: "Windows executable", extensions: ["exe"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:openImage", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:openArchive", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Mod packages", extensions: [...ARCHIVE_EXTENSIONS, "rar", "7z"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

electron.ipcMain.handle("dialog:openModSource", async () => {
  // 怀沙:Electron Win/Linux 下 openFile + openDirectory 不能共存(强制 directory picker)
  // 所以拆成两个独立入口:这里只走压缩包(.zip/.7z/.rar/.mmp/.gmm)
  // 文件夹导入走 dialog:openModSourceDirectory(L4328)
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Mod packages", extensions: [...ARCHIVE_EXTENSIONS, "rar", "7z"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

electron.ipcMain.handle("dialog:openModSourceDirectory", async () => {
  // 怀沙:只选文件夹(配合导入模组 UI,Electron 不允许 file+directory 共存)
  const result = await electron.dialog.showOpenDialog({
    properties: ["openDirectory", "multiSelections"]
  });

  return result.canceled ? [] : result.filePaths;
});

electron.ipcMain.handle("dialog:openJson", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:saveJson", async (_event, defaultPath: string) => {
  const result = await electron.dialog.showSaveDialog({
    defaultPath,
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePath ?? "";
});

electron.ipcMain.handle("dialog:saveFile", async (_event, options: {
  defaultPath: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}) => {
  const result = await electron.dialog.showSaveDialog({
    defaultPath: options.defaultPath,
    filters: options.filters?.length
      ? options.filters
      : [{ name: "All files", extensions: ["*"] }]
  });

  return result.canceled ? "" : result.filePath ?? "";
});

electron.ipcMain.handle("shell:openPath", async (_event, targetPath: string) => {
  if (!targetPath) return false;
  const error = await electron.shell.openPath(targetPath);
  return !error;
});

electron.ipcMain.handle("shell:openExternal", async (_event, targetUrl: string) => {
  if (!targetUrl) return false;
  const url = new URL(targetUrl);
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
    throw new Error("不支持打开此链接。");
  }
  await electron.shell.openExternal(targetUrl);
  return true;
});

electron.ipcMain.handle("net:fetchJson", async (_event, options: {
  url: string;
  proxyUrl?: string;
}) => fetchRemoteJson(options));

electron.ipcMain.handle("shell:fileUrl", async (_event, targetPath: string) => {
  if (!targetPath) return "";
  const resolvedPath = resolve(targetPath);
  const mimeTypes: Record<string, string> = {
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  };
  const mimeType = mimeTypes[getPathExtension(resolvedPath)];

  if (mimeType && existsSync(resolvedPath)) {
    const imageData = await readFile(resolvedPath);
    return `data:${mimeType};base64,${imageData.toString("base64")}`;
  }

  return pathToFileURL(resolvedPath).toString();
});

electron.ipcMain.handle("app:openDevTools", async () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
  }
});
electron.ipcMain.handle("app:launchExecutable", async (_event, options: {
  executablePath: string;
  cwd?: string;
  args?: string[];
}) => {
  if (!options.executablePath || !existsSync(options.executablePath)) {
    throw new Error("启动失败：游戏主程序不存在。");
  }

  const child = spawn(options.executablePath, options.args ?? [], {
    cwd: options.cwd || dirname(options.executablePath),
    detached: true,
    stdio: "ignore"
  });

  child.unref();
  return true;
});

// HGMM 3.9:通过 Steam 协议启动游戏(steam://run/<appid>),让 Steam 客户端接管启动流程。
// 直接 spawn exe 会让 Steam 弹"游戏正在运行,但不是通过 Steam 启动"的提示,
// 且 Steam overlay / 成就同步失效。走 Steam 协议后:
//   - Steam 客户端验证许可证 + 注入 Steamworks DLL + 启动游戏 exe
//   - BepInEx/UE4SS 的 winhttp.dll / dwmapi.dll 仍通过 Windows DLL search order 注入
//     (因为 Steam 启动的也是同一个 exe,DLL search order 不变)
//   - 不再弹 Steam 提示框,Steam overlay / 成就 / 云存档正常工作
electron.ipcMain.handle("app:launchViaSteam", async (_event, options: {
  steamAppId: number;
  args?: string[];
}) => {
  if (!options.steamAppId || options.steamAppId <= 0) {
    throw new Error("缺少有效的 steamAppId,无法通过 Steam 协议启动");
  }
  // steam://run/<appid> 语法:参数用 //<urlencoded> 后缀,跟 Steam 客户端协议一致
  // 例:steam://run/270880//-fullscreen -w 1920
  const argsEncoded = options.args && options.args.length > 0
    ? `//${encodeURIComponent(options.args.join(" "))}`
    : "";
  const url = `steam://run/${options.steamAppId}${argsEncoded}`;
  // shell.openExternal 在系统未注册 steam:// 协议时(Steam 客户端未装/损坏)会 reject
  await electron.shell.openExternal(url);
  return true;
});

electron.ipcMain.handle("app:setLaunchAtStartup", async (_event, enabled: boolean) => {
  electron.app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
  return electron.app.getLoginItemSettings().openAtLogin;
});

electron.ipcMain.handle("app:checkUpdate", async (_event, options: {
  updateUrl: string;
  currentVersion?: string;
  proxyUrl?: string;
}) => checkAppUpdate(options));

// HGMM(2026-09-29):返回 app 版本号 — 关于页面用
electron.ipcMain.handle("app:getAppVersion", async () => electron.app.getVersion());

electron.ipcMain.handle("store:read", async (_event, fileName: string, fallback: unknown) => {
  const filePath = await ensureJsonFile(fileName, fallback);
  const raw = await readFile(filePath, "utf-8");
  // BUG-020 自愈:writeFile 非原子写 + BUG-019 崩溃,文件可能含 2 个顶层对象拼接。
  // 先试正常 parse,失败时裁到第一个完整顶层对象边界,自愈后 writeFile 重写回盘。
  try {
    return JSON.parse(raw) as unknown;
  } catch (parseErr) {
    const repaired = await tryRepairStoreFile(filePath, raw, parseErr as Error);
    if (repaired !== undefined) return repaired;
    // 真坏透了 → 返回 fallback 让前端不崩,但记录错误
    console.error(`[store:read] ${fileName} 解析失败且无法自愈,使用 fallback: ${(parseErr as Error).message}`);
    return fallback;
  }
});

electron.ipcMain.handle("store:write", async (_event, fileName: string, value: unknown) => {
  const filePath = await ensureJsonFile(fileName, value);
  // BUG-020 修复:writeFile 非原子,崩溃可能留脏文件。改"先写 .tmp → rename 覆盖"
  // rename 在同一文件系统下是原子操作(Windows NTFS ReplaceFile / POSIX rename),
  // 即使 rename 前的 writeFile 崩溃,原文件也不会被破坏
  const tmpPath = filePath + ".tmp";
  const serialized = JSON.stringify(value, null, 2);
  await writeFile(tmpPath, serialized, "utf-8");
  await renameAsync(tmpPath, filePath);
  return true;
});

electron.ipcMain.handle("fs:exists", async (_event, targetPath: string) => existsSync(targetPath));

electron.ipcMain.handle("fs:stat", async (_event, targetPath: string) => {
  const info = await stat(targetPath);
  return {
    isDirectory: info.isDirectory(),
    size: info.size,
    mtimeMs: info.mtimeMs
  };
});

electron.ipcMain.handle("fs:remove", async (_event, targetPath: string) => {
  // HGMM 一键修复:Windows 上游戏目录可能只读 / DLL 被锁(Steam 自身 / 病毒软件 / UE4SS 热加载)。
  // Node.js fs.rm 的 EPERM 无法处理被进程持有句柄的文件(如 UE4SS 启动过的 .dll / .pak 缓存)。
  // fallback 到 cmd rmdir /s /q:它对只读属性更强解,且走 RemoveDirectoryW 直接调用,
  // 对被 Steam Overlay / 杀软持有的目录句柄释放后立刻可删。
  try {
    await rm(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    return true;
  } catch (firstErr) {
    const firstCode = (firstErr as NodeJS.ErrnoException).code || "UNKNOWN";
    // 只对 EPERM/EBUSY/EACCES 走 fallback,ENOENT 等直接抛
    if (firstCode !== "EPERM" && firstCode !== "EBUSY" && firstCode !== "EACCES") {
      throw new Error(`${firstCode}: ${(firstErr as Error).message} (path: ${targetPath})`);
    }
    // fallback: cmd rmdir /s /q —— Windows 原生命令,对只读 + 残留句柄更激进
    try {
      await runRmdir(targetPath);
      return true;
    } catch (secondErr) {
      const secondCode = (secondErr as NodeJS.ErrnoException).code || "UNKNOWN";
      const secondMsg = secondErr instanceof Error ? secondErr.message : String(secondErr);
      throw new Error(`${firstCode} → ${secondCode}: ${secondMsg} (path: ${targetPath})`);
    }
  }
});

/** Windows 兜底:cmd rmdir /s /q,适合处理 Node.js fs.rm 无法删除的 EPERM/EBUSY 场景。
 *  跨平台守卫:非 Windows 直接抛 ENOSYS。 */
function runRmdir(targetPath: string): Promise<void> {
  if (process.platform !== "win32") {
    const err: NodeJS.ErrnoException = new Error("runRmdir 仅支持 Windows");
    err.code = "ENOSYS";
    return Promise.reject(err);
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn("cmd.exe", ["/c", "rmdir", "/s", "/q", targetPath], {
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const err: NodeJS.ErrnoException = new Error(
          `rmdir exit=${code} stderr=${stderr.trim() || "(empty)"} stdout=${stdout.trim() || "(empty)"}`
        );
        err.code = "EPERM";
        reject(err);
      }
    });
  });
}

electron.ipcMain.handle("fs:listFiles", async (_event, targetPath: string) => listFiles(targetPath));

// HGMM Phase 5:扫描游戏 mod 安装目录,发现用户手动丢入的 mod。
// 参照原 HGMM JianXingWindows.cpp::ScanLocalMods:
//   - 只接受目录 + .pak 单文件(原 HGMM C++ 严格只接受 .pak,这里追加 BepInEx 需要的 .dll)
//   - 跳过 .zip/.7z/.json/.log 等非 mod 文件
//   - 隐藏文件 / 系统文件跳过
//   - 空目录或只有运行时缓存的目录跳过
const SCAN_MOD_FILE_EXTENSIONS = new Set([
  "pak",      // Unreal Engine mod 包(原 HGMM 主识别)
  "dll",      // BepInEx plugin(HGMM 2.0 新增,因为 hksilksong / howtofish 走 BepInEx)
  "lua",      // UE4SS 脚本
  "uasset",   // UE 资源
  "uexp"      // UE 资源导出
]);
const SCAN_SKIP_FILE_EXTENSIONS = new Set([
  "log",
  "txt",
  "md",
  "tmp",
  "bak",
  "zip",
  "7z",
  "rar",
  "json",
  "ini",
  "cfg",
  "xml"
]);
// 怀沙:mod 加载器自身的文件名,扫描时跳过,否则 BepInEx 的 winhttp.dll 会被误识别成"用户 mod"
const SCAN_LOADER_FILE_NAMES = new Set([
  "winhttp.dll",       // BepInEx (Unity)
  "version.dll",       // MelonLoader (Unity)
  "dinput8.dll",       // SlayTheSpire2 mod 加载器(放在 \mods\ 子目录)
  "dwmapi.dll",        // UE4SS (Unreal,放在 Binaries/Win64)
  "xinput1_3.dll",     // UE4SS xinput (Unreal,放在 Binaries/Win64)
  "coreuobj.dll",
  "enabled.txt"
]);
electron.ipcMain.handle("tools:scanGameMods", async (
  _event,
  options: {
    gamePath: string;
    // BUG-010 round 5(2026-10-03):exe 在子目录时上溯到游戏根(权威解析在后端)
    gamePathPrefix?: string;
    targets: Array<{
      modTypeId: string;
      modTypeName: string;
      absPath: string;
      // BUG-010:per-target 扫描扩展名白名单(覆盖默认 SCAN_MOD_FILE_EXTENSIONS)
      scanExtensions?: string[];
    }>;
  }
) => {
  // BUG-010 round 5:权威解析 effectiveGamePath(renderer 也会算,但后端做最终确认)
  const effectiveGamePath = options.gamePathPrefix
    ? resolve(options.gamePath, options.gamePathPrefix)
    : options.gamePath;
  const scannedMods: Array<{
    modTypeId: string;
    modTypeName: string;
    modRoot: string;
    files: string[];
  }> = [];

  for (const target of options.targets) {
    if (!target.absPath || !existsSync(target.absPath)) continue;

    // BUG-010:per-target 扫描扩展名白名单,覆盖默认 SCAN_MOD_FILE_EXTENSIONS
    //   巫师 3 adapter 传 ["bundle","ws","lua","xml",...] 覆盖 .pak/.dll/.lua/.uasset/.uexp
    //   undefined → 用默认(向后兼容老 adapter)
    const extWhitelist: Set<string> = target.scanExtensions
      ? new Set(target.scanExtensions.map((e) => e.toLowerCase()))
      : SCAN_MOD_FILE_EXTENSIONS;

    let entries;
    try {
      entries = await readdir(target.absPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      // 跳过隐藏 / 系统文件(.DS_Store / desktop.ini / Thumbs.db)
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "desktop.ini" || entry.name === "Thumbs.db") continue;

      const entryPath = join(target.absPath, entry.name);

      try {
        if (entry.isDirectory()) {
          // 子目录作为目录型 mod(BepInEx/plugins/xxx.dll 是单文件,
          // 但 UE4SS/Mods/xxx/ 这种是目录型,LogicMods/xxx/ 也是目录型)
          // 递归列文件,过滤明显的运行时/缓存/配置文件
          const allFiles = await listFiles(entryPath);
          const modFiles = allFiles.filter((rel) => {
            const base = basename(rel).toLowerCase();
            const ext = base.split(".").pop() ?? "";
            // 跳过隐藏文件
            if (base.startsWith(".")) return false;
            // BUG-010:用 per-target 白名单,target 没传才回退到 SCAN_MOD_FILE_EXTENSIONS
            if (!extWhitelist.has(ext)) return false;
            // 跳过顶层 mod 加载器自身(winhttp.dll / version.dll / dinput8.dll)
            //   这是 BepInEx / MelonLoader / SlayTheSpire2 的 mod 加载器,不是用户 mod
            if (SCAN_LOADER_FILE_NAMES.has(base)) return false;
            return true;
          });
          if (modFiles.length === 0) continue;
          scannedMods.push({
            modTypeId: target.modTypeId,
            modTypeName: target.modTypeName,
            modRoot: entryPath,
            files: modFiles
          });
        } else if (entry.isFile()) {
          // 顶层单文件 mod:.pak / .dll / .lua / .uasset / .uexp(巫师 3:.bundle / .ws)
          const ext = entry.name.toLowerCase().split(".").pop() ?? "";
          // BUG-010:用 per-target 白名单,默认 SCAN_MOD_FILE_EXTENSIONS
          if (!extWhitelist.has(ext)) continue;
          // 跳过 mod 加载器自身(防止把 BepInEx 的 winhttp.dll 误识别为 mod)
          if (SCAN_LOADER_FILE_NAMES.has(entry.name.toLowerCase())) continue;
          scannedMods.push({
            modTypeId: target.modTypeId,
            modTypeName: target.modTypeName,
            modRoot: entryPath,
            files: [entry.name]
          });
        }
      } catch {
        // 单个目录/文件 stat 失败(权限/锁),跳过继续
        continue;
      }
    }
  }

  return { scannedMods };
});

// BUG-010(2026-10-03):读 modRoot 顶层条目(只一层,过滤隐藏文件)。
//   installMod 用来自动探测 modRoot 唯一顶层目录作 targetFolderName(folderRoot strategy)。
//   典型场景:7z 解压到 <storage>/mods/<game>/<folderId>/Complete Game Rebalance/...
//   顶层唯一目录 "Complete Game Rebalance" → 装到 <gamePath>/installPath/Complete Game Rebalance
//   比用 mod.name(中文 DisplayName)更符合用户对磁盘目录名的预期。
electron.ipcMain.handle("tools:readDirTopLevel", async (
  _event,
  options: { path: string },
) => {
  if (!options?.path || !existsSync(options.path)) return [];
  try {
    const entries = await readdir(options.path, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  } catch {
    return [];
  }
});

// BUG-010(2026-10-03):解析 game 根目录相对偏移(exe 在子目录时上溯到游戏根)。
//   适用:巫师 3 witcher3.exe 在 <root>/bin/x64_dx12/ — preset.gameBasePath = "..\\..\\"
//   返回 effectiveGamePath,前端 joinGameRelativePath 用它替代 gamePath 解析 installPath。
//   renderer 没有 Node fs/path 模块,只能走 IPC。
electron.ipcMain.handle("tools:resolveGamePath", async (
  _event,
  options: { gamePath: string; prefix?: string },
) => {
  if (!options?.gamePath) return "";
  if (!options.prefix) return options.gamePath;
  return resolve(options.gamePath, options.prefix);
});

// HGMM Phase 2.5:查询 UE4SS 加载器包路径(打包到 resources/ue4ss/{presetId}.zip)。
// 返回 { archivePath, exists }:exists=false 表示该游戏没打包加载器(hogwarts/tekken8 等)。
electron.ipcMain.handle("tools:getUE4SSPackage", async (_event, presetId: string) => {
  const archivePath = getResourcePath(`ue4ss/${presetId}.zip`);
  return {
    archivePath,
    exists: existsSync(archivePath)
  };
});

// HGMM 3.0:查询 BepInEx 加载器包路径(打包到 resources/bepinex/{presetId}.zip),
// 与 UE4SS 同模式但拆开,因 UE4SS / BepInEx 是不同引擎依赖,合并会强加 loaderType 参数。
// 不存在同样表示该游戏未打包(silksong / howtofish 之外的游戏)。
electron.ipcMain.handle("tools:getBepInExPackage", async (_event, presetId: string) => {
  const archivePath = getResourcePath(`bepinex/${presetId}.zip`);
  return {
    archivePath,
    exists: existsSync(archivePath)
  };
});

// HGMM Phase 2.5:UE4SS/BepInEx 加载器依赖直接解压到游戏目录(不经过 modRoot 中转)。
// archivePath 是打包到 resources/ 的 zip(UE4SS 或 BepInEx 加载器),
// targetPath 是 <gamePath>/<basePath>/Binaries/Win64(UE4SS) 或 <gamePath>/(BepInEx)。
// allowedRoot 是 gamePath,确保 targetPath 必须在游戏根目录下(防 zip-slip)。
electron.ipcMain.handle("tools:extractArchive", async (_event, options: {
  archivePath: string;
  targetPath: string;
  allowedRoot?: string;
}) => {
  if (options.allowedRoot) {
    assertPathInside(options.allowedRoot, resolve(options.targetPath), "解压目标路径");
  }
  await mkdir(options.targetPath, { recursive: true });

  // 怀沙:0 字节文件直接拒 — 明显是下载中断或引擎没写成功
  // 不卡阈值:合法小 mod(单 DLL 补丁、几行 JSON)打包后可能就几百字节
  // 真正的截断检测交给 7-Zip / AdmZip 解压去判,它们的错误消息比字节数判断准得多
  if (existsSync(options.archivePath)) {
    const archiveStat = await stat(options.archivePath);
    if (archiveStat.size === 0) {
      throw new Error(
        `文件为空:${basename(options.archivePath)}。可能是下载中断,请重新下载。`
      );
    }
  }

  const declaredExt = getPathExtension(options.archivePath);
  const isDeclaredArchive =
    ARCHIVE_EXTENSIONS.includes(declaredExt) || ["7z", "rar"].includes(declaredExt);

  if (!isDeclaredArchive) {
    throw new Error(`不支持的压缩包格式: .${declaredExt || "(无扩展名)"}`);
  }

  // HGMM Phase 5.x:先 sniff 真实格式,扩展名错也照常解压
  // 例:"xxx.zip" 实际是 RAR → 嗅到 RAR → 走 extractWith7za,不抛"No END header"
  const actualFormat = await detectArchiveFormat(options.archivePath);
  if (actualFormat === "unknown") {
    // 嗅不到已知格式,大概率是 HTML / JSON / 损坏,给明确错误
    await validateArchiveFile(options.archivePath);
    // validateArchiveFile 一定会抛,这里只是保险
    throw new Error(`文件格式无法识别:${basename(options.archivePath)}`);
  }

  if (actualFormat === "zip") {
    try {
      // zip: AdmZip 提取(safeJoin 防 slip,与 mods:importFolder 一致)
      const zip = new AdmZip(options.archivePath);
      for (const entry of zip.getEntries()) {
        const entryTarget = safeJoin(options.targetPath, entry.entryName);
        if (entry.isDirectory) {
          await mkdir(entryTarget, { recursive: true });
        } else {
          await mkdir(dirname(entryTarget), { recursive: true });
          await writeFile(entryTarget, entry.getData());
        }
      }
    } catch (caught) {
      // AdmZip 抛 No END header / invalid signature 等,把内部错误包装成人话
      if (caught instanceof Error && /ADM-ZIP|END header|signature/i.test(caught.message)) {
        throw new Error(
          `ZIP 文件结构损坏:${basename(options.archivePath)}。可能是下载不完整,请重新下载。`,
        );
      }
      throw caught;
    }
  } else {
    // 7z / rar 都走 7za(7-Zip 引擎能处理两种格式)
    await extractWith7za(options.archivePath, options.targetPath);
  }

  const files = await listFiles(options.targetPath);
  return { files, targetPath: options.targetPath };
});

electron.ipcMain.handle("app:getAboutNotice", async () => {
  // 怀沙:从远程拉取关于页面公告 HTML。
  // 历史:曾读 resources/about-notice.html(本地),asar + extraResources 路径分裂导致 ENOENT
  // 改成 fetch 后无需关心打包路径,且公告内容可独立于发版更新。
  // 失败时返回空字符串(渲染层已有"加载失败"兜底,见 SettingsView / 关于页 onError)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchWithProxy(ABOUT_NOTICE_URL, {
        signal: controller.signal,
        headers: { Accept: "text/html, */*" }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`远程公告加载失败:${reason}`);
  }
});

electron.ipcMain.handle("fs:readJsonFile", async (_event, targetPath: string) => {
  const raw = await readFile(targetPath, "utf-8");
  return JSON.parse(raw) as unknown;
});

electron.ipcMain.handle("fs:writeJsonFile", async (_event, targetPath: string, value: unknown) => {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(value, null, 2), "utf-8");
  return true;
});

electron.ipcMain.handle("fs:findFileByName", async (_event, options: {
  rootPath: string;
  fileNames: string[];
  maxDepth?: number;
}) => findFileByName(options.rootPath, options.fileNames, options.maxDepth ?? 5));

electron.ipcMain.handle("steam:findGamePath", async (_event, steamAppId: number) =>
  findSteamGamePath(steamAppId)
);

electron.ipcMain.handle("translate:text", async (_event, options: {
  text: string;
  provider?: string;
  targetLang: "zh-CN";
  sourceLang?: string;
  proxyUrl?: string;
  baiduAppId?: string;
  baiduSecret?: string;
  youdaoAppKey?: string;
  youdaoSecret?: string;
  tencentSecretId?: string;
  tencentSecretKey?: string;
  tencentRegion?: string;
  volcengineAccessKeyId?: string;
  volcengineSecretAccessKey?: string;
  volcengineRegion?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTimeoutMs?: number;
}) => enqueueTranslation(() =>
  translateTextByProvider({
    ...options,
    text: String(options.text || ""),
    targetLang: "zh-CN",
    sourceLang: options.sourceLang || "auto"
  })
));

electron.ipcMain.handle("nexus:startOAuthLogin", async (_event, options?: {
  proxyUrl?: string;
}) => startNexusOAuthLogin(options?.proxyUrl ?? ""));

electron.ipcMain.handle("nexus:cancelOAuthLogin", async () => {
  if (!activeNexusOAuth) return false;

  activeNexusOAuth.finish(new Error("已取消 Nexus 网页登录。"));
  return true;
});

electron.ipcMain.handle("nexus:validateApiKey", async (_event, options: string | {
  apiKey: string;
  proxyUrl?: string;
}) => {
  const apiKey = typeof options === "string" ? options : options.apiKey;
  const proxyUrl = typeof options === "string" ? "" : options.proxyUrl;
  const response = await fetchWithProxy(`${NEXUS_API_URL}/v1/users/validate.json`, {
    method: "GET",
    headers: nexusHeaders({ apiKey }, true),
    proxyUrl
  });
  const payload = await readJsonResponse<Record<string, unknown>>(response, "校验 NexusMods API Key 失败。");

  return {
    key: normalizeNexusText(payload.key) || apiKey.trim(),
    name: normalizeNexusText(payload.name),
    email: normalizeNexusText(payload.email),
    profileUrl: normalizeNexusText(payload.profile_url),
    isPremium: Boolean(payload.is_premium),
    isSupporter: Boolean(payload.is_supporter)
  };
});

electron.ipcMain.handle("nexus:listMods", async (_event, options: {
  apiKey: string;
  accessToken?: string;
  gameDomain: string;
  page: number;
  pageSize: number;
  proxyUrl?: string;
  searchText?: string;
  sort?: "default" | "updatedAt" | "createdAt" | "downloads";
  facets?: {
    categoryName?: string;
    languageName?: string;
    tag?: string;
  };
}) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(40, Math.max(1, Number(options.pageSize) || 20));
  const gameDomain = options.gameDomain.trim();
  const searchText = options.searchText?.trim() ?? "";
  const sortKey = options.sort === "updatedAt"
    ? "updatedAt"
    : options.sort === "createdAt"
      ? "createdAt"
      : "downloads";
  const gql = `
    query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $sort: [ModsSort!]) {
      mods(count: $count, facets: $facets, filter: $filter, offset: $offset, sort: $sort, viewUserBlockedContent: false) {
        facetsData
        nodes {
          adultContent
          createdAt
          downloads
          endorsements
          game { domainName }
          modCategory { name }
          modId
          name
          summary
          thumbnailUrl
          updatedAt
          uploader { name }
        }
        totalCount
      }
    }
  `;
  const variables: Record<string, unknown> = {
    count: pageSize,
    facets: {
      categoryName: options.facets?.categoryName ? [options.facets.categoryName] : [],
      languageName: options.facets?.languageName ? [options.facets.languageName] : [],
      tag: options.facets?.tag ? [options.facets.tag] : []
    },
    offset: (page - 1) * pageSize,
    sort: [{ [sortKey]: { direction: "DESC" } }],
    filter: {
      gameDomainName: {
        op: "EQUALS",
        value: gameDomain
      },
      ...(searchText
        ? {
            // 怀沙:Nexus 模糊搜索用 nameStemmed + MATCHES(全文/词干搜索,大小写不敏感)
            nameStemmed: [{ op: "MATCHES", value: searchText }]
          }
        : {})
    }
  };
  const response = await fetchWithProxy(NEXUS_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...nexusHeaders({
        apiKey: options.apiKey,
        accessToken: options.accessToken
      }, true)
    },
    body: JSON.stringify({ query: gql, variables }),
    proxyUrl: options.proxyUrl
  });
  const payload = await readJsonResponse<{
    data?: {
      mods?: {
        nodes?: Array<Record<string, unknown>>;
        totalCount?: number;
        facetsData?: {
          categoryName?: Record<string, number>;
          languageName?: Record<string, number>;
          tag?: Record<string, number>;
        };
      };
    };
  }>(response, "获取 NexusMods 列表失败。");
  const nodes = payload.data?.mods?.nodes ?? [];
  const totalCount = payload.data?.mods?.totalCount ?? 0;
  const facetsData = payload.data?.mods?.facetsData;

  return {
    items: nodes.map((node) => {
      const game = node.game && typeof node.game === "object" ? node.game as Record<string, unknown> : {};
      const uploader = node.uploader && typeof node.uploader === "object" ? node.uploader as Record<string, unknown> : {};
      const category = node.modCategory && typeof node.modCategory === "object" ? node.modCategory as Record<string, unknown> : {};
      const modId = String(node.modId ?? "").split("_")[0];
      const domain = normalizeNexusText(game.domainName) || gameDomain;

      return {
        id: modId,
        title: normalizeNexusText(node.name),
        summary: normalizeNexusText(node.summary),
        author: normalizeNexusText(uploader.name),
        version: "",
        website: buildNexusWebsite(domain, modId),
        cover: normalizeNexusText(node.thumbnailUrl),
        downloads: Math.max(0, Number(node.downloads ?? 0)),
        likes: Math.max(0, Number(node.endorsements ?? 0)),
        categories: [normalizeNexusText(category.name)].filter(Boolean),
        createdAt: normalizeNexusText(node.createdAt),
        updatedAt: normalizeNexusText(node.updatedAt),
        nsfw: Boolean(node.adultContent),
        filesCount: 0,
        primaryFile: null
      };
    }),
    page,
    pageSize,
    totalCount,
    totalPages: totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0,
    facets: {
      categoryName: normalizeNexusFacetOptions(facetsData?.categoryName),
      languageName: normalizeNexusFacetOptions(facetsData?.languageName),
      tag: normalizeNexusFacetOptions(facetsData?.tag)
    }
  };
});

electron.ipcMain.handle("nexus:getModDetail", async (_event, options: {
  apiKey: string;
  accessToken?: string;
  gameDomain: string;
  modId: string;
  proxyUrl?: string;
}) => {
  const gameDomain = options.gameDomain.trim();
  const modId = options.modId.trim();
  const headers = nexusHeaders({
    apiKey: options.apiKey,
    accessToken: options.accessToken
  }, true);
  const detailResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}.json`, {
    method: "GET",
    headers,
    proxyUrl: options.proxyUrl
  });
  const detail = await readJsonResponse<Record<string, unknown>>(detailResponse, "获取 NexusMods Mod 详情失败。");
  const filesResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/files.json`, {
    method: "GET",
    headers,
    proxyUrl: options.proxyUrl
  });
  const filesPayload = await readJsonResponse<{
    files?: Array<Record<string, unknown>>;
  }>(filesResponse, "获取 NexusMods 文件列表失败。");
  const imagesResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/images.json`, {
    method: "GET",
    headers,
    proxyUrl: options.proxyUrl
  });
  const imagesPayload = await imagesResponse.json().catch(() => []) as Array<Record<string, unknown>> | { images?: Array<Record<string, unknown>> };
  const images = Array.isArray(imagesPayload)
    ? imagesPayload
    : Array.isArray(imagesPayload.images)
      ? imagesPayload.images
      : [];

  return normalizeNexusDetail(detail, filesPayload.files ?? [], imagesResponse.ok ? images : [], gameDomain);
});

electron.ipcMain.handle("nexus:getDownloadUrl", async (_event, options: {
  apiKey: string;
  accessToken?: string;
  gameDomain: string;
  modId: string;
  fileId: string;
  proxyUrl?: string;
  key?: string;
  expires?: string;
}) => {
  const gameDomain = options.gameDomain.trim();
  const modId = options.modId.trim();
  const fileId = options.fileId.trim();
  const downloadLinkUrl = new URL(
    `${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/files/${fileId}/download_link.json`
  );
  const nexusDownloadKey = options.key?.trim();
  const nexusDownloadExpires = options.expires?.trim();

  if (nexusDownloadKey) {
    downloadLinkUrl.searchParams.set("key", nexusDownloadKey);

    if (nexusDownloadExpires) {
      downloadLinkUrl.searchParams.set("expires", nexusDownloadExpires);
    }
  }

  const response = await fetchWithProxy(downloadLinkUrl, {
    method: "GET",
    headers: nexusHeaders({
      apiKey: options.apiKey,
      accessToken: options.accessToken
    }, true),
    proxyUrl: options.proxyUrl
  });
  const payload = await response.json().catch(() => ({})) as Array<{ URI?: string }> | { message?: string };

  if (!response.ok) {
    if (response.status === 403) {
      return buildNexusWebsite(gameDomain, modId, fileId);
    }

    throw new Error(!Array.isArray(payload) && payload.message ? payload.message : "获取 NexusMods 下载地址失败。");
  }

  return Array.isArray(payload) && payload[0]?.URI
    ? payload[0].URI
    : buildNexusWebsite(gameDomain, modId, fileId);
});

function totalBytesFromHeaders(headers: Headers, startingBytes: number, receivedBytes: number) {
  const contentRange = headers.get("content-range") ?? "";
  const rangeTotal = contentRange.match(/\/(\d+)$/u)?.[1];
  if (rangeTotal) return Number(rangeTotal);

  const contentLength = Number(headers.get("content-length") ?? 0);
  if (contentLength > 0) return startingBytes + contentLength;

  return receivedBytes;
}

electron.ipcMain.handle("downloads:downloadFile", async (_event, options: {
  taskId?: string;
  url: string;
  outputPath: string;
  resume?: boolean;
  proxyUrl?: string;
  engine?: "builtin" | "aria2";
  aria2ExecutablePath?: string;
  aria2MaxConnections?: number;
}) => {
  if (options.engine === "aria2") {
    return downloadWithAria2({
      taskId: options.taskId,
      url: options.url,
      outputPath: options.outputPath,
      resume: options.resume,
      aria2ExecutablePath: options.aria2ExecutablePath,
      aria2MaxConnections: options.aria2MaxConnections
    });
  }

  const taskId = options.taskId?.trim();
  const controller = new AbortController();
  let startingBytes = 0;

  if (taskId) {
    downloadControllers.get(taskId)?.abort();
    downloadControllers.set(taskId, controller);
  }

  if (options.resume && existsSync(options.outputPath)) {
    const outputStat = await stat(options.outputPath);
    startingBytes = outputStat.size;
  }

  let response: Response;
  try {
    response = await fetchWithProxy(options.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "HuaishaGameModManager",
        ...(startingBytes > 0 ? { range: `bytes=${startingBytes}-` } : {})
      },
      proxyUrl: options.proxyUrl
    });
  } catch (caught) {
    if (taskId && downloadControllers.get(taskId) === controller) {
      downloadControllers.delete(taskId);
    }
    throw caught;
  }

  if (!response.ok || !response.body) {
    if (taskId && downloadControllers.get(taskId) === controller) {
      downloadControllers.delete(taskId);
    }
    throw new Error(`下载失败：HTTP ${response.status}`);
  }

  const shouldAppend = startingBytes > 0 && response.status === 206;
  if (startingBytes > 0 && !shouldAppend) {
    startingBytes = 0;
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  const file = await open(options.outputPath, shouldAppend ? "a" : "w");
  let receivedBytes = startingBytes;

  try {
    const reader = response.body.getReader();
    let lastReportTime = 0;
    const totalBytes = totalBytesFromHeaders(response.headers, startingBytes, receivedBytes);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      await file.write(Buffer.from(value));

      const now = Date.now();
      if (taskId && mainWindow && now - lastReportTime > 250) {
        mainWindow.webContents.send("downloads:progress", {
          taskId,
          receivedBytes,
          totalBytes: totalBytes || receivedBytes
        });
        lastReportTime = now;
      }
    }
  } finally {
    await file.close();
    if (taskId && downloadControllers.get(taskId) === controller) {
      downloadControllers.delete(taskId);
    }
  }

  // 怀沙:Nexus 上传者经常把 RAR/7z 改名为 .zip — 嗅探真实格式并按需重命名,让扩展名 = 内容
  // 让用户在文件管理器看到的文件名不再撒谎,也方便手动用 WinRAR / 7-Zip 操作
  const correctedOutputPath = await correctArchiveExtension(options.outputPath);
  if (correctedOutputPath !== options.outputPath) {
    await rename(options.outputPath, correctedOutputPath).catch((caught) => {
      console.warn("[hgmm] downloadFile: failed to rename to corrected extension", {
        from: options.outputPath,
        to: correctedOutputPath,
        error: caught instanceof Error ? caught.message : String(caught)
      });
    });
  }

  return {
    outputPath: correctedOutputPath,
    receivedBytes,
    totalBytes: totalBytesFromHeaders(response.headers, startingBytes, receivedBytes) || receivedBytes
  };
});

electron.ipcMain.handle("downloads:cancel", async (_event, taskId: string) => {
  const aria2Task = aria2Tasks.get(taskId);
  if (aria2Task && aria2Runtime) {
    aria2Task.cancelled = true;
    await aria2Rpc(aria2Runtime, "aria2.forceRemove", [aria2Task.gid]).catch(() => undefined);
    return true;
  }

  const controller = downloadControllers.get(taskId);
  if (!controller) return false;

  controller.abort();
  downloadControllers.delete(taskId);
  return true;
});

electron.ipcMain.handle("backups:createZip", async (_event, options: {
  sourcePath: string;
  outputPath: string;
}) => {
  const source = resolve(options.sourcePath);
  const output = resolve(options.outputPath);
  const sourceStat = await stat(source);

  if (!sourceStat.isDirectory()) {
    throw new Error("备份失败：来源必须是文件夹。");
  }

  await mkdir(dirname(output), { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(source);
  zip.writeZip(output);
  const outputStat = await stat(output);

  return {
    outputPath: output,
    size: outputStat.size,
    filesCount: (await listFiles(source)).length
  };
});

electron.ipcMain.handle("backups:restoreZip", async (_event, options: {
  backupPath: string;
  targetPath: string;
}) => {
  const backup = resolve(options.backupPath);
  const target = resolve(options.targetPath);

  if (!existsSync(backup)) {
    throw new Error("恢复失败：备份文件不存在。");
  }

  await mkdir(target, { recursive: true });
  const zip = new AdmZip(backup);

  for (const entry of zip.getEntries()) {
    const entryTarget = safeJoin(target, entry.entryName);

    if (entry.isDirectory) {
      await mkdir(entryTarget, { recursive: true });
    } else {
      await mkdir(dirname(entryTarget), { recursive: true });
      await writeFile(entryTarget, entry.getData());
    }
  }

  return true;
});

electron.ipcMain.handle("backups:listZip", async (_event, backupPath: string) => {
  const backup = resolve(backupPath);

  if (!existsSync(backup)) {
    throw new Error("读取失败：备份文件不存在。");
  }

  const zip = new AdmZip(backup);

  return zip.getEntries().map((entry) => ({
    path: entry.entryName,
    isDirectory: entry.isDirectory,
    size: entry.header.size
  }));
});

electron.ipcMain.handle("package:exportMods", async (event, options: {
  mods: Array<{
    rootPath: string;
    folderName: string;
  }>;
  manifest: Record<string, unknown>;
  outputPath: string;
  operationId?: string;
}) => {
  const output = resolve(options.outputPath);
  const operationId = options.operationId || randomUUID();
  await mkdir(dirname(output), { recursive: true });

  if (existsSync(output)) {
    throw new Error("导出失败：目标文件已存在，请换一个文件名。");
  }

  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(options.manifest, null, 2), "utf-8"));
  const report = (payload: Omit<PackageProgressPayload, "operationId" | "operation">) => {
    sendPackageProgress(event.sender, {
      operationId,
      operation: "export",
      ...payload
    });
  };

  report({
    phase: "准备中",
    current: 0,
    total: options.mods.length,
    message: "正在扫描 Mod 文件..."
  });
  await yieldToRenderer();

  const scannedMods: Array<{
    rootPath: string;
    folderName: string;
    files: string[];
  }> = [];

  for (let index = 0; index < options.mods.length; index += 1) {
    const mod = options.mods[index];
    const rootPath = resolve(mod.rootPath);
    const folderName = sanitizeFileName(mod.folderName);

    const files = existsSync(rootPath) ? await listFiles(rootPath) : [];
    scannedMods.push({ rootPath, folderName, files });
    report({
      phase: "扫描文件",
      current: index + 1,
      total: Math.max(options.mods.length, 1),
      message: `正在扫描 Mod ${index + 1} / ${options.mods.length}`
    });
    await yieldToRenderer();
  }

  const totalFiles = scannedMods.reduce((total, mod) => total + mod.files.length, 0);
  const progressTotal = Math.max(totalFiles, 1);
  let processedFiles = 0;
  let lastReportAt = 0;

  report({
    phase: "写入文件",
    current: 0,
    total: progressTotal,
    message: "正在写入整合包..."
  });
  await yieldToRenderer();

  for (const mod of scannedMods) {
    for (const file of mod.files) {
      const sourcePath = resolve(mod.rootPath, file);
      const entryPath = join(mod.folderName, file).replace(/\\/g, "/");
      zip.addFile(entryPath, await readFile(sourcePath));
      processedFiles += 1;

      const now = Date.now();
      if (processedFiles === totalFiles || now - lastReportAt >= 100) {
        report({
          phase: "写入文件",
          current: processedFiles,
          total: progressTotal,
          message: `已写入 ${processedFiles} / ${totalFiles || 0} 个文件`
        });
        lastReportAt = now;
        await yieldToRenderer();
      }
    }
  }

  report({
    phase: "压缩中",
    current: progressTotal,
    total: progressTotal,
    message: "正在生成压缩文件..."
  });
  await yieldToRenderer();
  zip.writeZip(output);
  const outputStat = await stat(output);
  report({
    phase: "完成",
    current: progressTotal,
    total: progressTotal,
    message: "整合包导出完成"
  });

  return {
    outputPath: output,
    size: outputStat.size
  };
});

electron.ipcMain.handle("package:readManifest", async (_event, packagePath: string) => {
  const zip = new AdmZip(resolve(packagePath));
  const manifestEntry = zip.getEntry("manifest.json");

  if (!manifestEntry) {
    throw new Error("整合包缺少 manifest.json。");
  }

  return JSON.parse(manifestEntry.getData().toString("utf-8")) as Record<string, unknown>;
});

electron.ipcMain.handle("package:importGamePack", async (event, options: {
  packagePath: string;
  storagePath: string;
  gameName: string;
  overwrite?: boolean;
  operationId?: string;
}) => {
  const packagePath = resolve(options.packagePath);
  const gameRoot = join(resolve(options.storagePath), "mods", sanitizeFileName(options.gameName));
  const operationId = options.operationId || randomUUID();
  const zip = new AdmZip(packagePath);
  const manifestEntry = zip.getEntry("manifest.json");

  if (!manifestEntry) {
    throw new Error("整合包缺少 manifest.json。");
  }

  const manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as {
    format?: string;
    mods?: Array<Record<string, unknown>>;
  };

  if (manifest.format !== "mayfly-game-pack" || !Array.isArray(manifest.mods)) {
    throw new Error("这不是 HGMM 游戏整合包。");
  }

  const report = (payload: Omit<PackageProgressPayload, "operationId" | "operation">) => {
    sendPackageProgress(event.sender, {
      operationId,
      operation: "import",
      ...payload
    });
  };

  const fileEntries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const entriesByFolder = new Map<string, typeof fileEntries>();
  for (const entry of fileEntries) {
    const separatorIndex = entry.entryName.indexOf("/");
    if (separatorIndex <= 0) continue;

    const folder = sanitizeFileName(entry.entryName.slice(0, separatorIndex));
    const folderEntries = entriesByFolder.get(folder) ?? [];
    folderEntries.push(entry);
    entriesByFolder.set(folder, folderEntries);
  }

  const validMods = manifest.mods
    .map((mod) => sanitizeFileName(String(mod.folder || mod.id || mod.name || "")))
    .filter((folder) => Boolean(folder) && (entriesByFolder.get(folder)?.length ?? 0) > 0);
  const totalFiles = validMods.reduce(
    (total, folder) => total + (entriesByFolder.get(folder)?.length ?? 0),
    0
  );
  const progressTotal = Math.max(totalFiles, 1);
  let processedFiles = 0;
  let lastReportAt = 0;

  report({
    phase: "准备中",
    current: 0,
    total: progressTotal,
    message: `准备导入 ${validMods.length} 个 Mod...`
  });
  await yieldToRenderer();

  await mkdir(gameRoot, { recursive: true });
  const importedMods: Array<{ folder: string; rootPath: string; files: string[]; coverImage?: string }> = [];

  for (const mod of manifest.mods) {
    const folder = sanitizeFileName(String(mod.folder || mod.id || mod.name || ""));
    if (!folder) continue;

    const prefix = `${folder}/`;
    const rootPath = safeJoin(gameRoot, folder);
    const entries = (entriesByFolder.get(folder) ?? []).filter((entry) =>
      entry.entryName.startsWith(prefix) && !entry.entryName.includes("..")
    );

    if (entries.length === 0) continue;

    if (existsSync(rootPath)) {
      if (!options.overwrite) {
        throw new Error(`整合包恢复失败：目标 Mod 目录已存在：${folder}`);
      }

      await rm(rootPath, { recursive: true, force: true });
    }

    for (const entry of entries) {
      const relativeEntry = entry.entryName.slice(prefix.length);
      if (!relativeEntry) continue;
      const target = safeJoin(rootPath, relativeEntry);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.getData());
      processedFiles += 1;

      const now = Date.now();
      if (processedFiles === totalFiles || now - lastReportAt >= 100) {
        report({
          phase: "写入文件",
          current: processedFiles,
          total: progressTotal,
          message: `已导入 ${processedFiles} / ${totalFiles || 0} 个文件`
        });
        lastReportAt = now;
        await yieldToRenderer();
      }
    }

    const files = await listFiles(rootPath);
    importedMods.push({
      folder,
      rootPath,
      files,
      coverImage: findCoverImage(files)
    });
  }

  report({
    phase: "完成",
    current: progressTotal,
    total: progressTotal,
    message: `已导入 ${importedMods.length} 个 Mod`
  });

  return {
    manifest,
    mods: importedMods
  };
});

electron.ipcMain.handle("mods:importFolder", async (_event, options: {
  sourcePath: string;
  storagePath: string;
  gameId: string;
  gameName?: string;
  modId: string;
}) => {
  const sourceStat = await stat(options.sourcePath);
  const gameFolderName = sanitizeFileName(options.gameName || options.gameId);
  const modRoot = join(options.storagePath, "mods", gameFolderName, options.modId);
  await mkdir(modRoot, { recursive: true });

  // 怀沙:0 字节文件直接拒 — 明显是下载中断或引擎没写成功
  // 不卡阈值:合法小 mod(单 DLL 补丁、几行 JSON)打包后可能就几百字节
  // 真正的截断检测交给 AdmZip / 7-Zip 解压去判,它们的错误消息比字节数判断准得多
  if (!sourceStat.isDirectory() && sourceStat.size === 0) {
    throw new Error(
      `文件为空:${basename(options.sourcePath)}。可能是下载中断,请重新下载。`
    );
  }

  if (sourceStat.isDirectory()) {
    await cp(options.sourcePath, modRoot, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  } else {
    // HGMM Phase 5.x:嗅探真实格式,扩展名错也照常解压
    // 例:"xxx.zip" 实际是 RAR/7z → 嗅探后路由到 extractWith7za
    let actualExt = getPathExtension(options.sourcePath);
    if (ARCHIVE_EXTENSIONS.includes(actualExt) || ["7z", "rar"].includes(actualExt)) {
      const detected = await detectArchiveFormat(options.sourcePath);
      if (detected !== "unknown" && detected !== actualExt) {
        actualExt = detected;
      } else if (detected === "unknown") {
        await validateArchiveFile(options.sourcePath);
        throw new Error(`文件格式无法识别:${basename(options.sourcePath)}`);
      }
    }

    if (ARCHIVE_EXTENSIONS.includes(actualExt)) {
      try {
        const zip = new AdmZip(options.sourcePath);
        for (const entry of zip.getEntries()) {
          const entryTarget = safeJoin(modRoot, entry.entryName);

          if (entry.isDirectory) {
            await mkdir(entryTarget, { recursive: true });
          } else {
            await mkdir(dirname(entryTarget), { recursive: true });
            await writeFile(entryTarget, entry.getData());
          }
        }
      } catch (caught) {
        if (caught instanceof Error && /ADM-ZIP|END header|signature/i.test(caught.message)) {
          throw new Error(
            `ZIP 文件结构损坏:${basename(options.sourcePath)}。可能是下载不完整,请重新下载。`,
          );
        }
        throw caught;
      }
    } else if (["7z", "rar"].includes(actualExt)) {
      await extractWith7za(options.sourcePath, modRoot);
    } else {
      await cp(options.sourcePath, join(modRoot, basename(options.sourcePath)), {
        force: true,
        errorOnExist: false
      });
    }
  }

  const files = await listFiles(modRoot);

  return {
    rootPath: modRoot,
    files,
    manifest: await readManifest(modRoot, files),
    coverImage: findCoverImage(files)
  };
});

/**
 * BUG-022(2026-10-05):精选 mod 的 subFile 平铺部署。
 * 旧路径(BUG-014)走 installMod 的 folderRoot 策略,会把 modRoot 顶层目录当
 *   targetFolderName 再 cp 一次,导致 subFile 装到错的子目录名(如 JSON 写
 *   ModName="DekCNS_P.pak" 但 7z 顶层叫 "CustomNanosuitSystem/",装出
 *   "LogicMods/CustomNanosuitSystem/" 而非 "LogicMods/DekCNS_P.pak/"。
 *
 * 用户原话:"这个模组 3 个文件,每一个文件我都配置了 url 地址,以及安装路径,
 *   就一个下载解压到指定路径,这很难么?"
 *
 * 新实现:把 modRoot 整个内容平铺到 <effectiveGamePath>/<installPath>/ 下,
 *   不嵌套任何子目录、不做 7z 顶层探测、不做 targetFolderName 推断。
 *   subFile 的 7z 包是黑盒,里面啥样都直接平铺过去。
 *
 * effectiveGamePath 由 renderer 侧 resolveGamePath 计算(走 BUG-010 gameBasePath 偏移)。
 */
electron.ipcMain.handle("mods:flattenDeploy", async (_event, options: {
  modRoot: string;
  effectiveGamePath: string;
  installPath: string;
}) => {
  // 1. 校验 modRoot 存在
  if (!options?.modRoot || !existsSync(options.modRoot)) {
    throw new Error(`modRoot 不存在: ${options?.modRoot ?? "(空)"}`);
  }
  // 2. 校验 installPath 不含 .. 路径穿越 + 不以盘符开头(相对 game 根)
  const installPath = (options.installPath ?? "").trim();
  if (installPath === "") {
    throw new Error("installPath 为空");
  }
  if (/^[a-zA-Z]:[\\\/]/u.test(installPath)) {
    throw new Error(
      `installPath 必须是相对路径(相对游戏根目录),不能是绝对路径: ${installPath}`,
    );
  }
  if (/(\.\.[/\\])/u.test(installPath)) {
    throw new Error(`installPath 包含路径穿越标记 "..": ${installPath}`);
  }
  if (!options?.effectiveGamePath) {
    throw new Error("effectiveGamePath 为空");
  }
  // 3. 解析目标目录
  const targetDir = resolve(options.effectiveGamePath, installPath);
  // 4. 安全检查:targetDir 必须在 effectiveGamePath 下
  assertPathInside(options.effectiveGamePath, targetDir, "installPath");
  // 5. 确保目标目录存在
  await mkdir(targetDir, { recursive: true });
  // 6. 平铺 cp modRoot/* → targetDir/*(覆盖式,force=true 跟 installMod 一致)
  await cp(options.modRoot, targetDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  return {
    targetDir,
    deployedFrom: options.modRoot,
  };
});

/**
 * HGMM marker mod 导入(2026-10-04):
 * 嗅探源文件是否包含 marker manifest,如果 game 匹配当前 presetId,
 *   直接解压到 effectiveGamePath,**不导入到 storagePath**,不创建 LocalMod 记录。
 *
 * 三种返回:
 * - { kind: "marker", manifest } → 解压成功,UI 提示"已部署到游戏目录"
 * - { kind: "wrong-game", manifest } → game 字段不匹配,抛错(让用户知道装错游戏了)
 * - { kind: "no-marker" } → 没 marker,UI 应该走原导入流程(本 handler 不再返回)
 *
 * effectiveGamePath 由 renderer 侧 resolveGamePath 计算后传入(走 BUG-010 机制,
 *   考虑 gameBasePath 偏移)。
 */
electron.ipcMain.handle("mods:importMarkerMod", async (_event, options: {
  sourcePath: string;
  effectiveGamePath: string;
  expectedGame: string;
}) => {
  const peek = await peekMarkerModInArchive(options.sourcePath, options.expectedGame);
  if (!peek) {
    return { kind: "no-marker" as const };
  }
  if (peek.kind === "wrong-game") {
    throw new Error(
      `marker mod 的 game 字段是 "${peek.manifest.game}",但当前游戏 presetId 是 "${options.expectedGame}",拒绝解压(避免装错游戏)`,
    );
  }
  // 解压到 effectiveGamePath
  const result = await deployMarkerModToGameRoot(options.sourcePath, options.effectiveGamePath);
  return {
    kind: "marker" as const,
    extractedTo: result.extractedTo,
    manifest: peek.manifest,
  };
});

electron.ipcMain.handle("mods:copyCoverImage", async (_event, options: {
  sourcePath: string;
  modRoot: string;
}) => {
  const sourcePath = resolve(options.sourcePath);
  const modRoot = resolve(options.modRoot);
  const sourceStat = await stat(sourcePath);

  if (!sourceStat.isFile()) {
    throw new Error("预览图必须是图片文件。");
  }

  const extension = getPathExtension(sourcePath);
  if (!["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(extension)) {
    throw new Error("预览图只支持 JPG、PNG、WEBP、GIF 或 BMP 图片。");
  }

  const metadataRoot = safeJoin(modRoot, MOD_PREVIEW_FOLDER);
  await mkdir(metadataRoot, { recursive: true });

  for (const entry of await readdir(metadataRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^cover\./iu.test(entry.name)) {
      await rm(join(metadataRoot, entry.name), { force: true });
    }
  }

  const targetPath = safeJoin(metadataRoot, `cover.${extension}`);
  await copyFile(sourcePath, targetPath);

  return {
    coverImage: `${MOD_PREVIEW_FOLDER}/cover.${extension}`
  };
});

electron.ipcMain.handle("mods:migrateCoverImage", async (_event, options: {
  modRoot: string;
  coverImage: string;
}) => {
  const currentCover = options.coverImage.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!/^\.mayfly\/preview\./iu.test(currentCover)) {
    return { coverImage: options.coverImage };
  }

  const sourcePath = safeJoin(resolve(options.modRoot), currentCover);
  if (!existsSync(sourcePath)) {
    return { coverImage: options.coverImage };
  }

  const extension = getPathExtension(sourcePath);
  const targetRoot = safeJoin(resolve(options.modRoot), MOD_PREVIEW_FOLDER);
  const targetPath = safeJoin(targetRoot, `cover.${extension}`);
  await mkdir(targetRoot, { recursive: true });
  await copyFile(sourcePath, targetPath);
  await rm(safeJoin(resolve(options.modRoot), ".mayfly"), { recursive: true, force: true });

  return {
    coverImage: `${MOD_PREVIEW_FOLDER}/cover.${extension}`
  };
});

electron.ipcMain.handle("mods:migrateCacheFolder", async (_event, options: {
  sourcePath: string;
  storagePath: string;
  gameName: string;
  folderName: string;
}) => {
  const sourceRoot = resolve(options.sourcePath);
  const targetRoot = join(
    resolve(options.storagePath),
    "mods",
    sanitizeFileName(options.gameName),
    sanitizeFileName(options.folderName)
  );

  if (!existsSync(sourceRoot)) {
    throw new Error("旧 Mod 缓存目录不存在，无法迁移。");
  }

  if (resolve(sourceRoot) !== resolve(targetRoot)) {
    if (existsSync(targetRoot)) {
      throw new Error(`目标缓存目录已存在，无法迁移：${targetRoot}`);
    }

    await mkdir(dirname(targetRoot), { recursive: true });
    await cp(sourceRoot, targetRoot, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
    await rm(sourceRoot, { recursive: true, force: true });
  }

  const files = await listFiles(targetRoot);

  return {
    rootPath: targetRoot,
    files,
    manifest: await readManifest(targetRoot, files),
    coverImage: findCoverImage(files)
  };
});

electron.ipcMain.handle("mods:install", async (_event, options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) => {
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  await mkdir(targetRoot, { recursive: true });
  await cp(options.modRoot, targetRoot, {
    recursive: true,
    force: true,
    errorOnExist: false
  });

  return true;
});

electron.ipcMain.handle("mods:uninstall", async (_event, options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) => {
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const files = await listFiles(options.modRoot);

  await Promise.all(
    files.map((file) => rm(safeJoin(targetRoot, file), { force: true }))
  );

  return true;
});

// HGMM absolute mod:解压前清空目标目录(确保重复安装不留旧文件)
// 存在 → 递归删除后重建;不存在 → 创建
electron.ipcMain.handle("mods:cleanDirectory", async (_event, options: {
  targetPath: string;
}) => {
  await rm(options.targetPath, { recursive: true, force: true });
  await mkdir(options.targetPath, { recursive: true });
  return true;
});

electron.ipcMain.handle("mods:createInstallPlan", async (_event, options: {
  modRoot: string;
  gamePath: string;
  // BUG-010 round 5(2026-10-03):exe 在子目录时上溯到游戏根(权威解析在后端)
  gamePathPrefix?: string;
  targetFolderName?: string;
  strategy: {
    kind: string;
    installPath?: string;
    keepPath?: boolean;
    folderName?: string | string[];
    include?: boolean;
    spare?: boolean;
    fileName?: string;
    isExtname?: boolean;
    commonParent?: boolean;
    pass?: string[];
    dictionaryFile?: string;
    requireParent?: boolean;
    targetScope?: InstallTargetScope;
    documentsGameFolder?: string;
    iniFileName?: string;
    localAppDataGameFolder?: string;
    pluginsHeader?: string;
    updateGeneralTestFiles?: boolean;
    extension?: string;
    prefix?: string;
    startIndex?: number;
    listFileName?: string;
    rootFile?: string;
    portraitFolders?: string[];
    managedToolFileName?: string;
    reason?: string;
  };
  useSymlink?: boolean;
}) => {
  const installPath = options.strategy.installPath ?? "";
  const targetScope = normalizeTargetScope(options.strategy.targetScope);
  // BUG-010 round 5:权威解析 effectiveGamePath,plan 和 apply 走同一逻辑
  const effectiveGamePath = options.gamePathPrefix
    ? resolve(options.gamePath, options.gamePathPrefix)
    : options.gamePath;
  const targetRoot = getTargetScopeRoot(effectiveGamePath, targetScope);
  let targetFiles: string[] = [];

  switch (options.strategy.kind) {
    case "general":
      targetFiles = await planGeneralStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        keepPath: options.strategy.keepPath
      });
      break;
    case "folder":
      targetFiles = await planFolderStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        folderName: options.strategy.folderName ?? "",
        include: options.strategy.include,
        spare: options.strategy.spare
      });
      break;
    case "folderRoot":
      targetFiles = await planFolderRootStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        targetFolderName: options.targetFolderName
      });
      break;
    case "file":
      targetFiles = await planFileStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        useSymlink: options.useSymlink
      });
      break;
    case "fileSibling":
      targetFiles = await planFileSiblingStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        pass: options.strategy.pass
      });
      break;
    case "fileOnly":
      targetFiles = await planFileOnlyStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname
      });
      break;
    case "folderParent":
      targetFiles = await planFolderParentStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        folderName: options.strategy.folderName ?? "",
        useSymlink: options.useSymlink
      });
      break;
    case "fileMap":
      targetFiles = await planFileMapStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        dictionaryFile: options.strategy.dictionaryFile ?? ""
      });
      break;
    case "fileIntoParentFolder":
      targetFiles = await planFileIntoParentFolderStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        requireParent: options.strategy.requireParent
      });
      break;
    case "bethesdaData":
      targetFiles = await planBethesdaDataStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        folderName: options.strategy.folderName ?? ""
      });
      break;
    case "bethesdaPluginFiles":
      targetFiles = await planBethesdaPluginFilesStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath
      });
      break;
    case "oblivionPlugins":
      targetFiles = await planOblivionPluginsStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath
      });
      break;
    case "noMansSkyMods":
      targetFiles = await planGeneralStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        keepPath: options.strategy.keepPath
      });
      break;
    case "numberedPak":
      targetFiles = await planNumberedPakStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        extension: options.strategy.extension ?? "pak",
        prefix: options.strategy.prefix ?? "data",
        startIndex: options.strategy.startIndex ?? 2,
        listFileName: options.strategy.listFileName ?? "pakList.txt"
      });
      break;
    case "watchDogsPatch":
      targetFiles = await planWatchDogsPatchStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        listFileName: options.strategy.listFileName ?? "pakList.txt"
      });
      break;
    case "michangshengLinkedFolder":
      targetFiles = await planMiChangShengLinkedFolderStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        rootFile: options.strategy.rootFile ?? "mod.bin"
      });
      break;
    case "michangshengDllPlugins":
      targetFiles = await planFileOnlyStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: "dll",
        isExtname: true
      });
      break;
    case "legendPortraits":
      targetFiles = await planLegendPortraitsStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        portraitFolders: options.strategy.portraitFolders ?? []
      });
      break;
    case "inzoiModKit":
      targetFiles = await planFileStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: "mod_manifest.json"
      });
      break;
    case "bg3Pak":
      targetFiles = await planFileOnlyStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: "pak",
        isExtname: true
      });
      break;
    case "redDeadAsi":
      targetFiles = await planFileSiblingStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "asi",
        isExtname: options.strategy.isExtname
      });
      break;
    case "redDeadLml":
      targetFiles = await planRedDeadLmlStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath
      });
      break;
    case "manual":
      throw new Error(options.strategy.reason || "该 Mod 类型需要手动安装。");
    default:
      throw new Error(`未知安装策略: ${options.strategy.kind}`);
  }

  return {
    targetFiles: targetFiles.map((file) => formatScopedFile(targetScope, file)),
    conflicts: options.useSymlink && options.strategy.kind === "folderRoot"
      ? []
      : targetFiles
        .filter((file) => existsSync(safeJoin(targetRoot, file)))
        .map((file) => formatScopedFile(targetScope, file))
  };
});

electron.ipcMain.handle("mods:applyStrategy", async (_event, options: {
  modRoot: string;
  gamePath: string;
  // BUG-010 round 5(2026-10-03):exe 在子目录时上溯到游戏根(权威解析在后端)
  gamePathPrefix?: string;
  targetFolderName?: string;
  strategy: {
    kind: string;
    installPath?: string;
    keepPath?: boolean;
    folderName?: string | string[];
    include?: boolean;
    spare?: boolean;
    fileName?: string;
    isExtname?: boolean;
    commonParent?: boolean;
    pass?: string[];
    dictionaryFile?: string;
    requireParent?: boolean;
    targetScope?: InstallTargetScope;
    documentsGameFolder?: string;
    iniFileName?: string;
    localAppDataGameFolder?: string;
    pluginsHeader?: string;
    updateGeneralTestFiles?: boolean;
    extension?: string;
    prefix?: string;
    startIndex?: number;
    listFileName?: string;
    rootFile?: string;
    portraitFolders?: string[];
    managedToolFileName?: string;
    reason?: string;
  };
  isInstall: boolean;
  useSymlink?: boolean;
  managedToolCandidates?: string[];
}) => {
  const installPath = options.strategy.installPath ?? "";
  const targetScope = normalizeTargetScope(options.strategy.targetScope);
  // BUG-010 round 5:权威解析 effectiveGamePath,所有 strategy 都基于真正的游戏根
  const effectiveGamePath = options.gamePathPrefix
    ? resolve(options.gamePath, options.gamePathPrefix)
    : options.gamePath;
  const targetRoot = getTargetScopeRoot(effectiveGamePath, targetScope);
  let deployedFiles: string[] = [];

  try {
    switch (options.strategy.kind) {
      case "general":
        deployedFiles = await applyGeneralStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          keepPath: options.strategy.keepPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "folder":
        deployedFiles = await applyFolderStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          folderName: Array.isArray(options.strategy.folderName)
            ? (options.strategy.folderName[0] ?? "")
            : (options.strategy.folderName ?? ""),
          include: options.strategy.include,
          spare: options.strategy.spare,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "folderRoot":
        deployedFiles = await applyFolderRootStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          targetFolderName: options.targetFolderName,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "file":
        deployedFiles = await applyFileStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          commonParent: options.strategy.commonParent,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileSibling":
        deployedFiles = await applyFileSiblingStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          pass: options.strategy.pass,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileOnly":
        deployedFiles = await applyFileOnlyStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "folderParent":
        deployedFiles = await applyFolderParentStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          folderName: options.strategy.folderName ?? "",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileMap":
        deployedFiles = await applyFileMapStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          dictionaryFile: options.strategy.dictionaryFile ?? "",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileIntoParentFolder":
        deployedFiles = await applyFileIntoParentFolderStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          requireParent: options.strategy.requireParent,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "bethesdaData":
        deployedFiles = await applyBethesdaDataStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          folderName: options.strategy.folderName ?? "",
          documentsGameFolder: options.strategy.documentsGameFolder ?? "",
          iniFileName: options.strategy.iniFileName ?? "",
          localAppDataGameFolder: options.strategy.localAppDataGameFolder ?? "",
          pluginsHeader: options.strategy.pluginsHeader,
          updateGeneralTestFiles: options.strategy.updateGeneralTestFiles,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "bethesdaPluginFiles":
        deployedFiles = await applyBethesdaPluginFilesStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          documentsGameFolder: options.strategy.documentsGameFolder ?? "",
          iniFileName: options.strategy.iniFileName ?? "",
          localAppDataGameFolder: options.strategy.localAppDataGameFolder ?? "",
          pluginsHeader: options.strategy.pluginsHeader,
          updateGeneralTestFiles: options.strategy.updateGeneralTestFiles,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "oblivionPlugins":
        deployedFiles = await applyOblivionPluginsStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "noMansSkyMods":
        if (options.isInstall) {
          await ensureNoMansSkyModsEnabled(targetRoot);
        }
        deployedFiles = await applyGeneralStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          keepPath: options.strategy.keepPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "numberedPak":
        deployedFiles = await applyNumberedPakStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          extension: options.strategy.extension ?? "pak",
          prefix: options.strategy.prefix ?? "data",
          startIndex: options.strategy.startIndex ?? 2,
          listFileName: options.strategy.listFileName ?? "pakList.txt",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "watchDogsPatch":
        deployedFiles = await applyWatchDogsPatchStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          listFileName: options.strategy.listFileName ?? "pakList.txt",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "michangshengLinkedFolder":
        deployedFiles = await applyMiChangShengLinkedFolderStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          rootFile: options.strategy.rootFile ?? "mod.bin",
          isInstall: options.isInstall
        });
        break;
      case "michangshengDllPlugins":
        await ensureMiChangShengModBin(targetRoot);
        deployedFiles = await applyFileOnlyStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: "dll",
          isExtname: true,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "legendPortraits":
        deployedFiles = await applyLegendPortraitsStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          portraitFolders: options.strategy.portraitFolders ?? [],
          isInstall: options.isInstall
        });
        break;
      case "inzoiModKit":
        deployedFiles = await applyInzoiModKitStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          isInstall: options.isInstall
        });
        break;
      case "bg3Pak":
        deployedFiles = await applyBg3PakStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          managedToolFileName: options.strategy.managedToolFileName ?? "BaldursGate3.dll",
          managedToolCandidates: options.managedToolCandidates,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "redDeadAsi":
        deployedFiles = await applyRedDeadAsiStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "asi",
          isExtname: options.strategy.isExtname,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "redDeadLml":
        deployedFiles = await applyRedDeadLmlStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "manual":
        throw new Error(options.strategy.reason || "该 Mod 类型需要手动安装。");
      default:
        throw new Error(`未知安装策略: ${options.strategy.kind}`);
    }

    return {
      deployedFiles: deployedFiles.map((file) => formatScopedFile(targetScope, file))
    };
  } catch (error) {
    if (options.isInstall && deployedFiles.length > 0) {
      try {
        await deleteRelativeFiles(
          options.gamePath,
          deployedFiles.map((file) => formatScopedFile(targetScope, file))
        );
      } catch {
        // 保留原始错误，让调用方看到真正的安装失败原因。
      }
    }

    throw error;
  }
});

electron.ipcMain.handle("mods:removeDeployedFiles", async (_event, options: {
  gamePath: string;
  deployedFiles: string[];
}) => {
  await deleteRelativeFiles(options.gamePath, options.deployedFiles);
  return true;
});

registerNxmProtocol();

if (!electron.app.requestSingleInstanceLock()) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (_event, argv) => {
    dispatchNxmUrl(findNxmUrl(argv));
  });
}

electron.app.on("open-url", (event, url) => {
  event.preventDefault();
  dispatchNxmUrl(url);
});

electron.app.whenReady().then(() => {
  createWindow();
  dispatchNxmUrl(findNxmUrl(process.argv));

  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});

electron.app.on("will-quit", () => {
  aria2Tasks.forEach((task) => {
    task.cancelled = true;
  });
  aria2Tasks.clear();
  aria2Runtime?.process.kill();
  aria2Runtime = null;
});
