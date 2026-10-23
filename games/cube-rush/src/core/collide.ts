/**
 * 碰撞（04 §2.3：玩家 AABB 0.8³ vs 障碍 AABB；金币距离阈值）。
 * 纯逻辑层，单测覆盖。坐标：x 车道 / y 高度 / z 沿轨道（玩家恒在 z=0）。
 */
import { PLAYER, COIN } from './constants.ts';

export interface Box3 {
  cx: number; cy: number; cz: number; // 中心
  sx: number; sy: number; sz: number; // 尺寸（宽/高/长）
}

/** AABB 相交（严格；贴边不算）。 */
export function aabbOverlap(a: Box3, b: Box3): boolean {
  return (
    Math.abs(a.cx - b.cx) * 2 < a.sx + b.sx &&
    Math.abs(a.cy - b.cy) * 2 < a.sy + b.sy &&
    Math.abs(a.cz - b.cz) * 2 < a.sz + b.sz
  );
}

/** 玩家当前 AABB（滑铲时高度降低）。 */
export function playerBox(x: number, y: number, sliding: boolean): Box3 {
  const h = sliding ? PLAYER.slideHeight : PLAYER.height;
  return { cx: x, cy: y + h / 2, cz: 0, sx: PLAYER.width, sy: h, sz: 0.8 };
}

/** 金币拾取判定（3D 距离阈值；磁力扩大半径）。 */
export function coinPickup(px: number, py: number, coin: { x: number; y: number; z: number }, magnet: boolean): boolean {
  const r = magnet ? COIN.magnetRadius : COIN.pickupRadius;
  const dx = px - coin.x, dy = py - coin.y, dz = -coin.z;
  return dx * dx + dy * dy + dz * dz <= r * r;
}
