import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 产物刻意压成单个 .html：这个项目的分发方式是"下载一个文件，双击就玩"。
// 开发时仍然是正常的模块化 TS 工程。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  // 端口固定成 5178：tools/smoke.mjs 的默认目标就是它，两边对不上就跑不起来
  server: { port: 5178, strictPort: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 8 * 1024 * 1024,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
