/**
 * Menu：标题 / 关卡选择（本局进度）/ 设置（音量、震屏）/ 登录态展示。
 * 操作：键盘 ←→ 选关、↑↓ 音量、Enter 开始；触控/点击按钮。
 */
import Phaser from 'phaser'
import { LEVELS, W, H } from '../core/constants.ts'
import { loadSettings, saveSettings, type Settings } from '../core/settings.ts'
import { audio } from '../audio/synth.ts'
import { sendReady, sendTrack, getJwt, getPlatformUser } from '../platform/bridge.ts'
import { newRun } from '../core/run.ts'
import { freshSeed } from '../core/rng.ts'

export class MenuScene extends Phaser.Scene {
  private sel = 0
  private settings!: Settings
  private btnTexts: Phaser.GameObjects.Text[] = []
  private readySent = false

  constructor() {
    super('menu')
  }

  create(): void {
    if (!this.readySent) {
      this.readySent = true
      sendReady({ version: '1.0.0', engine: 'phaser-4', dpr: window.devicePixelRatio || 1 })
    }
    this.settings = loadSettings()
    this.sel = Math.min(this.sel, LEVELS.length - 1)

    // 背景
    const bg = this.add.image(W / 2, H / 2, 'bg1').setAlpha(0.5)
    this.tweens.add({ targets: bg, alpha: 0.85, duration: 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })

    const title = this.add.text(W / 2, 76, 'NEON RAID', {
      font: 'bold 64px Arial', color: '#eafcff',
    }).setOrigin(0.5)
    title.setShadow(0, 0, '#ff2d95', 18, true, true)
    this.add.text(W / 2, 124, '霓 虹 突 袭', {
      fontFamily: 'Arial', fontSize: '26px', color: '#12f0ff',
    }).setOrigin(0.5)

    // 关卡选择（v1.1.0：tile 放大，触控目标 ≥48px）
    const levelY = 190
    const levelLabels: Phaser.GameObjects.Text[] = []
    LEVELS.forEach((lv, i) => {
      const unlocked = i + 1 <= this.settings.unlockedLevel
      const label = this.add.text(
        W / 2 + (i - 1) * 260, levelY,
        `${lv.id}. ${lv.name}\n${lv.sub}${unlocked ? '' : '（未解锁）'}`,
        { fontFamily: 'Arial', fontSize: '22px', color: unlocked ? '#eafcff' : '#3a4a66', align: 'center', lineSpacing: 8 },
      ).setOrigin(0.5)
      levelLabels.push(label)
      if (unlocked) {
        this.add.zone(W / 2 + (i - 1) * 260, levelY + 16, 240, 84).setInteractive().on('pointerdown', () => {
          this.sel = i
          this.redrawLevels(levelLabels)
          this.startRun(i)
        })
      }
    })
    this.btnTexts = levelLabels

    // 开始按钮（v1.1.0：显式大按钮——不再只靠「点关卡」隐式开始；03 §1.3 触控可达）
    const startRect = this.add.rectangle(W / 2, 330, 332, 88, 0x12f0ff, 0.25)
    this.add.rectangle(W / 2, 330, 320, 76, 0x0a1428, 0.95).setStrokeStyle(3, 0x12f0ff)
    this.add.text(W / 2, 322, '开 始 突 袭', { font: 'bold 30px Arial', color: '#eafcff' }).setOrigin(0.5)
    this.startSub = this.add.text(W / 2, 352, `Level ${this.sel + 1} · ${LEVELS[this.sel].sub}`, { fontFamily: 'Arial', fontSize: '16px', color: '#7fd7ff' }).setOrigin(0.5)
    startRect.setInteractive()
    startRect.on('pointerdown', () => this.startRun(this.sel))

    // 设置区（v1.1.0：下移避让开始按钮）
    const s = this.settings
    const volLabel = this.add.text(W / 2 - 320, 380, `音量 ${Math.round(s.volume * 100)}%`, {
      fontFamily: 'Arial', fontSize: '18px', color: '#7fd7ff',
    })
    this.add.text(W / 2 - 320, 406, `[↑/↓ 或 点击]`, { fontFamily: 'Arial', fontSize: '13px', color: '#3a5a86' }).setInteractive()
    const shakeLabel = this.add.text(W / 2 - 320, 434, `震屏 ${s.shake ? '开' : '关'}`, {
      fontFamily: 'Arial', fontSize: '18px', color: '#7fd7ff',
    })
    this.add.zone(W / 2 - 320, 434, 140, 34).setInteractive().on('pointerdown', () => {
      s.shake = !s.shake
      saveSettings(s)
      shakeLabel.setText(`震屏 ${s.shake ? '开' : '关'}`)
    })

    // 登录态（02 §4.3：platform:init 或 localStorage 判定）
    const logged = !!getJwt()
    const user = getPlatformUser()
    const loginText = logged
      ? `已登录：${user?.name || user?.id || '玩家'}（成绩上榜单）`
      : '游客模式：登录平台后成绩才能上榜单'
    this.add.text(W / 2 - 320, 486, loginText, {
      fontFamily: 'Arial', fontSize: '15px', color: logged ? '#3dff8f' : '#ffd23d',
    })

    this.add.text(W / 2, 508, `最高纪录 ${this.settings.bestScore}    ——    [→←] 选关  [Enter / 点击「开始」] 开始`, {
      fontFamily: 'Arial', fontSize: '16px', color: '#5a7aa6',
    }).setOrigin(0.5, 0)

    // 键盘
    const kb = this.input.keyboard!
    kb.on('keydown-LEFT', () => { this.sel = (this.sel + LEVELS.length - 1) % LEVELS.length; this.redrawLevels(levelLabels); this.refreshStart() })
    kb.on('keydown-RIGHT', () => { this.sel = (this.sel + 1) % LEVELS.length; this.redrawLevels(levelLabels); this.refreshStart() })
    kb.on('keydown-UP', () => {
      s.volume = Math.min(1, s.volume + 0.1)
      audio.setVolume(s.volume)
      saveSettings(s)
      volLabel.setText(`音量 ${Math.round(s.volume * 100)}%`)
    })
    kb.on('keydown-DOWN', () => {
      s.volume = Math.max(0, s.volume - 0.1)
      audio.setVolume(s.volume)
      saveSettings(s)
      volLabel.setText(`音量 ${Math.round(s.volume * 100)}%`)
    })
    kb.on('keydown-ENTER', () => this.startRun(this.sel))
    kb.on('keydown-P', () => this.startRun(this.sel))

    // 选中框
    this.refreshSelBox(levelLabels)
  }

  private selBox: Phaser.GameObjects.Graphics | null = null
  private startSub: Phaser.GameObjects.Text | null = null

  /** 开始按钮副标题跟随选中关（选关后点「开始」进的是选中的关） */
  private refreshStart(): void {
    this.startSub?.setText(`Level ${this.sel + 1} · ${LEVELS[this.sel].sub}`)
  }

  private refreshSelBox(labels: Phaser.GameObjects.Text[]): void {
    this.selBox?.destroy()
    const t = labels[this.sel]
    if (!t) return
    this.selBox = this.add.graphics()
    this.selBox.lineStyle(2.5, 0x12f0ff, 0.9)
    this.selBox.strokeRect(t.x - 125, t.y - 46, 250, 92)
  }

  private redrawLabels: Phaser.GameObjects.Text[] | null = null

  private redrawLevels(labels: Phaser.GameObjects.Text[]): void {
    this.redrawLabels = labels
    const s = loadSettings()
    labels.forEach((t, i) => {
      const unlocked = i + 1 <= s.unlockedLevel
      t.setColor(unlocked ? '#eafcff' : '#3a4a66')
    })
    this.refreshSelBox(labels)
  }

  private startRun(levelIdx: number): void {
    const run = newRun(levelIdx)
    const seed = freshSeed()
    this.add.text(W / 2, H - 40, '', {})
    this.scene.start('play', { run, seed })
    audio.stopBgm()
    audio.startBgm(levelIdx)
    sendTrack('start')
  }
}
