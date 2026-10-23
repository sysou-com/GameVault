/**
 * 玩家（04 §2.3：换道 easeOut 插值 150ms + 抛物线跳/二段跳 + 滑铲 + AABB 供碰撞层）。
 * 玩家 mesh 固定 z=0（传送带世界），x 向车道插值，y 向跳跃物理。
 */
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Sprite, SpriteMaterial, AdditiveBlending } from 'three/webgpu'
import { LANES, PLAYER, JUMP, SLIDE_MS } from '../core/constants.ts'
import { makeGlowTexture } from './track.ts'

export interface PlayerState {
  lane: number          // 目标车道 0/1/2
  x: number             // 当前 x（插值中）
  y: number             // 离地高度
  vy: number
  jumpsLeft: number     // 0/1/2
  slidingUntil: number  // ms 时间戳
  lastHitAt: number
}

export function newPlayerState(): PlayerState {
  return { lane: 1, x: LANES[1], y: 0, vy: 0, jumpsLeft: 2, slidingUntil: 0, lastHitAt: 0 }
}

export function isSliding(p: PlayerState, now: number): boolean {
  return now < p.slidingUntil
}

/** 逻辑步（固定 60Hz）：换道插值 + 跳跃物理。 */
export function stepPlayer(p: PlayerState, dtMs: number): void {
  // 换道插值（easeOut：t' = 1-(1-t)^2 的速度近似——这里用指数逼近，150ms 内 99% 到位）
  const target = LANES[p.lane]
  const k = 1 - Math.pow(0.001, dtMs / PLAYER.laneLerpMs) // 150ms 后剩 0.1% 距离
  p.x += (target - p.x) * k
  if (Math.abs(target - p.x) < 0.002) p.x = target

  // 跳跃物理
  if (p.y > 0 || p.vy !== 0) {
    p.y += p.vy * (dtMs / 1000)
    p.vy += JUMP.gravity * (dtMs / 1000)
    if (p.y <= 0) {
      p.y = 0
      p.vy = 0
      p.jumpsLeft = 2
    }
  }
}

/** 换道（到边再按不越界）。 */
export function moveLane(p: PlayerState, dir: -1 | 1): void {
  p.lane = Math.max(0, Math.min(2, p.lane + dir))
}

/** 跳（二段）。@returns 是否起跳。 */
export function jump(p: PlayerState): boolean {
  if (p.jumpsLeft <= 0) return false
  p.vy = p.jumpsLeft === 2 ? JUMP.vy0 : JUMP.doubleJumpVy
  p.jumpsLeft -= 1
  p.slidingUntil = 0 // 空中取消滑铲
  return true
}

/** 滑铲（仅地面）。 */
export function slide(p: PlayerState, now: number): void {
  if (p.y > 0) return
  p.slidingUntil = now + SLIDE_MS
}

/** 玩家 mesh（发光方块 + 假辉光）。 */
export function buildPlayerMesh(): { group: Group; core: Mesh; glowSprite: Sprite } {
  const group = new Group()
  const core = new Mesh(
    new BoxGeometry(PLAYER.width, PLAYER.height, PLAYER.width),
    new MeshStandardMaterial({ color: 0x101020, emissive: 0x00e5ff, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 }),
  )
  core.position.y = PLAYER.height / 2
  group.add(core)
  const glowSprite = new Sprite(new SpriteMaterial({
    map: makeGlowTexture(), color: 0x00e5ff, blending: AdditiveBlending, depthWrite: false, transparent: true,
  }))
  glowSprite.scale.set(2.2, 2.2, 1)
  glowSprite.position.y = PLAYER.height / 2
  group.add(glowSprite)
  return { group, core, glowSprite }
}
