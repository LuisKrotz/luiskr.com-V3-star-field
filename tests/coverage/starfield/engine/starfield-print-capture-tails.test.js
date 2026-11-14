/**
 * @file starfield-print-capture-tails.test.js
 * @description Coverage tails for the star-field bootstrap printcapture
 * answer — the handler armed after shader warmup that repaints one frame
 * through the post chain and writes detail.dataUrl. Every arm runs against
 * the real booted state: the disposed/canvas guards, the
 * renderer-scene-camera triple, the pipeline render + renderer.render
 * fallback, and the outer catch that swallows a toDataURL failure into
 * devWarn.
 */
import { describe, test, expect, jest } from '@jest/globals'

import { PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { getDevLog, clearDevLog } from '@core/devlog.js'
import { LOG_LEVELS } from '@core/tokens/data/log.js'

import { createStarState } from '../../../../engine/state.js'
import { bootstrapStarField } from '../../../../engine/bootstrap.js'

describe('star print capture tails', () => {
  test('onPrintCapture arms after boot and answers with a PNG data URL', async () => {
    const s = createStarState(document.createElement(HTML_TAGS.CANVAS))

    await bootstrapStarField(s)

    expect(s.onPrintCapture).toBeTruthy()

    s.canvas.toDataURL = () => 'data:image/png;base64,SF=='

    const fire = () => {
      const detail = {}

      s.canvas.dispatchEvent(new CustomEvent(PRINT_EVENTS.CAPTURE, { detail }))

      return detail
    }

    // Pipeline repaint → toDataURL lands on detail.
    const pipelineRender = jest.fn()

    s.pipeline = { render: pipelineRender }

    expect(fire().dataUrl).toBe('data:image/png;base64,SF==')
    expect(pipelineRender).toHaveBeenCalled()

    // The disposed guard declines before any repaint.
    s.disposed = true
    expect(fire().dataUrl).toBeUndefined()
    s.disposed = false

    // A null canvas declines the same way — the bound listener still fires
    // on the element, so the state read is what guards.
    const el = s.canvas

    s.canvas = null

    const dead = {}

    el.dispatchEvent(new CustomEvent(PRINT_EVENTS.CAPTURE, { detail: dead }))
    expect(dead.dataUrl).toBeUndefined()

    s.canvas = el

    // Missing renderer / scene / camera skip the repaint but still answer —
    // the buffer's last frame is read as-is.
    const renderer = s.renderer
    const scene = s.scene
    const camera = s.camera

    s.renderer = null
    expect(fire().dataUrl).toBe('data:image/png;base64,SF==')

    s.renderer = renderer
    s.scene = null
    expect(fire().dataUrl).toBe('data:image/png;base64,SF==')

    s.scene = scene
    s.camera = null
    expect(fire().dataUrl).toBe('data:image/png;base64,SF==')

    s.camera = camera

    // A throwing pipeline render falls back to the plain renderer.
    const render = jest.fn()

    s.renderer = { render }
    s.pipeline = {
      render: () => {
        throw new Error('pipeline-boom')
      },
    }

    expect(fire().dataUrl).toBe('data:image/png;base64,SF==')
    expect(render.mock.calls[0][0]).toBe(scene)
    expect(render.mock.calls[0][1]).toBe(camera)

    // No pipeline at all → the else arm renders straight through.
    s.pipeline = null
    render.mockClear()
    expect(fire().dataUrl).toBe('data:image/png;base64,SF==')
    expect(render.mock.calls[0][0]).toBe(scene)
    expect(render.mock.calls[0][1]).toBe(camera)

    // A failing toDataURL lands in devWarn — the still is simply skipped.
    clearDevLog()
    s.canvas.toDataURL = () => {
      throw new Error('canvas-dead')
    }

    expect(fire().dataUrl).toBeUndefined()
    expect(getDevLog().some((e) => e.level === LOG_LEVELS.WARN)).toBe(true)

    s.disposed = true
  }, 30000)
})
