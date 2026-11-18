/**
 * 选一个本地文件。两种导入都走它（`.md` 直接导入 / 文档生成），
 * 临时 `<input>` 用完就扔，不挂在 DOM 上。
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // 取消选择不会触发 change；不 resolve 也无害（面板上的文案会停在那儿）
    input.click();
  });
}
