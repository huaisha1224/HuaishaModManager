import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";

// HGMM Phase 2 修复:7zip-bin 必须 externalize,不能 bundle。
// bundle 后 7zip-bin/index.js 里的 path.join(__dirname, ...) 会指向 out/main/,
// 但 7za.exe 二进制没被复制过去,运行时报 ENOENT。
// externalize 后运行时 require("7zip-bin") 加载 node_modules/7zip-bin/,
// __dirname 指向真实路径,7za.exe 才能 spawn。
const NATIVE_BINARY_EXTERNALS = ["7zip-bin"];

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/main.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        },
        external: NATIVE_BINARY_EXTERNALS
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/preload.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname),
    server: {
      port: 5176,
      strictPort: true
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html")
      }
    },
    plugins: [vue()]
  }
});
