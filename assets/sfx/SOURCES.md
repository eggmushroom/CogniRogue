# 战斗音效来源

除项目原创合成音效外，本目录的音效来自 OpenGameArt 上的 **CC0 1.0** 素材包。CC0 素材不受项目代码的 MIT 许可证约束。

- StarNinjas · [20 Sword Sound Effects (Attacks and Clashes)](https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes)
- Vehicle · [Fantasy Weapons and Apparel SFX Library](https://opengameart.org/content/fantasy-weapons-and-apparel-sfx-library)
- artisticdude · [RPG Sound Pack](https://opengameart.org/content/rpg-sound-pack)
- Kenney · [50 RPG Sound Effects](https://opengameart.org/content/50-rpg-sound-effects)、[54 Casino Sound Effects](https://opengameart.org/content/54-casino-sound-effects-cards-dice-chips)
- [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

| 游戏素材 | 原始文件 | 用途 |
| --- | --- | --- |
| `thrust.wav` | `swing3.wav` + `sword.6.ogg` | 玩家向前出手时的短促穿刺声 |
| `hurt.wav` | 项目原创合成 | 玩家受伤：短促的刀刃刮擦和下沉冲击 |
| `block.wav` | `sword_clash.4.ogg` + `sword-clash-01.wav` | 玩家完全挡住攻击时的金属碰撞 |
| `select.wav` | `card-fan-1.ogg` | 成功拿起选定的一张牌，轻而短；不用于悬停 |
| `draw.wav` | `cards-pack-take-out-1.ogg` + `card-slide-6.ogg` | 每批抽牌开始：先是牌边松动，再是卡纸滑出 |
| `play.wav` | `card-place-1.ogg` | 一张牌成功打出 |
| `discard.wav` | `card-place-4.ogg` + `card-place-3.ogg` | 回合末弃牌落堆：牌叠的闷落与纸边收尾，每批一次 |
| `guard.wav` | 项目原创合成 | 随盾牌变色徐徐展开、淡出的暖色闪光，无钟鸣或碰撞 |
| `heal.wav` | `magic1.wav` | 玩家回血 |
| `fizzle.wav` | `match-light-01.wav` | 答错时出招失败 |
| `victory.wav` | `metal-ringing.wav` | 战斗胜利 |
| `defeat.wav` | `bookClose.ogg` | 战斗落败 |

这些片段均为 32 kHz / 16-bit mono WAV，以便嵌入离线 HTML。原创片段可在仓库根目录执行 `python tools/synth-battle-sfx.py` 重新生成，无需下载素材。
