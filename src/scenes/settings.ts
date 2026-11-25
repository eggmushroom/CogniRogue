import { G } from '../core/infra';
import { refreshServiceInfo, serviceModelBase, serviceModelName, serviceReady, setGenConfig } from '../core/library';
import type { ModelForm } from '../core/model';
import { editField, fieldOf, pasteInto, type KeyIn } from './textfield';

/**
 * 设置面板的动作。和题库面板一样，失败就写在面板底部那行，不弹窗、不 toast。
 *
 * 模型参数只在编辑页修改，连接状态由实际请求反馈。
 */
const pane = () => (G.panel.k === 'settings' ? G.panel : null);

export function say(msg: string, ok = true) {
  const p = pane();
  if (!p) return;
  p.msg = msg;
  p.ok = ok;
}

/** 三个字段的长度上限：URL 和 key 够长，模型名短得多。 */
const MAX = [220, 80, 220];
export const modelFields = (f: ModelForm) => [f.base, f.model, f.key];

export function openModelForm() {
  const p = pane();
  if (!p) return;
  // 地址和模型名拿服务报上来的当前值当默认值；密钥永远是空的 —— 服务从不下发它
  p.form = {
    base: fieldOf(serviceModelBase()),
    model: fieldOf(serviceModelName()),
    key: fieldOf(''),
    field: 1,
    reveal: false,
    connection: false,
  };
  say('');
}

export function closeModelForm() {
  const p = pane();
  if (!p) return;
  p.form = undefined;
  say('');
}

export function toggleReveal() {
  const f = pane()?.form;
  if (f) f.reveal = !f.reveal;
}

export function focusModelField(i: number) {
  const f = pane()?.form;
  if (!f) return;
  f.field = i;
  const cur = modelFields(f)[i];
  cur.caret = cur.value.length;
}

export async function saveModelForm() {
  const p = pane();
  const f = p?.form;
  if (!p || !f) return;
  const base = f.base.value.trim();
  const model = f.model.value.trim();
  const key = f.key.value.trim();
  if (base && !/^https?:\/\//i.test(base)) {
    say('接口地址要以 http:// 或 https:// 开头。', false);
    return;
  }
  say('正在保存 …');
  if (!(await setGenConfig({ baseUrl: base, key, model }))) {
    say('保存失败，请稍后重试', false);
    return;
  }
  await refreshServiceInfo();
  p.form = undefined;
  const ready = serviceReady();
  say(ready
    ? '已保存'
    : '已保存，请填写模型密钥', ready);
}

/**
 * 输入框有焦点时，按键先过这里。返回 true = 这一下归输入框，别再去当快捷键。
 */
export function settingsKey(k: KeyIn): boolean {
  const f = pane()?.form;
  if (!f) return false;
  const cur = modelFields(f)[f.field];
  if (k.ctrl && (k.key === 'v' || k.key === 'V')) {
    void pasteInto(cur, MAX[f.field]);
    return true;
  }
  if (editField(cur, k, MAX[f.field])) return true;
  if (k.key === 'Tab') {
    const order = f.connection ? [1, 2, 0] : [1, 2];
    focusModelField(order[(order.indexOf(f.field) + 1) % order.length]);
    return true;
  }
  if (k.key === 'Enter') {
    void saveModelForm();
    return true;
  }
  return false;
}
