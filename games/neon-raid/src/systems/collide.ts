/**
 * 纯几何碰撞（无 Phaser 依赖，可 node 单测）。
 * 扫掠 AABB：dt 被钳到 50ms 时，玩家子弹一步 45px > 敌机宽 34px，
 * 必须同时检查上一帧位置，否则高速帧率抖动下子弹会「穿透」敌机。
 */

export function aabb(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh
}

export interface SweptBullet {
  x: number
  y: number
  px: number
  py: number
}

/** 子弹（本帧 x/y + 上一帧 px/py）对目标矩形是否命中 */
export function sweptBulletHits(
  b: SweptBullet,
  bw: number,
  bh: number,
  t: { x: number; y: number; w: number; h: number },
): boolean {
  return aabb(b.x, b.y, bw, bh, t.x, t.y, t.w, t.h) || aabb(b.px, b.py, bw, bh, t.x, t.y, t.w, t.h)
}
