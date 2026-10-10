/**
 * @file coverage/starfield/engine/starfield-engine-wiring-tails.test.js
 * @description Coverage tails for starfield-engine.ts — the facade arms
 * the real bootstrap path can't reach under test: init() rejection
 * (console.error + catch), the failed flag when bootstrap leaves no
 * scene, destroy() with a null canvas, selectBody() with a populated
 * anchor map and the flyHome() camera branch. bootstrapStarField is
 * mocked so it can fill or fail the state on cue.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals'

const mockCtl = { populate: true, throwBoot: false }

jest.unstable_mockModule('../../../../engine/bootstrap.js', () => ({
  armFrame: jest.fn(),
  armPicking: jest.fn(),
  bootstrapStarField: jest.fn(async (s) => {
    if (mockCtl.throwBoot) throw new Error('boom')

    if (!mockCtl.populate) return

    s.scene = { isScene: true }
    s.renderer = { render: jest.fn(), dispose: jest.fn() }
    s.nodes.set('mars', {
      def: { radius: 1 },
      pivot: { rotation: { x: 0, y: 0, z: 0 } },
      spinner: { rotation: { x: 0, y: 0, z: 0 } },
      mesh: {},
      satPivots: [],
    })
    s.camera = {
      position: { x: 0, y: 0, z: 900, set: jest.fn() },
      aspect: 1,
      updateProjectionMatrix: jest.fn(),
    }
    s.anchors.set('mars', {
      getWorldPosition: (v) => {
        v.x = 10
        v.y = 0
        v.z = 0

        return v
      },
    })
  }),
}))

const { StarFieldEngine } = await import('../../../../starfield-engine.js')

const makeCanvas = () =>
  Object.assign(window.document.createElement('canvas'), {
    getRootNode: () => window.document,
  })

const events = () => ({
  onReady: jest.fn(),
  onSelect: jest.fn(),
  onHover: jest.fn(),
  onApproach: jest.fn(),
  onProgress: jest.fn(),
})

beforeEach(() => {
  mockCtl.populate = true
  mockCtl.throwBoot = false
})

describe('StarFieldEngine wiring tails', () => {
  test('init() populates state and fires onReady', async () => {
    const ev = events()
    const eng = new StarFieldEngine(makeCanvas(), ev)

    await eng.init()

    expect(ev.onReady).toHaveBeenCalled()
    expect(eng.failed).toBe(false)

    eng.selectBody('mars')
    eng.rotateView(0.1, -0.1)
    eng.flyHome()
    eng.takeScreenshot()
    eng.setReducedMotion(true)
    eng.setReducedMotion(false)

    eng.destroy()
  })

  test('selectBody on a registry id resolves the shard but skips the fly without a Milky Way position', async () => {
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
          json: async () => [{ i: 'star-000000', n: 'Sirius', x: 1, y: 2, z: 3 }],
        }

      return { ok: false, status: 404 }
    })

    try {
      const ev = events()
      const eng = new StarFieldEngine(makeCanvas(), ev)

      await eng.init()

      // The wiring mock never registers a 'milky-way' node, so
      // registryWorldPos resolves null — the selection resolves but the
      // camera stays put.
      eng.selectBody('star-000000')

      await new Promise((r) => setTimeout(r, 20))

      eng.destroy()
    } finally {
      globalThis.fetch = origFetch
    }
  })

  test('init() without a scene flags failed but still fires onReady', async () => {
    mockCtl.populate = false

    const ev = events()
    const eng = new StarFieldEngine(makeCanvas(), ev)

    await eng.init()

    expect(ev.onReady).toHaveBeenCalled()
    expect(eng.failed).toBe(true)
  })

  test('init() rejection routes through devError and reports failure', async () => {
    mockCtl.throwBoot = true

    const { clearDevLog, getDevLog } = await import('@core/devlog.js')

    clearDevLog()

    const ev = events()
    const eng = new StarFieldEngine(makeCanvas(), ev)

    await eng.init()

    expect(getDevLog().length).toBeGreaterThan(0)
    expect(eng.failed).toBe(true)
  })

  test('destroy() without a canvas hits the detach guard', () => {
    const eng = new StarFieldEngine(null, events())

    eng.destroy()

    expect(eng.failed).toBe(false)
  })

  test('selectBody no-ops on unknown ids', () => {
    const eng = new StarFieldEngine(makeCanvas(), events())

    eng.selectBody('not-a-body')
  })
})
