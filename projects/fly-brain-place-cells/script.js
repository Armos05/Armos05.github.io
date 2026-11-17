const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d");
const SCENE_W = 1400;
const SCENE_H = 700;
const CURVE_W = 760;
const CURVE_H = 300;

const trainButton = document.getElementById("train-mode");
const testButton = document.getElementById("test-mode");
const resetBrainButton = document.getElementById("reset-brain");
const showPlumeToggle = document.getElementById("show-plume");
const showValueToggle = document.getElementById("show-value");

const trialLabel = document.getElementById("trial-label");
const findsLabel = document.getElementById("finds-label");
const rpeLabel = document.getElementById("rpe-label");
const odorLabel = document.getElementById("odor-label");
const valueLabel = document.getElementById("value-label");
const regionList = document.getElementById("region-list");
const stageLabel = document.getElementById("stage-label");
const curveCanvas = document.getElementById("curve");
const curveCtx = curveCanvas.getContext("2d");
const medianLabel = document.getElementById("median-label");
const testLabel = document.getElementById("test-label");
const captionLabel = document.getElementById("live-caption");
const compareList = document.getElementById("compare-list");
const dataTable = document.getElementById("data-table");

const arena = {
  x: 26,
  y: 34,
  w: 600,
  h: 632,
  grid: 70
};

const brain = {
  x: 690,
  y: 56,
  w: 660,
  h: 590
};

const regions = [
  { id: "orn", label: "ORN", name: "olfactory receptor neurons", color: "#171205", glow: "#ffe066", fullHz: 60, labelSide: "left", activity: 0 },
  { id: "al", label: "AL", name: "antennal lobe projection and local neurons", color: "#6c94b8", glow: "#4cc9f0", fullHz: 50, labelSide: "right", activity: 0 },
  { id: "lh", label: "LH", name: "lateral horn (innate odor pathway)", color: "#a07c2c", glow: "#ff9f1c", fullHz: 40, labelSide: "left", activity: 0 },
  { id: "mb", label: "MB", name: "mushroom body Kenyon cells and APL", color: "#89b56f", glow: "#ffb347", fullHz: 8, labelSide: "right", activity: 0 },
  { id: "dan", label: "DAN", name: "PAM reward / PPL1 punishment dopamine neurons", color: "#d88491", glow: "#ff4d6d", fullHz: 25, labelSide: "left", activity: 0 },
  { id: "mbon", label: "MBON", name: "mushroom body output neurons", color: "#171205", glow: "#c77dff", fullHz: 40, labelSide: "right", activity: 0 },
  { id: "cx", label: "CX", name: "central complex compass and steering", color: "#6f632c", glow: "#00f5d4", fullHz: 40, labelSide: "left", activity: 0 },
  { id: "dn", label: "DN", name: "descending neurons", color: "#171205", glow: "#7ee787", fullHz: 40, labelSide: "right", activity: 0 }
];
const regionById = new Map(regions.map((region) => [region.id, region]));

// Model constants. Time step is one simulation tick; two ticks run per frame.
const HEADING_BINS = 16;
const WALL_CHANNELS = 12;
const WALL_HEIGHT = 20;
const TRIAL_TIMEOUT = 1500;
// Simulation steps per second, independent of the display's refresh rate.
const TRAIN_STEPS_PER_SECOND = 75;
const TEST_STEPS_PER_SECOND = 50;
const COMPARE_TRIALS = 5;
const GAMMA = 0.985;
const LAMBDA = 0.9;
const CRITIC_RATE = 0.15;
const OPPONENT_RECOVERY = 1;
// MBONs integrate KC input over about 100 ms, which smooths the puff-by-puff
// flicker of olfactory KCs; fraction of the gap closed per step.
const KC_SMOOTHING = 0.2;
// Food-vector memory: dopamine-gated, stored per KC from path integration.
const MEMORY_RATE = 0.5;
const POSITION_TRACE = 0.999;
const PI_NOISE = 0.03;
const KC_OLF_ACTIVE = 10;
const KC_VIS_ACTIVE = 7;
const IPSI_RELEASE = 1.4;

// Leaky integrate-and-fire neurons with the membrane parameters of the Shiu
// et al. 2024 whole-brain model: dv/dt = (v0 - v + g) / tauM,
// dg/dt = -g / tauSyn, and a presynaptic spike adds its synaptic weight to g
// after a delay. Times in ms, voltages in mV.
const LIF = { v0: -52, vReset: -52, vThreshold: -45, tauM: 20, tauSyn: 5, refractory: 2.2, delay: 1.8, wPoisson: 68.75 };
const LIF_DT = 0.5;
const NEURAL_MS_PER_STEP = 20;
// Each model neuron stands in for its whole cell type, so a spike carries the
// synapses of all the real neurons it represents, at wSyn mV each (the Shiu
// et al. value) times SYNAPSE_GAIN. One model spike stands for many
// near-synchronous real ones, so a single input is capped at MAX_SPIKE_MV.
const W_SYN = 0.275;
const SYNAPSE_GAIN = 0.3;
const MAX_SPIKE_MV = 40;
// PN boutons make multi-site synapses onto KC claws, which EM synapse counts
// undercount. This one factor is set so an odor-driven KC fires a few spikes
// per encounter; how many KCs fire is left to the real APL feedback.
const CLAW_GAIN = 4;
// Populations whose firing the model sets from the world: odor (ORNs), wall
// views (visual KCs, whose visual input neurons are not modelled), reward
// prediction error (DANs) and heading, turning and goal in the central
// complex. So does any neuron whose real input comes mostly from cell types
// not in the model (coverage below MIN_COVERAGE), such as PFL3 and the
// descending neurons. They fire as Poisson spike trains at the model rate
// times this ceiling. Every other neuron fires only through its real
// synapses.
const DRIVEN_HZ = { orn: 200, kc_vis: 30, pam: 40, ppl1: 40, epg: 60, pen: 40, fc2: 40 };
const OTHER_DRIVEN_HZ = 60;
const MIN_COVERAGE = 0.5;

// Fallback anatomy (normalized FlyWire space, fly's left hemisphere) used only
// when data/connectome_projection.json cannot be fetched, e.g. from file://.
const FALLBACK_GROUPS = [
  { group: "orn", region: "orn", count: 128, c: [0.47, 0.48, 0.13], s: [0.05, 0.1, 0.08] },
  { group: "pn", region: "al", count: 64, c: [0.46, 0.4, 0.3], s: [0.04, 0.12, 0.15] },
  { group: "ln", region: "al", count: 24, c: [0.43, 0.47, 0.22], s: [0.03, 0.06, 0.04] },
  { group: "lh", region: "lh", count: 36, c: [0.33, 0.19, 0.62], s: [0.03, 0.07, 0.06] },
  { group: "kc_olf", region: "mb", count: 200, c: [0.43, 0.16, 0.72], s: [0.03, 0.06, 0.08] },
  { group: "kc_vis", region: "mb", count: 140, c: [0.42, 0.16, 0.68], s: [0.03, 0.07, 0.12] },
  { group: "apl", region: "mb", count: 2, c: [0.42, 0.15, 0.69], s: [0, 0, 0] },
  { group: "pam", region: "dan", count: 48, c: [0.46, 0.16, 0.19], s: [0.02, 0.04, 0.05] },
  { group: "ppl1", region: "dan", count: 16, c: [0.45, 0.16, 0.5], s: [0.05, 0.04, 0.15] },
  { group: "mbon_av", region: "mbon", count: 74, c: [0.47, 0.2, 0.3], s: [0.05, 0.1, 0.12] },
  { group: "mbon_ap", region: "mbon", count: 22, c: [0.47, 0.28, 0.29], s: [0.04, 0.15, 0.1] },
  { group: "epg", region: "cx", count: 47, c: [0.5, 0.14, 0.65], s: [0.02, 0.08, 0.1] },
  { group: "pen", region: "cx", count: 42, c: [0.52, 0.24, 0.54], s: [0.03, 0.07, 0.12] },
  { group: "fc2", region: "cx", count: 32, c: [0.51, 0.16, 0.63], s: [0.03, 0.08, 0.07] },
  { group: "pfl3", region: "cx", count: 24, c: [0.51, 0.11, 0.59], s: [0.03, 0.08, 0.1] },
  { group: "dna02", region: "dn", count: 4, c: [0.47, 0.5, 0.53], s: [0.01, 0.04, 0.06] },
  { group: "dnp09", region: "dn", count: 4, c: [0.48, 0.59, 0.37], s: [0.03, 0.05, 0.15] },
  { group: "dn", region: "dn", count: 70, c: [0.48, 0.59, 0.58], s: [0.04, 0.18, 0.12] }
];
const FALLBACK_GLOMERULI = { DM1: 1, DM4: 0.95, DP1m: 0.85, VA2: 0.8, DM2: 0.75, DM3: 0.6, DM5: 0.5, VM7d: 0.45, DL1: 0.35, VA3: 0.3 };

let projection = makeFallbackProjection();
let circuit = buildCircuit(projection.nodes);
let contextLayer = null;

let training = true;
let stopped = false;
let idle = true;
let testResult = null;
let lastRewardFrame = -1000;
let goalConfidence = 0;
let trialStats = newTrialStats();
let earlyTrials = [];
let trial = 1;
let finds = 0;
let frame = 0;
let trialSteps = 0;
let rewardError = 0;
let rewardErrorDisplay = 0;
let odorDrive = 0;
let learnedValue = 0;
let previousValue = null;
let odorOn = 0;
let odorPeak = 0;
let odorOffLevel = 0;
let smellLevel = 0;
let fly;
let cupcake;
let trail = [];
let history = [];
let valueMap = [];
let regionRows = new Map();

function newTrialStats() {
  return { n: 0, avoid: 0, approach: 0, goal: 0, turn: 0, speed: 0, odor: 0, dan: null };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function relu(value) {
  return value > 0 ? value : 0;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function gaussian() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(Math.PI * 2 * Math.random());
}

function mulberry32(seed) {
  return function nextRandom() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Projection data
// ---------------------------------------------------------------------------

function makeFallbackProjection() {
  const random = mulberry32(240917);
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(Math.PI * 2 * random());
  const glomeruli = Object.keys(FALLBACK_GLOMERULI).concat(["DA1", "DA2", "DL3", "DL5", "VA1d", "VM2", "VM3", "VC4"]);
  const nodes = [];

  for (const spec of FALLBACK_GROUPS) {
    for (let i = 0; i < spec.count; i++) {
      const side = i % 2 === 0 ? "left" : "right";
      const x = spec.c[0] + normal() * spec.s[0];
      const node = {
        x: clamp(side === "left" ? x : 1 - x, 0, 1),
        y: clamp(spec.c[1] + normal() * spec.s[1], 0, 1),
        z: clamp(spec.c[2] + normal() * spec.s[2], 0, 1),
        region: spec.region,
        group: spec.group,
        side
      };
      if (spec.group === "orn" || spec.group === "pn") {
        const per = spec.group === "orn" ? 4 : 2;
        node.glom = glomeruli[Math.floor(i / per) % glomeruli.length];
        node.drive = FALLBACK_GLOMERULI[node.glom] || 0;
      }
      nodes.push(node);
    }
  }

  return { source: "offline fallback anatomy", nodes, context: null, extent: [786, 342, 271], total: 0 };
}

function normalizeProjection(data) {
  if (!data || !Array.isArray(data.nodes)) {
    throw new Error("connectome projection requires a nodes array");
  }

  const nodes = data.nodes
    .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && node.group)
    .map((node) => ({
      x: clamp(node.x, 0, 1),
      y: clamp(node.y, 0, 1),
      z: Number.isFinite(node.z) ? clamp(node.z, 0, 1) : 0.5,
      region: regionById.has(node.region) ? node.region : "mb",
      group: node.group,
      side: node.side === "right" ? "right" : "left",
      glom: node.glom || "",
      drive: Number.isFinite(node.drive) ? node.drive : 0,
      cellType: node.cell_type || "",
      bodyId: node.body_id || ""
    }));

  const required = ["orn", "pn", "kc_olf", "kc_vis", "mbon_av", "mbon_ap", "epg", "pfl3"];
  for (const group of required) {
    if (!nodes.some((node) => node.group === group)) {
      throw new Error(`connectome projection is missing the ${group} population`);
    }
  }

  const scale = data.context_scale || 1000;
  const context = Array.isArray(data.context) ? Float32Array.from(data.context, (value) => value / scale) : null;
  const contextFile = typeof data.context_file === "string" ? data.context_file : null;
  const extent = Array.isArray(data.extent_um) && data.extent_um.length === 3 ? data.extent_um : [786, 342, 271];

  return { source: data.source || "real neuron positions", nodes, context, contextFile, contextScale: scale, extent, total: data.total_neurons || 0 };
}

// Whole-brain glass cloud: little-endian uint16 x/y/z triplets.
async function loadContext(file, scale) {
  try {
    const response = await fetch(`data/${file}`);
    if (!response.ok) return null;
    const view = new DataView(await response.arrayBuffer());
    const count = Math.floor(view.byteLength / 2);
    const points = new Float32Array(count);
    for (let i = 0; i < count; i++) points[i] = view.getUint16(i * 2, true) / scale;
    return points;
  } catch (error) {
    return null;
  }
}

// Real synapses onto the model neurons, each model neuron standing in for its
// whole cell type: little-endian (uint16 pre, uint16 post, float32 signed
// synapses) records, plus metadata.
async function loadWiring(nodeCount) {
  try {
    const response = await fetch("data/connectome_wiring.json", { cache: "no-store" });
    if (!response.ok) return null;
    const meta = await response.json();
    if (!Array.isArray(meta.coverage) || meta.coverage.length !== nodeCount) return null;
    const binary = await fetch(`data/${meta.edges_file}`);
    if (!binary.ok) return null;
    const view = new DataView(await binary.arrayBuffer());
    const count = Math.floor(view.byteLength / 8);
    const pre = new Uint16Array(count);
    const post = new Uint16Array(count);
    const signed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pre[i] = view.getUint16(i * 8, true);
      post[i] = view.getUint16(i * 8 + 2, true);
      signed[i] = view.getFloat32(i * 8 + 4, true);
    }
    return { pre, post, signed, coverage: meta.coverage, synapses: meta.represented_synapses || 0 };
  } catch (error) {
    return null;
  }
}

async function loadConnectomeProjection() {
  try {
    const response = await fetch("data/connectome_projection.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    projection = normalizeProjection(await response.json());
    if (projection.contextFile) projection.context = await loadContext(projection.contextFile, projection.contextScale);
    circuit = buildCircuit(projection.nodes, await loadWiring(projection.nodes.length));
    contextLayer = null;
    resetPlasticity();
    if (stageLabel) stageLabel.textContent = circuit.wired ? "FlyWire synapses" : "FlyWire positions";
  } catch (error) {
    if (stageLabel) stageLabel.textContent = "Offline anatomy";
  }
}

// ---------------------------------------------------------------------------
// Circuit construction
// ---------------------------------------------------------------------------

function buildCircuit(nodes, wiring = null) {
  const random = mulberry32(7331);
  const groups = {};
  nodes.forEach((node, index) => {
    (groups[node.group] ||= []).push(index);
  });
  for (const key of ["orn", "pn", "ln", "lh", "kc_olf", "kc_vis", "apl", "pam", "ppl1", "mbon_av", "mbon_ap", "epg", "pen", "fc2", "pfl3", "dna02", "dnp09", "dn"]) {
    groups[key] ||= [];
  }

  const rate = new Float32Array(nodes.length);
  const glow = new Float32Array(nodes.length);
  const sample = (list, count) => {
    const out = [];
    for (let i = 0; i < count && list.length; i++) out.push(list[Math.floor(random() * list.length)]);
    return out;
  };

  // Real FlyWire synapses into each model neuron, when the wiring file loaded.
  const inputsOf = Array.from({ length: nodes.length }, () => []);
  if (wiring) {
    for (let e = 0; e < wiring.pre.length; e++) inputsOf[wiring.post[e]].push({ index: wiring.pre[e], count: wiring.signed[e] });
  }

  // ORN -> PN: the synapses each PN gets from the model's ORNs, from both
  // antennae. ORN synapses release more transmitter onto ipsilateral PNs
  // (Gaudry et al. 2013), which synapse counts alone miss, so those are
  // weighted by IPSI_RELEASE. Without wiring, ORNs of the PN's glomerulus, 0.7
  // ipsilateral and 0.3 contralateral.
  const ornsByGlom = new Map();
  for (const index of groups.orn) {
    const key = nodes[index].glom;
    if (!ornsByGlom.has(key)) ornsByGlom.set(key, []);
    ornsByGlom.get(key).push(index);
  }
  const pnInputs = groups.pn.map((pn) => {
    const real = inputsOf[pn].filter((input) => nodes[input.index].group === "orn" && input.count > 0);
    if (real.length) return real.map((input) => ({ index: input.index, weight: input.count * (nodes[input.index].side === nodes[pn].side ? IPSI_RELEASE : 1) }));
    const orns = ornsByGlom.get(nodes[pn].glom) || [];
    return orns.map((orn) => ({ index: orn, weight: nodes[orn].side === nodes[pn].side ? 0.7 : 0.3 }));
  });

  // PN -> KC and PN -> LH: real excitatory synapses from all PNs of each
  // model glomerulus, carried by the model PN of that glomerulus.
  const pnInputsOf = (index) =>
    inputsOf[index].filter((input) => nodes[input.index].group === "pn" && input.count > 0);

  // Each olfactory KC's claws. Weights are scaled so the average KC's inputs
  // sum to 6, as in the random-claw fallback.
  const kcClaws = groups.kc_olf.map(pnInputsOf);
  const clawTotals = kcClaws.map((claws) => claws.reduce((sum, claw) => sum + claw.count, 0)).filter((total) => total > 0);
  const meanClaws = clawTotals.length ? clawTotals.reduce((a, b) => a + b, 0) / clawTotals.length : 1;
  const kcOlfInputs = groups.kc_olf.map((kc, i) => {
    if (wiring) return kcClaws[i].map((claw) => ({ index: claw.index, weight: (6 * claw.count) / meanClaws }));
    return sample(groups.pn, 6).map((pn) => ({ index: pn, weight: 0.7 + random() * 0.6 }));
  });

  const lhInputs = groups.lh.map((lh) => {
    const real = pnInputsOf(lh);
    if (real.length) return real.map((input) => ({ index: input.index, weight: input.count }));
    const ipsilateral = groups.pn.filter((pn) => nodes[pn].side === nodes[lh].side && nodes[pn].drive > 0);
    return sample(ipsilateral.length ? ipsilateral : groups.pn, 5).map((pn) => ({ index: pn, weight: 1 }));
  });

  // Visual context -> visual KC (KCg-d, KCab-p). Channels are wall-elevation
  // detectors, 4 walls x WALL_CHANNELS tunings. Each KC is a coincidence
  // detector for one east/west-wall channel and one north/south-wall channel,
  // so it fires in a compact patch of the arena. The visual projection
  // neurons are not in the model, so this input stays a model choice.
  const channelCount = 4 * WALL_CHANNELS;
  const kcVisInputs = groups.kc_vis.map(() => {
    const xWall = Math.floor(random() * 2);
    const yWall = 2 + Math.floor(random() * 2);
    return [xWall, yWall].map((wall) => ({
      index: wall * WALL_CHANNELS + Math.floor(random() * WALL_CHANNELS),
      weight: 0.8 + random() * 0.4
    }));
  });

  // KC -> MBON: each KC's real synapses onto approach and onto avoidance
  // MBONs, relative to the average KC of its population (olfactory or
  // visual). Learning depresses these synapses, so a KC with few synapses
  // onto a pathway can change it only a little.
  const kcs = groups.kc_olf.concat(groups.kc_vis);
  const kcTotal = kcs.length;
  const toApproach = new Float32Array(kcTotal).fill(1);
  const toAvoid = new Float32Array(kcTotal).fill(1);
  const kcSlot = new Map(kcs.map((kc, k) => [kc, k]));
  if (wiring) {
    toApproach.fill(0);
    toAvoid.fill(0);
    for (let e = 0; e < wiring.pre.length; e++) {
      const k = kcSlot.get(wiring.pre[e]);
      if (k === undefined || wiring.signed[e] <= 0) continue;
      const group = nodes[wiring.post[e]].group;
      if (group === "mbon_ap") toApproach[k] += wiring.signed[e];
      else if (group === "mbon_av") toAvoid[k] += wiring.signed[e];
    }
    const split = groups.kc_olf.length;
    for (const weights of [toApproach, toAvoid]) {
      for (const [from, to] of [[0, split], [split, kcTotal]]) {
        let mean = 0;
        for (let k = from; k < to; k++) mean += weights[k] / Math.max(1, to - from);
        for (let k = from; k < to; k++) weights[k] = mean > 0 ? Math.min(weights[k] / mean, 2.5) : 1;
      }
    }
  }

  // Synapses drawn when a neuron spikes: its three strongest real outputs, or
  // the class-level rules without wiring.
  const edges = [];
  if (wiring) {
    for (let e = 0; e < wiring.pre.length; e++) edges.push({ from: wiring.pre[e], to: wiring.post[e], count: Math.abs(wiring.signed[e]) });
  } else {
    const link = (from, to) => edges.push({ from, to, count: 1 });
    groups.pn.forEach((pn, i) => pnInputs[i].forEach((input) => link(input.index, pn)));
    groups.ln.forEach((ln) => sample(groups.pn, 3).forEach((pn) => link(pn, ln)));
    groups.lh.forEach((lh, i) => lhInputs[i].forEach((input) => link(input.index, lh)));
    groups.kc_olf.forEach((kc, i) => kcOlfInputs[i].forEach((input) => link(input.index, kc)));
    kcs.forEach((kc) => {
      sample(groups.mbon_av, 1).forEach((mbon) => link(kc, mbon));
      sample(groups.mbon_ap, 1).forEach((mbon) => link(kc, mbon));
    });
    groups.apl.forEach((apl) => sample(kcs, 24).forEach((kc) => link(apl, kc)));
    groups.pam.forEach((pam) => sample(groups.mbon_av, 2).forEach((mbon) => link(pam, mbon)));
    groups.ppl1.forEach((ppl1) => sample(groups.mbon_ap, 2).forEach((mbon) => link(ppl1, mbon)));
    groups.mbon_av.concat(groups.mbon_ap).forEach((mbon) => {
      sample(groups.pam.concat(groups.ppl1), 1).forEach((dan) => link(mbon, dan));
      sample(groups.fc2, 1).forEach((fc2) => link(mbon, fc2));
    });
    groups.epg.forEach((epg) => sample(groups.pfl3, 2).forEach((pfl3) => link(epg, pfl3)));
    groups.pen.forEach((pen) => sample(groups.epg, 2).forEach((epg) => link(pen, epg)));
    groups.fc2.forEach((fc2) => sample(groups.pfl3, 2).forEach((pfl3) => link(fc2, pfl3)));
    groups.pfl3.forEach((pfl3) => sample(groups.dna02, 1).forEach((dn) => link(pfl3, dn)));
    groups.lh.forEach((lh) => sample(groups.dna02.concat(groups.dnp09), 1).forEach((dn) => link(lh, dn)));
    groups.dna02.concat(groups.dnp09).forEach((dn) => sample(groups.dn, 3).forEach((target) => link(dn, target)));
  }
  const outgoing = Array.from({ length: nodes.length }, () => []);
  for (const edge of [...edges].sort((a, b) => b.count - a.count)) {
    if (outgoing[edge.from].length < 3) outgoing[edge.from].push(edge.to);
  }

  // EPG / FC2 heading bins, assigned by left-right order within the bridge.
  const bins = (list) => {
    const out = new Map();
    [...list].sort((a, b) => nodes[a].x - nodes[b].x).forEach((index, order) => out.set(index, order % HEADING_BINS));
    return out;
  };

  return {
    nodes,
    groups,
    rate,
    glow,
    spiking: buildSpikingNetwork(nodes, wiring, kcSlot),
    wired: Boolean(wiring),
    edges,
    synapseCount: wiring ? wiring.synapses : edges.length,
    outgoing,
    pnInputs,
    lhInputs,
    kcOlfInputs,
    kcVisInputs,
    toApproach,
    toAvoid,
    epgBin: bins(groups.epg),
    fc2Bin: bins(groups.fc2),
    visual: new Float32Array(channelCount),
    kcOut: new Float32Array(kcTotal),
    kcSmooth: new Float32Array(kcTotal),
    // Visual (place) KCs follow the olfactory ones in kcOut; only they store
    // food vectors.
    visualOffset: groups.kc_olf.length,
    wApproach: new Float32Array(kcTotal).fill(1),
    wAvoid: new Float32Array(kcTotal).fill(1),
    criticTrace: new Float32Array(kcTotal),
    // Where (in path-integrated coordinates) each KC was active this trial.
    posX: new Float32Array(kcTotal),
    posY: new Float32Array(kcTotal),
    posW: new Float32Array(kcTotal),
    // Remembered vector from each KC's place to the food, and its certainty.
    memX: new Float32Array(kcTotal),
    memY: new Float32Array(kcTotal),
    memC: new Float32Array(kcTotal),
    goalX: 0,
    goalY: 0
  };
}

// ---------------------------------------------------------------------------
// Spiking network
// ---------------------------------------------------------------------------

function buildSpikingNetwork(nodes, wiring, kcSlot) {
  const n = nodes.length;
  const drivenHz = new Float32Array(n);
  nodes.forEach((node, i) => {
    // Without real wiring nothing would reach the other populations, so all
    // of them follow the model rates.
    const simulated = wiring && wiring.coverage[i] >= MIN_COVERAGE;
    drivenHz[i] = DRIVEN_HZ[node.group] ?? (simulated ? 0 : OTHER_DRIVEN_HZ);
  });

  // Synapses by presynaptic neuron (CSR). KC -> MBON synapses remember their
  // KC and pathway so learning can scale them.
  const start = new Int32Array(n + 1);
  let targets = new Uint16Array(0);
  let weights = new Float32Array(0);
  let plastic = new Int32Array(0);
  if (wiring) {
    // Driven populations ignore synaptic input, so only edges onto the others
    // are kept.
    const kept = [];
    for (let e = 0; e < wiring.pre.length; e++) {
      if (!(drivenHz[wiring.post[e]] > 0)) kept.push(e);
    }
    for (const e of kept) start[wiring.pre[e] + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const fill = start.slice(0, n);
    targets = new Uint16Array(kept.length);
    weights = new Float32Array(kept.length);
    plastic = new Int32Array(kept.length).fill(-1);
    for (const e of kept) {
      const pre = wiring.pre[e];
      const post = wiring.post[e];
      const slot = fill[pre]++;
      targets[slot] = post;
      const claw = nodes[pre].group === "pn" && (nodes[post].group === "kc_olf" || nodes[post].group === "kc_vis") ? CLAW_GAIN : 1;
      weights[slot] = clamp(W_SYN * SYNAPSE_GAIN * claw * wiring.signed[e], -MAX_SPIKE_MV, MAX_SPIKE_MV);
      const k = kcSlot.get(pre);
      const group = nodes[post].group;
      if (k !== undefined && (group === "mbon_ap" || group === "mbon_av")) plastic[slot] = k * 2 + (group === "mbon_ap" ? 0 : 1);
    }
  }

  const delaySlots = Math.round(LIF.delay / LIF_DT);
  return {
    drivenHz,
    start,
    targets,
    weights,
    plastic,
    v: new Float32Array(n).fill(LIF.v0),
    g: new Float32Array(n),
    refractory: new Float32Array(n),
    pending: Array.from({ length: delaySlots + 1 }, () => new Float32Array(n)),
    cursor: 0,
    spikes: new Uint16Array(n),
    hz: new Float32Array(n),
    flashed: new Uint8Array(n)
  };
}

// Runs NEURAL_MS_PER_STEP of spiking for one behavioural step. Driven
// populations take their rate from circuit.rate.
function spikingStep(c) {
  const net = c.spiking;
  const { v, g, refractory, pending, drivenHz, start, targets, weights, plastic, spikes } = net;
  const n = v.length;
  const decay = Math.exp(-LIF_DT / LIF.tauSyn);
  const leak = LIF_DT / LIF.tauM;
  const substeps = Math.round(NEURAL_MS_PER_STEP / LIF_DT);
  const poisson = new Float32Array(n);
  for (let i = 0; i < n; i++) poisson[i] = drivenHz[i] * c.rate[i] * LIF_DT * 1e-3;
  spikes.fill(0);

  for (let t = 0; t < substeps; t++) {
    const arriving = pending[net.cursor];
    const later = pending[(net.cursor + pending.length - 1) % pending.length];
    for (let i = 0; i < n; i++) {
      if (poisson[i] > 0 && Math.random() < poisson[i]) arriving[i] += LIF.wPoisson;
      if (refractory[i] > 0) {
        // Membrane and synapse are frozen, but input still arrives.
        refractory[i] -= LIF_DT;
        g[i] += arriving[i];
        arriving[i] = 0;
        continue;
      }
      g[i] = g[i] * decay + arriving[i];
      arriving[i] = 0;
      v[i] += (LIF.v0 - v[i] + g[i]) * leak;
      if (v[i] > LIF.vThreshold) {
        v[i] = LIF.vReset;
        g[i] = 0;
        refractory[i] = LIF.refractory;
        spikes[i]++;
        net.flashed[i] = 1;
        for (let s = start[i]; s < start[i + 1]; s++) {
          let w = weights[s];
          const p = plastic[s];
          if (p >= 0) w *= p & 1 ? c.wAvoid[p >> 1] : c.wApproach[p >> 1];
          later[targets[s]] += w;
        }
      }
    }
    net.cursor = (net.cursor + 1) % pending.length;
  }

  const seconds = NEURAL_MS_PER_STEP / 1000;
  for (let i = 0; i < n; i++) net.hz[i] += (spikes[i] / seconds - net.hz[i]) * 0.15;
}

// ---------------------------------------------------------------------------
// Senses
// ---------------------------------------------------------------------------

// Turbulent odor plume. Puffs leave the cupcake, ride a meandering wind from
// right to left (toward where the fly starts), spread and jitter, so odor
// arrives as brief, patchy encounters that thin out downwind, as in
// filament models of turbulent plumes (Farrell et al. 2002). One step is
// NEURAL_MS_PER_STEP of time.
const WIND_SPEED = 1.6;
const WIND_MEANDER = 0.08;
const PUFF_RATE = 0.6;
const PUFF_GROWTH = 0.35;
const PUFF_JITTER = 0.5;
const PUFF_MASS = 1.1;
let puffs = [];
let windDrift = 0;
let windAngle = Math.PI;

function updatePlume() {
  windDrift = windDrift * 0.985 + gaussian() * WIND_MEANDER;
  windAngle = Math.PI + clamp(windDrift, -0.6, 0.6);
  if (Math.random() < PUFF_RATE) puffs.push({ x: cupcake.x, y: cupcake.y, r2: 0.3, vy: 0 });
  for (const puff of puffs) {
    puff.vy = puff.vy * 0.8 + gaussian() * PUFF_JITTER;
    puff.x += Math.cos(windAngle) * WIND_SPEED + gaussian() * PUFF_JITTER * 0.5;
    puff.y += Math.sin(windAngle) * WIND_SPEED + puff.vy;
    puff.r2 += PUFF_GROWTH;
  }
  puffs = puffs.filter((puff) => puff.x > -3 && puff.x < arena.grid + 3 && puff.y > -3 && puff.y < arena.grid + 3);
}

function odorAt(x, y) {
  let odor = 0;
  for (const puff of puffs) {
    const d2 = (puff.x - x) ** 2 + (puff.y - y) ** 2;
    if (d2 < 9 * puff.r2) odor += (PUFF_MASS / puff.r2) * Math.exp(-d2 / (2 * puff.r2));
  }
  return Math.min(1, odor);
}

// The plume averaged over time: strongest at the cupcake, with a long tail
// downwind and a short one upwind. Used for the gradient field, which shows
// where the fly would steer on average.
const PLUME_PEAK = 0.8;
const PLUME_DOWNWIND = 13;
const PLUME_UPWIND = 9;
const PLUME_CROSSWIND = 12;

function meanOdorAt(x, y) {
  const dx = x - cupcake.x;
  const dy = y - cupcake.y;
  const along = dx / (dx < 0 ? PLUME_DOWNWIND : PLUME_UPWIND);
  const across = dy / PLUME_CROSSWIND;
  return PLUME_PEAK * Math.exp(-Math.hypot(along, across));
}

function antennae(x, y, heading, odor = odorAt) {
  // Heading increases clockwise on screen, so the fly's right is heading + 90deg.
  const fx = x + Math.cos(heading) * 0.9;
  const fy = y + Math.sin(heading) * 0.9;
  return {
    left: odor(fx + Math.cos(heading - Math.PI / 2) * 0.6, fy + Math.sin(heading - Math.PI / 2) * 0.6),
    right: odor(fx + Math.cos(heading + Math.PI / 2) * 0.6, fy + Math.sin(heading + Math.PI / 2) * 0.6)
  };
}

function wallChannels(x, y, out) {
  // Panoramic view: each wall's apparent elevation, encoded by tuned channels.
  const distances = [x, arena.grid - x, y, arena.grid - y];
  for (let wall = 0; wall < 4; wall++) {
    const elevation = Math.atan(WALL_HEIGHT / Math.max(distances[wall], 0.5));
    for (let i = 0; i < WALL_CHANNELS; i++) {
      const center = 0.28 + (i / (WALL_CHANNELS - 1)) * 1.12;
      out[wall * WALL_CHANNELS + i] = Math.exp(-((elevation - center) ** 2) / (2 * 0.07 * 0.07));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Neural dynamics
// ---------------------------------------------------------------------------

function ornRate(node, odor) {
  // Sigmoidal dose-response (Hill coefficient 1.5), so faint odor far from the
  // cupcake barely registers.
  const h = odor ** 1.5;
  return clamp(0.03 + node.drive * h / (h + 0.09) + Math.random() * 0.02, 0, 1);
}

function kWinners(inputs, k, floor, out, offset) {
  // APL feedback inhibition: only the k most driven KCs stay above threshold.
  const sorted = Array.from(inputs).sort((a, b) => b - a);
  const threshold = Math.max(sorted[Math.min(k, sorted.length - 1)], floor);
  let total = 0;
  for (let i = 0; i < inputs.length; i++) {
    const value = relu(inputs[i] - threshold);
    out[offset + i] = value;
    total += value;
  }
  const norm = total > 1e-6 ? 1 / Math.max(total, 0.2) : 0;
  for (let i = 0; i < inputs.length; i++) out[offset + i] *= norm;
  return threshold;
}

// Computes PN, LH and KC responses for a given sensory state. Used both for
// the live fly and for the value-map probe (with write=false).
function sensoryPass(odorLeft, odorRight, x, y, kcOut, write) {
  const c = circuit;
  const { nodes, groups, rate } = c;

  const orn = new Float32Array(nodes.length);
  for (const index of groups.orn) {
    orn[index] = ornRate(nodes[index], nodes[index].side === "left" ? odorLeft : odorRight);
  }

  let pnMean = 0;
  const pnRaw = groups.pn.map((pn, i) => {
    let drive = 0;
    let weight = 0;
    for (const input of c.pnInputs[i]) {
      drive += orn[input.index] * input.weight;
      weight += input.weight;
    }
    drive = weight ? drive / weight * 1.4 : 0;
    pnMean += drive;
    return drive;
  });
  pnMean /= Math.max(1, groups.pn.length);

  // Bilateral comparison (Gaudry et al. 2013): for each cupcake-responsive
  // glomerulus, compare its left and right PN input before gain control, so the
  // signal neither saturates nor depends on which PNs an LH neuron samples.
  // Pairing within a glomerulus keeps the comparison balanced.
  const baseline = 1.4 * 0.04;
  const pairs = new Map();
  groups.pn.forEach((index, i) => {
    const node = nodes[index];
    if (!(node.drive > 0)) return;
    const entry = pairs.get(node.glom) || { drive: node.drive, left: 0, right: 0 };
    entry[node.side === "right" ? "right" : "left"] = relu(pnRaw[i] - baseline);
    pairs.set(node.glom, entry);
  });
  let lateralNumerator = 0;
  let lateralDenominator = 0;
  for (const pair of pairs.values()) {
    lateralNumerator += pair.drive * (pair.right - pair.left);
    lateralDenominator += pair.drive * (pair.right + pair.left);
  }
  // Smell strength: the receptors' odor-driven response, read back as an
  // estimate of how far up the dose-response curve they are (0 = nothing,
  // 1 = close to the cupcake).
  let hillSum = 0;
  let driveSq = 0;
  for (const index of groups.orn) {
    const d = nodes[index].drive;
    if (!(d > 0)) continue;
    hillSum += d * (orn[index] - 0.04);
    driveSq += d * d;
  }
  const hillLevel = driveSq ? clamp(hillSum / driveSq, 0, 0.95) : 0;
  const smellStrength = clamp((hillLevel - 0.08) / 0.7, 0, 1);

  // Receptor gain control (Weber's law): as receptors near saturation their
  // response to a small change shrinks by about 1.5 * (1 - H); dividing that
  // back out keeps the left/right contrast usable right up to the cupcake.
  const rawLateral = lateralDenominator > 1e-3 ? lateralNumerator / lateralDenominator : 0;
  const lateral = rawLateral / (1.5 * (1 - hillLevel) + 0.15);

  // LN divisive normalization across glomeruli.
  const lnLevel = clamp(pnMean * 3, 0, 1);
  const pn = new Float32Array(nodes.length);
  groups.pn.forEach((index, i) => {
    pn[index] = clamp(pnRaw[i] / (pnRaw[i] + 0.35 + 0.35 * lnLevel) * 1.6, 0, 1);
  });

  // LH neurons carry the innate approach drive: their real PN input, biased
  // toward the side that smells more.
  const lateralDrive = Math.tanh(lateral / LATERAL_SCALE);
  const lh = new Float32Array(nodes.length);
  groups.lh.forEach((index, i) => {
    let drive = 0;
    let weight = 0;
    for (const input of c.lhInputs[i]) {
      drive += pn[input.index] * input.weight;
      weight += input.weight;
    }
    const sideSign = nodes[index].side === "right" ? 1 : -1;
    lh[index] = clamp((weight ? drive / weight : 0) * 1.4 * (0.6 + 0.4 * sideSign * lateralDrive), 0, 1);
  });

  const olfDrive = new Float32Array(groups.kc_olf.length);
  groups.kc_olf.forEach((_, i) => {
    let drive = 0;
    for (const input of c.kcOlfInputs[i]) drive += pn[input.index] * input.weight;
    olfDrive[i] = drive / 6;
  });

  const visual = wallChannels(x, y, write ? c.visual : new Float32Array(c.visual.length));
  const visDrive = new Float32Array(groups.kc_vis.length);
  groups.kc_vis.forEach((_, i) => {
    // Coincidence detection: the geometric mean is high only when both
    // wall cues match at once.
    let drive = 1;
    for (const input of c.kcVisInputs[i]) drive *= visual[input.index] * input.weight;
    visDrive[i] = Math.sqrt(drive) + (write ? Math.random() * 0.005 : 0);
  });

  kWinners(olfDrive, KC_OLF_ACTIVE, 0.32, kcOut, 0);
  kWinners(visDrive, KC_VIS_ACTIVE, 0.02, kcOut, groups.kc_olf.length);

  if (write) {
    for (const index of groups.orn) rate[index] = orn[index];
    for (const index of groups.pn) rate[index] = pn[index];
    for (const index of groups.ln) rate[index] = clamp(lnLevel + Math.random() * 0.03, 0, 1);
    for (const index of groups.lh) rate[index] = clamp(lh[index] + Math.random() * 0.03, 0, 1);
    groups.kc_olf.forEach((index, i) => { rate[index] = clamp(kcOut[i] * 3, 0, 1); });
    groups.kc_vis.forEach((index, i) => { rate[index] = clamp(kcOut[groups.kc_olf.length + i] * 3, 0, 1); });
    for (const index of groups.apl) rate[index] = clamp(0.15 + pnMean + 0.3, 0, 1);
  }

  return { pnMean, lateral, smellStrength };
}

// MBON output: approach minus avoidance drive through each KC's real
// synapses, plus the recalled food vector that sets the goal in the
// fan-shaped body. Value is measured from the naive state, so an untrained
// fly expects nothing anywhere.
function mbonReadout(kcOut) {
  const c = circuit;
  let approach = 0;
  let avoid = 0;
  let naive = 0;
  let goalX = 0;
  let goalY = 0;
  let vectorX = 0;
  let vectorY = 0;
  let memory = 0;
  for (let k = 0; k < kcOut.length; k++) {
    const r = kcOut[k];
    if (!r) continue;
    approach += r * c.toApproach[k] * c.wApproach[k];
    avoid += r * c.toAvoid[k] * c.wAvoid[k];
    naive += r * (c.toApproach[k] - c.toAvoid[k]);
    const certainty = k >= c.visualOffset ? c.memC[k] : 0;
    if (certainty > 0.001) {
      const mx = c.memX[k];
      const my = c.memY[k];
      // Direction toward the food; shrinks close to it so smell takes over.
      const scale = r * certainty / (Math.hypot(mx, my) + 4);
      goalX += mx * scale;
      goalY += my * scale;
      vectorX += r * certainty * mx;
      vectorY += r * certainty * my;
      memory += r * certainty;
    }
  }
  const distance = memory > 1e-3 ? Math.hypot(vectorX, vectorY) / memory : Infinity;
  return { approach, avoid, value: approach - avoid - naive, goalX, goalY, memory, distance };
}

const STEER_GAIN = 0.45;

// PFL3 steering: turn toward the goal in proportion to sin(goal - heading).
// PFL3 alone has a blind spot when the goal is directly behind, where sin is
// near zero, so a PFL2-like term saturates the turn once the goal is more
// than 90 degrees away, keeping the direction of the turn already under way.
function steeringCommand(goalX, goalY, heading, currentTurn) {
  const strength = Math.min(Math.hypot(goalX, goalY), 1.2);
  const error = wrapAngle(Math.atan2(goalY, goalX) - heading);
  const behind = Math.cos(error) < 0;
  let side = Math.sin(error);
  if (behind) {
    const direction = Math.abs(side) > 0.3 ? Math.sign(side) : Math.sign(currentTurn) || 1;
    side = direction * Math.max(Math.abs(side), 0.9);
  }
  return { turn: STEER_GAIN * strength * side, behind, error, strength };
}

// Innate tropotaxis: turn toward the antenna that smells more. The turn grows
// with smell strength, so the closer the fly is, the more smell steers it, and
// learned value strengthens it further. tanh makes the response graded for
// small left/right differences and saturating for large ones.
const SMELL_GAIN = 0.45;
const LATERAL_SCALE = 0.02;

function innateOdorTurn(lateral, smellStrength, value) {
  return SMELL_GAIN * smellStrength * Math.tanh(lateral / LATERAL_SCALE) * (1 + 0.6 * clamp(relu(value), 0, 1));
}

// Odor ON and OFF responses (Alvarez-Salvado et al. 2018). ON follows smell up
// quickly and fades over about half a second; OFF is how far ON has fallen
// from its recent peak, so it is largest just after the fly loses the plume.
// ON sets an upwind goal in the central complex, which needs the antennae's
// wind sense (Matheson et al. 2022); OFF widens the search and adds a weaker
// downwind goal, so a fly that overshoots the source drifts back to the plume.
const ON_DECAY = 0.96;
const OFF_DECAY = 0.985;
const UPWIND_GAIN = 0.8;
const RETURN_GAIN = 0.5;
const CAST_GAIN = 2.5;

function updateOdorResponses(smellStrength) {
  odorOn = smellStrength > odorOn ? odorOn + (smellStrength - odorOn) * 0.6 : odorOn * ON_DECAY;
  odorPeak = Math.max(odorOn, odorPeak * OFF_DECAY);
  return relu(odorPeak - odorOn);
}

function circuitStep(reward, terminal) {
  const c = circuit;
  const { nodes, groups, rate } = c;
  const sense = antennae(fly.x, fly.y, fly.heading);
  odorDrive = (sense.left + sense.right) / 2;

  const { lateral, smellStrength } = sensoryPass(sense.left, sense.right, fly.x, fly.y, c.kcOut, true);
  smellLevel = smellStrength;
  const odorOff = updateOdorResponses(smellStrength);
  odorOffLevel = odorOff;
  for (let k = 0; k < c.kcOut.length; k++) c.kcSmooth[k] += (c.kcOut[k] - c.kcSmooth[k]) * KC_SMOOTHING;
  const readout = mbonReadout(c.kcSmooth);
  learnedValue = readout.value;

  // Dopamine: reward prediction error from reward plus MBON -> DAN feedback.
  const current = terminal ? 0 : learnedValue;
  rewardError = previousValue === null ? 0 : reward + GAMMA * current - previousValue;
  rewardErrorDisplay = Math.abs(rewardError) > Math.abs(rewardErrorDisplay) ? rewardError : rewardErrorDisplay * 0.97;

  if (training && previousValue !== null) {
    const delta = clamp(rewardError, -1, 1);
    for (let k = 0; k < c.kcOut.length; k++) {
      const trace = c.criticTrace[k];
      if (trace > 1e-4) {
        // PAM (reward) depresses KC -> avoidance MBON synapses; PPL1
        // (punishment / omission) depresses KC -> approach MBON synapses.
        // Each also lets depressed synapses in the opposite compartment
        // recover toward their naive strength, so noisy errors of both signs
        // cannot wear both pathways down to nothing (a model choice).
        const change = CRITIC_RATE * Math.abs(delta) * trace;
        if (delta > 0) {
          c.wAvoid[k] = Math.max(0, c.wAvoid[k] - change);
          if (c.wApproach[k] < 1) c.wApproach[k] = Math.min(1, c.wApproach[k] + change * OPPONENT_RECOVERY);
        } else {
          c.wApproach[k] = Math.max(0, c.wApproach[k] - change);
          if (c.wAvoid[k] < 1) c.wAvoid[k] = Math.min(1, c.wAvoid[k] + change * OPPONENT_RECOVERY);
        }
        // Slow homeostatic recovery of both pathways keeps capacity without
        // changing the value they encode: each is lifted in proportion to
        // the other's synapse count.
        const low = Math.min(c.wApproach[k], c.wAvoid[k]);
        if (low < 1) {
          const lift = 0.002 * (1 - low);
          const scale = Math.max(c.toApproach[k], c.toAvoid[k], 1e-6);
          c.wApproach[k] += (lift * c.toAvoid[k]) / scale;
          c.wAvoid[k] += (lift * c.toApproach[k]) / scale;
        }
      }
    }
  }

  if (training) updateFoodMemory(reward, terminal, readout);

  const pamLevel = clamp(0.08 + relu(rewardError) * 3 + reward * 0.6, 0, 1);
  const pplLevel = clamp(0.08 + relu(-rewardError) * 3 + relu(-reward), 0, 1);
  for (const index of groups.pam) rate[index] = clamp(pamLevel + Math.random() * 0.05, 0, 1);
  for (const index of groups.ppl1) rate[index] = clamp(pplLevel + Math.random() * 0.05, 0, 1);
  for (const index of groups.mbon_av) rate[index] = clamp(readout.avoid * 0.5 + Math.random() * 0.04, 0, 1);
  for (const index of groups.mbon_ap) rate[index] = clamp(readout.approach * 0.5 + Math.random() * 0.04, 0, 1);

  // Central complex. EPG bump encodes heading; FC2 holds the goal: the food
  // vector recalled through the MBONs, plus upwind while odor is on and
  // downwind just after it is lost. PFL3 compares them and drives turning.
  const heading = fly.heading;
  const upwind = windAngle + Math.PI;
  const windDrive = UPWIND_GAIN * odorOn - RETURN_GAIN * clamp(odorOff, 0, 1);
  c.goalX = readout.goalX + windDrive * Math.cos(upwind);
  c.goalY = readout.goalY + windDrive * Math.sin(upwind);
  const goalStrength = Math.min(Math.hypot(c.goalX, c.goalY), 1.2);
  const goalAngle = Math.atan2(c.goalY, c.goalX);

  for (const index of groups.epg) {
    const angle = (c.epgBin.get(index) / HEADING_BINS) * Math.PI * 2;
    rate[index] = clamp(relu(Math.cos(angle - heading)) ** 2 + Math.random() * 0.03, 0, 1);
  }
  for (const index of groups.fc2) {
    const angle = (c.fc2Bin.get(index) / HEADING_BINS) * Math.PI * 2;
    rate[index] = clamp(goalStrength * relu(Math.cos(angle - goalAngle)) * 1.4 + Math.random() * 0.03, 0, 1);
  }

  const steer = steeringCommand(c.goalX, c.goalY, heading, fly.turn);
  const pflRight = goalStrength * relu(Math.sin(steer.error));
  const pflLeft = goalStrength * relu(-Math.sin(steer.error));
  for (const index of groups.pfl3) rate[index] = clamp((nodes[index].side === "right" ? pflRight : pflLeft) * 1.3, 0, 1);

  const approachDrive = clamp(relu(learnedValue), 0, 1);
  const innateTurn = innateOdorTurn(lateral, smellStrength, learnedValue);
  const steerTurn = steer.turn;

  const confidence = clamp(goalStrength * 1.6, 0, 1);
  goalConfidence = confidence;
  // Random search shrinks while odor is on and as memory confidence grows;
  // losing the odor (OFF) triggers wider casting turns.
  const casting = 1 + CAST_GAIN * odorOff;
  const noise = (training ? 0.2 : 0.09) * (1 - 0.65 * confidence) * (1 - 0.75 * odorOn) * casting;
  fly.turn = fly.turn * 0.72 + gaussian() * noise;
  const turn = clamp(fly.turn + steerTurn + innateTurn, -0.55, 0.55);

  const turnRight = relu(turn);
  const turnLeft = relu(-turn);
  for (const index of groups.dna02) rate[index] = clamp(0.06 + (nodes[index].side === "right" ? turnRight : turnLeft) * 2.2, 0, 1);
  // ON speeds the fly up and OFF slows it (Alvarez-Salvado et al. 2018).
  fly.speed = (0.34 + 0.2 * approachDrive + 0.15 * odorOn) * (1 - 0.35 * clamp(odorOff, 0, 1));
  // PFL2-like: slow down to turn around when the goal is behind.
  if (steer.behind && steer.strength > 0.2) fly.speed *= 0.6;
  for (const index of groups.dnp09) rate[index] = clamp(fly.speed * 1.4, 0, 1);
  for (const index of groups.dn) rate[index] = clamp(0.05 + fly.speed * 0.4 * Math.random() + Math.abs(turn) * 0.6 * Math.random(), 0, 1);
  for (const index of groups.pen) {
    const side = nodes[index].side === "right" ? turnRight : turnLeft;
    rate[index] = clamp(0.08 + side * 3 + Math.random() * 0.04, 0, 1);
  }

  trialStats.n++;
  trialStats.avoid += readout.avoid;
  trialStats.approach += readout.approach;
  trialStats.goal += goalStrength;
  trialStats.turn += Math.abs(turn);
  trialStats.speed += fly.speed;
  trialStats.odor += odorDrive;
  if (terminal) trialStats.dan = rewardError;

  // Eligibility traces: which KCs (and which heading) were active recently.
  for (let k = 0; k < c.kcOut.length; k++) {
    const r = c.kcSmooth[k];
    c.criticTrace[k] = c.criticTrace[k] * GAMMA * LAMBDA + r;
    c.posW[k] = c.posW[k] * POSITION_TRACE + r;
    c.posX[k] = c.posX[k] * POSITION_TRACE + r * fly.pi.x;
    c.posY[k] = c.posY[k] * POSITION_TRACE + r * fly.pi.y;
  }

  previousValue = terminal ? null : learnedValue;
  spikingStep(c);
  return turn;
}

// Sugar triggers a PAM burst that writes, for every visual KC active earlier in the
// trial, the path-integrated vector from where it fired to the food. Arriving
// where memory says the food is, and finding nothing, weakens that memory
// (PPL1 omission signal), so the fly can relearn a moved cupcake.
function updateFoodMemory(reward, terminal, readout) {
  const c = circuit;
  if (terminal && reward > 0) {
    for (let k = c.visualOffset; k < c.kcOut.length; k++) {
      const w = c.posW[k];
      if (w < 1e-3) continue;
      const dx = fly.pi.x - c.posX[k] / w;
      const dy = fly.pi.y - c.posY[k] / w;
      const a = MEMORY_RATE * Math.min(1, w);
      c.memX[k] += a * (dx - c.memX[k]);
      c.memY[k] += a * (dy - c.memY[k]);
      c.memC[k] += a * (1 - c.memC[k]);
    }
  } else if (reward <= 0 && readout.memory > 0.15 && readout.distance < 3) {
    // Omission: the food is not where memory says. Weaken the memory here
    // strongly and everywhere a little, so a moved cupcake can be relearned.
    for (let k = c.visualOffset; k < c.kcOut.length; k++) {
      const local = c.kcOut[k] ? 0.08 * Math.min(1, c.kcOut[k] * 4) : 0;
      c.memC[k] *= (1 - local) * 0.992;
    }
  }
}

// A trial that ends without sugar weakens every stored food vector.
function weakenFoodMemory(factor) {
  const c = circuit;
  for (let k = c.visualOffset; k < c.kcOut.length; k++) c.memC[k] *= factor;
}

function clearTraces() {
  circuit.criticTrace.fill(0);
  circuit.kcSmooth.fill(0);
  circuit.posX.fill(0);
  circuit.posY.fill(0);
  circuit.posW.fill(0);
  previousValue = null;
}

// Region bars show mean simulated firing rate; a neuron glows when it spiked
// since the last frame.
function updateRegionActivity() {
  const { nodes, glow, spiking } = circuit;
  const sums = new Map(regions.map((region) => [region.id, 0]));
  const counts = new Map(regions.map((region) => [region.id, 0]));
  for (let i = 0; i < nodes.length; i++) {
    sums.set(nodes[i].region, sums.get(nodes[i].region) + spiking.hz[i]);
    counts.set(nodes[i].region, counts.get(nodes[i].region) + 1);
    glow[i] = spiking.flashed[i] && !stopped && !idle ? 1 : glow[i] * 0.78;
    spiking.flashed[i] = 0;
  }
  for (const region of regions) {
    region.hz = sums.get(region.id) / Math.max(1, counts.get(region.id));
    region.activity += (clamp(region.hz / region.fullHz, 0, 1) - region.activity) * 0.16;
  }
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

function gridToCanvas(point) {
  return {
    x: arena.x + (point.x / arena.grid) * arena.w,
    y: arena.y + (point.y / arena.grid) * arena.h
  };
}

function placeCupcake(x, y) {
  cupcake = {
    x: clamp(x, 6, arena.grid - 6),
    y: clamp(y, 6, arena.grid - 6)
  };
  valueMap = [];
  // Let the new plume reach across the arena before the fly meets it.
  puffs = [];
  for (let i = 0; i < 60; i++) updatePlume();
}

function resetTrial() {
  fly = {
    x: randomBetween(6, 22),
    y: randomBetween(8, arena.grid - 8),
    heading: randomBetween(-Math.PI, Math.PI),
    turn: 0,
    speed: 0.34,
    // Path integrator: self-motion summed since the trial began (the fly
    // never sees its absolute position).
    pi: { x: 0, y: 0 }
  };
  trail = [];
  trialSteps = 0;
  rewardError = 0;
  odorOn = 0;
  odorPeak = 0;
  trialStats = newTrialStats();
  stopped = false;
  clearTraces();
}

function resetPlasticity() {
  const c = circuit;
  c.wApproach.fill(1);
  c.wAvoid.fill(1);
  c.memX.fill(0);
  c.memY.fill(0);
  c.memC.fill(0);
  learnedValue = 0;
  rewardErrorDisplay = 0;
  finds = 0;
  trial = 1;
  history = [];
  earlyTrials = [];
  testResult = null;
  training = true;
  placeCupcake(randomBetween(46, arena.grid - 10), randomBetween(14, arena.grid - 14));
  resetTrial();
}

function summarizeTrial() {
  const n = Math.max(1, trialStats.n);
  return {
    avoid: trialStats.avoid / n,
    approach: trialStats.approach / n,
    goal: trialStats.goal / n,
    turn: trialStats.turn / n,
    speed: trialStats.speed / n,
    odor: trialStats.odor / n,
    dan: trialStats.dan
  };
}

function endTrial(found) {
  if (training && !found) weakenFoodMemory(0.6);
  const entry = { steps: trialSteps, found, training, stats: summarizeTrial() };
  history.push(entry);
  if (history.length > 80) history.shift();
  if (training && earlyTrials.length < COMPARE_TRIALS) earlyTrials.push(entry);
  if (found) {
    finds++;
    lastRewardFrame = frame;
  }
  trial++;

  if (training) {
    resetTrial();
  } else {
    // A test run is a single trial: the fly stops where it ended.
    testResult = { steps: trialSteps, found };
    stopped = true;
  }
}

function startTraining() {
  idle = false;
  training = true;
  if (stopped) resetTrial();
}

function startTest() {
  idle = false;
  training = false;
  testResult = null;
  resetTrial();
}

function step() {
  if (stopped || idle) return;
  updatePlume();
  const found = dist(fly, cupcake) < 3.1;
  const wall = fly.x <= 2 || fly.x >= arena.grid - 2 || fly.y <= 2 || fly.y >= arena.grid - 2;
  const reward = found ? 1 : wall ? -0.05 : 0;
  const turn = circuitStep(reward, found);

  if (found) {
    trialSteps++;
    endTrial(true);
    frame++;
    return;
  }

  fly.heading = wrapAngle(fly.heading + turn);
  const startX = fly.x;
  const startY = fly.y;
  fly.x += Math.cos(fly.heading) * fly.speed;
  fly.y += Math.sin(fly.heading) * fly.speed;

  if (fly.x < 2 || fly.x > arena.grid - 2) fly.heading = wrapAngle(Math.PI - fly.heading);
  if (fly.y < 2 || fly.y > arena.grid - 2) fly.heading = wrapAngle(-fly.heading);
  fly.x = clamp(fly.x, 2, arena.grid - 2);
  fly.y = clamp(fly.y, 2, arena.grid - 2);

  // Idiothetic path integration with a little noise per step.
  const moved = Math.hypot(fly.x - startX, fly.y - startY);
  recordDataStats(fly.x - startX, moved, turn);
  const noise = gaussian() * PI_NOISE;
  const direction = Math.atan2(fly.y - startY, fly.x - startX) + noise;
  fly.pi.x += Math.cos(direction) * moved;
  fly.pi.y += Math.sin(direction) * moved;

  trail.push({ x: fly.x, y: fly.y, t: frame });
  if (trail.length && frame - trail[0].t >= 190) trail = trail.filter((point) => frame - point.t < 190);

  trialSteps++;
  if (trialSteps >= TRIAL_TIMEOUT) endTrial(false);
  frame++;
}

const VALUE_MAP_STEP = 3.5;
const valueProbe = { kcOut: null, cursor: 0 };

// Where the fly's brain would steer at (x, y): memory (PFL3 goal) plus smell
// (lateral-horn tropotaxis). Both turn signals are sine-shaped in heading, so
// they add like vectors, and the sum points along the heading where the net
// turn is zero. Returns the expected reward there as well.
function steeringField(x, y, kcOut) {
  // Face the fly across the odor gradient, so the innate turn it produces
  // measures how hard smell pulls toward the gradient direction.
  const gradX = meanOdorAt(x + 0.5, y) - meanOdorAt(x - 0.5, y);
  const gradY = meanOdorAt(x, y + 0.5) - meanOdorAt(x, y - 0.5);
  const gradAngle = Math.atan2(gradY, gradX);
  const sense = antennae(x, y, gradAngle - Math.PI / 2, meanOdorAt);
  const sensed = sensoryPass(sense.left, sense.right, x, y, kcOut, false);
  const readout = mbonReadout(kcOut);
  const smell = Math.hypot(gradX, gradY) > 1e-6 ? relu(innateOdorTurn(sensed.lateral, sensed.smellStrength, readout.value)) : 0;
  // On average the wind blows right to left, so odor adds an upwind (+x) goal.
  const goalX = readout.goalX + UPWIND_GAIN * sensed.smellStrength;
  const strength = Math.min(Math.hypot(goalX, readout.goalY), 1.2);
  const goalAngle = Math.atan2(readout.goalY, goalX);
  return {
    value: readout.value,
    gx: STEER_GAIN * strength * Math.cos(goalAngle) + smell * Math.cos(gradAngle),
    gy: STEER_GAIN * strength * Math.sin(goalAngle) + smell * Math.sin(gradAngle)
  };
}

// Probes the MBON value and goal readout across the arena, a few cells per
// frame so the page never stalls.
function updateValueMap(cellsPerFrame) {
  if (!valueMap.length) {
    for (let y = VALUE_MAP_STEP / 2; y < arena.grid; y += VALUE_MAP_STEP) {
      for (let x = VALUE_MAP_STEP / 2; x < arena.grid; x += VALUE_MAP_STEP) {
        valueMap.push({ x, y, value: 0, gx: 0, gy: 0 });
      }
    }
    valueProbe.cursor = 0;
  }
  if (!valueProbe.kcOut || valueProbe.kcOut.length !== circuit.kcOut.length) {
    valueProbe.kcOut = new Float32Array(circuit.kcOut.length);
  }
  for (let n = 0; n < cellsPerFrame; n++) {
    const cell = valueMap[valueProbe.cursor];
    const field = steeringField(cell.x, cell.y, valueProbe.kcOut);
    cell.value = field.value;
    cell.gx = field.gx;
    cell.gy = field.gy;
    valueProbe.cursor = (valueProbe.cursor + 1) % valueMap.length;
  }
}

// ---------------------------------------------------------------------------
// Drawing: arena
// ---------------------------------------------------------------------------

function drawPixel(x, y, size, alpha = 1) {
  const point = gridToCanvas({ x, y });
  const cell = arena.w / arena.grid;
  ctx.globalAlpha = alpha;
  ctx.fillRect(Math.round(point.x), Math.round(point.y), Math.ceil(size * cell), Math.ceil(size * cell));
  ctx.globalAlpha = 1;
}

function drawArena() {
  ctx.fillStyle = "#e8c94a";
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  ctx.fillStyle = "#f1dc76";
  ctx.fillRect(arena.x, arena.y, arena.w, arena.h);

  if (showValueToggle && showValueToggle.checked) drawValueMap();
  if (showPlumeToggle.checked) drawPlume();
  drawTrail();
  drawCupcake();
  drawFly();
  drawTestBanner();

  ctx.strokeStyle = "#171205";
  ctx.lineWidth = 8;
  ctx.strokeRect(arena.x, arena.y, arena.w, arena.h);
}

let valueLayer = null;

// Learned field: a smooth gradient of expected reward (MBON value) with an
// arrow field of the heading the fly's brain would steer from each spot.
function drawValueMap() {
  updateValueMap(20);
  const cols = Math.round(arena.grid / VALUE_MAP_STEP);
  const rows = Math.ceil(valueMap.length / cols);
  if (!valueLayer) {
    valueLayer = document.createElement("canvas");
    valueLayer.width = cols;
    valueLayer.height = rows;
  }
  const lctx = valueLayer.getContext("2d");
  const image = lctx.createImageData(cols, rows);
  valueMap.forEach((cell, i) => {
    const v = clamp(cell.value, 0, 1);
    // Ramp from pale pink to deep rose as expected reward rises.
    image.data[i * 4] = Math.round(232 - 38 * v);
    image.data[i * 4 + 1] = Math.round(150 - 64 * v);
    image.data[i * 4 + 2] = Math.round(160 - 50 * v);
    image.data[i * 4 + 3] = Math.round(Math.min(1, v * 1.4) * 170);
  });
  lctx.putImageData(image, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(valueLayer, arena.x, arena.y, arena.w, arena.h);
  ctx.restore();

  ctx.strokeStyle = "#171205";
  ctx.fillStyle = "#171205";
  ctx.lineWidth = 1.6;
  valueMap.forEach((cell, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (col % 2 || row % 2) return;
    const strength = Math.hypot(cell.gx, cell.gy) / 0.55;
    if (strength < 0.12) return;
    const angle = Math.atan2(cell.gy, cell.gx);
    const p = gridToCanvas({ x: cell.x + VALUE_MAP_STEP / 2, y: cell.y + VALUE_MAP_STEP / 2 });
    const len = 6 + Math.min(strength, 1) * 16;
    const tipX = p.x + Math.cos(angle) * len * 0.5;
    const tipY = p.y + Math.sin(angle) * len * 0.5;
    ctx.globalAlpha = clamp(0.25 + strength * 0.6, 0.25, 0.85);
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(angle) * len * 0.5, p.y - Math.sin(angle) * len * 0.5);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(angle - 0.5) * 6, tipY - Math.sin(angle - 0.5) * 6);
    ctx.lineTo(tipX - Math.cos(angle + 0.5) * 6, tipY - Math.sin(angle + 0.5) * 6);
    ctx.closePath();
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  const legend = "pink: expected reward  ·  arrows: where the fly steers (memory + smell)";
  ctx.font = "12px ui-monospace, monospace";
  const width = ctx.measureText(legend).width + 16;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#fff3b2";
  ctx.fillRect(arena.x + 10, arena.y + arena.h - 30, width, 20);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#171205";
  ctx.fillText(legend, arena.x + 18, arena.y + arena.h - 16);
}

// Each odor puff as a translucent square that grows and fades downwind.
function drawPlume() {
  const cell = arena.w / arena.grid;
  ctx.save();
  ctx.beginPath();
  ctx.rect(arena.x, arena.y, arena.w, arena.h);
  ctx.clip();
  ctx.fillStyle = "#6c94b8";
  for (const puff of puffs) {
    const peak = PUFF_MASS / puff.r2;
    if (peak < 0.03) continue;
    const p = gridToCanvas(puff);
    const size = Math.round(Math.sqrt(puff.r2) * 2.2 * cell);
    ctx.globalAlpha = clamp(peak * 0.45, 0.04, 0.4);
    ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawTrail() {
  // Thin trail through the centre of the fly's body pixel.
  const offset = (arena.w / arena.grid) * 0.55;
  ctx.fillStyle = "#171205";
  for (const point of trail) {
    const age = (frame - point.t) / 190;
    const p = gridToCanvas(point);
    ctx.globalAlpha = (1 - age) * 0.8;
    ctx.fillRect(Math.round(p.x + offset - 1), Math.round(p.y + offset - 1), 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawTestBanner() {
  if (!idle && (!stopped || !testResult)) return;
  const text = idle
    ? "press Train to start"
    : testResult.found
    ? `test: cupcake found in ${testResult.steps} steps`
    : `test: gave up after ${testResult.steps} steps`;
  ctx.font = "16px ui-monospace, monospace";
  const width = ctx.measureText(text).width + 24;
  const x = arena.x + (arena.w - width) / 2;
  const y = arena.y + 18;
  ctx.fillStyle = "#171205";
  ctx.fillRect(x, y, width, 32);
  ctx.fillStyle = "#e8c94a";
  ctx.fillText(text, x + 12, y + 21);
}

function drawCupcake() {
  ctx.fillStyle = "#171205";
  drawPixel(cupcake.x - 1, cupcake.y, 1);
  drawPixel(cupcake.x, cupcake.y, 1);
  drawPixel(cupcake.x + 1, cupcake.y, 1);
  drawPixel(cupcake.x - 1, cupcake.y + 1, 3);
  drawPixel(cupcake.x, cupcake.y - 1, 1);
}

function drawFly() {
  ctx.fillStyle = "#171205";
  drawPixel(fly.x, fly.y, 1.1);
  drawPixel(fly.x - Math.cos(fly.heading) * 1.4, fly.y - Math.sin(fly.heading) * 1.4, 1);
  drawPixel(fly.x + Math.sin(fly.heading) * 1.1, fly.y - Math.cos(fly.heading) * 1.1, 1);
  drawPixel(fly.x - Math.sin(fly.heading) * 1.1, fly.y + Math.cos(fly.heading) * 1.1, 1);
}

// ---------------------------------------------------------------------------
// Drawing: glass brain (two orthographic projections of real positions)
// ---------------------------------------------------------------------------

function brainViews() {
  const [ex, ey, ez] = projection.extent;
  const coronalH = brain.w * (ey / ex);
  const dorsalH = brain.w * (ez / ex);
  const coronal = { x: brain.x, y: brain.y + 4, w: brain.w, h: coronalH, axis: "y", label: "posterior view" };
  const dorsal = { x: brain.x, y: coronal.y + coronalH + 36, w: brain.w, h: dorsalH, axis: "z", label: "dorsal view" };
  return { coronal, dorsal };
}

function viewPoint(view, x, y, z) {
  return {
    x: view.x + x * view.w,
    y: view.y + (view.axis === "y" ? y : z) * view.h
  };
}

const BRAIN_BG = "#101318";
const BRAIN_TEXT = "rgba(232, 230, 223, 0.86)";
const BRAIN_MUTED = "rgba(232, 230, 223, 0.5)";
const glowSprites = new Map();

function glowSprite(color) {
  // Soft radial glow, pre-rendered once per colour.
  if (glowSprites.has(color)) return glowSprites.get(color);
  const size = 64;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const sctx = sprite.getContext("2d");
  const gradient = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  sctx.fillStyle = gradient;
  sctx.fillRect(0, 0, size, size);
  glowSprites.set(color, sprite);
  return sprite;
}

function renderContextLayer() {
  const layer = document.createElement("canvas");
  layer.width = Math.round(SCENE_W * renderScale);
  layer.height = Math.round(SCENE_H * renderScale);
  const lctx = layer.getContext("2d");
  lctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  const { coronal, dorsal } = brainViews();

  if (projection.context) {
    // Every FlyWire neuron as a faint additive point: dense neuropil glows.
    const points = projection.context;
    const count = points.length / 3;
    const alpha = clamp(12000 / count, 0.08, 0.2);
    const random = mulberry32(99);
    lctx.globalCompositeOperation = "lighter";
    lctx.fillStyle = "rgb(118, 136, 180)";
    lctx.globalAlpha = alpha;
    for (const view of [coronal, dorsal]) {
      for (let i = 0; i < points.length; i += 3) {
        // Depth comes in 40 nm sections; a tiny jitter hides the banding.
        const z = points[i + 2] + (random() - 0.5) * 0.03;
        const p = viewPoint(view, points[i], points[i + 1], z);
        lctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
      }
    }
  } else {
    lctx.strokeStyle = "rgba(118, 136, 180, 0.6)";
    lctx.lineWidth = 2;
    for (const view of [coronal, dorsal]) {
      lctx.beginPath();
      lctx.ellipse(view.x + view.w * 0.5, view.y + view.h * 0.45, view.w * 0.28, view.h * 0.42, 0, 0, Math.PI * 2);
      lctx.stroke();
      for (const side of [0.12, 0.88]) {
        lctx.beginPath();
        lctx.ellipse(view.x + view.w * side, view.y + view.h * 0.5, view.w * 0.1, view.h * 0.38, 0, 0, Math.PI * 2);
        lctx.stroke();
      }
    }
  }
  contextLayer = layer;
}

function drawBrain() {
  ctx.save();

  const frameX = brain.x - 24;
  const frameY = brain.y - 34;
  const frameW = brain.w + 48;
  const frameH = brain.h + 76;
  ctx.fillStyle = BRAIN_BG;
  ctx.fillRect(frameX, frameY, frameW, frameH);
  ctx.strokeStyle = "#171205";
  ctx.lineWidth = 3;
  ctx.strokeRect(frameX, frameY, frameW, frameH);

  ctx.font = "16px ui-monospace, monospace";
  ctx.fillStyle = BRAIN_TEXT;
  ctx.fillText("glass brain connectome", brain.x - 10, brain.y - 13);

  const { coronal, dorsal } = brainViews();
  if (!contextLayer) renderContextLayer();
  ctx.drawImage(contextLayer, 0, 0, SCENE_W, SCENE_H);

  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = BRAIN_MUTED;
  for (const view of [coronal, dorsal]) {
    ctx.fillText(view.label, view.x, view.y + view.h + 14);
    ctx.fillText("L", view.x - 12, view.y + view.h * 0.5);
    ctx.fillText("R", view.x + view.w + 4, view.y + view.h * 0.5);
  }

  const { nodes, glow, outgoing } = circuit;
  ctx.globalCompositeOperation = "lighter";

  // Synapses carrying a spike this frame (posterior view only, for legibility).
  ctx.lineWidth = 0.8;
  for (let i = 0; i < nodes.length; i++) {
    if (glow[i] < 0.99) continue;
    const from = nodes[i];
    const a = viewPoint(coronal, from.x, from.y, from.z);
    ctx.strokeStyle = regionById.get(from.region).glow;
    ctx.globalAlpha = 0.16;
    for (const target of outgoing[i]) {
      const to = nodes[target];
      const b = viewPoint(coronal, to.x, to.y, to.z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const view of [coronal, dorsal]) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const color = regionById.get(node.region).glow;
      const p = viewPoint(view, node.x, node.y, node.z);
      const g = glow[i];
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = color;
      ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
      if (g > 0.06) {
        const size = 5 + g * 9;
        ctx.globalAlpha = g * 0.85;
        ctx.drawImage(glowSprite(color), p.x - size / 2, p.y - size / 2, size, size);
        ctx.globalAlpha = g;
        ctx.fillRect(p.x - 1.1, p.y - 1.1, 2.2, 2.2);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  drawDescendingRings(coronal);
  drawRegionLabels(coronal);

  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = BRAIN_MUTED;
  const nodeCount = nodes.length.toLocaleString();
  const synapses = `${circuit.synapseCount.toLocaleString()} ${circuit.wired ? "real synapses" : "rule-based links"}`;
  const cloud = projection.context ? `${(projection.context.length / 3).toLocaleString()} neurons in the glass` : "approximate outline";
  const source = projection.total ? "FlyWire FAFB v783" : projection.source;
  ctx.fillText(`${source} · ${cloud} · ${nodeCount} model neurons · ${synapses}`, brain.x - 10, brain.y + brain.h + 32);
  ctx.restore();
}

// Descending neurons as rings, like a neuron browser; the most active named
// DN gets its FlyWire cell type as a label.
function drawDescendingRings(view) {
  const { nodes, glow, groups, spiking } = circuit;
  const color = regionById.get("dn").glow;
  let best = -1;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  for (const index of groups.dna02.concat(groups.dnp09, groups.dn)) {
    const g = glow[index];
    if (g < 0.3) continue;
    const node = nodes[index];
    const p = viewPoint(view, node.x, node.y, node.z);
    ctx.globalAlpha = 0.35 + g * 0.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 + g * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const index of groups.dna02.concat(groups.dnp09)) {
    if (spiking.hz[index] > 15 && (best < 0 || spiking.hz[index] > spiking.hz[best])) best = index;
  }
  if (best >= 0 && !idle && !stopped) {
    const node = nodes[best];
    const p = viewPoint(view, node.x, node.y, node.z);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.fillStyle = BRAIN_TEXT;
    const name = node.cellType || (node.group === "dna02" ? "DNa02" : "DNp09");
    ctx.fillText(`${name} ${node.side === "right" ? "R" : "L"}`, p.x + 10, p.y + 4);
  }
  ctx.globalAlpha = 1;
}

function drawRegionLabels(view) {
  // Labels sit in two columns over the optic lobes, with leader lines to each
  // region's centroid in the labelled hemisphere.
  const { nodes } = circuit;
  for (const side of ["left", "right"]) {
    const column = regions.filter((region) => region.labelSide === side);
    column.forEach((region, row) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const node of nodes) {
        if (node.region !== region.id || node.side !== side) continue;
        sx += node.x;
        sy += node.y;
        n++;
      }
      if (!n) return;
      const target = viewPoint(view, sx / n, sy / n, 0);
      const labelY = view.y + 14 + row * ((view.h - 44) / Math.max(1, column.length - 1));
      const anchorX = side === "left" ? view.x + 58 : view.x + view.w - 58;
      const radius = 3 + region.activity * 5;

      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = "#e8e6df";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(anchorX, labelY);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      ctx.globalAlpha = 0.35 + region.activity * 0.65;
      ctx.fillStyle = region.glow;
      ctx.beginPath();
      ctx.arc(anchorX, labelY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = BRAIN_TEXT;
      ctx.font = "13px ui-monospace, monospace";
      const labelX = side === "left" ? anchorX - radius - 6 - region.label.length * 7.8 : anchorX + radius + 6;
      ctx.fillText(region.label, labelX, labelY + 4);
    });
  }
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Bigger learning-curve chart: one bar per trial, running median line.
function drawCurveChart() {
  const w = CURVE_W;
  const h = CURVE_H;
  const pad = { left: 66, right: 16, top: 18, bottom: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  curveCtx.fillStyle = "#f1dc76";
  curveCtx.fillRect(0, 0, w, h);

  curveCtx.font = "17px ui-monospace, monospace";
  curveCtx.fillStyle = "rgba(23, 18, 5, 0.72)";
  curveCtx.strokeStyle = "rgba(23, 18, 5, 0.18)";
  curveCtx.lineWidth = 1;
  for (const tick of [0, 500, 1000, 1500]) {
    const y = pad.top + plotH - (tick / TRIAL_TIMEOUT) * plotH;
    curveCtx.beginPath();
    curveCtx.moveTo(pad.left, Math.round(y) + 0.5);
    curveCtx.lineTo(pad.left + plotW, Math.round(y) + 0.5);
    curveCtx.stroke();
    curveCtx.fillText(String(tick), 8, y + 6);
  }

  const slots = 60;
  const entries = history.slice(-slots);
  const live = !stopped ? [{ steps: trialSteps, live: true, training }] : [];
  const all = entries.concat(live);
  const barW = plotW / slots;
  const lastTrial = stopped ? trial - 1 : trial;
  const firstTrial = lastTrial - all.length + 1;

  all.forEach((entry, i) => {
    const barH = clamp(entry.steps / TRIAL_TIMEOUT, 0.01, 1) * plotH;
    curveCtx.globalAlpha = entry.live ? 0.35 : 0.9;
    curveCtx.fillStyle = entry.live ? "#171205" : !entry.found ? "#d88491" : entry.training ? "#171205" : "#6c94b8";
    curveCtx.fillRect(Math.round(pad.left + i * barW + 1), Math.round(pad.top + plotH - barH), Math.max(1, Math.floor(barW - 2)), Math.round(barH));
  });
  curveCtx.globalAlpha = 1;

  // Running median over the previous 7 training trials.
  curveCtx.strokeStyle = "#171205";
  curveCtx.lineWidth = 3;
  curveCtx.beginPath();
  let started = false;
  entries.forEach((entry, i) => {
    if (!entry.training) return;
    const window = entries.slice(0, i + 1).filter((item) => item.training).slice(-7).map((item) => item.steps);
    if (window.length < 3) return;
    const x = pad.left + i * barW + barW / 2;
    const y = pad.top + plotH - (median(window) / TRIAL_TIMEOUT) * plotH;
    if (!started) curveCtx.moveTo(x, y);
    else curveCtx.lineTo(x, y);
    started = true;
  });
  curveCtx.stroke();

  curveCtx.strokeStyle = "#171205";
  curveCtx.lineWidth = 2;
  curveCtx.beginPath();
  curveCtx.moveTo(pad.left, pad.top);
  curveCtx.lineTo(pad.left, pad.top + plotH);
  curveCtx.lineTo(pad.left + plotW, pad.top + plotH);
  curveCtx.stroke();

  curveCtx.fillStyle = "rgba(23, 18, 5, 0.72)";
  curveCtx.fillText(`trial ${Math.max(1, firstTrial)}`, pad.left, h - 12);
  const endLabel = `trial ${lastTrial}`;
  curveCtx.fillText(endLabel, pad.left + Math.min(plotW, all.length * barW) - curveCtx.measureText(endLabel).width, h - 12);
  if (!history.length) {
    curveCtx.font = "20px ui-monospace, monospace";
    curveCtx.fillStyle = "#171205";
    curveCtx.fillText("press Train and watch the bars shrink", pad.left + 16, pad.top + 34);
  }
}

// ---------------------------------------------------------------------------
// Readout and loop
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Model vs fly recordings
// ---------------------------------------------------------------------------

// Running measurements from this session, compared with published fly data.
function newDataStats() {
  const state = () => ({ n: 0, upwind: 0, speed: 0, turn: 0 });
  return { kcOdor: { n: 0, sum: 0 }, kcQuiet: { n: 0, sum: 0 }, baseline: state(), on: state(), off: state() };
}
let dataStats = newDataStats();

// Called once per step after the fly moves. States follow the ON / OFF
// split of Alvarez-Salvado et al. 2018: smelling, just lost the odor, or no
// odor for a while.
function recordDataStats(upwindStep, moved, turn) {
  const { groups, spiking } = circuit;
  if (odorOn > 0.3) {
    let responding = 0;
    for (const index of groups.kc_olf) if (spiking.hz[index] > 5) responding++;
    dataStats.kcOdor.sum += responding / Math.max(1, groups.kc_olf.length);
    dataStats.kcOdor.n++;
  } else if (odorPeak < 0.02) {
    let hz = 0;
    for (const index of groups.kc_olf) hz += spiking.hz[index];
    dataStats.kcQuiet.sum += hz / Math.max(1, groups.kc_olf.length);
    dataStats.kcQuiet.n++;
  }
  const state = odorOn > 0.3 ? dataStats.on : odorOn < 0.1 && odorOffLevel > 0.15 ? dataStats.off : odorPeak < 0.02 ? dataStats.baseline : null;
  if (!state) return;
  state.n++;
  state.upwind += upwindStep;
  state.speed += moved;
  state.turn += Math.abs(turn);
}

// KC -> avoidance-MBON drive from the KCs active at a place, relative to the
// naive fly.
function avoidDriveChange(x, y) {
  const c = circuit;
  if (!valueProbe.kcOut || valueProbe.kcOut.length !== c.kcOut.length) valueProbe.kcOut = new Float32Array(c.kcOut.length);
  const odor = meanOdorAt(x, y);
  sensoryPass(odor, odor, x, y, valueProbe.kcOut, false);
  let now = 0;
  let naive = 0;
  for (let k = 0; k < valueProbe.kcOut.length; k++) {
    now += valueProbe.kcOut[k] * c.toAvoid[k] * c.wAvoid[k];
    naive += valueProbe.kcOut[k] * c.toAvoid[k];
  }
  return naive > 1e-6 ? now / naive - 1 : 0;
}

const percent = (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
const meanOf = (total, n) => (n ? total / n : null);

const dataChecks = [
  {
    label: "Kenyon cells firing in odor",
    fly: "~5%, under 20%",
    source: "Honegger 2011",
    measure: () => meanOf(dataStats.kcOdor.sum, dataStats.kcOdor.n),
    show: (v) => `${Math.round(v * 100)}%`,
    match: (v) => v <= 0.2
  },
  {
    label: "Kenyon cell rate, no odor",
    fly: "almost silent",
    source: "Turner 2008",
    measure: () => meanOf(dataStats.kcQuiet.sum, dataStats.kcQuiet.n),
    show: (v) => `${v.toFixed(1)} Hz`,
    match: (v) => v < 1
  },
  {
    label: "Avoid-MBON drive, rewarded place",
    fly: "-80% paired odor",
    source: "Hige 2015",
    measure: () => (finds >= 5 ? avoidDriveChange(cupcake.x, cupcake.y) : null),
    show: percent,
    match: (v) => v <= -0.5
  },
  {
    label: "Avoid-MBON drive, other place",
    fly: "-27% unpaired odor",
    source: "Hige 2015",
    measure: () => {
      if (finds < 5) return null;
      // The arena corner farthest from the cupcake.
      const x = cupcake.x < arena.grid / 2 ? arena.grid - 8 : 8;
      const y = cupcake.y < arena.grid / 2 ? arena.grid - 8 : 8;
      return avoidDriveChange(x, y);
    },
    show: percent,
    // Hige et al. found depression specific to the paired odor.
    match: (v) => v > avoidDriveChange(cupcake.x, cupcake.y) + 0.1
  },
  {
    label: "Upwind run while smelling",
    fly: "rises",
    source: "Alvarez-Salvado 2018",
    measure: () => {
      const { on, baseline } = dataStats;
      return on.n > 50 && baseline.n > 50 ? on.upwind / on.n - baseline.upwind / baseline.n : null;
    },
    show: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}/step`,
    match: (v) => v > 0
  },
  {
    label: "Walking speed while smelling",
    fly: "rises",
    source: "Alvarez-Salvado 2018",
    measure: () => {
      const { on, baseline } = dataStats;
      return on.n > 50 && baseline.n > 50 ? on.speed / on.n / (baseline.speed / baseline.n) - 1 : null;
    },
    show: percent,
    match: (v) => v > 0
  },
  {
    label: "Turning after losing odor",
    fly: "rises",
    source: "Alvarez-Salvado 2018",
    measure: () => {
      const { off, baseline } = dataStats;
      return off.n > 50 && baseline.n > 50 ? off.turn / off.n / (baseline.turn / baseline.n) - 1 : null;
    },
    show: percent,
    match: (v) => v > 0
  },
  {
    label: "Upwind run after losing odor",
    fly: "turns negative",
    source: "Alvarez-Salvado 2018",
    measure: () => {
      const { off, baseline } = dataStats;
      return off.n > 50 && baseline.n > 50 ? off.upwind / off.n - baseline.upwind / baseline.n : null;
    },
    show: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}/step`,
    match: (v) => v < 0
  },
  {
    label: "Walking speed after losing odor",
    fly: "falls",
    source: "Alvarez-Salvado 2018",
    measure: () => {
      const { off, baseline } = dataStats;
      return off.n > 50 && baseline.n > 50 ? off.speed / off.n / (baseline.speed / baseline.n) - 1 : null;
    },
    show: percent,
    match: (v) => v < 0
  },
  {
    label: "Dopamine at sugar, trained",
    fly: "unclear in flies",
    source: "Schultz 1997",
    measure: () => {
      // Medians, since single bursts vary with whether a puff is in reach.
      // The history keeps only recent trials, so the first ones come from
      // earlyTrials.
      const bursts = (entries) => entries.filter((entry) => entry.training && entry.found).map((entry) => entry.stats.dan);
      const first = bursts(earlyTrials);
      const recent = bursts(history).slice(-10);
      if (first.length < 2 || recent.length < 10 || trial < 20) return null;
      const early = median(first);
      return early > 0 ? median(recent) / early - 1 : null;
    },
    show: percent,
    match: () => null
  }
];
let dataRows = [];

function makeDataRows() {
  dataTable.innerHTML = `
    <div class="data-row data-head"><span>Measure</span><span>Model</span><span>Fly</span><span>Source</span><span>Match</span></div>
  `;
  dataRows = dataChecks.map((check) => {
    const row = document.createElement("div");
    row.className = "data-row";
    row.innerHTML = `<span>${check.label}</span><strong>-</strong><span>${check.fly}</span><span>${check.source}</span><em>-</em>`;
    dataTable.append(row);
    return { model: row.querySelector("strong"), verdict: row.querySelector("em") };
  });
}

function renderDataChecks() {
  dataChecks.forEach((check, i) => {
    const value = check.measure();
    const row = dataRows[i];
    if (value === null || !Number.isFinite(value)) {
      row.model.textContent = "-";
      row.verdict.textContent = "-";
      row.verdict.className = "";
      return;
    }
    const match = check.match(value);
    row.model.textContent = check.show(value);
    row.verdict.textContent = match === null ? "prediction" : match ? "match" : "off";
    row.verdict.className = match === null ? "is-prediction" : match ? "is-match" : "is-off";
  });
}

const comparisons = [
  { key: "dan", label: "Dopamine at sugar", note: "PAM burst when the cupcake is reached" },
  { key: "avoid", label: "Avoid-MBON output", note: "KC to avoidance-MBON drive" },
  { key: "goal", label: "CX goal signal", note: "FC2 goal strength fed to PFL3" },
  { key: "turn", label: "Turning (DNa02)", note: "mean turn command" },
  { key: "speed", label: "Walking (DNp09)", note: "forward drive" },
  { key: "odor", label: "Smell (ORN/AL)", note: "mean odor at the antennae" }
];
let compareRows = new Map();

function makeCompareRows() {
  compareList.innerHTML = "";
  compareRows = new Map();
  for (const item of comparisons) {
    const row = document.createElement("div");
    row.className = "compare-row";
    row.title = item.note;
    row.innerHTML = `
      <span>${item.label}</span>
      <div class="compare-bars">
        <div class="compare-track"><div class="compare-fill early"></div></div>
        <div class="compare-track"><div class="compare-fill late"></div></div>
      </div>
      <span class="compare-value">-</span>
    `;
    compareList.append(row);
    compareRows.set(item.key, {
      early: row.querySelector(".early"),
      late: row.querySelector(".late"),
      value: row.querySelector(".compare-value")
    });
  }
}

function averageStat(entries, key) {
  const values = entries.map((entry) => entry.stats[key]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function renderComparison() {
  const trainingTrials = history.filter((entry) => entry.training);
  const ready = earlyTrials.length >= COMPARE_TRIALS && trainingTrials.length >= COMPARE_TRIALS * 2;
  const late = trainingTrials.slice(-COMPARE_TRIALS);
  for (const item of comparisons) {
    const row = compareRows.get(item.key);
    const early = ready ? averageStat(earlyTrials, item.key) : null;
    const recent = ready ? averageStat(late, item.key) : null;
    if (early === null || recent === null) {
      row.early.style.width = "0%";
      row.late.style.width = "0%";
      row.value.textContent = "-";
      continue;
    }
    const top = Math.max(Math.abs(early), Math.abs(recent), 1e-6);
    row.early.style.width = `${Math.round((Math.abs(early) / top) * 100)}%`;
    row.late.style.width = `${Math.round((Math.abs(recent) / top) * 100)}%`;
    const change = early !== 0 ? (recent - early) / Math.abs(early) : 0;
    row.value.textContent = `${change >= 0 ? "+" : ""}${Math.round(change * 100)}%`;
  }
}

function liveCaption() {
  if (idle) return "Waiting. Press Train and the fly starts exploring, or press Test to see what an untrained fly does.";
  if (stopped) return "Test finished. The fly has stopped, so its brain goes quiet. Press Test for another run from a new start, or Train to keep learning.";
  if (frame - lastRewardFrame < 60) return "Sugar! PAM dopamine neurons (DAN) burst, and eligible Kenyon-cell to MBON synapses change. This is the learning step.";
  if (odorOn > 0.3) return "Odor! ORNs fire on each puff. The central complex sets an upwind goal, so the fly runs into the wind and turns toward the antenna that smells more.";
  if (odorOffLevel > 0.15) return "Lost the odor: the OFF response slows the fly and widens its turns, so it casts to find the plume again.";
  if (goalConfidence > 0.35) return "Out of the plume but on course: place-like Kenyon cells recall a food vector stored at the last sugar find, and PFL3 neurons steer the fly along it.";
  return "Exploring: visual Kenyon cells track where the fly is, but nothing has been learned here yet, so descending turning commands are mostly random.";
}

let renderTick = 0;

function renderReadout() {
  trialLabel.textContent = trial;
  findsLabel.textContent = finds;
  rpeLabel.textContent = rewardErrorDisplay.toFixed(2);
  odorLabel.textContent = odorDrive.toFixed(2);
  valueLabel.textContent = learnedValue.toFixed(2);
  trainButton.classList.toggle("is-active", !idle && training);
  testButton.classList.toggle("is-active", !idle && !training);

  for (const region of regions) {
    const row = regionRows.get(region.id);
    row.fill.style.width = `${Math.round(region.activity * 100)}%`;
    row.value.textContent = `${Math.round(region.hz || 0)} Hz`;
  }

  renderTick++;
  if (renderTick % 6 === 0) {
    const recent = history.filter((entry) => entry.training).slice(-10).map((entry) => entry.steps);
    medianLabel.textContent = recent.length ? `${median(recent)} steps` : "-";
    testLabel.textContent = testResult ? (testResult.found ? `${testResult.steps} steps` : "gave up") : "-";
    captionLabel.textContent = liveCaption();
    renderComparison();
    renderDataChecks();
  }
}

function makeRegionRows() {
  regionList.innerHTML = "";
  regionRows = new Map();
  for (const region of regions) {
    const row = document.createElement("div");
    row.className = "region-row";
    row.innerHTML = `
      <span title="${region.name}"><i class="swatch" style="background: ${region.glow}"></i>${region.label}</span>
      <div class="region-track"><div class="region-fill"></div></div>
      <span>0 Hz</span>
    `;
    regionList.append(row);
    regionRows.set(region.id, {
      fill: row.querySelector(".region-fill"),
      value: row.querySelector("span:last-child")
    });
  }
}

function settleCircuit() {
  // While a finished test fly sits still, activity relaxes toward baseline.
  const { rate, spiking } = circuit;
  for (let i = 0; i < rate.length; i++) {
    rate[i] *= 0.9;
    spiking.hz[i] *= 0.9;
  }
}

let lastFrameTime = null;
let stepBudget = 0;

function loop(now = 0) {
  const elapsed = lastFrameTime === null ? 0 : Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  stepBudget += elapsed * (training ? TRAIN_STEPS_PER_SECOND : TEST_STEPS_PER_SECOND);
  const steps = Math.floor(stepBudget);
  stepBudget -= steps;
  for (let i = 0; i < steps; i++) step();
  if (stopped || idle) {
    settleCircuit();
    updatePlume();
  }
  updateRegionActivity();
  drawArena();
  drawBrain();
  drawCurveChart();
  renderReadout();
  requestAnimationFrame(loop);
}

trainButton.addEventListener("click", startTraining);
testButton.addEventListener("click", startTest);
resetBrainButton.addEventListener("click", () => {
  resetPlasticity();
  dataStats = newDataStats();
  idle = true;
});

// Match the canvas backing store to its on-screen size and pixel density so
// the glass brain stays sharp on high-DPI screens.
let renderScale = 1;
function fitCanvases() {
  const dpr = window.devicePixelRatio || 1;
  const sceneScale = Math.max(1, ((canvas.clientWidth || SCENE_W) * dpr) / SCENE_W);
  if (Math.abs(sceneScale - renderScale) > 0.01 || canvas.width !== Math.round(SCENE_W * sceneScale)) {
    renderScale = sceneScale;
    canvas.width = Math.round(SCENE_W * renderScale);
    canvas.height = Math.round(SCENE_H * renderScale);
    contextLayer = null;
  }
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

  const curveScale = Math.max(1, ((curveCanvas.clientWidth || CURVE_W) * dpr) / CURVE_W);
  curveCanvas.width = Math.round(CURVE_W * curveScale);
  curveCanvas.height = Math.round(CURVE_H * curveScale);
  curveCtx.setTransform(curveScale, 0, 0, curveScale, 0, 0);
}

window.addEventListener("resize", fitCanvases);

canvas.addEventListener("click", (event) => {
  // Click inside the arena to move the cupcake; the fly has to relearn where it is.
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * SCENE_W;
  const y = ((event.clientY - rect.top) / rect.height) * SCENE_H;
  if (x < arena.x || x > arena.x + arena.w || y < arena.y || y > arena.y + arena.h) return;
  placeCupcake(((x - arena.x) / arena.w) * arena.grid, ((y - arena.y) / arena.h) * arena.grid);
});

fitCanvases();
makeRegionRows();
makeCompareRows();
makeDataRows();
resetPlasticity();
loadConnectomeProjection();
loop();
