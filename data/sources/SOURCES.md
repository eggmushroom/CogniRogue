# 语料来源

这里记录题库上游文档及许可。来源清单在 `sources.json`；运行 `npm run sources` 下载、校验并提取 Markdown。PDF 解析依赖由 `uv sync` 安装，PDF 与提取出的中间文件不提交。

| 来源 | 许可 | 格式 |
| --- | --- | --- |
| 《Rust 程序设计语言》简体中文版 | MIT | mdbook，使用固定 commit |
| NIST SP 800-53 Rev. 5 | 美国公有领域 | PDF |
| NIST SP 800-63B-4 | 美国公有领域 | PDF |

只使用允许制作和分发衍生题库的材料：公有领域、MIT 或 CC BY。CC BY-SA 的相同方式共享条款会传递到衍生题库；CC BY-NC 与项目的 MIT 许可不兼容。添加来源前先核实原文许可并保留出处。

PDF 来源在 `sources.json` 中记录下载地址、SHA-256 和字节数；提取时按 PDF 目录切分。mdbook 来源记录仓库、目录和固定 commit，并按 `SUMMARY.md` 顺序合并章节。固定来源版本，保证相同清单可重现相同语料。
