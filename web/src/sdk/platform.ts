/**
 * 平台 ⇄ 游戏 桥（02 文档 §4）。
 *
 * 登录态（同源模式）：中心 JWT 存 localStorage['gamevault.session']——
 * sessionStorage 按 tab 隔离、iframe 与顶层页不共享（02 文档 §4.3），故用 localStorage；
 * 写前校验未被污染（值必须与当前内存 token 一致才写）。
 * M1 为游客态：无中心登录，token 为空，游戏侧据此显示「登录保存」。
 */

const SESSION_KEY = 'gamevault.session'

export interface PlatformUser {
  id?: string
  name?: string
  anonymous: boolean
}

/** 平台侧：把当前 token 写入共享存储（M1 恒无 token；M2 接中心登录后启用）。 */
export function publishSession(token: string | null): void {
  if (token) localStorage.setItem(SESSION_KEY, token)
  else localStorage.removeItem(SESSION_KEY)
}

/** 游戏侧（bridge.ts 同款逻辑，供各游戏 src/platform/bridge.ts 参照实现）。 */
export function readSession(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

export function currentPlatformUser(): PlatformUser {
  // M1：恒游客。M2：中心 /me 解析 JWT 后填充。
  return { anonymous: true }
}
