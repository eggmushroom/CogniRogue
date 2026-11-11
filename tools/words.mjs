/**
 * 生成临时单词表题库：5 章 × 80 词，英语单词 → 中文释义。
 *
 *   npm run words        # 重写 packs/words.md
 *
 * 为什么要有这个脚本，而不是直接把 3200 行 md 交上去：
 *   词表是**数据**，错项是**生成物**。手写 400 道题意味着每写一个词要自己挑三个
 *   同章干扰项，改一个词还得找到它那四行一起改 —— 一定会出现"改了一半"的题库。
 *   所以这里只维护"单词 → 释义"这张表，干扰项、选项位置（A/B/C/D 轮流）、
 *   解析行全部由脚本生成，重跑一次就整体一致。
 *
 * 干扰项取**同一章**的词：跨章的选项（"放弃"配"数据库"）玩家一眼就能排除，
 * 那样测的是排除法，不是词义。同章之内还要避免近义打架 —— 所以下面偶尔会看到
 * 释义写得比字典更窄（`difficult` 用「艰难的」而不是「困难的」），那是为了和
 * 同章的 `hard`（坚硬的）区分开。改词时请顺手看一眼同章有没有近义词。
 *
 * 产物进 `packs/words.md`，`core/builtin.ts` 用 vite 的 ?raw 内联它；
 * 换回计算机题库只改 builtin.ts（老的三份 md 还在 packs/ 里）。
 */
import { writeFileSync } from 'node:fs';

const OUT = new URL('../packs/words.md', import.meta.url);

const chapters = [
  ['基础动词', `
abandon|放弃
accept|接受
achieve|实现
admit|承认
advise|劝告
agree|同意
allow|允许
announce|宣布
apologize|道歉
appear|现身
apply|申请
argue|争论
arrive|到达
ask|询问
attend|参加
avoid|避免
boil|煮沸
believe|相信
belong|属于
borrow|借入
breathe|呼吸
build|建造
burn|燃烧
buy|购买
carry|携带
catch|抓住
change|改变
choose|挑选
climb|攀爬
collect|采集
compare|比较
complain|抱怨
complete|使完整
continue|继续
cook|烹饪
copy|复制
count|计数
cover|覆盖
create|创造
cry|哭泣
dance|跳舞
decide|决定
describe|描述
design|设计
destroy|摧毁
develop|发展
discover|发觉
discuss|商讨
draw|绘画
dream|做梦
drink|喝
drive|驾驶
drop|丢下
eat|吃
encourage|鼓励
enjoy|享受
enter|进入
escape|逃跑
explain|说明
explore|探索
fail|未能做到
fall|落下
feel|感觉
fight|战斗
fill|填满
find|找到
finish|结束
fix|修理
fly|飞行
follow|跟随
forget|忘记
forgive|原谅
gather|聚集
give|给予
grow|生长
guess|猜测
happen|发生
hate|讨厌
hear|听见
help|帮助
`],
  ['生活名词', `
airport|机场
apartment|公寓
apple|苹果
bank|银行
beach|海滩
bed|床
bicycle|自行车
book|书
bottle|瓶子
bread|面包
bridge|桥
building|建筑物
bus|公交车
camera|相机
chair|椅子
city|城市
clock|时钟
clothes|衣服
coffee|咖啡
computer|电脑
country|国家
cup|杯子
desk|书桌
doctor|医生
door|门
dress|连衣裙
driver|司机
ear|耳朵
egg|鸡蛋
email|电子邮件
family|家庭
farm|农场
finger|手指
flower|花
food|食物
forest|森林
friend|朋友
garden|花园
mirror|镜子
hair|头发
hand|手
hat|帽子
hospital|医院
hotel|旅馆
house|房子
island|岛屿
jacket|夹克
kitchen|厨房
knife|刀
lake|湖
lamp|灯
letter|信
library|图书馆
lunch|午餐
market|市场
milk|牛奶
money|钱
mountain|山
mouth|嘴
movie|电影
museum|博物馆
music|音乐
newspaper|报纸
nose|鼻子
office|办公室
park|公园
pen|钢笔
phone|电话
picture|图片
plane|飞机
rain|雨
restaurant|餐馆
river|河
road|道路
room|房间
school|学校
shoe|鞋
shop|商店
table|桌子
window|窗户
`],
  ['形容词与副词', `
ancient|古代的
angry|生气的
anxious|焦虑的
awake|醒着的
beautiful|美丽的
big|大的
bitter|苦的
black|黑色的
blue|蓝色的
brave|勇敢的
bright|明亮的
busy|忙碌的
calm|平静的
careful|小心的
cheap|便宜的
clean|干净的
clear|清晰的
clever|聪明的
close|亲密的
cold|寒冷的
comfortable|舒适的
common|常见的
correct|正确的
crowded|拥挤的
dangerous|危险的
dark|黑暗的
deep|深的
different|不同的
difficult|艰难的
dirty|脏的
dry|干燥的
early|早的
easy|容易的
empty|空的
expensive|昂贵的
famous|著名的
far|远的
fast|快的
fat|胖的
few|很少的
final|最后的
fine|晴朗的
foreign|外国的
free|免费的
fresh|新鲜的
friendly|友好的
full|满的
funny|滑稽的
gentle|温和的
glad|欣慰的
good|好的
great|伟大的
happy|快乐的
hard|坚硬的
healthy|健康的
heavy|重的
high|高的
honest|诚实的
hot|热的
hungry|饥饿的
important|重要的
interesting|有趣的
kind|体贴的
late|迟到的
lazy|懒惰的
light|轻的
little|小的
local|当地的
long|长的
loud|响亮的
low|低的
lucky|幸运的
modern|现代的
narrow|狭窄的
near|近的
new|新的
noisy|嘈杂的
old|老的
open|打开的
patient|耐心的
`],
  ['学术高频', `
abstract|抽象的
accurate|准确的
acquire|获得
adapt|适应
adequate|充分的
analyze|剖析
approach|途径
appropriate|合适的
assess|评估
assume|假定
available|可用的
benefit|好处
category|类别
challenge|挑战
circumstance|情况
complex|复杂的
concept|概念
conclude|得出结论
considerable|相当大的
consistent|一致的
constant|恒定的
context|语境
contrast|对比
contribute|贡献
crucial|关键的
data|数据
define|定义
demonstrate|证明
derive|推导
distribute|分配
economy|经济
element|元素
emphasize|强调
environment|环境
establish|建立
estimate|估计
evidence|证据
evolve|进化
factor|因素
function|功能
generate|产生
hypothesis|假说
imply|暗示
indicate|表明
individual|个人
interpret|解读
involve|涉及
issue|问题
maintain|维持
method|方法
occur|出现
participate|参与
primary|首要的
significant|显著的
similar|相似的
source|来源
specific|具体的
structure|结构
precise|精确的
theory|理论
therefore|因此
trend|趋势
valid|有效的
vary|变化
affect|影响
implement|实施
attribute|归因
capable|有能力的
combine|结合
conduct|进行
consequence|后果
consume|消耗
dominate|支配
enable|使能够
ensure|确保
fundamental|基本的
identify|识别
innovate|创新
justify|证明正当
predict|预测
`],
  ['抽象概念', `
ability|能力
absence|缺席
abuse|滥用
access|通道
account|账户
action|行动
advantage|优势
advice|建议
agreement|协议
attempt|尝试
analysis|分析
answer|答案
anxiety|焦虑
attitude|态度
authority|权威
balance|平衡
behavior|行为
belief|信念
capacity|容量
cause|原因
chance|偶然
character|性格
choice|选择
communication|交流
community|社区
competition|竞争
confidence|信心
conflict|冲突
confusion|困惑
connection|联系
cooperation|合作
courage|勇气
creativity|创造力
crisis|危机
culture|文化
curiosity|好奇心
decision|决策
demand|需求
difference|差异
difficulty|困难
direction|方向
discipline|纪律
discussion|讨论会
duty|责任
effect|效果
effort|努力
emotion|情感
energy|能量
example|例子
experience|经验
explanation|解释
failure|失败
trust|信任
fear|恐惧
freedom|自由
future|未来
goal|目的
growth|成长
habit|习惯
happiness|幸福
health|健康
history|历史
hope|希望
idea|想法
identity|身份
imagination|想象力
improvement|改进
influence|影响力
information|信息
interest|兴趣
knowledge|知识
language|语言
leadership|领导力
memory|记忆
motivation|动机
nature|自然
opportunity|机遇
patience|耐心
peace|和平
power|力量
`],
];

const seenWords = new Set();
const seenMeanings = new Set();
const parsed = [];
const problems = [];
for (const [topic, raw] of chapters) {
  const rows = raw.trim().split('\n').map((line) => {
    const [w, m] = line.split('|');
    return { w: w.trim(), m: m.trim() };
  });
  if (rows.length !== 80) problems.push(`${topic}: ${rows.length} 行（应为 80）`);
  for (const r of rows) {
    if (!/^[a-z]+$/.test(r.w)) problems.push(`${topic}: 单词格式 ${r.w}`);
    if (!r.m) problems.push(`${topic}: 缺释义 ${r.w}`);
    if (seenWords.has(r.w)) problems.push(`单词重复: ${r.w}`);
    if (seenMeanings.has(r.m)) problems.push(`释义重复: ${r.m}（${r.w}）`);
    seenWords.add(r.w);
    seenMeanings.add(r.m);
  }
  parsed.push({ topic, rows });
}
const all = parsed.flatMap((c) => c.rows);
console.log(`章节 ${parsed.length} / 词 ${all.length} / 唯一释义 ${seenMeanings.size}`);
if (problems.length) {
  console.log('--- 问题 ---');
  console.log(problems.join('\n'));
  process.exitCode = 1;
} else {
  const lines = [
    '# 英语单词表（临时题库）',
    '',
    '> 临时把内置题库换成单词表：5 章 × 80 词，共 400 道题。',
    '> 每道题给一个英文单词，四个中文释义里选一个；选项顺序由游戏在点开时打乱。',
    '> **本文件由 `npm run words` 生成，别手改** —— 源表在 `tools/words.mjs`，手改的题下次生成会被覆盖。',
    '> `## 主题` 就是课程表里的章节名，改章节名要同步改 `model/data.ts` 的 `CURRICULUM`。',
    '',
  ];
  const letters = ['A', 'B', 'C', 'D'];
  for (const { topic, rows } of parsed) {
    lines.push(`## ${topic}`, '');
    const pool = rows.map((r) => r.m);
    rows.forEach((r, i) => {
      const picked = [r.m];
      let step = 1;
      while (picked.length < 4) {
        const cand = pool[(i + step * 17) % pool.length];
        if (!picked.includes(cand)) picked.push(cand);
        step += 1;
      }
      const pos = i % 4;
      const options = [];
      let k = 0;
      for (let o = 0; o < 4; o++) {
        options.push(o === pos ? r.m : picked[++k]);
      }
      lines.push(`### 单词 "${r.w}" 的中文意思是？`);
      options.forEach((o, oi) => lines.push(`${letters[oi]}) ${o}`));
      lines.push(`= ${letters[pos]}`);
      lines.push(`+ ${r.w} 的常见中文释义是「${r.m}」。`, '');
    });
  }
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`写出 packs/words.md（${all.length} 道题 / ${parsed.length} 个题池）`);
}


