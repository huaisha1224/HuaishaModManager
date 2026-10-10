# HuaishaModManager


HuaishaModManager是基于mayflyMods的二开项目
用Electron + Vue 3 + TypeScript 的桌面端 Mod 管理器，目标是提供本地 Mod 导入、安装、卸载、排序、配置档案、备份恢复、NexusMods 浏览与下载等能力。


## 功能特性
1
- 游戏库管理：支持预设游戏、自定义游戏、Steam 路径识别、手动选择目录、启动游戏、打开游戏目录。
- 本地 Mod 导入：支持文件夹、单文件、zip、7z、rar包导入。
- Mod 安装卸载：基于游戏 adapter 规则安装，支持软链接安装、安装计划预览、覆盖风险检测、失败回滚、部署文件记录。
- Mod 管理：支持搜索、类型筛选、标签筛选、排序、多选、批量安装、批量卸载、批量删除、批量编辑。
- 配置档案：支持保存一套 Mod 启用状态和排序，并一键切换整套 Mod 配置。
- 冲突检测：可检测多个 Mod 写入同一目标路径的覆盖冲突。
- NexusMods：支持网页 OAuth 登录、API Key 备用登录、Mod 列表、详情、文件列表、下载链接解析、NXM 深链。
- Mod 更新：支持 Nexus 来源 Mod 更新检查、手动更新和批量更新。
- 下载队列：支持自定义 URL 下载、Nexus 下载、进度、暂停、继续、删除、下载完成自动导入。
- aria2：支持可选 aria2 下载引擎，可配置 `aria2c.exe` 路径和最大连接数。
- 翻译：支持 Nexus 页面实验性翻译，包含 Google 免费接口、百度、有道、腾讯云、火山引擎、Ollama 本地模型。
- 备份恢复：支持游戏目录/存档目录备份、恢复、删除、重命名和查看备份内容。

## 当前状态

当前核心本地 Mod 管理流程已经可用：

- 添加游戏
- 导入 Mod
- 识别 Mod 类型
- 安装/卸载 Mod
- 查看部署文件
- 检测冲突
- 标签管理
- 配置档案一键切换
- Nexus 浏览、下载、更新检查
- 备份与恢复
- Windows 构建和打包


## 技术栈

- Electron
- Electron Vite
- Vue 3
- TypeScript
- Pinia
- lucide-vue-next
- electron-builder

## 环境要求

- Node.js 20 或更高版本
- npm
- Windows 10/11

当前打包配置主要面向 Windows，其他平台未做完整验证。

## 安装依赖

```powershell
npm install
```

## 本地开发

```powershell
npm run dev
```

## 类型检查

```powershell
npm run typecheck
```

## 生产构建

```powershell
npm run build
```

构建产物会输出到：

```text
out/
```

## Windows 打包

```powershell
npm run dist
```

打包产物会输出到：

```text
release/
```

当前 `electron-builder` 已配置：

- NSIS 安装包
- portable 便携版
- 应用图标
- 应用名称 `mayflyMods`
- 可选择安装目录
- 桌面快捷方式
- 开始菜单快捷方式

## 常用检查命令

```powershell
npm run check:adapters
npm run check:adapter-rules
npm run check:archive-import
npm run check:install-safety
npm run check:import-flow
npm run check:real-mod-folders
npm run check:all
```

## 目录结构

```text
mayfly-mod-manager-electron/
├─ electron/              # Electron 主进程和 preload
├─ resources/             # 应用资源、字典文件、图标等
├─ scripts/               # 开发、构建、校验脚本
├─ src/
│  ├─ adapters/           # 游戏 adapter 和安装规则
│  ├─ data/               # 游戏预设数据
│  ├─ stores/             # Pinia 状态管理
│  ├─ types/              # 领域类型定义
│  ├─ App.vue             # 当前主界面入口
│  └─ style.css           # 全局样式
└─ docs/                  # 任务单、运行打包说明、adapter 指南
```

## NexusMods 说明

项目支持两种 NexusMods 登录方式：

- 网页 OAuth 登录
- API Key 备用登录

普通用户下载 NexusMods 文件时，受 NexusMods 下载机制限制，部分文件仍需要通过网页确认或 NXM 深链回传。项目会尽量接收浏览器传回的 NXM 链接并加入下载队列。

## 翻译说明

NexusMods 页面数据通常是英文，项目内置实验性翻译层，可翻译列表、详情、说明、分类、标签和文件信息。

当前支持：

- Google 免费 Web 接口
- 百度翻译
- 有道智云
- 腾讯云机器翻译
- 火山引擎机器翻译
- Ollama 本地模型

部分接口需要用户自行配置密钥或本地服务。

## 游戏适配说明

项目通过 adapter 描述不同游戏的 Mod 类型识别和安装规则。adapter 会决定：

- 如何识别 Mod 类型
- 文件应该安装到哪里
- 是否跳过说明文件、manifest、图标等元文件
- 安装前如何生成变更计划
- 卸载时如何按部署记录删除文件



## 数据安全说明

安装和卸载逻辑包含以下保护：

- 安装路径限制在游戏目录内
- zip 导入防路径穿越
- 安装前生成文件变更计划
- 安装前检测覆盖风险
- 安装失败尝试回滚
- 卸载优先按部署记录删除
- 无部署记录卸载前确认
- 卸载后清理空目录

建议在大量安装 Mod 前先使用备份功能保存当前游戏目录或存档目录。

## License

