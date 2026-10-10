# mayflyMods 运行与打包说明

本文档说明当前 Electron 项目的本地运行、检查、生产构建和后续打包方式。

## 环境要求

- Node.js 18 或更高版本，建议 Node.js 20+
- npm
- Windows 环境优先

项目目录：

```bash
E:\mayflyOT\mayfly-mod\mayfly-mod-manager-electron
```

## 安装依赖

第一次拉取或复制项目后，在项目目录执行：

```bash
npm install
```

如果已经存在 `node_modules`，通常可以跳过。

## 开发运行

开发调试时执行：

```bash
npm run dev
```

当前 `dev` 脚本会通过 `scripts/dev.cjs` 启动 Electron Vite，并处理 Windows 下 `ELECTRON_RUN_AS_NODE=1` 导致 Electron 被当成 Node 运行的问题。

## 类型检查

只检查 TypeScript 和 Vue 类型，不生成产物：

```bash
npm run typecheck
```

建议每次改完核心代码后先跑这个。

## aria2 下载引擎

项目支持在设置中切换“内置下载”或“aria2”。aria2 不内置在当前源码中，使用前需要准备 `aria2c.exe`：

1. 在设置中把下载引擎切换为“aria2”。
2. 选择或填写 `aria2c.exe` 路径；如果不填写，程序会尝试查找项目资源目录或系统 `PATH`。
3. 设置最大连接数，默认是 4。
4. 之后 Nexus 和自定义下载任务都会通过 aria2 添加和管理。

当前 aria2 支持进度、暂停、继续和失败提示；aria2 任务快照与软件重启后的历史任务恢复暂未接入。

## 生产构建

生成 Electron 主进程、preload 和 renderer 的生产构建产物：

```bash
npm run build
```

构建输出目录：

```bash
out
```

当前构建命令实际执行：

```bash
vue-tsc --noEmit && electron-vite build
```

也就是说，构建前会先做类型检查。

## 预览生产构建

构建后可以用 Electron Vite 的 preview 方式预览：

```bash
npm run preview
```

注意：这不是安装包，只是用生产构建产物启动预览。

## 当前还不能直接打安装包

当前 `package.json` 还没有配置 `electron-builder`、`electron-forge` 或其他打包工具，所以暂时没有下面这种命令：

```bash
npm run dist
npm run package
```

任务单里“添加打包发布工具”“生成 Windows 安装包”“配置应用图标、名称、版本号”还没有完成。

## 后续推荐打包方案

建议使用 `electron-builder` 打 Windows 安装包。

后续需要补的内容大概是：

```bash
npm install -D electron-builder
```

然后在 `package.json` 增加脚本：

```json
{
  "scripts": {
    "dist": "npm run build && electron-builder"
  }
}
```

再增加 `build` 配置，例如：

```json
{
  "build": {
    "appId": "com.mayfly.modmanager",
    "productName": "mayflyMods",
    "directories": {
      "output": "release"
    },
    "files": [
      "out/**/*",
      "package.json"
    ],
    "win": {
      "target": "nsis"
    }
  }
}
```

配置完成后，打包命令会是：

```bash
npm run dist
```

安装包输出目录预计为：

```bash
release
```

## 常用命令汇总

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run preview
```

当前建议开发流程：

```bash
npm install
npm run dev
```

改完代码后验证：

```bash
npm run typecheck
npm run build
```
