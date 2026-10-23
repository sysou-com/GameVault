/** 输入统一：pointerdown（鼠标/触屏）/ 空格键 → performance.now() 时戳上报（06 文档 §4 输入公平性）。 */
export function attachInput(onHit: (ts: number) => void): () => void {
  const canvas = document.getElementById('c') as HTMLCanvasElement | null

  const pointer = (e: Event) => {
    e.preventDefault()
    onHit('performance' in e ? (e as PointerEvent).timeStamp ?? performance.now() : performance.now())
  }
  const key = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault()
      onHit(performance.now())
    }
  }

  canvas?.addEventListener('pointerdown', pointer)
  window.addEventListener('keydown', key)
  return () => {
    canvas?.removeEventListener('pointerdown', pointer)
    window.removeEventListener('keydown', key)
  }
}
