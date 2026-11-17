# 语料源

题库的上游。这里只有**清单**，正文是跑出来的：

```bash
npm run sources                    # 下载 → 校验 → 抽成 markdown
npm run gen -- --src=data/sources/rust-cn-book.md --out=packs/rust-cn.md --per=20
```

抽 PDF 要 `python -m pip install pymupdf`（只在换语料时需要）；md 仓库不需要任何额外东西。
PDF 与抽出来的 markdown 都在 `.gitignore` 里：它们是可以随时重新生成的中间物，
仓库里只留清单和产物（题库）。

## 现在收的

| id | 是什么 | 许可 | 为什么选它 |
| --- | --- | --- | --- |
| `rust-cn-book` | 《Rust 程序设计语言》中文版 | **MIT** | 中文、散文式正文（不是文档站的短代码堆），20 章 80 节，正好切成 20 个主题；钉了 commit，同一份清单永远跑出同一份语料 |
| `nist-sp800-53r5` | NIST SP 800-53 Rev. 5，安全与隐私控制目录 | 公有领域 | 结构深（20 个族 / 316 条控制），一份文档就撑得起多个主题 |
| `nist-sp800-63b-4` | NIST SP 800-63B-4，数字身份认证指南 | 公有领域 | 与上面互补：一本讲"系统该有什么控制"，一本讲"人怎么证明自己是自己" |

NIST 那两份是**美国政府作品**，在美国不受版权保护；原文写明
"not subject to copyright in the United States"，只希望注明出处。

## 为什么只收这几种许可

出题是从原文派生，所以"能免费下载"远远不够：

- **公有领域 / MIT / CC BY**：可以派生，署名就够。
- **CC BY-SA**（Wikipedia、多数开源教材）：ShareAlike 会传染到题库上，整个项目得跟着换许可。
- **CC BY-NC**：非商业条款和 MIT 冲突。
- **"免费 PDF"但保留版权**（大学教材、厂商白皮书）：能读，不能分发。

## 两种格式，两条路

| format | 怎么取 | 能不能通用 |
| --- | --- | --- |
| `pdf` | 下载 → 校验 `sha256` → `tools/pdf2md.py` 按 PDF 自带的目录切 | **通用**：换任何一份带目录的 PDF 都不用改代码 |
| `mdbook` | 按 `SUMMARY.md` 的清单抓 md 仓库，合并成一份，章做 `##`、节降一级 | **只认 mdbook** 那套结构 |

文档站之间没有共同的骨架：mdbook 用 `SUMMARY.md`，Hugo 用 `content/` + front-matter +
短代码，React 那种用 MDX 组件。所以**每换一类文档站就要写一个适配器**，
这一步省不掉 —— 但 PDF 那条路一直是通用的，书和规范都走它。

## 没选，但试过的

- **OpenStax**（CC BY 4.0，Python 编程入门）：许可最合适、内容也最贴游戏，但这台机器上
  它的 CDN 对无浏览器客户端返回 403，拿不到。
- **Kubernetes / Vue 中文文档**（CC BY 4.0 / 待确认）：内容新，但 md 里混着 Hugo 短代码
  和 MDX 组件，得先写清洗层。
- **中文历史**：维基文库、中国哲学书电子化计划、国会图书馆、Internet Archive、
  Project Gutenberg 在这台机器上全部连不通或 403。能拿到的公有领域历史是英文的
  （Standard Ebooks 的 epub、NASA 历史部 PDF）。若要做中文历史，最现实的是**古籍原文**
  （作者过世几百年，文本本身是公有领域），缺的只是一个能连上的镜像。

## 换语料要改什么

`data/sources/sources.json` 加一条，然后 `npm run sources`：

- `format: "pdf"` —— 填 `url` + `sha256` + `bytes`。
- `format: "mdbook"` —— 填 `repo` + `dir` + **钉住的 `ref`（commit sha）**。

不钉 commit 的话，同一份清单明天会跑出不同的语料，已经生成的题库就对不上号了。
