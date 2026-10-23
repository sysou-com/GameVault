/**
 * 平台 ⇄ 游戏 桥（02 文档 §4）。
 *
 * 登录态（M2）：中心 JWT 在内存（session.ts，/api/me 后端验签后）；
 * 验证通过后发布到 localStorage['gamevault.session']（游戏侧唯一读通道，02 §4.3 防污染写入）；
 * 游戏侧 bridge.ts 读该键做同源直连提分（模式一），失败回落 postMessage（模式二，GameFrame 代理）。
 */
import { user, restoreSession } from '../session'

export interface PlatformUser {
  id?: string
  name?: string
  anonymous: boolean
}

/** 当前登录态（异步：先恢复会话再取；游客 = {anonymous: true}）。 */
export async function platformUser(): Promise<PlatformUser> {
  await restoreSession()
  const u = user.value
  return u ? { id: u.id, name: u.email ?? undefined, anonymous: false } : { anonymous: true }
}

/** 游戏侧 bridge.ts 的同款读取逻辑（各游戏 src/platform/bridge.ts 参照实现）。 */
export function readSession(): string | null {
  try {
    return localStorage.getItem('gamevault.session')
  } catch {
    return null
  }
}
