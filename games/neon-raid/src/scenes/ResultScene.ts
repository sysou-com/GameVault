/**
 * Result：结算（本局得分 / 最高连击 / 清波 / 精英）+ 提交分数（02 §4.3 同源直连）+ 再来一局。
 * 成就由平台服务端按 manifest 规则在提分时评估（FIRST_CLEAR / COMBO_30），游戏侧只报 meta。
 */
import Phaser from 'phaser'
import { W, H } from '../core/constants.ts'
import type { RunState } from '../core/run.ts'
import { submitScore, getJwt, getPlatformUser, sendTrack } from '../platform/bridge.ts'
import { newRun } from '../core/run.ts'
import { freshSeed } from '../core/rng.ts'
import { loadSettings } from '../core/settings.ts'
import { audio } from '../audio/synth.ts'

export class ResultScene extends Phaser.Scene {
  private run!: RunState
  private seed = 1
  private died = false
  private submitting = false
  private statusText!: Phaser.GameObjects.Text

  constructor() {
    super('result')
  }

  init(data: { run: RunState; seed: number; died: boolean }): void {
    this.run = data.run
    this.seed = data.seed
    this.died = data.died
  }

  create(): void {
    const bg = this.add.image(W / 2, H / 2, 'bg1').setAlpha(0.5)
    this.tweens.add({ targets: bg, alpha: 0.8, duration: 4000, yoyo: true, repeat: -1 })

    this.add.text(W / 2, 64, this.died ? 'SHIP DESTROYED' : this.run.levelsCleared === 3 ? 'MISSION COMPLETE' : 'TIME UP', {
      font: 'bold 40px Arial',
      color: this.died ? '#ff2d95' : '#3dff8f',
    }).setOrigin(0.5).setShadow(0, 0, this.died ? '#ff2d95' : '#3dff8f', 16, true, true)

    const rows: [string, string][] = [
      ['本局得分', String(this.run.score)],
      ['最高连击', `×${this.run.bestCombo}`],
      ['清波', `${this.run.wavesCleared} 波`],
      ['精英击坠', `${this.run.elitesKilled}`],
      ['通关', `${this.run.levelsCleared}/3 关`],
    ]
    rows.forEach(([k, v], i) => {
      this.add.text(W / 2 - 120, 130 + i * 40, k, { fontFamily: 'Arial', fontSize: '18px', color: '#7fd7ff' })
      this.add.text(W / 2 + 160, 130 + i * 40, v, { font: 'bold 20px Arial', color: '#eafcff' }).setOrigin(1, 0)
    })

    const s = loadSettings()
    this.add.text(W / 2, 340, `历史最佳 ${s.bestScore}`, { fontFamily: 'Arial', fontSize: '16px', color: '#ffd23d' }).setOrigin(0.5)

    // 提交状态
    this.statusText = this.add.text(W / 2, 380, this.getInitialStatus(), {
      fontFamily: 'Arial', fontSize: '16px', color: '#7fd7ff', align: 'center',
    }).setOrigin(0.5)

    // 按钮（登录时 3 枚，间距 210 > 170 宽不重叠）
    this.makeBtn(W / 2 - 210, 440, '再来一局', () => {
      const run = newRun(0)
      const seed = freshSeed()
      audio.stopBgm()
      audio.startBgm(0)
      sendTrack('start')
      this.scene.start('play', { run, seed })
    })
    this.makeBtn(W / 2 + 210, 440, '返回菜单', () => {
      this.scene.start('menu')
    })
    if (getJwt()) {
      this.makeBtn(W / 2, 440, '提交分数', () => this.doSubmit())
    }

    this.input.keyboard!.on('keydown-ENTER', () => {
      if (getJwt() && !this.submitting) this.doSubmit()
      else this.scene.start('menu')
    })
    this.input.keyboard!.on('keydown-R', () => {
      this.scene.start('menu')
      audio.startBgm(0)
    })
  }

  private makeBtn(x: number, y: number, label: string, fn: () => void): Phaser.GameObjects.Container {
    const rect = this.add.rectangle(x, y, 170, 44, 0x0a1428, 0.9).setStrokeStyle(2, 0x12f0ff)
    const t = this.add.text(x, y, label, { fontFamily: 'Arial', fontSize: '17px', color: '#eafcff' }).setOrigin(0.5)
    const c = this.add.container(x, y, [rect, t])
    rect.setInteractive()
    rect.on('pointerdown', fn)
    return c
  }

  private getInitialStatus(): string {
    if (!getJwt()) {
      const u = getPlatformUser()
      return u?.anonymous ? '游客成绩：登录平台后自动上榜单' : '登录后保存成绩'
    }
    return '已登录'
  }

  private async doSubmit(): Promise<void> {
    if (this.submitting) return
    this.submitting = true
    this.statusText.setText('提交中…').setColor('#ffd23d')
    const result = await submitScore(this.run.score, {
      bestCombo: this.run.bestCombo,
      wavesCleared: this.run.wavesCleared,
      elitesKilled: this.run.elitesKilled,
    })
    this.submitting = false
    if (result === 'ok') {
      this.statusText.setText('✓ 已提交，可在榜单查看').setColor('#3dff8f')
    } else if (result === 'no-auth') {
      this.statusText.setText('未登录：先登录平台再提交').setColor('#ffd23d')
    } else {
      this.statusText.setText('提交失败：稍后重试（可回菜单重进）').setColor('#ff2d95')
    }
  }
}
