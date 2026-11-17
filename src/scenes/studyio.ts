import { studySnapshot } from '../core/library';

/**
 * 把章节记忆导出成一份 JSON 文件。
 *
 * 游戏运行时对外通信是 0 次（AGENTS.md 的硬约束），所以「按错题重出题」这条
 * 闭环只能靠玩家**手动**把这份文件交给生成工具（`npm run gen -- --feedback=...`）。
 * 导出走的是本地 data URL，一个字节都不离开这台机器。
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
