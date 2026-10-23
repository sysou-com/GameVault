/**
 * 通用对象池（03 文档 §2.3：子弹 64/128、粒子 512，目标 0 GC 峰值尖刺）。
 * 固定容量，take/release 配对；releaseAll 一次性回收（波次切换/结算用）。
 */
export class Pool<T> {
  private items: T[] = []
  private capacity: number
  private factory: () => T
  private resetFn: (t: T) => void

  constructor(capacity: number, factory: () => T, resetFn: (t: T) => void) {
    this.capacity = capacity
    this.factory = factory
    this.resetFn = resetFn
    for (let i = 0; i < capacity; i++) this.items.push(factory())
  }

  /** 在用的数量（调试/遥测用） */
  get inUse(): number {
    return this.capacity - this.items.length
  }

  take(): T | null {
    return this.items.pop() ?? null
  }

  release(t: T): void {
    if (this.items.length < this.capacity) {
      this.resetFn(t)
      this.items.push(t)
    }
  }

  /** 回收所有在用对象（调用前先把引用挪回 items） */
  releaseAll(): void {
    while (this.items.length < this.capacity) {
      const t = this.factory()
      this.resetFn(t)
      this.items.push(t)
    }
  }
}
