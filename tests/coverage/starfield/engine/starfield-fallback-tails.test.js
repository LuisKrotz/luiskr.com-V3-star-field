/**
 * @file coverage/starfield/engine/starfield-fallback-tails.test.js
 * @description Coverage tails for the no-WebGL fallback surface —
 * fallback-stars.ts paints a seeded 2D starfield (null-ctx arm, zero-size
 * arm, canvas resize, glint branch, observer arms) and frame.ts's
 * tickStar catch path marks the engine failed and fires onLost.
 */
import { describe, test, expect, jest, afterEach } from '@jest/globals'

import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { paintStarFallback, bindStarFallback } from '../../../../engine/fallback-stars.js'
import { createStarState } from '../../../../engine/state.js'
import { tickStar } from '../../../../engine/frame.js'

/** Fake 2d context covering every call the painter issues. */
const fake2d = () => ({
  setTransform: jest.fn(),
  clearRect: jest.fn(),
  fillStyle: '',
  strokeStyle: '',
  globalAlpha: 1,
  lineWidth: 0,
  beginPath: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  stroke: jest.fn(),
})

const makeCanvas = (w = 640, h = 480) => {
  const el = document.createElement(HTML_TAGS.CANVAS)

  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true })

  return el
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('paintStarFallback', () => {
  test('returns early when the 2d context is unavailable', () => {
    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)

    const canvas = makeCanvas()

    expect(() => paintStarFallback(canvas)).not.toThrow()
  })

  test('returns early when the canvas resolves to zero size', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const canvas = makeCanvas(0, 0)

    canvas.remove() // detached — parentElement fallback also empty

    const innerWidth = window.innerWidth
    const innerHeight = window.innerHeight

    Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true })

    paintStarFallback(canvas)

    Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true })

    expect(ctx.setTransform).not.toHaveBeenCalled()
  })

  test('paints stars and the band into a real-sized canvas', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const canvas = makeCanvas()

    document.body.appendChild(canvas)

    paintStarFallback(canvas)

    expect(ctx.setTransform).toHaveBeenCalled()
    expect(ctx.clearRect).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.arc).toHaveBeenCalled()

    canvas.remove()
  })

  test('repaints without resizing when the backing size already matches', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const canvas = makeCanvas()

    document.body.appendChild(canvas)

    paintStarFallback(canvas)

    const w = canvas.width
    const h = canvas.height

    paintStarFallback(canvas)

    expect(canvas.width).toBe(w)
    expect(canvas.height).toBe(h)

    canvas.remove()
  })

  test('falls back to parentElement/client dims and window dims', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    // clientWidth 0 → parentElement branch → window branch.
    const canvas = makeCanvas(0, 0)

    document.body.appendChild(canvas)

    paintStarFallback(canvas)

    expect(ctx.setTransform).toHaveBeenCalled()

    canvas.remove()
  })

  test('sizes from the parent element when the canvas itself reports zero', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const parent = document.createElement(HTML_TAGS.DIV)

    Object.defineProperty(parent, 'clientWidth', { value: 320, configurable: true })
    Object.defineProperty(parent, 'clientHeight', { value: 240, configurable: true })

    const canvas = makeCanvas(0, 0)

    parent.appendChild(canvas)
    document.body.appendChild(parent)

    paintStarFallback(canvas)

    expect(ctx.setTransform).toHaveBeenCalled()
    expect(canvas.width).toBeGreaterThan(0)

    parent.remove()
  })

  test('falls back to 1x when devicePixelRatio is unavailable', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const dpr = window.devicePixelRatio

    Object.defineProperty(window, 'devicePixelRatio', { value: 0, configurable: true })

    const canvas = makeCanvas()

    document.body.appendChild(canvas)

    paintStarFallback(canvas)

    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true })

    expect(ctx.setTransform).toHaveBeenCalled()
    expect(canvas.width).toBe(640)

    canvas.remove()
  })
})

describe('bindStarFallback', () => {
  test('returns null when ResizeObserver is unavailable', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const RO = globalThis.ResizeObserver

    globalThis.ResizeObserver = undefined

    const canvas = makeCanvas()

    document.body.appendChild(canvas)

    expect(bindStarFallback(canvas)).toBeNull()

    globalThis.ResizeObserver = RO

    canvas.remove()
  })

  test('returns a disposer that disconnects the observer', () => {
    const ctx = fake2d()
    let cb
    const disconnect = jest.fn()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const RO = globalThis.ResizeObserver

    globalThis.ResizeObserver = class {
      constructor(f) {
        cb = f
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnect()
      }
    }

    const canvas = makeCanvas()

    document.body.appendChild(canvas)

    const dispose = bindStarFallback(canvas)

    expect(typeof dispose).toBe('function')

    cb() // resize repaint
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(1)

    dispose()
    expect(disconnect).toHaveBeenCalled()

    globalThis.ResizeObserver = RO

    canvas.remove()
  })

  test('still disposes cleanly when observe() throws on a non-Element', () => {
    const ctx = fake2d()

    jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)

    const disconnect = jest.fn()
    const RO = globalThis.ResizeObserver

    globalThis.ResizeObserver = class {
      constructor() {}
      observe() {
        throw new Error('not an element')
      }
      disconnect() {
        disconnect()
      }
    }

    const canvas = makeCanvas()

    document.body.appendChild(canvas)

    const dispose = bindStarFallback(canvas)

    expect(typeof dispose).toBe('function')

    dispose()
    expect(disconnect).toHaveBeenCalled()

    globalThis.ResizeObserver = RO

    canvas.remove()
  })
})

describe('tickStar failure failover', () => {
  test('a throwing frame marks the engine failed and fires onLost', async () => {
    const { clearDevLog, getDevLog } = await import('@core/devlog.js')

    clearDevLog()

    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))
    const onLost = jest.fn()
    const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    s.onLost = onLost
    // renderer.render throws → tickFrame propagates → catch arm.
    s.camera = {
      position: { x: 0, y: 0, z: 900, set: jest.fn() },
      aspect: 1,
      updateProjectionMatrix: jest.fn(),
    }
    s.scene = {}
    s.renderer = {
      render: jest.fn(() => {
        throw new Error('context-lost')
      }),
    }

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)

    expect(() => tickStar(s, 0)).not.toThrow()
    expect(s.failed).toBe(true)
    expect(s.animId).toBeNull()
    expect(onLost).toHaveBeenCalled()
    expect(getDevLog().length).toBeGreaterThan(0)

    // Second tick is a no-op on the failed flag.
    raf.mockClear()
    tickStar(s, 16)
    expect(raf).not.toHaveBeenCalled()

    raf.mockRestore()
    cancel.mockRestore()
  })

  test('structure nodes without speckleMat take the no-op arm', () => {
    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.camera = {
      position: { x: 0, y: 0, z: 900, set: jest.fn() },
      aspect: 1,
      updateProjectionMatrix: jest.fn(),
    }
    s.scene = {}
    s.renderer = { render: jest.fn() }
    const fadeUniform = { value: -1 }

    s.nodes.set('void-shell', {
      def: { kind: 'structure', radius: 100, structure: { radius: 100 } },
      pivot: { rotation: { x: 0, y: 0, z: 0 } },
      spinner: { rotation: { x: 0, y: 0, z: 0 } },
      mesh: {
        userData: { fade: fadeUniform },
        getWorldPosition: (v) => {
          v.x = 0
          v.y = 0
          v.z = 0

          return v
        },
      },
      satPivots: [],
    })

    const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    expect(() => tickStar(s, 0)).not.toThrow()
    expect(s.failed).toBe(false)
    expect(fadeUniform.value).toBeGreaterThanOrEqual(0)

    raf.mockRestore()
  })

  test('the catch arm drops the pending frame handle', () => {
    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    s.onLost = jest.fn()
    s.camera = {
      position: { x: 0, y: 0, z: 900, set: jest.fn() },
      aspect: 1,
      updateProjectionMatrix: jest.fn(),
    }
    s.scene = {}
    s.renderer = {
      render: jest.fn(() => {
        throw new Error('ctx-dead')
      }),
    }

    tickStar(s, 0)

    expect(s.failed).toBe(true)
    expect(s.animId).toBeNull()
  })
})
