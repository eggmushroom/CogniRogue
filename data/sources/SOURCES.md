# 语料源

题库的上游。这里只有**清单**，正文是跑出来的：

```bash
python -m pip install pymupdf     # 只在换语料时需要
npm run sources                    # 下载 → 校验 sha256 → 抽成 markdown
npm run gen -- --src=data/sources/nist-sp800-53r5.md --out=packs/nist.md
```

PDF 与抽出来的 markdown 都在 `.gitignore` 里：它们是可以随时重新生成的中间物，
仓库里只留清单和产物（题库）。

## 为什么是这两份

| id | 是什么 | 为什么选它 |
| --- | --- | --- |
| `nist-sp800-53r5` | NIST SP 800-53 Rev. 5，安全与隐私控制目录 | 公开、成体系、每条控制都有明确的适用对象与判据；结构深（20 个族 / 316 条控制），正好撑起多个主题 |
| `nist-sp800-63b-4` | NIST SP 800-63B-4，数字身份认证指南 | 与其互补：上面那本讲"系统该有什么控制"，这本讲"人怎么证明自己是自己" |

两份都是**美国政府作品**，在美国不受版权保护；NIST 原文写明
"not subject to copyright in the United States"，只希望注明出处。这是少数
**允许再做衍生作品**的许可：出题是从原文派生，署名就够，不会把题库的许可传染掉。

刻意**没有**选（不是它们不好，是许可不合适）：

- **CC BY-SA / CC BY-NC-SA**（Wikipedia、多数开源教材）：ShareAlike 会传染到题库上，
  整个项目就得跟着换许可；NonCommercial 又和 MIT 冲突。
- **arXiv 预印本**：逐篇许可不同，不能用一条规则覆盖。
- **"免费 PDF"但保留版权**（很多大学教材、厂商白皮书）：能读不能分发。

## 换语料要改什么

`data/sources/sources.json` 加一条（url + sha256 + license + attribution），
然后 `npm run sources`。抽取规则不用改 —— `tools/pdf2md.py` 只依赖 PDF 自带的目录。
