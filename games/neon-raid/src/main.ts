/**
 * 霓虹突袭 Neon Raid — Phaser 4.2.1 装配（03 文档 §2.2）。
 * 960×540 FIT；powerPreference high-performance（§2.3 帧率自适应在 PlayScene 内）。
 */
import Phaser from 'phaser'
import { W, H } from './core/constants.ts'
import { BootScene } from './scenes/BootScene.ts'
import { MenuScene } from './scenes/MenuScene.ts'
import { PlayScene } from './scenes/PlayScene.ts'
import { ResultScene } from './scenes/ResultScene.ts'
import { sendError } from './platform/bridge.ts'

// v4：自定义/受控环境（headless、沙箱浏览器、传入 canvas 元素）必须显式渲染器（v3 的 render.type 已移除，
// 改由顶层 type 指定：Phaser.WEBGL / Phaser.CANVAS；AUTO 仅在原生浏览器环境可用）
const hasWebGL = (() => {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
})()

// 运行时错误 → 平台错误卡（02 §4.1 game:error）
window.addEventListener('error', (e) => {
  sendError('runtime', e.message || 'unknown error')
})
window.addEventListener('unhandledrejection', (e) => {
  sendError('runtime', String((e as PromiseRejectionEvent).reason).slice(0, 300))
})

const game = new Phaser.Game({
  type: hasWebGL ? Phaser.WEBGL : Phaser.CANVAS,
  canvas: document.getElementById('game') as HTMLCanvasElement,
  width: W,
  height: H,
  backgroundColor: '#04060f',
  render: { antialias: true },
  powerPreference: 'high-performance',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, PlayScene, ResultScene],
})

// 调试钩子（本地/排障用；平台 iframe 内也可读，无敏感数据）
;(window as unknown as { __nv?: Phaser.Game }).__nv = game
