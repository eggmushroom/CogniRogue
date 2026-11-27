# CogniRogue

CogniRogue 是一款结合题库复习的单机 Roguelike 卡牌游戏。内置英语题库，支持导入题库以及从 PDF 或 Markdown 文档生成题目。

![首页](docs/title.jpg)

## 快速试玩

从 [v0.1.0 发布页](https://github.com/eggmushroom/CogniRogue/releases/tag/v0.1.0) 下载 `CogniRogue-v0.1.0.html`，用浏览器打开即可离线使用内置题库。

## 从源码运行

需要 Node.js 22+、Python 3.11+ 和 uv。

```powershell
npm ci
uv sync --frozen
npm run dev
```

打开终端显示的本地地址。生成题目或使用模型分章前，可在「设置 → 出题模型」填写配置，也可设置 `GEN_BASE_URL`、`GEN_API_KEY` 和 `GEN_MODEL` 环境变量。

```powershell
npm run build
npm run serve
```

构建产物位于 `dist/index.html`。导入题库、上传文档和生成题目需要本机服务。

## 题库

- 在「题库 → 导入题库文件」选择 Markdown 或 JSON 文件。Markdown 格式可参考项目自带的示例。[内置题库](packs/words.md)
- 在「题库 → 从文档建题库」选择 PDF 或 Markdown，确认主题划分后勾选主题，点击「生成所选主题」。在首页「任务」中查看进度。

![战斗界面](docs/screenshot.jpg)

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run verify` | 运行项目检查 |
| `npm run smoke` | 在开发服务运行时执行浏览器冒烟测试 |
| `npm run sim` | 运行无头模拟 |
| `npm run gencheck` | 离线检查题库生成流程 |
| `npm run reviewcheck` | 调用审核模型运行回归样例 |
| `npm run sources` | 按语料清单重新提取来源文档 |

## 许可

项目采用 MIT 许可证。题库语料遵循各自来源的许可。[项目许可证](LICENSE) · [语料来源](data/sources/SOURCES.md)
