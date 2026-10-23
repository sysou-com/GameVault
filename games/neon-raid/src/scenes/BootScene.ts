/**
 * Boot：纹理构建（零资产，运行时生成）+ 音频首交互初始化 + 平台桥 + game:ready。
 */
import Phaser from 'phaser'
import { buildTextures } from '../assets/textures.ts'
import { audio } from '../audio/synth.ts'
import { loadSettings } from '../core/settings.ts'
import { initBridge, sendError, sendReady, sendTrack, getJwt } from '../platform/bridge.ts'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot')
  }

  create(): void {
    try {
      buildTextures(this)
    } catch (e) {
      sendError('runtime', `texture build failed: ${(e as Error).message}`)
      return
    }

    // 平台桥（02 文档 §4.1）
    initBridge({
      onInit: () => { /* 登录态由 ResultScene 消费 */ },
      onRestart: () => {
        this.scene.start('menu')
      },
    })
    sendTrack('pv')

    // 切主菜单（首帧渲染后平台收 game:ready）
    this.scene.start('menu')

    // 音频：首次 pointerdown/keydown 后初始化（自动播放策略，manifest.audio.requiresGesture）
    const bootAudio = () => {
      audio.init(loadSettings().volume)
      window.removeEventListener('pointerdown', bootAudio)
      window.removeEventListener('keydown', bootAudio)
    }
    window.addEventListener('pointerdown', bootAudio)
    window.addEventListener('keydown', bootAudio)
    // 若进入游戏前已交互过（平台注入过事件）—— getJwt 供 ResultScene 用，此处无操作
  }
}
