/**
 * @file engine/bodies/mask.ts
 * @description Photo-texture edge feathering for deep-sky billboards.
 * NASA/ESA stills arrive as opaque rectangles — composited raw they show
 * a hard frame over the skybox. `maskPhotoTexture` redraws the source
 * into a capped canvas and multiplies in a radial alpha ramp
 * (`SF_DETAIL.MASK_INNER` → edge), so the object's photograph dissolves
 * into black space exactly like a long-exposure crop. Nebula sprites and
 * galaxy discs both consume the result through normal alpha blending;
 * when no 2d context exists (headless probes) callers keep the raw
 * texture on additive blending, where the photo's black sky adds ~0
 * anyway.
 */
import type * as THREE_NS from 'three'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { CANVAS_STRINGS } from '@core/tokens/strings/canvas.js'
import { WEBGL_STRINGS } from '@core/tokens/strings/webgl.js'
import { SF_COLORS, SF_DETAIL } from '@core/tokens/starfield/params.js'
import { lcg, seedFrom } from '../rand.js'

type ThreeModule = typeof import('three')

/**
 * Returns the intrinsic pixel size of a loaded texture — `image` may be
 * an HTMLImageElement (`naturalWidth`) or any frame source carrying
 * `width`/`height`; both collapse to 0 when unset (teardown mid-load).
 * @param tex Source texture.
 * @returns `[width, height]` in source pixels.
 */
export function photoSize(tex: THREE_NS.Texture): [number, number] {
  const img = tex.image as
    { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number } | undefined

  return [img?.naturalWidth ?? img?.width ?? 0, img?.naturalHeight ?? img?.height ?? 0]
}

/**
 * Composites a loaded photo texture into a square-capped canvas whose
 * alpha fades to zero past `MASK_INNER` of the half-extent. Aspect ratio
 * is preserved inside the canvas (letterboxed with transparent space),
 * so the caller still gets the source's true `w/h` from `photoSize` for
 * non-square scaling. Returns undefined when canvas/2d is unavailable or
 * the texture image never resolved (callers fall back to additive).
 *
 * By default the mask is a smooth radial disc — appropriate for galaxies
 * and face-on discs. For nebulae, `options.lobes` produces a seeded,
 * irregular, wispy boundary so each nebula reads as a gas cloud rather
 * than a flat circular photograph pasted on the sky.
 * @param THREE The three.js module.
 * @param tex Loaded photo texture (`tex.image` must be set).
 * @param options Optional mask shape — `lobes` and `seed` for nebulae.
 * @returns A CanvasTexture with feathered alpha, or undefined.
 */
export function maskPhotoTexture(
  THREE: ThreeModule,
  tex: THREE_NS.Texture,
  options: { lobes?: number; seed?: string } = {}
): THREE_NS.Texture | undefined {
  const [w, h] = photoSize(tex)

  if (!w || !h) return undefined

  // Cap the composite edge so a 6k source doesn't allocate a 6k canvas —
  // the sprite/disc never exceeds a few hundred screen pixels anyway.
  const scale = Math.min(1, SF_DETAIL.MASK_PX / Math.max(w, h))

  const cw = Math.max(1, Math.round(w * scale))

  const ch = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement(HTML_TAGS.CANVAS)

  canvas.width = cw
  canvas.height = ch

  const ctx = canvas.getContext(WEBGL_STRINGS.CONTEXT_2D)

  if (!ctx) return undefined

  ctx.drawImage(tex.image as CanvasImageSource, 0, 0, cw, ch)

  const lobes = options.lobes ?? 0
  const seed = options.seed ?? 'default'

  if (lobes > 0) {
    irregularMask(ctx, cw, ch, lobes, seed)
  } else {
    radialMask(ctx, cw, ch)
  }

  const out = new THREE.CanvasTexture(canvas)

  out.colorSpace = tex.colorSpace

  return out
}

/**
 * Radial alpha ramp: full opacity inside MASK_INNER·half-extent, smooth
 * fade to transparent at the inscribed circle's edge. The corner
 * letterbox stays untouched (already transparent). Using destination-in
 * keeps RGB data but zeroes alpha outward.
 */
function radialMask(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
  const gx = cw / 2

  const gy = ch / 2

  const rOuter = Math.min(gx, gy)

  const grad = ctx.createRadialGradient(gx, gy, rOuter * SF_DETAIL.MASK_INNER, gx, gy, rOuter)

  grad.addColorStop(0, SF_COLORS.GLOW_INNER)
  grad.addColorStop(1, SF_COLORS.GLOW_OUTER)

  ctx.globalCompositeOperation = CANVAS_STRINGS.COMPOSITE_DESTINATION_IN

  ctx.fillStyle = grad

  ctx.fillRect(0, 0, cw, ch)
}

/**
 * Wispy nebula mask — a seeded union of overlapping soft radial lobes
 * so the photograph dissolves with irregular cloud-like edges instead of
 * a perfect circle. Each nebula gets a deterministic shape from its id.
 */
function irregularMask(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  lobes: number,
  seed: string
): void {
  const gx = cw / 2

  const gy = ch / 2

  const rOuter = Math.min(gx, gy)

  // Build the alpha mask on a separate canvas, then punch it into the
  // photo with destination-in. This creates a union of soft lobes.
  const m = document.createElement(HTML_TAGS.CANVAS)

  m.width = cw
  m.height = ch

  const mx = m.getContext(WEBGL_STRINGS.CONTEXT_2D)

  if (!mx) return

  const rand = lcg(seedFrom(seed))

  const drawLobe = (lx: number, ly: number, lr: number, alpha: number): void => {
    const g = mx.createRadialGradient(lx, ly, 0, lx, ly, lr)

    g.addColorStop(0, `rgba(255,255,255,${alpha})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')

    mx.globalCompositeOperation = 'source-over'
    mx.fillStyle = g
    mx.fillRect(0, 0, cw, ch)
  }

  // Central lobe plus lobes scattered near the edge.
  drawLobe(gx, gy, rOuter * SF_DETAIL.MASK_INNER, 1.0)

  for (let i = 0; i < lobes; i++) {
    const angle = rand() * Math.PI * 2
    const dist = rOuter * (0.3 + rand() * 0.55)
    const lr = rOuter * (0.35 + rand() * 0.35)
    const alpha = 0.55 + rand() * 0.35

    drawLobe(gx + Math.cos(angle) * dist, gy + Math.sin(angle) * dist, lr, alpha)
  }

  ctx.globalCompositeOperation = CANVAS_STRINGS.COMPOSITE_DESTINATION_IN
  ctx.drawImage(m, 0, 0)
}
