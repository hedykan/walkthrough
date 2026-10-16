import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import { kitScript } from "./scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--dark") ? "dark" : "light";

const WIDTH = 720;
const HEIGHT = 500;
const TOP = 10;
const EDITOR = { x: -168, y: -105, w: 336, d: 210, r: 10 };
const INNER = { x: -162, y: -99, w: 324, d: 198, r: 6 };
const TITLE_H = 17;
const STATUS_H = 11;
const ACTIVITY_W = 21;
const PANEL_W = 106;
const TAB_H = 16;
const CONTENT_TOP = INNER.y + TITLE_H;
const CONTENT_BOTTOM = INNER.y + INNER.d - STATUS_H;
const ACTIVITY_X = INNER.x;
const WORK_X = ACTIVITY_X + ACTIVITY_W;
const PANEL_X = INNER.x + INNER.w - PANEL_W;
const CODE_X = WORK_X;
const CODE_W = PANEL_X - CODE_X;

const P = k.fitProjection(
  [...k.boxCorners(EDITOR, -5, TOP + 13)],
  WIDTH,
  HEIGHT,
  { pad: 42, azimuth: 43, elevation: 38 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style = {}) => k.solidSvg(paths, style);
const L = (d, style = {}) => k.lineSvg(d, style);
const D = (points, style = {}) => k.dotsSvg(points, style);
const T = (x, y, z, text, options = {}) => k.faceTextSvg(k.topMatrix([x, y], z, P), text, options);
const slab = (plan, z, h, tone = "mid", extra = {}) => S(k.slabOf(plan, z, h, P, 4, extra.bevel ?? 0.45), { tone, crease: extra.crease ?? "faint", lit: extra.lit });
const rect = (x, y, w, d, r = 1) => ({ x, y, w, d, r });
const button = (id, plan, label, options = {}) => {
  const z = options.z ?? TOP + 1.2;
  const h = options.h ?? 2.2;
  const textX = options.textX ?? plan.x + 4;
  const textY = options.textY ?? plan.y + plan.d * 0.67;
  return `<g class="wt-control" data-control="${id}" tabindex="-1">${slab(plan, z, h, options.tone ?? "mid", { bevel: 0.55 })}${T(textX, textY, z + h + 0.08, label, { size: options.size ?? 4.1, tone: options.textTone ?? "hi", anchor: options.anchor ?? "start" })}</g>`;
};

function editorShell() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(EDITOR, -5, 7, P)}"/>`);
  out.push(S(k.slabOf(EDITOR, -2, 12, P, 10, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(EDITOR, 4.5), TOP, P, 8), { tone: "lo" }));
  const screws = k.corners(EDITOR, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.1, TOP + 0.05, P, 18)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, TOP + 0.05])), { size: 0.48 }));
  return out.join("");
}

function editorChrome() {
  const out = [];
  const title = rect(INNER.x, INNER.y, INNER.w, TITLE_H, 5);
  const status = rect(INNER.x, CONTENT_BOTTOM, INNER.w, STATUS_H, 3);
  const activity = rect(ACTIVITY_X, CONTENT_TOP, ACTIVITY_W, CONTENT_BOTTOM - CONTENT_TOP, 1);
  const code = rect(CODE_X, CONTENT_TOP, CODE_W, CONTENT_BOTTOM - CONTENT_TOP, 1);
  const panel = rect(PANEL_X, CONTENT_TOP, PANEL_W, CONTENT_BOTTOM - CONTENT_TOP, 2);
  out.push(slab(title, TOP + 0.4, 1.3, "lo", { bevel: 0.3 }));
  out.push(slab(activity, TOP + 0.45, 1.1, "lo", { bevel: 0.25 }));
  out.push(slab(code, TOP + 0.4, 0.8, "hi", { bevel: 0.25 }));
  out.push(slab(panel, TOP + 0.5, 1.05, "mid", { bevel: 0.3 }));
  out.push(slab(status, TOP + 0.5, 1.0, "lo", { bevel: 0.25 }));

  out.push(T(INNER.x + 9, INNER.y + 10.8, TOP + 1.85, "walkthrough — customer-service", { size: 4.4, tone: "mid" }));
  out.push(D([
    at([INNER.x + INNER.w - 31, INNER.y + 8.5, TOP + 1.85]),
    at([INNER.x + INNER.w - 22, INNER.y + 8.5, TOP + 1.85]),
    at([INNER.x + INNER.w - 13, INNER.y + 8.5, TOP + 1.85]),
  ], { size: 0.75, tone: "mid" }));
  out.push(T(INNER.x + 8, CONTENT_BOTTOM + 7.2, TOP + 1.65, "main*", { size: 3.8, tone: "hi" }));
  out.push(T(INNER.x + 56, CONTENT_BOTTOM + 7.2, TOP + 1.65, "Ln 168, Col 12", { size: 3.5, tone: "mid" }));
  out.push(T(INNER.x + INNER.w - 43, CONTENT_BOTTOM + 7.2, TOP + 1.65, "UTF-8   Go", { size: 3.5, tone: "mid" }));
  return out.join("");
}

function activityBar() {
  const out = [];
  const icons = ["◇", "⌕", "⑂", "▧", "▷", "◎"];
  icons.forEach((icon, index) => {
    const y = CONTENT_TOP + 8 + index * 21;
    const plan = rect(ACTIVITY_X + 4, y, 13, 13, 2.2);
    const id = index === 4 ? "open" : `activity-${index}`;
    out.push(`<g class="wt-control wt-activity" data-control="${id}">${slab(plan, TOP + 1.6, 2.3, index === 4 ? "hi" : "lo", { bevel: 0.5 })}${T(plan.x + plan.w / 2, plan.y + 9.1, TOP + 4.0, icon, { size: 5.2, tone: index === 4 ? "hi" : "mid", anchor: "middle" })}</g>`);
  });
  return out.join("");
}

function tabs() {
  const out = [];
  const tabs = [
    ["customer.go", 62],
    ["service.go", 57],
    ["repository.go", 68],
  ];
  let x = CODE_X + 3;
  for (const [name, width] of tabs) {
    const plan = rect(x, CONTENT_TOP + 2, width, TAB_H - 4, 1.8);
    out.push(slab(plan, TOP + 1.35, name === "service.go" ? 1.5 : 0.9, name === "service.go" ? "hi" : "lo", { bevel: 0.35 }));
    out.push(T(x + 5, CONTENT_TOP + 10.5, TOP + (name === "service.go" ? 3.0 : 2.35), name, { size: 3.7, tone: name === "service.go" ? "hi" : "mid" }));
    out.push(T(x + width - 8, CONTENT_TOP + 10.5, TOP + (name === "service.go" ? 3.0 : 2.35), "×", { size: 3.8, tone: "lo" }));
    x += width + 2;
  }
  return out.join("");
}

const CODE = [
  [0, "func UpdateCustomer(ctx context.Context, id int64) error {"],
  [1, "customer, err := repo.Find(ctx, id)"],
  [1, "if err != nil { return err }"],
  [1, "if customer.DeletedAt.Valid {"],
  [2, "return ErrCustomerDeleted"],
  [1, "}"],
  [1, "profile := buildProfile(customer)"],
  [1, "if err := syncCRM(ctx, profile); err != nil {"],
  [2, "return fmt.Errorf(\"sync crm: %w\", err)"],
  [1, "}"],
  [1, "return repo.Save(ctx, customer)"],
  [0, "}"],
];
const STEP_ROWS = [[3, 4], [3, 4], [3, 4], [0, 1], [3, 4], [10]];

function codeArea() {
  const out = [];
  const y0 = CONTENT_TOP + TAB_H + 8;
  const row = 11.2;
  const numberX = CODE_X + 8;
  const textX = CODE_X + 21;

  out.push(T(CODE_X + CODE_W - 10, CONTENT_TOP + TAB_H + 1, TOP + 1.55, "│││", { size: 3.2, tone: "faint", anchor: "end" }));
  CODE.forEach(([indent, text], index) => {
    const y = y0 + index * row;
    out.push(T(numberX, y + 5.5, TOP + 1.45, String(157 + index), { size: 3.45, tone: "lo", anchor: "end" }));
    out.push(T(textX + indent * 9, y + 5.5, TOP + 1.5, text, { size: 3.75, tone: index === 3 || index === 4 ? "hi" : "mid" }));
    const barW = Math.min(CODE_W - 30 - indent * 9, 16 + text.length * 2.65);
    out.push(`<g class="wt-code-rail" opacity="${index === 3 || index === 4 ? 0.6 : 0.24}">${slab(rect(textX + indent * 9, y + 7.2, barW, 1.4, 0.6), TOP + 1.35, 0.28, index === 3 || index === 4 ? "hi" : "lo", { bevel: 0.05, crease: "none" })}</g>`);
  });

  STEP_ROWS.forEach((rows, step) => {
    const first = Math.min(...rows);
    const last = Math.max(...rows);
    const plan = rect(CODE_X + 16, y0 + first * row - 1, CODE_W - 24, (last - first + 1) * row - 1, 2.2);
    out.push(`<g class="wt-code-focus" data-code-step="${step}" opacity="0">${slab(plan, TOP + 1.75, 1.0, "hi", { bevel: 0.4 })}${D(rows.map((r) => at([CODE_X + 12, y0 + r * row + 4.5, TOP + 2.9])), { size: 0.7, tone: "hi" })}</g>`);
  });

  const askPlan = rect(CODE_X + CODE_W - 24, y0 + 3 * row + 1, 13, 13, 6.5);
  out.push(`<g class="wt-control" data-control="ask">${slab(askPlan, TOP + 2.6, 2.7, "hi", { bevel: 0.7 })}${T(askPlan.x + 6.5, askPlan.y + 9.2, TOP + 5.45, "+", { size: 6.4, tone: "hi", anchor: "middle" })}</g>`);

  const qa = rect(CODE_X + 61, y0 + 5.5 * row, CODE_W - 76, 47, 4);
  out.push(`<g class="wt-qa" data-qa opacity="0">${slab(qa, TOP + 4.1, 3.6, "hi", { bevel: 0.8 })}${T(qa.x + 7, qa.y + 11, TOP + 7.8, "为什么先判断 deleted_at？", { size: 4.2, tone: "hi" })}${T(qa.x + 7, qa.y + 23, TOP + 7.8, "避免把已删除顾客重新同步到 CRM。", { size: 3.7, tone: "mid" })}${T(qa.x + 7, qa.y + 34, TOP + 7.8, "↳ repository.go:168", { size: 3.6, tone: "hi" })}</g>`);
  return out.join("");
}

function walkthroughPanel() {
  const out = [];
  const x = PANEL_X + 6;
  const w = PANEL_W - 12;
  let y = CONTENT_TOP + 6;

  out.push(T(x, y + 6, TOP + 2.0, "代码走读", { size: 5.0, tone: "hi" }));
  out.push(button("prev", rect(x + w - 29, y - 1, 12, 10, 2), "‹", { size: 4.6, z: TOP + 1.5, h: 1.8, textX: x + w - 23, textY: y + 6.2, anchor: "middle" }));
  out.push(button("next", rect(x + w - 14, y - 1, 14, 10, 2), "›", { size: 4.6, z: TOP + 1.5, h: 1.8, textX: x + w - 7, textY: y + 6.2, anchor: "middle", tone: "hi" }));
  y += 13;

  const range = [
    ["repo", "仓库  customer-service"],
    ["branch", "分支  fix/deleted-customer"],
    ["compare", "对比  origin/main"],
  ];
  range.forEach(([id, text]) => {
    const plan = rect(x, y, w, 10.5, 2);
    out.push(button(id, plan, text, { size: 3.3, z: TOP + 1.55, h: 1.8, textY: y + 7.2 }));
    y += 12;
  });

  const commit = rect(x, y + 0.5, w, 18, 2.2);
  out.push(slab(commit, TOP + 1.4, 1.15, "lo", { bevel: 0.3 }));
  out.push(T(x + 5, y + 7.3, TOP + 2.65, "● 98475290", { size: 3.35, tone: "hi" }));
  out.push(T(x + 5, y + 14.2, TOP + 2.65, "fix deleted customer", { size: 3.15, tone: "mid" }));
  y += 21;

  out.push(button("generate", rect(x, y, w, 13, 3), "生成走读", { size: 4.0, z: TOP + 1.8, h: 2.6, textX: x + w / 2, textY: y + 8.9, anchor: "middle" }));
  y += 17;

  out.push(T(x, y + 3.7, TOP + 1.9, "第 1/5 项 · 当前主线", { size: 3.35, tone: "mid" }));
  y += 7;
  const steps = ["修改原因", "核心思想", "具体场景", "第 1 步 · 入口", "第 2 步 · 判断", "第 3 步 · 落库"];
  steps.forEach((label, index) => {
    const plan = rect(x, y, w, 8.4, 1.8);
    out.push(button(`step-${index}`, plan, label, { size: 3.15, z: TOP + 1.5, h: 1.55, textY: y + 5.9, tone: index < 3 ? "mid" : "lo" }));
    y += 9.5;
  });
  return out.join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "A single isometric code editor showing the Walkthrough extension. Controls rise from the editor surface as the review advances from selecting a branch, through generating a walkthrough, to following code changes and asking a question in place.",
  body: [editorShell(), editorChrome(), activityBar(), tabs(), codeArea(), walkthroughPanel()],
});

const PHASES = [
  { active: ["open"], step: -1, readout: "open · walkthrough view" },
  { active: ["repo", "branch", "compare"], step: -1, readout: "range · 2 commits · 16 files" },
  { active: ["generate"], step: -1, readout: "generate · main → fix/deleted-customer" },
  { active: ["step-0", "next"], step: 0, readout: "reason · prevent deleted customers returning" },
  { active: ["step-1", "next"], step: 1, readout: "idea · reject before building the profile" },
  { active: ["step-2", "next"], step: 2, readout: "scenario · deleted customer is skipped" },
  { active: ["step-3", "next"], step: 3, readout: "step 1 / 3 · service entry" },
  { active: ["step-4", "next"], step: 4, readout: "step 2 / 3 · deletion guard" },
  { active: ["step-5", "next"], step: 5, readout: "step 3 / 3 · repository save" },
  { active: ["ask"], step: 1, readout: "ask · why check deleted_at first?" },
];

const live = `
const P = ${JSON.stringify(P)};
const PHASES = ${JSON.stringify(PHASES)};
const stage = document.querySelector(".iso-stage");
const controls = [...stage.querySelectorAll("[data-control]")];
const focuses = [...stage.querySelectorAll("[data-code-step]")];
const qa = stage.querySelector("[data-qa]");
const readout = document.querySelector("[data-readout]");
const liveStatus = stage.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const liftVector = axisVector(P, [0, 0, 1]);
const states = new Map(controls.map((node) => [node, { lift: 0, hover: 0 }]));
let phase = 0, frame = 0, previous = 0, visible = false;
let touring = !still.matches, tourClock = 0, idleTimer = 0;

function desired(node) {
  const id = node.dataset.control;
  const active = PHASES[phase].active.includes(id);
  const over = node.matches(":hover");
  return (active ? 6.2 : 0) + (over ? 2.0 : 0);
}
function applyPhase(announce = false) {
  const current = PHASES[phase];
  controls.forEach((node) => node.toggleAttribute("data-active", current.active.includes(node.dataset.control)));
  focuses.forEach((node) => {
    const on = Number(node.dataset.codeStep) === current.step;
    node.style.opacity = on ? "0.88" : "0";
    node.toggleAttribute("data-active", on);
  });
  qa.style.opacity = phase === PHASES.length - 1 ? "1" : "0";
  qa.style.pointerEvents = phase === PHASES.length - 1 ? "auto" : "none";
  readout.textContent = current.readout;
  stage.setAttribute("aria-valuenow", String(phase + 1));
  stage.setAttribute("aria-valuetext", "Walkthrough demonstration " + (phase + 1) + " of " + PHASES.length + ": " + current.readout);
  if (announce) liveStatus.textContent = current.readout;
  run();
}
function setPhase(next, announce = true) {
  phase = (next + PHASES.length) % PHASES.length;
  tourClock = 0;
  applyPhase(announce);
}
function tick(now) {
  const dt = previous ? Math.min((now - previous) / 1000, 1 / 30) : 1 / 60;
  previous = now;
  if (touring && !still.matches) {
    tourClock += dt;
    if (tourClock > (phase === 9 ? 3.2 : 2.15)) setPhase(phase + 1, false);
  }
  let moving = touring;
  for (const [node, state] of states) {
    const want = still.matches ? 0 : desired(node);
    state.lift += (want - state.lift) * (1 - Math.exp(-dt / 0.22));
    if (Math.abs(want - state.lift) < 0.01) state.lift = want;
    const x = liftVector[0] * state.lift, y = liftVector[1] * state.lift;
    node.setAttribute("transform", state.lift ? "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ")" : "");
    moving ||= state.lift !== want;
  }
  frame = visible && moving ? requestAnimationFrame(tick) : 0;
}
function run() { if (!frame && visible) { previous = 0; frame = requestAnimationFrame(tick); } }
function takeOver() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!still.matches) { touring = true; tourClock = 0; run(); } }, 7000);
}
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", run);
stage.addEventListener("pointerleave", run);
stage.addEventListener("click", (event) => {
  const node = event.target.closest("[data-control]");
  if (!node) return;
  takeOver();
  const id = node.dataset.control;
  if (id === "next") setPhase(phase + 1);
  else if (id === "prev") setPhase(phase - 1);
  else if (id.startsWith("step-")) setPhase(3 + Number(id.slice(5)));
  else if (["repo", "branch", "compare"].includes(id)) setPhase(1);
  else if (id === "open") setPhase(0);
  else if (id === "generate") setPhase(2);
  else if (id === "ask") setPhase(9);
  stage.focus({ preventScroll: true });
});
stage.addEventListener("keydown", (event) => {
  if (!["ArrowRight", "ArrowLeft", " ", "Enter", "Home", "End", "Escape"].includes(event.key)) return;
  event.preventDefault();
  takeOver();
  if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") setPhase(phase + 1);
  else if (event.key === "ArrowLeft") setPhase(phase - 1);
  else if (event.key === "Home" || event.key === "Escape") setPhase(0);
  else if (event.key === "End") setPhase(PHASES.length - 1);
});
stage.addEventListener("focus", () => { liveStatus.textContent = PHASES[phase].readout; });
still.addEventListener("change", () => { if (still.matches) touring = false; run(); });
applyPhase(false);
`;

const css = `<style>
.wt-control{cursor:pointer;transition:opacity .25s var(--anatomy-ease)}
.wt-control:not([data-active]){opacity:.72}
.wt-control[data-active]{opacity:1}
.wt-control[data-active] .iso-edge{stroke:var(--anatomy-lit);stroke-width:.9px}
.wt-control[data-active] .iso-top{fill:var(--anatomy-lit-top)}
.wt-code-focus,.wt-qa{transition:opacity .5s var(--anatomy-ease)}
.wt-code-focus[data-active] .iso-top{fill:var(--anatomy-lit-top)}
.wt-code-focus[data-active] .iso-edge{stroke:var(--anatomy-lit)}
.wt-qa .iso-top{fill:var(--anatomy-face)}
.iso-face-text{pointer-events:none;user-select:none}
.iso-stage{touch-action:pan-y;cursor:default}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.wt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:520px){.iso-svg{width:114%;margin-left:-7%}}
@media(prefers-reduced-motion:reduce){.wt-code-focus,.wt-qa,.wt-control{transition:none}}
</style>`;

const body = css + k.plateHtml({
  fig: "Fig 1",
  title: "Guided code review",
  hint: "Click the raised controls · ← →",
  readout: PHASES[0].readout,
  keys: [
    { mark: "raised", label: "The control for the next action rises from the editor" },
    { mark: "lit", label: "Only the code for the current walkthrough step comes forward" },
    { mark: "flat", label: "The full change stays in place, dimmed but available" },
  ],
  caption: "One editor, one review path. Choose the change, generate its walkthrough, then move through reason, idea, scenario and call chain. Each step raises only the control and code that matter; select a line to ask why without leaving the editor.",
  body: `<div class="iso-stage" tabindex="0" role="group" aria-roledescription="interactive isometric explanation" aria-label="Guided code review in one editor. Use left and right arrows to move through ten stages." aria-valuemin="1" aria-valuemax="${PHASES.length}" aria-valuenow="1">${svg}<span class="wt-sr" role="status" aria-live="polite" data-status></span></div>`,
});

const name = theme === "dark" ? "walkthrough-editor-dark.html" : "walkthrough-editor.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Guided code review", theme, body, script: kitScript() + live, width: 820 }));
console.log("wrote", name);
