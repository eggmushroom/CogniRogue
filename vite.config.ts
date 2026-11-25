import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/*
 * 有的 Windows 机器上 TEMP 指向 `C:\Windows\temp`，而那个目录不允许删除 ——
 * esbuild 收尾清临时文件时直接 `Access is denied`，构建在最后一步失败（92 个模块都转好了）。
 * 临时目录改到仓库内：一定可写，也一定删得掉。必须在 esbuild 启动前设好，所以放在配置顶层。
 */
const TMP = join(import.meta.dirname, '.cache', 'tmp');
mkdirSync(TMP, { recursive: true });
process.env.TMP = TMP;
process.env.TEMP = TMP;

// 产物刻意压成单个 .html：这个项目的分发方式是"下载一个文件，双击就玩"。
// 开发时仍然是正常的模块化 TS 工程。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  // 端口固定成 5178：tools/smoke.mjs 的默认目标就是它，两边对不上就跑不起来
  server: {
    port: Number(process.env.WEB_PORT ?? 5178),
    strictPort: true,
    // 开发时把 /api 转给本机题库服务（uv run uvicorn server.app:app）。浏览器只认一个来源，
    // 前端那边也就只剩一个地址要算 —— 见 core/library/remote.ts 的 setServiceBase。
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 7777}` },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 8 * 1024 * 1024,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
