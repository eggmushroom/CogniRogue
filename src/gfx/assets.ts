import shardUrl from '../../assets/shard.jpg';
import examinerUrl from '../../assets/examiner.jpg';
import oblivionUrl from '../../assets/oblivion.jpg';
import arenaUrl from '../../assets/arena.jpg';

/**
 * 立绘都是"纯黑底 + 发光主体"。直接画会有方形色差，
 * 所以统一用 screen 混合 —— 黑即透明，光留下。省掉抠图。
 */
export interface Art {
  shard: HTMLImageElement;
  examiner: HTMLImageElement;
  oblivion: HTMLImageElement;
  arena: HTMLImageElement;
}

const mk = (src: string) => {
  const im = new Image();
  im.src = src;
  return im;
};

export const ART: Art = {
  shard: mk(shardUrl),
  examiner: mk(examinerUrl),
  oblivion: mk(oblivionUrl),
  arena: mk(arenaUrl),
};

export const ready = () =>
  Object.values(ART).every((im) => im.complete && im.naturalWidth > 0);

export function loadArt(): Promise<void> {
  const imgs = Object.values(ART);
  return Promise.all(
    imgs.map((im) =>
      im.complete && im.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((res) => {
            im.onload = () => res();
            im.onerror = () => res();
          }),
    ),
  ).then(() => undefined);
}
