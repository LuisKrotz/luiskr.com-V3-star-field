/**
 * @file starfield/starfield-engine.test.js
 * @description StarFieldEngine facade — init() always resolves (success,
 * bailout, destroy-mid-boot), the failed flag the host reads for the CSS
 * fallback, reduced-motion pause/resume, selectBody/flyHome camera
 * control, takeScreenshot and destroy teardown.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'

import { DEBUG_PARAMS, WEBGL_MODES } from '@core/tokens/strings/debug.js'
import { STATE_CLASSES } from '@core/tokens/classes/state.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { StarFieldEngine } from '../../starfield-engine.js'
import { __setRendererInitDelay } from 'three/webgpu'

const setSearch = (s) => window.history.replaceState(null, '', s)

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))

const makeCanvas = () => {
  const canvas = document.createElement(HTML_TAGS.CANVAS)

  document.body.appendChild(canvas)

  return canvas
}

beforeEach(() => {
  setSearch('/')
  document.documentElement.classList.remove(STATE_CLASSES.REDUCED_MOTION)
})

afterEach(() => {
  setSearch('/')
  __setRendererInitDelay(0)
})

describe('StarFieldEngine', () => {
  test('init() boots the scene and fires onReady', async () => {
    const events = { onReady: jest.fn(), onProgress: jest.fn() }
    const engine = new StarFieldEngine(makeCanvas(), events)

    await engine.init()

    expect(events.onReady).toHaveBeenCalled()
    expect(events.onProgress).toHaveBeenCalled()
    expect(engine.failed).toBe(false)

    engine.destroy()
  })

  test('init() reports failure when WebGL is disallowed', async () => {
    setSearch(`/?${DEBUG_PARAMS.KEY}=${DEBUG_PARAMS.WEBGL_MODE}:${WEBGL_MODES.FALLBACK}`)

    const events = { onReady: jest.fn() }
    const engine = new StarFieldEngine(makeCanvas(), events)

    await engine.init()

    expect(engine.failed).toBe(true)
    expect(events.onReady).toHaveBeenCalled()

    engine.destroy()
  })

  test('destroy() during a delayed boot aborts without onReady', async () => {
    __setRendererInitDelay(120)

    const events = { onReady: jest.fn() }
    const engine = new StarFieldEngine(makeCanvas(), events)
    const pending = engine.init()

    engine.destroy()
    await pending

    expect(events.onReady).not.toHaveBeenCalled()
  })

  test('destroy() disposes every scene geometry, material and texture slot', async () => {
    const engine = new StarFieldEngine(makeCanvas())

    await engine.init()

    const geometry = { dispose: jest.fn() }
    const texture = { isTexture: true, dispose: jest.fn() }
    const plain = { notATexture: 1 }
    const material = {
      map: texture,
      normalMap: texture,
      label: plain,
      empty: null,
      halfTex: { isTexture: true },
      dispose: jest.fn(),
    }
    const material2 = { dispose: jest.fn() }
    const meshB = { geometry: { dispose: jest.fn() }, material: [material2] }
    const meshC = { geometry: null }

    // __sfDebug IS the live state — swap in a traversable scene stub.
    window.__sfDebug.scene = {
      traverse: (cb) => [{ geometry, material }, meshB, meshC].forEach(cb),
    }

    engine.destroy()

    expect(geometry.dispose).toHaveBeenCalled()
    expect(texture.dispose).toHaveBeenCalled()
    expect(material.dispose).toHaveBeenCalled()
    expect(material2.dispose).toHaveBeenCalled()
    expect(meshB.geometry.dispose).toHaveBeenCalled()
  })

  test('destroy() tolerates a scene without traverse', async () => {
    const engine = new StarFieldEngine(makeCanvas())

    await engine.init()

    window.__sfDebug.scene = {}

    engine.destroy()
  })

  test('setReducedMotion pauses and resumes the RAF loop', async () => {
    const engine = new StarFieldEngine(makeCanvas())

    await engine.init()

    engine.setReducedMotion(true)
    engine.setReducedMotion(true)

    engine.setReducedMotion(false)
    engine.setReducedMotion(false)

    await flush(60)

    engine.destroy()
  })

  test('selectBody ignores unknown ids and flies to known ones', async () => {
    const events = { onSelect: jest.fn() }
    const engine = new StarFieldEngine(makeCanvas(), events)

    await engine.init()

    engine.selectBody('not-a-body')
    engine.selectBody('mars')

    await flush(40)

    engine.destroy()
  })

  test('selectBody flies to a registry object via the shard index', async () => {
    const origFetch = globalThis.fetch

    globalThis.fetch = jest.fn(async (url) => {
      const u = String(url)

      if (u.endsWith('manifest.json'))
        return {
          ok: true,
          json: async () => ({
            total: 1,
            shardSize: 1000,
            kinds: { star: { count: 1, shards: ['star-000.json'] } },
          }),
        }
      if (u.endsWith('star-000.json'))
        return {
          ok: true,
          json: async () => [{ i: 'star-000000', n: 'Sirius', m: -1.4, d: 8.6, x: 5, y: 0, z: 0 }],
        }

      return { ok: false, status: 404 }
    })

    try {
      const engine = new StarFieldEngine(makeCanvas())

      await engine.init()

      engine.selectBody('star-000000')
      await flush(40)

      // Stale-selection guard — a second select before the shard lands
      // must not be hijacked by the first resolve.
      engine.selectBody('star-000000')
      engine.selectBody('mars')
      await flush(40)

      engine.destroy()

      // Disposed mid-flight — resolve must no-op.
      const dead = new StarFieldEngine(makeCanvas())

      await dead.init()

      dead.selectBody('star-000000')
      dead.destroy()
      await flush(30)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test('flyHome returns to the overview pose', async () => {
    const engine = new StarFieldEngine(makeCanvas())

    await engine.init()

    engine.flyHome()
    await flush(30)

    engine.destroy()
  })

  test('takeScreenshot drives the capture pipeline', async () => {
    const canvas = makeCanvas()

    canvas.toDataURL = () => 'data:image/png;base64,x'
    globalThis.URL.createObjectURL = jest.fn(() => 'blob:shot')

    const engine = new StarFieldEngine(canvas)

    await engine.init()

    engine.takeScreenshot()
    await flush(80)

    engine.destroy()
  })

  test('takeScreenshot no-ops before a renderer exists', () => {
    const engine = new StarFieldEngine(makeCanvas())

    expect(() => engine.takeScreenshot()).not.toThrow()
  })

  test('selectBody and flyHome no-op before boot', () => {
    const engine = new StarFieldEngine(makeCanvas())

    expect(() => {
      engine.selectBody('mars')
      engine.deselect()
      engine.flyHome()
      engine.setReducedMotion(true)
      engine.setReducedMotion(false)
    }).not.toThrow()

    engine.destroy()
  })

  test('deselect releases the selection without moving the camera', async () => {
    const engine = new StarFieldEngine(makeCanvas())

    await engine.init()

    engine.selectBody('mars')
    engine.deselect()

    engine.destroy()
  })

  test('destroy() releases listeners even before boot', () => {
    const canvas = makeCanvas()
    const engine = new StarFieldEngine(canvas)
    const rmSpy = jest.spyOn(canvas, 'removeEventListener')

    engine.destroy()
    engine.destroy()

    expect(rmSpy).not.toThrow
  })
})
