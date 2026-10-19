import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import { kitScript } from "./scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--dark") ? "dark" : "light";

const WIDTH = 920;
const HEIGHT = 570;
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
  { pad: 22, azimuth: 90, elevation: 70 },
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
  out.push(T(x + 5, y + 7.3, TOP + 2.65, "● 5d3a7e19", { size: 3.35, tone: "hi" }));
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
  { active: ["open"], step: -1, eyebrow: "进入走读", title: "打开代码走读", description: "从编辑器侧边栏进入一次结构化走读。先建立阅读入口，不必在十几个改动文件里猜从哪里开始。", readout: "打开 · 代码走读视图" },
  { active: ["repo", "branch", "compare"], step: -1, eyebrow: "确定范围", title: "选择要审的改动", description: "确认仓库、目标分支和对比基准。这次走读覆盖 2 个提交、16 个文件，后续所有说明都来自这个范围。", readout: "范围 · 2 个提交 · 16 个文件" },
  { active: ["generate"], step: -1, eyebrow: "建立主线", title: "生成一条阅读路径", description: "AI 不替你做 Review，而是先把改动整理成可以理解的顺序：为什么改、怎么改，以及应该沿哪条调用链验证。", readout: "生成 · main → fix/deleted-customer" },
  { active: ["step-0", "next"], step: 0, eyebrow: "先讲原因", title: "防止已删除客户重新出现", description: "这次改动真正要解决的问题，是软删除记录仍可能进入后续同步流程。先知道风险，再看实现是否真的堵住了它。", readout: "原因 · 阻止已删除客户返回" },
  { active: ["step-1", "next"], step: 1, eyebrow: "理解策略", title: "在构建 Profile 前拒绝", description: "核心思路很简单：查到客户后立即判断 deleted_at，不再创建 Profile，也不给后续 CRM 同步留下机会。", readout: "思路 · 构建 Profile 前拒绝" },
  { active: ["step-2", "next"], step: 2, eyebrow: "代入场景", title: "删除记录不会再次同步", description: "当一个已删除客户被请求更新时，旧逻辑可能继续构建资料；新逻辑会在进入同步链条前明确返回。", readout: "场景 · 已删除客户被跳过" },
  { active: ["step-3", "next"], step: 3, eyebrow: "调用链 01", title: "从服务入口开始", description: "先定位 UpdateCustomer。它拿到客户 ID，向仓库读取记录，是整条业务链真正的入口。", readout: "第 1 / 3 步 · 服务入口" },
  { active: ["step-4", "next"], step: 4, eyebrow: "调用链 02", title: "检查删除保护", description: "读取成功后立刻检查 DeletedAt.Valid。这个判断的位置很关键：它必须发生在 buildProfile 和 syncCRM 之前。", readout: "第 2 / 3 步 · 删除保护" },
  { active: ["step-5", "next"], step: 5, eyebrow: "调用链 03", title: "确认最终落库", description: "只有通过删除检查并完成同步的客户才会进入 Save。沿主线走到这里，才算验证了完整结果。", readout: "第 3 / 3 步 · 仓库保存" },
  { active: ["ask"], step: 1, eyebrow: "保留疑问", title: "对着当前代码直接问", description: "不确定为什么要先检查 deleted_at，就在这一段代码旁提问。问题会带上当前步骤、代码快照和调用链上下文。", readout: "提问 · 为什么先检查 deleted_at？" },
];

const live = `
const P = ${JSON.stringify(P)};
const PHASES = ${JSON.stringify(PHASES)};
const stage = document.querySelector(".iso-stage");
const device = document.querySelector("[data-device]");
const tiltSurface = document.querySelector("[data-tilt-surface]");
const controls = [...stage.querySelectorAll("[data-control]")];
const focuses = [...stage.querySelectorAll("[data-code-step]")];
const qa = stage.querySelector("[data-qa]");
const readout = document.querySelector("[data-readout]");
const phaseNumber = document.querySelector("[data-phase-number]");
const phaseEyebrow = document.querySelector("[data-phase-eyebrow]");
const phaseTitle = document.querySelector("[data-phase-title]");
const phaseDescription = document.querySelector("[data-phase-description]");
const progress = [...document.querySelectorAll("[data-phase-jump]")];
const liveStatus = stage.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const liftVector = axisVector(P, [0, 0, 1]);
const states = new Map(controls.map((node) => [node, { lift: 0, hover: 0 }]));
let phase = 0, frame = 0, previous = 0, visible = false;
let touring = !still.matches, tourClock = 0, idleTimer = 0;
const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

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
  phaseNumber.textContent = String(phase + 1).padStart(2, "0") + " / " + String(PHASES.length).padStart(2, "0");
  phaseEyebrow.textContent = current.eyebrow;
  phaseTitle.textContent = current.title;
  phaseDescription.textContent = current.description;
  progress.forEach((node, index) => {
    node.toggleAttribute("data-current", index === phase);
    node.toggleAttribute("data-past", index < phase);
    node.setAttribute("aria-current", index === phase ? "step" : "false");
  });
  stage.setAttribute("aria-valuenow", String(phase + 1));
  stage.setAttribute("aria-valuetext", "代码走读第 " + (phase + 1) + " 步，共 " + PHASES.length + " 步：" + current.title);
  if (announce) liveStatus.textContent = current.title + "。" + current.description;
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
  const tiltTX = still.matches ? 0 : tilt.tx;
  const tiltTY = still.matches ? 0 : tilt.ty;
  tilt.x += (tiltTX - tilt.x) * (1 - Math.exp(-dt / 0.24));
  tilt.y += (tiltTY - tilt.y) * (1 - Math.exp(-dt / 0.24));
  if (Math.abs(tiltTX - tilt.x) < 0.002) tilt.x = tiltTX;
  if (Math.abs(tiltTY - tilt.y) < 0.002) tilt.y = tiltTY;
  device.style.setProperty("--tilt-x", tilt.x.toFixed(3) + "deg");
  device.style.setProperty("--tilt-y", tilt.y.toFixed(3) + "deg");
  moving ||= tilt.x !== tiltTX || tilt.y !== tiltTY;
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
tiltSurface.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" || still.matches) return;
  const box = tiltSurface.getBoundingClientRect();
  const nx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2));
  const ny = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2));
  tilt.tx = -ny * 3.2;
  tilt.ty = nx * 3.8;
  run();
});
tiltSurface.addEventListener("pointerleave", () => { tilt.tx = 0; tilt.ty = 0; run(); });
stage.addEventListener("click", (event) => {
  const node = event.target.closest("[data-control], [data-page-action], [data-phase-jump]");
  if (!node) return;
  takeOver();
  if (node.dataset.phaseJump !== undefined) {
    setPhase(Number(node.dataset.phaseJump));
    stage.focus({ preventScroll: true });
    return;
  }
  const id = node.dataset.control || node.dataset.pageAction;
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
html,body{min-height:100%;margin:0;background:var(--anatomy-page)}
body{overflow-x:hidden}
.iso-page{width:100%;margin:0}
.wt-page-shell{box-sizing:border-box;min-height:100svh;display:grid;grid-template-rows:auto minmax(390px,1fr) auto;overflow:hidden;background:
  radial-gradient(circle at 50% 42%,color-mix(in srgb,var(--anatomy-card) 78%,transparent) 0,transparent 54%),var(--anatomy-page);color:var(--anatomy-text)}
.wt-nav{width:min(1240px,calc(100% - 64px));margin:0 auto;padding:26px 0 8px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:5}
.wt-brand{display:flex;align-items:center;gap:13px;color:var(--anatomy-strong);font:600 13px/1 var(--anatomy-mono);letter-spacing:.08em}
.wt-brand-mark{width:25px;height:25px;display:grid;place-items:center;border:1px solid var(--anatomy-mid);box-shadow:var(--anatomy-lift);font-size:12px}
.wt-brand-copy small{display:block;margin-top:5px;color:var(--anatomy-muted);font-size:9px;font-weight:400;letter-spacing:.16em;text-transform:uppercase}
.wt-github{position:relative;display:inline-flex;align-items:center;gap:10px;padding:10px 14px 11px;border:1px solid var(--anatomy-mid);color:var(--anatomy-strong);background:var(--anatomy-card);box-shadow:var(--anatomy-lift);font:500 11px/1 var(--anatomy-mono);letter-spacing:.08em;text-decoration:none;transition:transform .35s var(--anatomy-ease),border-color .35s var(--anatomy-ease)}
.wt-github:hover{transform:translateY(-3px);border-color:var(--anatomy-hi)}
.wt-github svg{width:14px;height:14px;fill:currentColor}
.wt-visual{min-height:0;display:grid;place-items:center;perspective:1500px;padding:0 24px 4px;position:relative}
.wt-visual::after{content:"";position:absolute;left:18%;right:18%;bottom:4%;height:10%;border-radius:50%;background:var(--anatomy-halo);opacity:calc(var(--anatomy-halo-opacity) * .4);filter:blur(28px);pointer-events:none}
.wt-device{--tilt-x:0deg;--tilt-y:0deg;width:min(1240px,95vw,calc((100svh - 292px) * 1.614));min-width:680px;position:relative;z-index:1;transform:rotateX(var(--tilt-x)) rotateY(var(--tilt-y));transform-style:preserve-3d;transform-origin:50% 52%;will-change:transform;filter:drop-shadow(0 22px 25px color-mix(in srgb,var(--anatomy-halo) 28%,transparent))}
.wt-device .iso-svg{width:100%;overflow:visible}
.wt-story{width:min(1180px,calc(100% - 64px));margin:0 auto;padding:18px 0 28px;display:grid;grid-template-columns:130px minmax(0,1fr) auto;gap:28px;align-items:end;border-top:1px solid var(--anatomy-faint);position:relative;z-index:4}
.wt-step-meta{align-self:stretch;display:flex;flex-direction:column;justify-content:space-between;gap:18px}
.wt-phase-number{color:var(--anatomy-strong);font:500 12px/1 var(--anatomy-mono);letter-spacing:.12em;font-variant-numeric:tabular-nums}
.wt-progress{display:flex;gap:5px;align-items:center}
.wt-progress button{width:7px;height:7px;padding:0;border:1px solid var(--anatomy-lo);border-radius:50%;background:transparent;cursor:pointer;transition:background .25s var(--anatomy-ease),transform .25s var(--anatomy-ease)}
.wt-progress button[data-past]{background:var(--anatomy-lo)}
.wt-progress button[data-current]{background:var(--anatomy-lit);border-color:var(--anatomy-lit);transform:scale(1.35)}
.wt-copy{max-width:760px;min-height:88px}
.wt-eyebrow{margin:0 0 8px;color:var(--anatomy-muted);font:500 10px/1 var(--anatomy-mono);letter-spacing:.16em;text-transform:uppercase}
.wt-title{margin:0 0 9px;color:var(--anatomy-strong);font:500 clamp(20px,2.1vw,29px)/1.12 system-ui,-apple-system,"PingFang SC",sans-serif;letter-spacing:-.025em}
.wt-description{max-width:720px;margin:0;color:var(--anatomy-text);font:400 14px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif}
.wt-story-controls{display:flex;gap:8px;align-items:center;padding-bottom:3px}
.wt-story-controls button{min-width:45px;height:42px;border:1px solid var(--anatomy-mid);background:var(--anatomy-card);color:var(--anatomy-strong);box-shadow:var(--anatomy-lift);font:500 16px/1 var(--anatomy-mono);cursor:pointer;transition:transform .3s var(--anatomy-ease),border-color .3s var(--anatomy-ease)}
.wt-story-controls button:last-child{min-width:116px;font-size:11px;letter-spacing:.08em}
.wt-story-controls button:hover{transform:translateY(-3px);border-color:var(--anatomy-hi)}
.wt-readout{position:absolute;right:0;top:-24px;color:var(--anatomy-muted);font:400 9px/1 var(--anatomy-mono);letter-spacing:.08em}
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
.iso-stage:focus-visible .wt-phase-number{text-decoration:underline;text-decoration-color:var(--anatomy-muted);text-underline-offset:5px}
.wt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:720px){
  .wt-page-shell{grid-template-rows:auto minmax(300px,47svh) auto}
  .wt-nav{width:calc(100% - 32px);padding-top:18px}.wt-brand-copy small{display:none}.wt-github{padding:9px 11px}.wt-github span{display:none}
  .wt-visual{padding:0;overflow:hidden}.wt-visual::after{left:8%;right:8%}
  .wt-device{width:102vw;min-width:0;max-width:none;filter:drop-shadow(0 14px 18px color-mix(in srgb,var(--anatomy-halo) 24%,transparent))}
  .wt-story{width:calc(100% - 32px);padding:18px 0 24px;grid-template-columns:1fr auto;gap:15px 12px;align-items:start}
  .wt-step-meta{grid-column:1 / -1;display:flex;flex-direction:row;align-items:center;gap:12px}.wt-progress{margin-left:auto}
  .wt-copy{min-height:154px}.wt-title{font-size:21px}.wt-description{font-size:13px;line-height:1.65}
  .wt-story-controls{align-self:end}.wt-story-controls button{min-width:42px;height:40px}.wt-story-controls button:last-child{min-width:42px;font-size:0}.wt-story-controls button:last-child::after{content:"→";font-size:16px}
  .wt-readout{display:none}
}
@media(prefers-reduced-motion:reduce){.wt-device{transform:none!important}.wt-code-focus,.wt-qa,.wt-control,.wt-github,.wt-story-controls button,.wt-progress button{transition:none}}
</style>`;

const githubIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.58-.3-5.29-1.29-5.29-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.41-2.72 5.39-5.3 5.68.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>`;
const progressHtml = PHASES.map((item, index) => `<button type="button" data-phase-jump="${index}" aria-label="第 ${index + 1} 步：${item.title}"></button>`).join("");
const body = `${css}<div class="iso-stage wt-page-shell" tabindex="0" role="group" aria-roledescription="交互式代码走读演示" aria-label="代码走读的十个阶段。使用左右方向键切换。" aria-valuemin="1" aria-valuemax="${PHASES.length}" aria-valuenow="1">
  <header class="wt-nav">
    <div class="wt-brand"><span class="wt-brand-mark">W</span><span class="wt-brand-copy">代码走读<small>Walkthrough for VS Code / Cursor</small></span></div>
    <a class="wt-github" href="https://github.com/hedykan/walkthrough" target="_blank" rel="noreferrer">${githubIcon}<span>在 GitHub 查看</span><b aria-hidden="true">↗</b></a>
  </header>
  <section class="wt-visual" data-tilt-surface aria-label="直立的代码编辑器模型">
    <div class="wt-device" data-device>${svg}</div>
  </section>
  <section class="wt-story" aria-live="off">
    <div class="wt-step-meta"><span class="wt-phase-number" data-phase-number>01 / 10</span><div class="wt-progress" aria-label="走读进度">${progressHtml}</div></div>
    <div class="wt-copy"><p class="wt-eyebrow" data-phase-eyebrow>${PHASES[0].eyebrow}</p><h1 class="wt-title" data-phase-title>${PHASES[0].title}</h1><p class="wt-description" data-phase-description>${PHASES[0].description}</p></div>
    <div class="wt-story-controls"><button type="button" data-page-action="prev" aria-label="上一步">←</button><button type="button" data-page-action="next">下一步&nbsp; →</button></div>
    <span class="wt-readout" data-readout>${PHASES[0].readout}</span>
  </section>
  <span class="wt-sr" role="status" aria-live="polite" data-status></span>
</div>`;

const name = theme === "dark" ? "walkthrough-editor-dark.html" : "walkthrough-editor.html";
const page = k.pageHtml({ title: "代码走读 · 沿主线理解一次改动", theme, body, script: kitScript() + live, width: 1600 }).replace('<html lang="en">', '<html lang="zh-CN">');
writeFileSync(join(HERE, name), page);
console.log("wrote", name);
