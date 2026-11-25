import { studySnapshot } from '../core/library';

/**
 * 把章节记忆导出成一份 JSON 文件。
 *
 * 离线生成器可通过 `npm run gen -- --feedback=...` 读取这份快照。
 * 导出使用本地 data URL，不访问网络。
 *
 * 不用 `createObjectURL` + `setTimeout(revoke)`：那是第二套时钟
 * （`clock/single` 会拦），而立刻 revoke 又会在部分浏览器里把下载掐断。
 * data URL 没有生命周期要回收，两个问题一起消失。
 */
export function downloadStudySnapshot() {
  const json = JSON.stringify(studySnapshot(), null, 2);
  const a = document.createElement('a');
  a.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  a.download = 'cognirogue-study.json';
  a.click();
}
