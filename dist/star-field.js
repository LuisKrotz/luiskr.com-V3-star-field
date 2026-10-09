import { ARIA_ATTRS as e } from "@core/tokens/attrs/aria.js";
import { ATTR_VALUES as t } from "@core/tokens/attrs/values.js";
import { HTML_TAGS as n } from "@core/tokens/elements/html.js";
import { VIEW_TAGS as r } from "@core/tokens/elements/views.js";
import { SF_CLASSES as i } from "@core/tokens/classes/starfield.js";
import { KEYS as a } from "@core/tokens/primitives.js";
import { KEYBOARD_EVENTS as o, MOUSE_EVENTS as s, POINTER_EVENTS as c, WINDOW_EVENTS as l } from "@core/tokens/events/dom.js";
import { Fragment as u, h as d } from "@core/jsx.js";
import { BaseComponent as f } from "@core/Component.js";
import p from "@core/store.js";
import { SF_APPROACH as m, SF_CAMERA as h, SF_COLORS as g, SF_MOTION as _, SF_SCENE as v } from "@core/tokens/starfield/params.js";
import { SF_DATA_BASE as ee, SF_TEXTURES as y } from "@core/tokens/starfield/textures.js";
import { TYPE_STRINGS as te } from "@core/tokens/strings/types.js";
import { webglAllowed as ne } from "@core/utils/canvas/webgl-mode.js";
import { canUseWebGPU as b } from "@core/browser/detect.js";
import { devError as x, devWarn as S } from "@core/devlog.js";
import { WEBGL_STRINGS as re } from "@core/tokens/strings/webgl.js";
import { SF_GROUPS as C, SF_KINDS as w } from "@core/tokens/starfield/kinds.js";
import { NET_STRINGS as T } from "@core/tokens/strings/net.js";
import { STATE_STRINGS as ie } from "@core/tokens/strings/state.js";
import { FORM_ATTRS as E } from "@core/tokens/attrs/form.js";
import { CMS_KEYS as ae } from "@core/tokens/data/cms-keys.js";
import { LOADER_UI_KEYS as oe, NAV_UI_KEYS as se } from "@core/tokens/data/ui-keys.js";
import { APP_IDS as ce } from "@core/tokens/ids/app.js";
import { TRANSLATION_KEYS as D } from "@core/tokens/routes/translation-keys.js";
import { FALLBACK_PAGES as le } from "@core/locale/fallback.js";
import { DATA_ATTRS as ue } from "@core/tokens/attrs/data.js";
import { appText as O } from "@core/locale/ui-text.js";
import { STATE_CLASSES as k } from "@core/tokens/classes/state.js";
import { CHAR_STRINGS as de } from "@core/tokens/strings/chars.js";
import { ANIMATION_DURATIONS as fe } from "@core/tokens/motion/animation.js";
import { LOCALES as A } from "@core/tokens/locales.js";
import { fetchFirebaseDb as j } from "@core/utils/data/db.js";
//#region engine/renderer-setup.ts
async function pe(e, t) {
	if (!ne()) return !1;
	let n = !0;
	if (typeof navigator !== te.UNDEFINED && navigator.gpu && b()) try {
		await navigator.gpu.requestAdapter() && (n = !1);
	} catch {
		n = !0;
	}
	let r = (n) => new t({
		canvas: e.canvas ?? void 0,
		antialias: !0,
		alpha: !1,
		powerPreference: "high-performance",
		forceWebGL: n
	});
	try {
		let t = r(n);
		e.renderer = t, await t.init();
	} catch (t) {
		S("[StarField] WebGPU init failed, falling back to WebGL:", t);
		let n = e.canvas, i = n?.parentNode;
		if (i) {
			let t = n.cloneNode(!0);
			i.replaceChild(t, n), e.canvas = t;
		}
		let a = r(!0);
		e.renderer = a, await a.init();
	}
	return !e.disposed;
}
//#endregion
//#region engine/scene.ts
function me(e) {
	let t = document.createElement(n.CANVAS);
	t.width = 128, t.height = 128;
	let r = t.getContext(re.CONTEXT_2D);
	if (!r) return;
	let i = r.createRadialGradient(64, 64, 0, 64, 64, 64);
	return i.addColorStop(0, g.GLOW_INNER), i.addColorStop(.35, g.GLOW_MID), i.addColorStop(1, g.GLOW_OUTER), r.fillStyle = i, r.fillRect(0, 0, 128, 128), new e.CanvasTexture(t);
}
function he(e, t, n) {
	let r = new t.PerspectiveCamera(h.FOV, (e.canvas?.clientWidth || 1) / (e.canvas?.clientHeight || 1), h.NEAR, h.FAR);
	r.position.set(h.HOME_X, h.HOME_Y, h.HOME_Z), e.camera = r, e.canvas && (e.controls = new n(r, e.canvas), e.controls.enableDamping = !0, e.controls.target.set(h.TARGET_X, h.TARGET_Y, h.TARGET_Z));
}
function ge(e, t, n) {
	let r = new t.Scene();
	if (e.scene = r, n) {
		let e = new t.SphereGeometry(v.SKYBOX_RADIUS, 32, 16), i = new t.MeshBasicMaterial({
			map: n,
			side: t.BackSide
		}), a = new t.Mesh(e, i);
		r.add(a);
	}
	r.add(new t.AmbientLight(g.AMBIENT, 1.6));
	let i = new t.PointLight(g.SUN_LIGHT, 2.2, 0, 0);
	i.position.set(0, 0, 0), r.add(i);
}
//#endregion
//#region engine/bodies-scene.ts
var _e = "bodyId";
function M(e, t, n) {
	let r = new e.SphereGeometry(t.radius, v.SPHERE_SEGMENTS, v.SPHERE_SEGMENTS / 2), i = t.kind === w.STAR || t.kind === w.SYSTEM ? new e.MeshBasicMaterial({
		map: n.get(t.texture ?? ""),
		color: t.color
	}) : new e.MeshStandardMaterial({
		map: n.get(t.texture ?? ""),
		color: t.color
	});
	return new e.Mesh(r, i);
}
function N(e, t, n) {
	let r = new e.SpriteMaterial({
		map: n,
		color: t.color,
		transparent: !0,
		blending: e.AdditiveBlending,
		depthWrite: !1
	}), i = new e.Sprite(r);
	return i.scale.set(t.radius * 2, t.radius * 2, 1), i;
}
function P(e, t, n) {
	let r = t.radius * 2.4, i = new e.PlaneGeometry(r, r), a = new e.MeshBasicMaterial({
		map: n,
		color: t.color,
		transparent: !0,
		side: e.DoubleSide,
		depthWrite: !1
	}), o = new e.Mesh(i, a);
	return o.rotation.x = -Math.PI / 2 + (t.tilt ?? 0), o;
}
function F(e, t, n, r, i) {
	let a = i.get(n);
	if (t.shellRing) {
		let n = new e.RingGeometry(t.radius * 1.35, t.radius * 2.25, v.RING_SEGMENTS), i = new e.MeshBasicMaterial({
			map: a,
			transparent: !0,
			side: e.DoubleSide
		}), o = new e.Mesh(n, i);
		o.rotation.x = -Math.PI / 2 + (t.tilt ?? .3), r.add(o);
		return;
	}
	let o = new e.SphereGeometry(t.radius * 1.06, v.SPHERE_SEGMENTS, v.SPHERE_SEGMENTS / 2), s = new e.MeshBasicMaterial({
		map: a,
		transparent: !0,
		opacity: .65
	});
	r.add(new e.Mesh(o, s));
}
function I(e, t, n) {
	let r = new e.RingGeometry(t.radius * 1.5, t.radius * 2.6, v.RING_SEGMENTS), i = new e.MeshBasicMaterial({
		color: g.ACCRETION,
		transparent: !0,
		opacity: .85,
		side: e.DoubleSide,
		blending: e.AdditiveBlending,
		depthWrite: !1
	}), a = new e.Mesh(r, i);
	a.rotation.x = -Math.PI / 2.4, n.add(a);
}
function ve(e, t, n) {
	let r = [];
	for (let i of t.satellites ?? []) {
		let t = new e.Object3D(), a = new e.SphereGeometry(i.radius, 24, 12), o = new e.MeshBasicMaterial({ color: i.color }), s = new e.Mesh(a, o);
		s.position.x = i.orbit, t.add(s), t.rotation.y = i.phase ?? 0, n.add(t), r.push({
			pivot: t,
			speed: i.speed,
			phase: i.phase ?? 0
		});
	}
	return r;
}
function ye(e, t, n) {
	let r = new e.RingGeometry(n - .08, n + .08, v.ORBIT_SEGMENTS), i = new e.MeshBasicMaterial({
		color: g.ORBIT_LINE,
		transparent: !0,
		opacity: .35,
		side: e.DoubleSide,
		depthWrite: !1
	}), a = new e.Mesh(r, i);
	return a.rotation.x = -Math.PI / 2, a;
}
function be(e, t, n, r, i) {
	for (let a of n) {
		let n = new t.Object3D(), o;
		o = a.kind === w.NEBULA ? N(t, a, i) : a.kind === w.GALAXY ? P(t, a, i) : M(t, a, r), o.userData[_e] = a.id, a.orbit == null ? a.pos && n.position.set(a.pos[0], a.pos[1], a.pos[2]) : (o.position.x = a.orbit, n.rotation.y = a.phase ?? 0), n.add(o), a.tilt && a.kind !== w.GALAXY && (o.rotation.z = a.tilt), a.shellTexture && F(t, a, a.shellTexture, o, r), a.kind === w.BLACK_HOLE && I(t, a, o);
		let s = ve(t, a, o), c = a.parent ? e.anchors.get(a.parent) : e.scene;
		if (c && c.add(n), a.ring && a.orbit != null) {
			let n = ye(t, a, a.orbit);
			c?.add(n), e.rings.push(n);
		}
		let l = {
			def: a,
			pivot: n,
			mesh: o,
			spinner: o,
			satPivots: s
		};
		e.nodes.set(a.id, l), e.anchors.set(a.id, o), e.pickables.push(o);
	}
}
//#endregion
//#region engine/picking.ts
var xe = 8;
function L(e, t, n) {
	let r = e.canvas;
	if (!r || !e.camera || !e.pickables.length) return null;
	let i = r.getBoundingClientRect();
	if (!i.width || !i.height) return null;
	let a = {
		x: (t - i.left) / i.width * 2 - 1,
		y: -((n - i.top) / i.height) * 2 + 1
	}, o = new R();
	return o.setFromCamera(a, e.camera), (o.intersectObjects(e.pickables, !0)?.[0])?.object?.userData?.bodyId ?? null;
}
var R;
function Se(e) {
	R = e;
}
function Ce(e) {
	let t = e.canvas;
	t && (e.onPointerDown = (t) => {
		let n = t;
		e.downXY = {
			x: n.clientX,
			y: n.clientY
		}, e.fly = null;
	}, e.onPointerUp = (t) => {
		let n = t, r = e.downXY;
		if (e.downXY = null, r && Math.hypot(n.clientX - r.x, n.clientY - r.y) > xe) return;
		let i = L(e, n.clientX, n.clientY);
		i && e.onSelect?.(i);
	}, e.onPointerMove = (t) => {
		let n = t, r = L(e, n.clientX, n.clientY);
		r !== e.hoverId && (e.hoverId = r, e.onHover?.(r));
	}, t.addEventListener(c.POINTERDOWN, e.onPointerDown), t.addEventListener(c.POINTERUP, e.onPointerUp), t.addEventListener(c.POINTERMOVE, e.onPointerMove), e.onWheel = () => {
		e.fly = null;
	}, t.addEventListener(s.WHEEL, e.onWheel));
}
//#endregion
//#region engine/fly.ts
var we = (e) => e < .5 ? 4 * e * e * e : 1 - (-2 * e + 2) ** 3 / 2;
function z(e, t, n, r) {
	let i = e.camera;
	if (!i) return;
	let a = i.position.x, o = i.position.y, s = i.position.z, c = a - t.x, l = o - t.y, u = s - t.z, d = Math.hypot(c, l, u);
	d < .001 ? (c = 0, l = n, u = 0) : (c = c / d * n, l = l / d * n + n * .35, u = u / d * n);
	let f = e.controls?.target;
	e.fly = {
		t0: performance.now(),
		fromPos: {
			x: a,
			y: o,
			z: s
		},
		toPos: {
			x: t.x + c,
			y: t.y + l,
			z: t.z + u
		},
		fromTgt: {
			x: f?.x ?? h.TARGET_X,
			y: f?.y ?? h.TARGET_Y,
			z: f?.z ?? h.TARGET_Z
		},
		toTgt: {
			x: t.x,
			y: t.y,
			z: t.z
		},
		done: r
	};
}
function Te(e) {
	let t = e.fly;
	if (!t || !e.camera) return;
	let n = Math.min(1, (performance.now() - t.t0) / _.FLY_MS), r = we(n), i = (e, t) => e + (t - e) * r;
	if (e.camera.position.set(i(t.fromPos.x, t.toPos.x), i(t.fromPos.y, t.toPos.y), i(t.fromPos.z, t.toPos.z)), e.controls && e.controls.target.set(i(t.fromTgt.x, t.toTgt.x), i(t.fromTgt.y, t.toTgt.y), i(t.fromTgt.z, t.toTgt.z)), n >= 1) {
		let n = t.done;
		e.fly = null, n?.();
	}
}
//#endregion
//#region engine/frame.ts
var B, V = null;
function Ee(e) {
	B = e, V = null;
}
function H(e) {
	return !B || !e.getWorldPosition ? {
		x: 0,
		y: 0,
		z: 0
	} : (V ||= new B(), e.getWorldPosition(V));
}
function U(e) {
	if (!e.canvas || !e.renderer || !e.camera) return;
	let t = e.canvas.getRootNode(), n = t instanceof ShadowRoot ? t.host : null, r = n?.clientWidth || e.canvas.parentElement?.clientWidth || window.innerWidth, i = n?.clientHeight || e.canvas.parentElement?.clientHeight || window.innerHeight;
	if (!r || !i) return;
	e.camera.aspect = r / i, e.camera.updateProjectionMatrix();
	let a = e.renderer;
	a.setPixelRatio?.(Math.min(window.devicePixelRatio, 2)), a.setSize?.(r, i);
}
function De(e) {
	if (!e.camera || !e.onApproach) return;
	let t = e.camera.position;
	for (let [n, r] of e.anchors) {
		if (e.approached.has(n)) continue;
		let i = e.nodes.get(n)?.def;
		if (!i) continue;
		let a = H(r);
		Math.hypot(t.x - a.x, t.y - a.y, t.z - a.z) < m.PAD + i.radius * m.SCALE && (e.approached.add(n), e.onApproach(n));
	}
}
function W(e, t) {
	if (e.disposed || e.reduced) return;
	e.animId = requestAnimationFrame((t) => W(e, t));
	let n = (t ?? performance.now()) / 1e3, r = Math.min(.1, Math.max(0, n - e.lastT));
	e.lastT = n, e.t += r;
	for (let t of e.nodes.values()) {
		let n = t.def;
		n.orbit != null && n.speed && (t.pivot.rotation.y = (n.phase ?? 0) + e.t * _.ORBIT_SPEED * n.speed), n.spin && (t.spinner.rotation.y = e.t * _.SPIN_SPEED * n.spin);
		for (let n of t.satPivots) n.pivot.rotation.y = n.phase + e.t * _.ORBIT_SPEED * n.speed;
	}
	Te(e), De(e), e.controls?.update(), e.renderer && e.scene && e.camera && e.renderer.render(e.scene, e.camera);
}
//#endregion
//#region engine/catalog.ts
var Oe = [
	{
		id: "sun",
		name: "Sun",
		kind: w.STAR,
		group: C.SOLAR,
		radius: 12,
		pos: [
			0,
			0,
			0
		],
		texture: y.SUN,
		color: g.EMISSIVE_SUN,
		spin: .05
	},
	{
		id: "mercury",
		name: "Mercury",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: .8,
		orbit: 24,
		speed: 1.6,
		spin: .02,
		texture: y.MERCURY,
		ring: !0,
		phase: .4
	},
	{
		id: "venus",
		name: "Venus",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: 1.6,
		orbit: 31,
		speed: 1.2,
		spin: -.01,
		texture: y.VENUS_SURFACE,
		shellTexture: y.VENUS_ATMOS,
		ring: !0,
		phase: 1.8
	},
	{
		id: "earth",
		name: "Earth",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: 1.7,
		orbit: 39,
		speed: 1,
		spin: 1,
		tilt: .41,
		texture: y.EARTH_DAY,
		ring: !0,
		phase: 3.1
	},
	{
		id: "moon",
		name: "Moon",
		kind: w.MOON,
		group: C.SOLAR,
		radius: .45,
		orbit: 4.5,
		parent: "earth",
		speed: 3.4,
		texture: y.MOON,
		phase: 1.2
	},
	{
		id: "mars",
		name: "Mars",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: 1.1,
		orbit: 47,
		speed: .8,
		spin: .97,
		texture: y.MARS,
		ring: !0,
		phase: 4.4
	},
	{
		id: "ceres",
		name: "Ceres",
		kind: w.DWARF,
		group: C.SOLAR,
		radius: .35,
		orbit: 55,
		speed: .65,
		color: g.CERES,
		ring: !0,
		phase: .9
	},
	{
		id: "jupiter",
		name: "Jupiter",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: 4.4,
		orbit: 66,
		speed: .45,
		spin: 2.4,
		texture: y.JUPITER,
		ring: !0,
		phase: 5.3
	},
	{
		id: "saturn",
		name: "Saturn",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: 3.8,
		orbit: 82,
		speed: .35,
		spin: 2.2,
		tilt: .47,
		texture: y.SATURN,
		shellTexture: y.SATURN_RING,
		shellRing: !0,
		ring: !0,
		phase: 2.2
	},
	{
		id: "uranus",
		name: "Uranus",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: 2.6,
		orbit: 95,
		speed: .28,
		spin: -1.4,
		tilt: 1.71,
		texture: y.URANUS,
		ring: !0,
		phase: 4.9
	},
	{
		id: "neptune",
		name: "Neptune",
		kind: w.PLANET,
		group: C.SOLAR,
		radius: 2.5,
		orbit: 106,
		speed: .22,
		spin: 1.5,
		texture: y.NEPTUNE,
		ring: !0,
		phase: 5.8
	},
	{
		id: "pluto",
		name: "Pluto",
		kind: w.DWARF,
		group: C.SOLAR,
		radius: .5,
		orbit: 116,
		speed: .15,
		color: g.PLUTO,
		ring: !0,
		phase: 1.5
	}
], ke = [
	{
		id: "proxima-centauri",
		name: "Proxima Centauri",
		kind: w.SYSTEM,
		group: C.MILKY_WAY,
		radius: 3,
		pos: [
			290,
			18,
			60
		],
		color: g.PROXIMA_STAR,
		satellites: [{
			radius: .7,
			orbit: 7,
			speed: 1.4,
			color: g.PROXIMA_PLANET
		}]
	},
	{
		id: "alpha-centauri",
		name: "Alpha Centauri",
		kind: w.SYSTEM,
		group: C.MILKY_WAY,
		radius: 3.4,
		pos: [
			330,
			-8,
			-110
		],
		color: g.ALPHA_STAR,
		satellites: [{
			radius: 2.4,
			orbit: 9,
			speed: .5,
			color: g.ALPHA_COMPANION
		}]
	},
	{
		id: "sirius",
		name: "Sirius",
		kind: w.STAR,
		group: C.MILKY_WAY,
		radius: 4,
		pos: [
			380,
			40,
			90
		],
		color: g.SIRIUS,
		spin: .3
	},
	{
		id: "vega",
		name: "Vega",
		kind: w.STAR,
		group: C.MILKY_WAY,
		radius: 3.8,
		pos: [
			420,
			70,
			-60
		],
		color: g.VEGA,
		spin: .4
	},
	{
		id: "betelgeuse",
		name: "Betelgeuse",
		kind: w.STAR,
		group: C.MILKY_WAY,
		radius: 6.5,
		pos: [
			460,
			-30,
			-160
		],
		color: g.BETELGEUSE,
		spin: .1
	},
	{
		id: "trappist-1",
		name: "TRAPPIST-1",
		kind: w.SYSTEM,
		group: C.MILKY_WAY,
		radius: 1.6,
		pos: [
			350,
			-55,
			170
		],
		color: g.TRAPPIST_STAR,
		satellites: [
			{
				radius: .45,
				orbit: 4,
				speed: 1.8,
				color: g.TRAPPIST_PLANET
			},
			{
				radius: .5,
				orbit: 6,
				speed: 1.3,
				color: g.TRAPPIST_PLANET,
				phase: 2.1
			},
			{
				radius: .55,
				orbit: 8,
				speed: .9,
				color: g.TRAPPIST_PLANET,
				phase: 4.2
			}
		]
	},
	{
		id: "sagittarius-a",
		name: "Sagittarius A*",
		kind: w.BLACK_HOLE,
		group: C.MILKY_WAY,
		radius: 4,
		pos: [
			0,
			10,
			-480
		],
		color: g.SAGITTARIUS_A
	}
], Ae = [
	{
		id: "orion-nebula",
		name: "Orion Nebula",
		kind: w.NEBULA,
		group: C.NEBULAE,
		radius: 34,
		pos: [
			480,
			40,
			-280
		],
		color: g.ORION_NEBULA
	},
	{
		id: "eagle-nebula",
		name: "Eagle Nebula",
		kind: w.NEBULA,
		group: C.NEBULAE,
		radius: 40,
		pos: [
			-520,
			80,
			-300
		],
		color: g.EAGLE_NEBULA
	},
	{
		id: "crab-nebula",
		name: "Crab Nebula",
		kind: w.NEBULA,
		group: C.NEBULAE,
		radius: 30,
		pos: [
			-450,
			-60,
			380
		],
		color: g.CRAB_NEBULA
	},
	{
		id: "helix-nebula",
		name: "Helix Nebula",
		kind: w.NEBULA,
		group: C.NEBULAE,
		radius: 26,
		pos: [
			560,
			-20,
			320
		],
		color: g.HELIX_NEBULA
	}
], je = [
	{
		id: "milky-way",
		name: "Milky Way",
		kind: w.GALAXY,
		group: C.GALAXIES,
		radius: 90,
		pos: [
			-260,
			-90,
			-180
		],
		color: g.MILKY_WAY,
		tilt: .9
	},
	{
		id: "andromeda",
		name: "Andromeda Galaxy",
		kind: w.GALAXY,
		group: C.GALAXIES,
		radius: 160,
		pos: [
			-1400,
			300,
			-900
		],
		color: g.ANDROMEDA,
		tilt: .6
	},
	{
		id: "triangulum",
		name: "Triangulum Galaxy",
		kind: w.GALAXY,
		group: C.GALAXIES,
		radius: 80,
		pos: [
			-1250,
			-140,
			700
		],
		color: g.TRIANGULUM,
		tilt: .8
	}
], G = Object.freeze([
	...Oe,
	...ke,
	...Ae,
	...je
]), K = Object.freeze([
	C.SOLAR,
	C.MILKY_WAY,
	C.NEBULAE,
	C.GALAXIES
]);
function q() {
	let e = /* @__PURE__ */ new Map();
	for (let t of G) {
		let n = e.get(t.group) ?? [];
		n.push(t), e.set(t.group, n);
	}
	return e;
}
//#endregion
//#region engine/bootstrap.ts
async function Me(e, t) {
	let n = /* @__PURE__ */ new Set([y.SKYBOX]);
	for (let e of G) e.texture && n.add(e.texture), e.shellTexture && n.add(e.shellTexture);
	let r = new e.TextureLoader(), i = /* @__PURE__ */ new Map(), a = [...n], o = 0;
	return await Promise.all(a.map(async (e) => {
		try {
			let t = await r.loadAsync(e);
			i.set(e, t);
		} catch (t) {
			S("[StarField] texture failed:", e, t);
		}
		o += 1, t.onProgress?.("Loading star charts…", 10 + o / a.length * 70);
	})), i;
}
async function Ne(e, t) {
	let { scene: n, camera: r } = t, i = e;
	try {
		n && r && i.compileAsync && await i.compileAsync(n, r);
	} catch (e) {
		S("[StarField] Shader compile warmup notice:", e);
	}
}
async function Pe(e) {
	let t = await import("three"), { WebGPURenderer: n } = await import("three/webgpu"), { OrbitControls: r } = await import("three/examples/jsm/controls/OrbitControls.js");
	if (e.disposed || (Se(t.Raycaster), Ee(t.Vector3), e.onProgress?.("Initializing renderer…", 5), !await pe(e, n) || !e.renderer)) return;
	he(e, t, r);
	let i = await Me(t, e);
	e.disposed || (ge(e, t, i.get(y.SKYBOX)), e.onProgress?.("Charting the skies…", 84), be(e, t, G, i, me(t)), Ce(e), U(e), e.onResize = () => U(e), window.addEventListener(l.RESIZE, e.onResize), e.onProgress?.("Compiling shaders…", 92), await Ne(e.renderer, e), e.disposed) || (e.reduced || W(e), e.onProgress?.("Ready", 100));
}
//#endregion
//#region engine/screenshot.ts
var Fe = "star-field-screenshot-";
async function Ie(e) {
	if (!(!e.canvas || !e.renderer)) try {
		e.scene && e.camera && e.renderer.render(e.scene, e.camera), await new Promise((e) => requestAnimationFrame(() => e()));
		let t = e.canvas, r = "";
		try {
			r = t.toDataURL(T.IMAGE_PNG);
		} catch (e) {
			S("[StarField] toDataURL fallback:", e);
		}
		if (!r || r === "data:,") {
			let e = await new Promise((e) => t.toBlob(e, T.IMAGE_PNG));
			r = e ? URL.createObjectURL(e) : "";
		}
		if (r) {
			let e = document.createElement(n.A);
			e.style.display = ie.NONE, e.download = `${Fe}${Date.now()}.png`, e.href = r, document.body.appendChild(e), e.click(), setTimeout(() => {
				e.remove(), r.startsWith(T.BLOB_COLON) && URL.revokeObjectURL(r);
			}, 1e3);
		}
	} catch (e) {
		x("[StarField] Screenshot failed:", e);
	}
}
//#endregion
//#region engine/state.ts
function Le(e, t = {}) {
	return {
		canvas: e,
		renderer: null,
		scene: null,
		camera: null,
		controls: null,
		nodes: /* @__PURE__ */ new Map(),
		anchors: /* @__PURE__ */ new Map(),
		pickables: [],
		rings: [],
		approached: /* @__PURE__ */ new Set(),
		fly: null,
		animId: null,
		disposed: !1,
		failed: !1,
		reduced: !1,
		onResize: null,
		onPointerDown: null,
		onPointerMove: null,
		onPointerUp: null,
		onWheel: null,
		downXY: null,
		lastT: 0,
		t: 0,
		hoverId: null,
		selectedId: null,
		onReady: t.onReady,
		onProgress: t.onProgress,
		onSelect: t.onSelect,
		onApproach: t.onApproach,
		onHover: t.onHover
	};
}
//#endregion
//#region starfield-engine.ts
var J = class {
	#e;
	constructor(e, t = {}) {
		this.#e = Le(e, t);
	}
	async init() {
		let e = this.#e;
		try {
			await Pe(e);
		} catch (t) {
			x("[StarField] Bootstrap failed:", t), e.failed = !0;
		}
		e.disposed || (e.scene || (e.failed = !0), e.onReady?.());
	}
	get failed() {
		return this.#e.failed;
	}
	setReducedMotion(e) {
		let t = this.#e;
		t.reduced = e, e ? t.animId &&= (cancelAnimationFrame(t.animId), null) : !t.animId && t.renderer && W(t);
	}
	selectBody(e) {
		let t = this.#e, n = t.anchors.get(e), r = t.nodes.get(e)?.def;
		!n || !r || !t.camera || (t.selectedId = e, z(t, H(n), r.radius * 5 + 14));
	}
	flyHome() {
		let e = this.#e;
		e.selectedId = null, z(e, {
			x: h.TARGET_X,
			y: h.TARGET_Y,
			z: h.TARGET_Z
		}, Math.max(Math.hypot(h.HOME_X, h.HOME_Y, h.HOME_Z), 1));
	}
	takeScreenshot() {
		Ie(this.#e);
	}
	destroy() {
		let e = this.#e;
		e.disposed = !0, e.animId &&= (cancelAnimationFrame(e.animId), null);
		let t = e.canvas;
		t && (e.onPointerDown && t.removeEventListener(c.POINTERDOWN, e.onPointerDown), e.onPointerMove && t.removeEventListener(c.POINTERMOVE, e.onPointerMove), e.onPointerUp && t.removeEventListener(c.POINTERUP, e.onPointerUp), e.onWheel && t.removeEventListener(s.WHEEL, e.onWheel)), e.onResize && window.removeEventListener(l.RESIZE, e.onResize), e.controls?.dispose(), e.renderer?.dispose(), e.renderer = null, e.scene = null, e.camera = null, e.controls = null;
	}
}, Re = le[D.STAR_FIELD], Y = ce.SF_NAV_PANEL;
function ze(e) {
	return /* @__PURE__ */ d("dl", { className: i.SF_FACTS }, (e.facts ?? []).map((e) => /* @__PURE__ */ d("div", {
		key: e.label,
		className: i.SF_FACT
	}, /* @__PURE__ */ d("dt", { className: i.SF_FACT_KEY }, e.label), /* @__PURE__ */ d("dd", { className: i.SF_FACT_VAL }, e.value))));
}
function Be(n) {
	let r = {
		...Re,
		title: O(ae.STAR_FIELD),
		...n.translations ?? {}
	}, a = q(), o = n._dossier, s = o ? r[o.kind] || o.kind : t.EMPTY;
	return /* @__PURE__ */ d(u, null, n._sfFailed && /* @__PURE__ */ d("div", {
		className: i.SF_FALLBACK,
		"aria-hidden": t.TRUE
	}), !n._sfReady && /* @__PURE__ */ d("div", { className: i.SF_LOADER }, /* @__PURE__ */ d("div", { className: i.SF_LOADER_GLOW }), /* @__PURE__ */ d("div", { className: i.SF_LOADER_CONTENT }, /* @__PURE__ */ d("div", { className: i.SF_LOADER_SPINNER }), /* @__PURE__ */ d("span", { className: i.SF_LOADER_PERCENT }, /* @__PURE__ */ d("span", { className: i.SF_LOADER_VAL }, "0"), /* @__PURE__ */ d("span", { className: i.SF_LOADER_SYM }, "%")), /* @__PURE__ */ d("div", { className: i.SF_LOADER_TITLE }, r.systemBoot), /* @__PURE__ */ d("div", { className: i.SF_LOADER_MSG }, O(oe.LOADER_INIT_WEBGPU)), /* @__PURE__ */ d("div", { className: i.SF_LOADER_BAR }, /* @__PURE__ */ d("div", { className: i.SF_LOADER_BAR_FILL })))), /* @__PURE__ */ d("div", { className: i.SF_HUD }, /* @__PURE__ */ d("span", { className: i.SF_HINT }, r.hint), /* @__PURE__ */ d("span", {
		className: i.SF_LIVE,
		role: e.ROLE_STATUS,
		"aria-live": e.POLITE
	}, n._liveText)), /* @__PURE__ */ d("button", {
		className: i.SF_NAV_TOGGLE,
		type: E.BUTTON,
		"aria-expanded": n._navOpen ? t.TRUE : t.FALSE,
		"aria-controls": Y,
		onClick: () => n._toggleNav()
	}, r.explore), /* @__PURE__ */ d("nav", {
		className: `${i.SF_NAV}${n._navOpen ? ` ${i.SF_NAV_OPEN}` : t.EMPTY}`,
		"aria-label": r.explore,
		role: e.ROLE_NAVIGATION
	}, /* @__PURE__ */ d("div", {
		className: i.SF_NAV_PANEL,
		id: Y
	}, /* @__PURE__ */ d("h2", { className: i.SF_NAV_HEADING }, r.explore), K.map((e) => /* @__PURE__ */ d("section", {
		key: e,
		className: i.SF_NAV_GROUP
	}, /* @__PURE__ */ d("h3", { className: i.SF_NAV_GROUP_TITLE }, r[e] || e), /* @__PURE__ */ d("ul", { className: i.SF_NAV_LIST }, (a.get(e) ?? []).map((e) => /* @__PURE__ */ d("li", { key: e.id }, /* @__PURE__ */ d("button", {
		className: `${i.SF_NAV_ITEM}${n._selectedId === e.id ? ` ${i.SF_NAV_ITEM_ACTIVE}` : t.EMPTY}`,
		type: E.BUTTON,
		[ue.DATA_BODY]: e.id,
		onClick: () => n._selectBody(e.id)
	}, e.name)))))))), /* @__PURE__ */ d("aside", {
		className: `${i.SF_PANEL}${n._selectedId ? ` ${i.SF_PANEL_OPEN}` : t.EMPTY}`,
		"aria-live": e.POLITE,
		inert: !n._selectedId
	}, /* @__PURE__ */ d("header", { className: i.SF_PANEL_HEAD }, /* @__PURE__ */ d("h2", { className: i.SF_PANEL_TITLE }, o?.name ?? t.EMPTY), o && /* @__PURE__ */ d("span", { className: i.SF_PANEL_TAG }, s), /* @__PURE__ */ d("button", {
		className: i.SF_PANEL_CLOSE,
		type: E.BUTTON,
		"aria-label": O(se.CLOSE),
		onClick: () => n._closePanel()
	}, "✕")), /* @__PURE__ */ d("div", { className: i.SF_PANEL_BODY }, n._dossierLoading && /* @__PURE__ */ d("p", { className: i.SF_PANEL_LOADING }, r.loading), o && /* @__PURE__ */ d(u, null, /* @__PURE__ */ d("p", { className: i.SF_PANEL_TAGLINE }, o.tagline), ze(o), /* @__PURE__ */ d("p", { className: i.SF_PANEL_HISTORY }, o.history), /* @__PURE__ */ d("p", { className: i.SF_PANEL_SOURCE }, r.source, ": ", o.source)))), /* @__PURE__ */ d("div", { className: i.SF_ACTIONS }, /* @__PURE__ */ d("button", {
		className: i.SF_BTN,
		type: E.BUTTON,
		onClick: () => n._takeScreenshot()
	}, r.screenshot), /* @__PURE__ */ d("button", {
		className: i.SF_BTN,
		type: E.BUTTON,
		onClick: () => n._flyHome()
	}, r.overview)));
}
//#endregion
//#region star/dossier.ts
var X = /* @__PURE__ */ new Map();
function Z(e) {
	let t = X.get(e);
	return t || (t = fetch(`${ee}/${e}.json`).then((t) => t.ok ? t.json() : (S("[StarField] dossier fetch failed:", e, t.status), null)).catch((t) => (x("[StarField] dossier error:", e, t), null)), X.set(e, t)), t;
}
function Ve(e, t) {
	e._selectedId = t, e._dossierLoading = !0, e._dossier = null, e._updateDom(), Z(t).then((n) => {
		e._selectedId === t && (e._dossierLoading = !1, e._dossier = n, e._updateDom());
	});
}
function He(e) {
	Z(e);
}
//#endregion
//#region star/boot.ts
function Ue(e, t, n) {
	let r = e.$(`.${i.SF_LOADER_MSG}`), a = e.$(`.${i.SF_LOADER_VAL}`), o = e.$(`.${i.SF_LOADER_BAR_FILL}`);
	r && (r.textContent = t), a && (a.textContent = String(Math.round(n))), o && (o.style.width = `${n}%`);
}
function We(e) {
	let t = e._getCanvasEl();
	!t || e._engine || e._isInitializing || (e._isInitializing = !0, e._engine = new J(t, {
		onProgress: (t, n) => e._updateLoader(t, n),
		onSelect: (t) => e._selectBody(t),
		onApproach: (e) => He(e),
		onHover: (t) => e._handleHover(t),
		onReady: () => {
			e._isInitializing = !1, e._sfReady = !0, e._sfFailed = e._engine?.failed === !0, e._sfFailed && e._canvasEl?.classList.add(k.IS_FALLBACK), e._engine?.setReducedMotion(p.getters.getReducedMotion()), e._sfFailed && e._updateDom(), e._dismissLoader();
		}
	}), e._engine.init().catch((t) => {
		x("[StarField] Engine init error:", t), e._isInitializing = !1, e._sfReady = !0, e._sfFailed = !0, e._canvasEl?.classList.add(k.IS_FALLBACK), e._updateDom(), e._dismissLoader();
	}));
}
function Ge(e) {
	let t = e.$(`.${i.SF_LOADER}`);
	t && (t.style.opacity = de.ZERO, setTimeout(() => t.remove(), fe.LOADER_FADE_MS));
}
//#endregion
//#region star/i18n.ts
function Ke(e) {
	let t = p.getters.getlang(), n = t?.locale || A.EN;
	e._lastLocale = n;
	let r = `${t.database}${n}${t.pagesPath}${D.STAR_FIELD}`;
	j(r).then((n) => {
		if (n?.exists()) e._applyTranslations(n.val());
		else {
			let n = `${t.database}${A.EN}${t.pagesPath}${D.STAR_FIELD}`;
			j(n).then((t) => {
				t?.exists() && e._applyTranslations(t.val());
			});
		}
	}).catch(x);
}
function qe(e, t) {
	e.translations = t ?? null, e._updateDom();
}
//#endregion
//#region star-field.scss?inline
var Je = ".ttl-xxl,.ttl-xl,.ttl-lg,.ttl-md,.sf-loader-percent,.ttl-sm,.ttl-xs,.sf-panel-title,.sf-nav-heading,.sf-live,.sf-loader-title,.ttl-xxs{font-family:var(--font-primary)}.ttl-xxl{letter-spacing:.313rem;font-size:2.125rem;font-weight:100}@media (width>=767px){.ttl-xxl{letter-spacing:.813rem;font-size:3.438rem}}@media (width>=1023px){.ttl-xxl{letter-spacing:.813rem;font-size:3.438rem}}@media (width>=1679px){.ttl-xxl{letter-spacing:1.313rem;font-size:5.563rem}}@media (width>=2559px){.ttl-xxl{letter-spacing:3.438rem;font-size:9rem}}@media (width>=3839px){.ttl-xxl{font-size:14.563rem}}.ttl-xl{letter-spacing:.313rem;font-size:2.125rem;font-weight:100}@media (width>=767px){.ttl-xl{letter-spacing:.5rem;font-size:2.125rem}}@media (width>=1023px){.ttl-xl{letter-spacing:.813rem;font-size:3.438rem}}@media (width>=2559px){.ttl-xl{letter-spacing:1.313rem;font-size:5.563rem}}.ttl-lg{font-size:1.125rem;font-weight:200}@media (width>=767px){.ttl-lg{font-size:1.313rem}}@media (width>=1023px){.ttl-lg{font-size:2.125rem}}@media (width>=1439px){.ttl-lg{font-size:3.438rem}}@media (width>=1559px){.ttl-lg{font-size:3.438rem}}.ttl-md,.sf-loader-percent{letter-spacing:.5rem;font-size:1.313rem;font-weight:200}@media (width>=767px){.ttl-md,.sf-loader-percent{font-size:2.125rem}}.ttl-sm{letter-spacing:.125rem;font-size:.813rem;font-weight:200}@media (width>=767px){.ttl-sm{letter-spacing:.188rem;font-size:1.313rem}}@media (width>=2559px){.ttl-sm{letter-spacing:.313rem;font-size:2.125rem}}.ttl-xs,.sf-panel-title,.sf-nav-heading,.sf-live,.sf-loader-title{font-size:.813rem;font-weight:200}@media (width>=2559px){.ttl-xs,.sf-panel-title,.sf-nav-heading,.sf-live,.sf-loader-title{font-size:1.313rem}}.ttl-xxs{text-transform:uppercase;font-size:.813rem;font-weight:200}@media (width>=2559px){.ttl-xxs{font-size:.813rem}}.txt-lg,.txt-md,.txt-sm,.sf-panel-history,.sf-panel-tagline,.sf-loader-sym,.txt-xs,.sf-fact-val,.sf-fact-key,.sf-panel-source,.sf-panel-loading,.sf-panel-tag,.sf-nav-group-title,.sf-hint,.sf-loader-msg{font-family:var(--font-primary)}.txt-lg{font-size:1.313rem;font-weight:100}@media (width>=1023px){.txt-lg{font-size:2.125rem}}.txt-md{font-size:.813rem;font-weight:100;line-height:1.313rem}@media (width>=1679px){.txt-md{font-size:1.313rem;line-height:2.125rem}}@media (width>=2559px){.txt-md{font-size:2.125rem;line-height:3.438rem}}.txt-sm,.sf-panel-history,.sf-panel-tagline,.sf-loader-sym{font-size:.813rem;font-weight:100;line-height:1.313rem}@media (width>=2559px){.txt-sm,.sf-panel-history,.sf-panel-tagline,.sf-loader-sym{font-size:1.313rem;line-height:2.125rem}}.txt-xs,.sf-fact-val,.sf-fact-key,.sf-panel-source,.sf-panel-loading,.sf-panel-tag,.sf-nav-group-title,.sf-hint,.sf-loader-msg{font-size:.5rem;font-weight:100;line-height:.813rem}@media (width>=2559px){.txt-xs,.sf-fact-val,.sf-fact-key,.sf-panel-source,.sf-panel-loading,.sf-panel-tag,.sf-nav-group-title,.sf-hint,.sf-loader-msg{font-size:.813rem;line-height:1.313rem}}.ttl-special{font-family:var(--font-primary);font-weight:100}button{user-select:none;-webkit-tap-highlight-color:transparent;background-color:#0000;border:none;outline:none;padding:0}.max-area{width:100%;height:100%;position:relative}@keyframes lk-link-line-cycle{0%{transform-origin:100%;transform:scaleX(1)}42%{transform-origin:100%;transform:scaleX(0)}50%{transform-origin:0;transform:scaleX(0)}92%,to{transform-origin:0;transform:scaleX(1)}}.sf-btn,.sf-nav-item,.sf-nav-toggle{cursor:pointer;border-bottom:.063rem solid;transition:border-bottom-color .3s;position:relative}.sf-btn:after,.sf-nav-item:after,.sf-nav-toggle:after{content:\"\";inset-inline:0;transform-origin:0;pointer-events:none;background:currentColor;height:.063rem;position:absolute;bottom:-.063rem;transform:scaleX(0)}.sf-btn:visited,.sf-nav-item:visited,.sf-nav-toggle:visited{border-bottom-color:var(--grey)}.sf-btn:hover,.sf-nav-item:hover,.sf-nav-toggle:hover,.sf-btn:focus-visible,.sf-nav-item:focus-visible,.sf-nav-toggle:focus-visible{border-bottom-color:#0000}.sf-btn:hover:after,.sf-nav-item:hover:after,.sf-nav-toggle:hover:after,.sf-btn:focus-visible:after,.sf-nav-item:focus-visible:after,.sf-nav-toggle:focus-visible:after{animation:1.8s cubic-bezier(.65,0,.35,1) infinite lk-link-line-cycle}@media (prefers-reduced-motion:reduce){.sf-btn:hover,.sf-nav-item:hover,.sf-nav-toggle:hover,.sf-btn:focus-visible,.sf-nav-item:focus-visible,.sf-nav-toggle:focus-visible{border-bottom-color:currentColor}.sf-btn:hover:after,.sf-nav-item:hover:after,.sf-nav-toggle:hover:after,.sf-btn:focus-visible:after,.sf-nav-item:focus-visible:after,.sf-nav-toggle:focus-visible:after{animation:none}}:root{--color-white-raw:#fff;--color-black-raw:#262626;--color-grey-raw:#a79e9e;--color-grey-2-raw:#f0f0f0;--color-grey-3-raw:#515151;--color-blue-raw:#006ca6;--color-accent:#66fcf1;--color-accent-hover:#45a29e;--color-accent-contrast:#0f8a84;--focus-ring:var(--color-accent-contrast);--bg-darkest:#0b0c10;--bg-primary:#fff;--bg-secondary:#f7f7f7;--bg-dark:#262626;--bg-darker:#161616;--text-primary:#262626;--text-secondary:#515151;--text-muted:#545454;--text-muted-on-dark:#b8b8b8;--border-color:#e2e2e2;--border-item:transparent;--border-item-hover:#ffffff38;--border-item-featured:#ffffff29;--btn-accent-fill:#0000000d;--glass-bg:#fffffff0;--menu-bg:#eaf4f9;--menu-ink:#0f5270;--menu-ink-2:#5cb9d8;--bg-glow:radial-gradient(ellipse 55% 45% at 18% 22%, color-mix(in srgb, var(--menu-bg) 70%, transparent) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 82% 78%, color-mix(in srgb, var(--menu-ink-2) 14%, transparent) 0%, transparent 70%), radial-gradient(ellipse 40% 55% at 55% 45%, color-mix(in srgb, var(--bg-secondary) 85%, transparent) 0%, transparent 70%);--shadow-card:0 0 0 .0625rem #0000000f, 0 .125rem .75rem #0000001a;--shadow-card-featured:0 0 0 .0625rem #0000001a, 0 .5rem 1.75rem #00000038;--shadow-card-hover:0 0 0 .0625rem #00000026, 0 1.25rem 3.125rem #00000073;--white:#fff;--black:#262626;--grey:#a79e9e;--grey-2:#f0f0f0;--grey-3:#515151;--blue:#006ca6;--skel-ink:var(--text-primary);--skel-bg-1:color-mix(in srgb, var(--bg-secondary) 93%, var(--bg-dark) 7%);--skel-bg-2:color-mix(in srgb, var(--bg-secondary) 83%, var(--bg-dark) 17%);--skel-bg-3:var(--skel-bg-1);--skel-line:1lh;--space-none:0;--space-hairline:1;--space-pixel:1;--space-3xs:1;--space-2xs:2;--space-xs:3;--space-sm:5;--space-md:8;--space-lg:13;--space-xl:21;--space-2xl:34;--space-3xl:55;--space-4xl:89;--space-5xl:144;--space-6xl:233;--space-7xl:377;--space-8xl:610;--space-9xl:987;--space-10xl:1597;--radius-none:0;--radius-hairline:.063rem;--radius-2xs:.125rem;--radius-xs:.188rem;--radius-sm:.313rem;--radius-md:.5rem;--radius-lg:.813rem;--radius-xl:1.313rem;--radius-full:50%;--radius-round:9999px;--z-overlay:200;--z-hud:500;--z-modal:1000;--z-cookies:1000;--z-nav:1100;--z-top:9999;--cookie-banner-h:0px;--font-mono:ui-monospace, SF Mono, SFMono-Regular, Cascadia Mono, Segoe UI Mono, Ubuntu Mono, Roboto Mono, monospace;--font-primary:\"Raleway\", sans-serif;--bg-1:var(--bg-primary);--bg-2:var(--bg-secondary);--bg-d:var(--bg-dark);--bg-dr:var(--bg-darker);--tx-1:var(--text-primary);--tx-2:var(--text-secondary);--tx-m:var(--text-muted);--bd-c:var(--border-color);--sp-xs:var(--space-xs);--sp-sm:var(--space-sm);--sp-md:var(--space-md);--sp-lg:var(--space-lg);--sp-xl:var(--space-xl);--r-sm:var(--radius-sm);--r-md:var(--radius-md);--filament-glow:none;--metallic-hairline:linear-gradient(90deg, transparent 0%, #ffffff40 20%, #37a7d473 50%, #ffffff40 80%, transparent 100%)}html.dark-mode{color-scheme:dark;--bg-primary:#000;--bg-secondary:#030302;--bg-dark:#040404;--bg-dark-alpha:#262626eb;--bg-darker:#1e1d1d;--bg-darkest:#020202;--text-primary:#fff;--text-secondary:#e2e8f0;--text-muted:#b8b1ac;--border-color:#ffffff24;--color-accent-contrast:#66fcf1;--btn-accent-fill:#ffffff14;--glass-bg:#0b0c10eb;--menu-bg:var(--bg-darkest);--menu-ink:var(--text-primary);--menu-ink-2:var(--text-primary);--filament-glow:radial-gradient(circle at 50% 30%, #5fdaff0d 0%, #28f4ff04 50%, transparent 80%);--bg-glow:radial-gradient(ellipse 55% 45% at 18% 22%, #5fdaff0a 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 82% 78%, #28f4ff06 0%, transparent 70%);--metallic-hairline:linear-gradient(90deg, transparent 0%, #ffffff40 20%, #37a7d473 50%, #ffffff40 80%, transparent 100%);--shadow-card:0 0 0 .0625rem #ffffff1f, 0 .125rem 1rem #00000073;--shadow-card-featured:0 0 0 .0625rem #ffffff2e, 0 .5rem 2rem #000000a6;--shadow-card-hover:0 0 0 .0625rem #ffffff47, 0 1.25rem 3.125rem #000000d9;--white:#0a0b10;--black:#fff;--grey:#b2b4b7;--grey-2:#abacac;--grey-3:#cbd5e1;--skel-ink:var(--text-primary);--skel-bg-1:color-mix(in srgb, var(--bg-secondary) 93%, var(--color-white-raw) 7%);--skel-bg-2:color-mix(in srgb, var(--bg-secondary) 83%, var(--color-white-raw) 17%);--skel-bg-3:var(--skel-bg-1)}html{color-scheme:light;background-color:var(--bg-primary);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;scrollbar-color:var(--border-color) transparent;scrollbar-width:thin;min-height:100%;overflow:hidden scroll}html.modal-open{overflow-y:hidden}body{background-color:var(--bg-primary);width:100%;min-height:100vh;color:var(--text-primary);font-family:var(--font-primary);word-break:normal;overflow-wrap:normal;hyphens:none;margin:0;padding:0;transition:background-color .3s,color .3s;overflow-x:hidden}body:before{content:\"\";z-index:-1;background:var(--bg-glow);pointer-events:none;animation:46s ease-in-out infinite alternate body-glow-drift;position:fixed;inset:-25%}@keyframes body-glow-drift{0%{transform:translate(0,0)scale(1)}50%{transform:translate(2.5%,-2%)scale(1.06)}to{transform:translate(-2%,2.5%)scale(1.03)}}#app{z-index:1;background:0 0;width:100%;min-height:100vh;position:relative}q,h1,h2,h3,h4,h5,h6,p,span,a,label,ul,ol,figure,video,image,iframe,picture,blockquote{margin:0;padding:0}ul,ol{list-style:none}a{vertical-align:baseline;color:inherit;cursor:pointer;background:0 0;font-size:100%;text-decoration:none}app-root,view-home,view-project,view-legal,view-not-found,view-admin-login,view-cms-dashboard,app-nav,home-mosaic,about-section,contact-section,awards-mentions,awards-carousel,custom-carousel,preferences-modal,lang-dialog,cookie-banner,portfolio-related,media-figure,media-expanded{display:block}draw-text{display:inline}main{padding-bottom:var(--cookie-banner-h)}.modal-open main{top:var(--modal-top,0px);width:100%;position:fixed;left:0}#main{min-height:100vh}#home,#about,#contact{width:100%;position:relative}@media (width>=1023px){#home{min-height:100vh}}@keyframes skeleton-shimmer{0%{transform:translate(-100%)}to{transform:translate(100%)}}.skeleton--shimmer,.skeleton--footer-note-2,.skeleton--footer-note-1,.skeleton--footer-link,.skeleton--badge,.skeleton--para-65,.skeleton--para-98,.skeleton--para-94,.skeleton--para-full,.skeleton--section-title,.skeleton--title-md,.skeleton--title-sm,.skeleton--tag,.skeleton--text-line,.skeleton--media,.skeleton--hero,.skeleton--title,.skeleton-cover,.skeleton-placeholder{background:var(--skel-bg-1);color:#0000;user-select:none;position:relative;overflow:hidden}.skeleton--shimmer:before,.skeleton--footer-note-2:before,.skeleton--footer-note-1:before,.skeleton--footer-link:before,.skeleton--badge:before,.skeleton--para-65:before,.skeleton--para-98:before,.skeleton--para-94:before,.skeleton--para-full:before,.skeleton--section-title:before,.skeleton--title-md:before,.skeleton--title-sm:before,.skeleton--tag:before,.skeleton--text-line:before,.skeleton--media:before,.skeleton--hero:before,.skeleton--title:before,.skeleton-cover:before,.skeleton-placeholder:before{content:\"\";background:linear-gradient(105deg, transparent 30%, var(--skel-bg-2) 45%, var(--skel-bg-2) 55%, transparent 70%);will-change:transform;pointer-events:none;animation:1.8s linear infinite skeleton-shimmer;position:absolute;inset:0;transform:translate(-100%)}.skeleton--title{border-radius:.125rem;width:45%;max-width:30rem;height:1.5rem;margin-bottom:.5rem;display:block}@media (width>=767px){.skeleton--title{height:2.25rem}}@media (width>=1023px){.skeleton--title{height:3.5rem}}.skeleton--hero{aspect-ratio:16/7;border-radius:.813rem;width:100%;display:block}.skeleton--media{border-radius:.813rem;width:100%;height:100%;min-height:12.5rem;display:block}.skeleton--text-block{flex-direction:column;gap:.313rem;width:100%;padding:.188rem 0;display:flex}.skeleton--text-line{border-radius:.125rem;height:1.125rem}@media (width>=767px){.skeleton--text-line{height:1.313rem}}.skeleton--tag{border-radius:1.313rem;width:6.875rem;height:2.25rem;display:inline-block}.skeleton--title-sm{border-radius:.125rem;width:35%;height:1em;display:inline-block}.skeleton--title-md{border-radius:.125rem;width:45%;height:1em;display:inline-block}.skeleton--section-title{width:55%;height:calc(var(--skel-line) * 2);border-radius:.125rem;display:block}.skeleton--para-full{width:100%;height:calc(var(--skel-line) * 3);border-radius:.125rem;display:block}.skeleton--para-94{width:94%;height:calc(var(--skel-line) * 2);border-radius:.125rem;display:block}.skeleton--para-98{width:98%;height:calc(var(--skel-line) * 3);border-radius:.125rem;display:block}.skeleton--para-65{width:65%;height:calc(var(--skel-line) * 2);border-radius:.125rem;display:block}.skeleton--badge{border-radius:50%;width:3.438rem;height:3.438rem;margin:0 .5rem;display:inline-block}.skeleton--footer-link{border-radius:.063rem;width:3.438rem;height:1em;display:inline-block}.skeleton--footer-note-1{border-radius:.125rem;width:90%;height:.813rem;margin-top:.813rem;margin-bottom:.313rem;display:block}.skeleton--footer-note-2{border-radius:.125rem;width:75%;height:.813rem;display:block}.skeleton-layer{pointer-events:none;z-index:2;position:absolute;top:0;left:0}.skeleton-layer--resolving{z-index:-1}.skeleton-content-in>*{animation:.45s cubic-bezier(.22,1,.36,1) skeleton-content-in}:host(.has-skeleton-layer){isolation:isolate;position:relative}:host(.has-skeleton-layer) [data-content] [class*=skeleton]{opacity:0}@keyframes skeleton-content-in{0%{opacity:0}to{opacity:1}}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,[role=button]:focus-visible,[role=switch]:focus-visible,[role=slider]:focus-visible,[tabindex]:not([tabindex=\"-1\"]):focus-visible{outline:.125rem solid var(--focus-ring);outline-offset:.125rem}:host{background:var(--bg-darkest);width:100%;height:100vh;min-height:100dvh;display:block;position:relative;overflow:hidden}.sf-canvas{z-index:0;width:100%;height:100%;display:block;position:absolute;inset:0}.sf-canvas.is-fallback{visibility:hidden}.sf-fallback{z-index:0;pointer-events:none;background:radial-gradient(ellipse 70% 45% at 30% 40%, #006ca638 0%, transparent 70%), radial-gradient(ellipse 50% 35% at 75% 65%, #006ca629 0%, transparent 70%), radial-gradient(circle at center, #006ca63d 0%, #262626eb 62%, var(--bg-darkest) 100%);position:absolute;inset:0}@keyframes sf-spin{to{rotate:360deg}}.sf-loader{z-index:50;color:var(--color-white-raw);font-family:var(--font-mono);pointer-events:auto;background-color:var(--bg-darkest);flex-direction:column;justify-content:center;align-items:center;transition:opacity .8s ease-in-out,filter .8s ease-in-out;display:flex;position:absolute;inset:0;overflow:hidden}.sf-loader-glow{background:radial-gradient(circle,#006ca659 0%,#262626e6 60%,#262626 100%);position:absolute;inset:0}.sf-loader-content{z-index:10;flex-direction:column;align-items:center;display:flex;position:relative}.sf-loader-spinner{border-radius:var(--radius-round);border:1px solid #ffffff1a;border-top-color:#fffc;width:38.125rem;height:38.125rem;margin-bottom:3.438rem;animation:8s linear infinite sf-spin}.sf-loader-percent{letter-spacing:.1em;color:#ffffffe6;margin-bottom:.813rem;font-weight:300}.sf-loader-sym{color:#fff6;margin-left:.125rem}.sf-loader-title{letter-spacing:.3em;text-transform:uppercase;color:#fff6;margin-bottom:.188rem}.sf-loader-msg{letter-spacing:.1em;color:#fffc;height:.813rem;line-height:.813rem}.sf-loader-bar{border-radius:var(--radius-round);background:#ffffff1f;width:99.813rem;height:.125rem;margin-top:1.313rem;overflow:hidden}.sf-loader-bar-fill{border-radius:var(--radius-round);background:#ffffffd9;width:0%;height:100%;transition:width .3s ease-out}.sf-hud{z-index:20;pointer-events:none;text-align:center;flex-direction:column;align-items:center;gap:.125rem;display:flex;position:absolute;top:1.313rem;left:50%;translate:-50%}.sf-hint{color:#ffffff80;letter-spacing:.08em}.sf-live{color:#ffffffe6;letter-spacing:.12em;text-transform:uppercase;min-height:.813rem}.sf-nav-toggle{z-index:30;font-family:var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:#ffffffd9;backdrop-filter:blur(.188rem);border-radius:var(--radius-sm);cursor:pointer;background:#26262666;border:1px solid #ffffff24;padding:.313rem .813rem;font-size:.5rem;position:absolute;top:1.313rem;left:1.313rem}.sf-nav{z-index:40;pointer-events:none;width:min(199.625rem,82vw);transition:translate .45s cubic-bezier(.22,1,.36,1);position:absolute;top:0;bottom:0;left:0;translate:-100%}.sf-nav--open{pointer-events:auto;translate:0}.sf-nav-panel{backdrop-filter:blur(.5rem);background:#262626b8;border-right:1px solid #ffffff1a;height:100%;padding:3.438rem 1.313rem 1.313rem;overflow-y:auto}.sf-nav-heading{letter-spacing:.3em;text-transform:uppercase;color:#ffffff73;margin:0 0 1.313rem}.sf-nav-group{margin-bottom:1.313rem}.sf-nav-group-title{letter-spacing:.2em;text-transform:uppercase;color:#ffffff8c;margin:0 0 .313rem}.sf-nav-list{margin:0;padding:0;list-style-type:none}.sf-nav-item{text-align:left;width:100%;font-family:var(--font-mono);color:#fffc;cursor:pointer;background:0 0;border:none;padding:.313rem .188rem;font-size:.5rem;display:block}.sf-nav-item--active{color:var(--color-white-raw)}.sf-panel{z-index:40;pointer-events:none;backdrop-filter:blur(.5rem);color:#ffffffd9;background:#262626b8;border-left:1px solid #ffffff1a;flex-direction:column;width:min(199.625rem,88vw);transition:translate .45s cubic-bezier(.22,1,.36,1);display:flex;position:absolute;top:0;bottom:0;right:0;translate:100%}.sf-panel--open{pointer-events:auto;translate:0}.sf-panel-head{border-bottom:1px solid #ffffff14;align-items:center;gap:.5rem;padding:1.313rem 1.313rem .813rem;display:flex}.sf-panel-title{letter-spacing:.18em;text-transform:uppercase;color:var(--color-white-raw);flex:1;margin:0}.sf-panel-tag{letter-spacing:.14em;text-transform:uppercase;color:#ffffff80;border-radius:var(--radius-round);border:1px solid #ffffff2e;padding:.125rem .313rem}.sf-panel-close{font-family:var(--font-mono);color:#ffffffb3;cursor:pointer;background:0 0;border:none;padding:.125rem .313rem;font-size:.813rem}.sf-panel-body{flex:1;padding:1.313rem;overflow-y:auto}.sf-panel-loading{color:#ffffff80;letter-spacing:.1em}.sf-panel-tagline{color:#ffffffbf;margin:0 0 1.313rem}.sf-panel-history{color:#fffc;margin:1.313rem 0;line-height:1.7}.sf-panel-source{color:#fff6;letter-spacing:.06em}.sf-facts{flex-direction:column;gap:.125rem;margin:0;display:flex}.sf-fact{border-bottom:1px solid #ffffff12;justify-content:space-between;gap:.5rem;padding:.188rem 0;display:flex}.sf-fact-key{color:#ffffff80;letter-spacing:.06em;text-transform:uppercase;margin:0}.sf-fact-val{color:#ffffffe6;text-align:right;margin:0}.sf-actions{z-index:30;gap:.313rem;display:flex;position:absolute;bottom:1.313rem;right:1.313rem}.sf-btn{font-family:var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:#ffffffd9;backdrop-filter:blur(.188rem);border-radius:var(--radius-sm);cursor:pointer;background:#26262666;border:1px solid #ffffff24;padding:.313rem .813rem;font-size:.313rem}@media (width<=767px){.sf-nav,.sf-panel{width:100%}.sf-hud{width:90%;top:auto;bottom:3.438rem}.sf-nav-toggle{top:.5rem;left:.5rem}.sf-actions{flex-direction:column;bottom:.5rem;right:.5rem}}", Q = new Map([...q().values()].flat().map((e) => [e.id, e.name])), $ = class extends f {
	_engine = null;
	_canvasEl = null;
	_isInitializing = !1;
	_sfReady = !1;
	_sfFailed = !1;
	_navOpen = !1;
	_selectedId = null;
	_dossier = null;
	_dossierLoading = !1;
	_liveText = "";
	_lastLocale = null;
	translations = null;
	_onKeyDown = null;
	constructor() {
		super(Je);
	}
	_getCanvasEl() {
		return this._canvasEl || (this._canvasEl = document.createElement(n.CANVAS), this._canvasEl.className = i.SF_CANVAS, this._canvasEl.setAttribute(e.ARIA_HIDDEN, t.TRUE)), this._canvasEl;
	}
	onMounted() {
		this.subscribe(p);
		let e = this._getCanvasEl();
		this.shadowRoot && !this.shadowRoot.contains(e) && this.shadowRoot?.insertBefore(e, this._contentNode), this._loadTranslations(), this._initEngine(), this._bindKeys();
	}
	onUpdated() {
		let e = this._getCanvasEl();
		this.shadowRoot && !this.shadowRoot.contains(e) && this.shadowRoot?.insertBefore(e, this._contentNode), !this._engine && !this._isInitializing && this._initEngine();
	}
	onDestroy() {
		this._engine?.destroy(), this._engine = null, this._canvasEl = null, this._isInitializing = !1, this._sfReady = !1, this._sfFailed = !1, this._onKeyDown &&= (this.removeEventListener(o.KEYDOWN, this._onKeyDown), null);
	}
	onStoreUpdate() {
		let e = p.getters.getLang();
		this._lastLocale && this._lastLocale !== e && this._loadTranslations();
	}
	_loadTranslations() {
		Ke(this);
	}
	_applyTranslations(e) {
		qe(this, e);
	}
	_updateLoader(e, t) {
		Ue(this, e, t);
	}
	_initEngine() {
		We(this);
	}
	_dismissLoader() {
		Ge(this);
	}
	_bindKeys() {
		this._onKeyDown || (this._onKeyDown = (e) => {
			e.key === a.ESCAPE && (this._selectedId ? this._closePanel() : this._navOpen && this._toggleNav());
		}, this.addEventListener(o.KEYDOWN, this._onKeyDown));
	}
	_toggleNav() {
		this._navOpen = !this._navOpen, this._updateDom();
	}
	_selectBody(e) {
		this._engine?.selectBody(e), Ve(this, e), this._announce(e);
	}
	_closePanel() {
		this._selectedId = null, this._dossier = null, this._dossierLoading = !1, this._updateDom();
	}
	_takeScreenshot() {
		this._engine?.takeScreenshot();
	}
	_flyHome() {
		this._engine?.flyHome();
	}
	_handleHover(e) {
		let t = e ? Q.get(e) ?? "" : "";
		if (t === this._liveText) return;
		this._liveText = t;
		let n = this.$(`.${i.SF_LIVE}`);
		n && (n.textContent = t);
	}
	_announce(e) {
		let t = Q.get(e) ?? "";
		this._liveText = t;
		let n = this.$(`.${i.SF_LIVE}`);
		n && (n.textContent = t);
	}
	render() {
		return Be(this);
	}
};
customElements.get(r.VIEW_STAR_FIELD) || customElements.define(r.VIEW_STAR_FIELD, $);
//#endregion
//#region index.ts
/* istanbul ignore file */
//#endregion
export { G as SF_CATALOG, K as SF_GROUP_ORDER, $ as StarField, J as StarFieldEngine, q as sfCatalogByGroup };
