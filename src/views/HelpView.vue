<script setup lang="ts">
// HGMM 帮助页面(2026-09-23)
//
// 渲染 src/assets/help.md(用 Vite ?raw 打包进 bundle,零运行时依赖)
// 顶部自动从 ## 抽取目录(左侧导航)
//
// 设计原则:内容从单一 markdown 文件读,方便后续维护。
// 改 markdown 文件后 dev 会热更新;生产构建时随 bundle 一起打包。

import { computed } from "vue";
import { marked } from "marked";
// TS 通配模块声明不识别 @/ 别名 + 子目录的 md?raw,用 @ts-expect-error 压过类型检查
// Vite ?raw 在运行时仍然能正确解析并把文件内容打包进 bundle
// @ts-expect-error -- Vite ?raw import (TS 通配声明不识别别名路径)
import helpContent from "@/assets/help.md?raw";

// 抽取 ## 二级标题当目录(### 不进目录,避免太长)
const headings = computed(() => {
  const lines = helpContent.split("\n");
  const out: { text: string; id: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (!m) continue;
    const text = m[1].trim();
    // 用 slug 给标题生成 id(中文友好:用 base64 不行,改用下标)
    const id = `h-${out.length}`;
    out.push({ text, id });
  }
  return out;
});

// 渲染 markdown(给 h2 加 id,跟目录的锚点对齐)
// marked v15 renderer API:heading({ tokens, depth }) → string
const renderedHtml = computed(() => {
  let h2Index = 0;
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }: { tokens: any[]; depth: number }) {
    const inner = this.parser.parseInline(tokens);
    if (depth === 2) {
      const id = `h-${h2Index++}`;
      return `<h2 id="${id}">${inner}</h2>`;
    }
    return `<h${depth}>${inner}</h${depth}>`;
  };
  // 链接统一 target="_blank" rel="noopener noreferrer"
  // (新窗口打开 + 防止 tabnabbing 攻击;真正的"跳到系统浏览器"在容器 click 拦截里走 openExternal)
  renderer.link = function ({ href, title, tokens }: { href: string; title?: string | null; tokens: any[] }) {
    const inner = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${title}"` : "";
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${inner}</a>`;
  };
  return marked.parse(helpContent, { renderer }) as string;
});

// 滚动到锚点
function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 内容区点击拦截:
// - 命中 <a href="https?://..."> 时调 window.mayfly.openExternal()
//   跳到系统默认浏览器(Electron 在新窗口开链接会用内置浏览器,体验割裂)
// - 命中锚点(#xxx)走平滑滚动
// - 其他不拦
function onContentClick(ev: MouseEvent) {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;
  // 锚点(#xxx):走滚动而不是 openExternal
  if (href.startsWith("#")) {
    ev.preventDefault();
    const id = href.slice(1);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  // 外链:用 IPC 跳到系统默认浏览器
  if (/^https?:\/\//i.test(href)) {
    ev.preventDefault();
    window.mayfly.openExternal(href).catch((err: unknown) => {
      console.error("[help] openExternal failed:", href, err);
    });
  }
}
</script>

<template>
  <div class="helpView">
    <aside class="helpToc">
      <h3>目录</h3>
      <ul>
        <li v-for="h in headings" :key="h.id">
          <a href="#" @click.prevent="scrollTo(h.id)">{{ h.text }}</a>
        </li>
      </ul>
    </aside>
    <article class="helpContent" v-html="renderedHtml" @click="onContentClick"></article>
  </div>
</template>

<style scoped>
.helpView {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 24px;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
  /* 继承父 .page 的 var(--c-bg-base),不再单独设置背景色 */
  color: var(--c-text-primary, #e4e4e7);
}

.helpToc {
  position: sticky;
  top: 24px;
  align-self: start;
  /* 跟其他面板一致,用 --c-bg-surface(Steam panel 色 #2a475c) */
  background: var(--c-bg-surface, #2a475c);
  border: 1px solid var(--c-border, #2e2e34);
  border-radius: 8px;
  padding: 16px;
}

.helpToc h3 {
  font-size: 13px;
  margin: 0 0 12px;
  color: var(--c-text-tertiary, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.helpToc ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.helpToc li {
  margin: 6px 0;
}

.helpToc a {
  color: var(--c-text-primary, #e4e4e7);
  text-decoration: none;
  font-size: 14px;
  display: block;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.15s;
}

.helpToc a:hover {
  /* 跟全局面板 hover 一致(浅白叠加) */
  background: rgba(255, 255, 255, 0.08);
}

.helpContent {
  /* 跟 .helpToc 一致,用 --c-bg-surface 保持视觉统一 */
  background: var(--c-bg-surface, #2a475c);
  border: 1px solid var(--c-border, #2e2e34);
  border-radius: 8px;
  padding: 24px 32px;
  line-height: 1.7;
}

/* markdown 排版 */
.helpContent :deep(h1) {
  font-size: 28px;
  margin: 0 0 24px;
  border-bottom: 1px solid var(--c-border, #2e2e34);
  padding-bottom: 12px;
}
.helpContent :deep(h2) {
  font-size: 20px;
  margin: 32px 0 12px;
  color: var(--c-accent, #f97316);
}
.helpContent :deep(h3) {
  font-size: 16px;
  margin: 24px 0 8px;
}
.helpContent :deep(p) {
  margin: 10px 0;
}
.helpContent :deep(ul),
.helpContent :deep(ol) {
  padding-left: 24px;
  margin: 8px 0;
}
.helpContent :deep(li) {
  margin: 4px 0;
}
.helpContent :deep(a) {
  color: var(--c-accent, #f97316);
  text-decoration: none;
  border-bottom: 1px dashed var(--c-accent, #f97316);
}
.helpContent :deep(a:hover) {
  border-bottom-style: solid;
}
.helpContent :deep(code) {
  /* 代码块用更深的 --c-bg-inset 跟 .helpContent 拉开层级 */
  background: var(--c-bg-inset, #16212d);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 0.9em;
}
.helpContent :deep(strong) {
  color: var(--c-text-primary, #e4e4e7);
  font-weight: 600;
}
</style>
