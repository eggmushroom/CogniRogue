import { G } from '../core/infra';
import { refreshServiceInfo, setGenConfig } from '../core/library';

/**
 * 设置面板的动作。和题库面板一样，失败就写在按钮下面那行，不弹窗、不 toast。
 *
 * 这里只有两件事可以"做"：重连本机服务、把模型配置交给它。其余都是说明 ——
 * 设置页最容易长成一排开关，而每一个开关都是一处要维护的假设。
 */
const say = (msg: string, ok = true) => {
  G.panel = { k: 'settings', msg, ok };
};

export async function reconnectService() {
  say('正在连 127.0.0.1:7777 …');
  const up = await refreshServiceInfo();
  say(up
    ? '连上了。服务那边的题库在「题库」面板里。'
    : '还是连不上：先在这个目录下跑 npm run serve。', up);
}

/**
 * 模型配置走剪贴板：`{"baseUrl":"…","key":"…","model":"…"}`。
 * 画布界面没有文本框，而这是唯一需要输入一长串字符的地方 —— 粘贴比手打现实。
 * key 交给服务存（`data/service/gen.json`），浏览器不落一份。
 */
export async function pasteModelConfig() {
  try {
    const txt = (await navigator.clipboard.readText()).trim();
    if (!txt) return say('剪贴板是空的。', false);
    const cfg = JSON.parse(txt) as { baseUrl?: string; key?: string; model?: string };
    if (!cfg.key) return say('配置里没有 key。', false);
    const ok = await setGenConfig({
      baseUrl: String(cfg.baseUrl ?? '').trim(),
      key: String(cfg.key).trim(),
      model: String(cfg.model ?? '').trim(),
    });
    if (!ok) return say('服务没有接受这份配置（它在跑吗？）。', false);
    await refreshServiceInfo();
    return say(`模型配置已交给服务：${cfg.model || '默认模型'}。现在可以从文档建题库了。`);
  } catch (err) {
    return say('配置要是一段 JSON：{"baseUrl":"…","key":"…","model":"…"}。'
      + (err as Error).message, false);
  }
}
