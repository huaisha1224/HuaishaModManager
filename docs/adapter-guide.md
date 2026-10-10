# 游戏适配编写规范

## 文件位置

适配器放在 `src/adapters`，统一从 `src/adapters/index.ts` 注册。

## 基本结构

```ts
import type { GameAdapter } from "@/types/domain";

export const exampleAdapter: GameAdapter = {
  presetId: "example",
  name: "示例游戏",
  modTypes: [
    {
      id: "root",
      name: "游戏根目录",
      install: {
        kind: "general",
        installPath: "",
        keepPath: true
      }
    }
  ],
  checkModType(files) {
    return "root";
  }
};
```

## 规则建议

- 能用通用 Unreal/Unity/RE Engine 规则时，优先复用通用 adapter。
- `checkModType(files)` 只做轻量判断，不访问文件系统。
- 安装路径必须是游戏目录下的相对路径。
- 不确定的 Mod 类型返回 `manual`，不要猜测写入位置。
- 前置依赖检测当前暂不启用；不要在 adapter 里新增 `requiredModNames`，需要时只把前置写进 Mod 备注/说明。

## 常见策略

- `general`：按文件复制到指定目录。
- `folder`：从压缩包中找到指定文件夹后复制。
- `file`：按文件名或扩展名匹配。
- `fileSibling`：找到文件后复制同级内容。
- `folderParent`：按文件夹父目录复制。
- `manual`：无法自动安装，交给用户处理。
