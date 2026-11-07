/**
 * 兼容门面 —— 旧入口。
 *
 * 原来 1364 行的规则全塞在这个文件里；现在按功能拆进了 model / infra /
 * library / cards / map / combat / journey 七个工具包，公共 API 汇总在
 * `core/index.ts`。这里只保留一个 re-export，让既有的 import 路径继续可用；
 * 新代码请直接引用具体工具包，见 core/index.ts 顶部的包地图。
 */
export * from './index';
