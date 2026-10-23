/**
 * 渲染器创建（04 §2.1：r186 WebGPURenderer 内建自动回退 WebGL2）。
 * 核实（three 0.186.1 源码 2026-10-23）：
 * - import { WebGPURenderer } from 'three/webgpu'（根 export 不含它，须走 ./webgpu 子入口）
 * - await renderer.init() 必须在首帧前完成（WebGPU 资源异步编译）
 * - 回退：WebGPUBackend 初始化失败 → 内建 getFallback 换 WebGLBackend（console.warn 可见）
 * - 后端判定：renderer.backend.isWebGPUBackend（WebGL 后端为 false/undefined）
 */
import { WebGPURenderer, SRGBColorSpace } from 'three/webgpu'

export interface RendererSetup {
  renderer: WebGPURenderer
  webgpu: boolean
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererSetup> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false })
  try {
    await renderer.init()
  } catch (e) {
    // init 内部已尝试 WebGPU→WebGL2 回退；走到这里 = 两档都失败
    throw new Error('renderer init failed: ' + String(e))
  }
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = 0 // NoToneMapping：霓虹 emissive 要硬亮
  const webgpu = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
  return { renderer, webgpu }
}
