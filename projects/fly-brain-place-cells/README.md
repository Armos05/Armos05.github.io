# Fly Connectome Navigation Lab

This project asks a careful version of the original idea:

Can place-like navigation behavior emerge from a Drosophila-inspired circuit while a fly searches for a sweet odor source?

Important biological note: fruit flies do not have a hippocampus, so this is not literally a fly place-cell model. The serious target is a connectome-grounded navigation loop using fly-relevant structures:

- ORN: olfactory receptor neurons sense the cupcake odor.
- AL: antennal lobe transforms odor input.
- MB / KC: mushroom body and Kenyon-cell-like sparse odor context.
- DAN: dopamine reward signal when sweetness is reached.
- MBON: learned value output from mushroom body pathways.
- CX: central-complex-style orientation and navigation state.
- DN: descending-neuron-style motor output.
- LH: lateral horn, the innate odor-approach pathway.

## Current Website Slice

The browser page runs a small pixel fly in an arena with a cupcake odor source, and a glass brain showing which real neurons are active.

### How the fly learns

The fly is never told where the cupcake is. It has only what a fly has:

- **Two antennae.** Odor arrives as patchy puffs carried by a meandering wind (a filament plume, Farrell et al. 2002) and is sampled at the left and right antenna. ORNs feed PNs through their real FlyWire synapses, with same-side synapses weighted x1.4 for stronger ipsilateral release (Gaudry et al. 2013), and AL local neurons normalize them divisively.
- **A panoramic view of the walls.** Each wall's apparent elevation is encoded by tuned visual channels.
- **A heading compass.** An EPG bump in the central complex, with PEN activity during turns.

The circuit, one tick at a time:

1. **Innate pathway (LH).** For each cupcake-responsive glomerulus, the left and right PN inputs are compared before gain control (Gaudry et al. 2013). Receptor gain control (Weber's law) keeps that contrast usable near the cupcake. The turn toward the stronger antenna scales with smell strength `S` (0 far away, 1 near), while random turning shrinks with `S`. So the closer the fly is, the more smell steers it.
   - **Odor ON and OFF** (Alvarez-Salvado et al. 2018): while smelling, the fly runs upwind, faster and straighter, through an upwind goal in the fan-shaped body (Matheson et al. 2022). Just after losing the odor, it slows, casts with wider turns and drifts back downwind.
   - Averaged over time the plume peaks at the cupcake, with a downwind tail toward the start area. The gradient field uses this average.
2. **Mushroom body.** Olfactory KCs get their real PN claws from FlyWire. Visual KCs (KCg-d, KCab-p) are coincidence detectors for two wall channels. APL inhibition keeps only the top ~5% active. Because visual KCs fire for conjunctions of wall views, their responses are place-like even though no input is a place cell.
3. **Dopamine teaching signal.** MBON output gives a value `V = sum_k KC_k (a_k w_approach_k - b_k w_avoid_k) - naive`, where `a_k`, `b_k` are each KC's real synapses onto approach and avoid MBONs and `naive` is the same sum before learning. DANs report the reward prediction error `delta = r + gamma V(t) - V(t-1)`, with sugar at the cupcake as `r = 1` and wall bumps as a small negative `r`.
4. **Plasticity at KC to MBON synapses.** An eligibility trace `e_k <- gamma lambda e_k + KC_k` marks recently active KCs.
   - When `delta > 0`, PAM depresses eligible KC to avoidance-MBON synapses (rate 0.15) and lets depressed approach synapses recover.
   - When `delta < 0`, PPL1 does the reverse.
   - A slow homeostatic lift restores capacity without changing the value.
5. **Food-vector memory (path integration + dopamine).** The fly path-integrates its own movement, with a little noise, from the start of each trial. It never sees its absolute position. Each visual KC keeps a trace of where, in path-integrated coordinates, it fired this trial.
   - **At the sugar:** the PAM burst writes, for each such KC, the vector from that place to the food: `v_k += a (food - place_k - v_k)`, with certainty `c_k -> 1`.
   - **Recall:** wherever the fly is, the active visual KCs sum their certainty-weighted vectors into a goal in the fan-shaped body. FC2 shows the goal, and PFL3 compares it with the EPG heading to drive DNa02 turning, in proportion to `sin(goal - heading)`.
   - **Turnaround:** PFL3 alone has a blind spot when the goal is directly behind, because `sin` is about 0 there. When the goal is more than 90 degrees away, a PFL2-like term saturates the turn and slows the fly so it turns around. Without it, test flies sometimes walked against the arrows for about 100 steps.
   - **Forgetting:** arriving where memory says food is and finding nothing weakens the memory (a PPL1 omission signal), and so does a trial that times out. A moved cupcake gets relearned in about 5-10 trials.
   - **Why only visual KCs:** olfactory KCs are left out of the vector memory. They fire across the whole plume, so they carry odor identity rather than place.
6. **Motor output.** DNa02 turns the fly and DNp09 sets forward speed, which rises with learned approach drive and odor ON. Exploration noise shrinks as goal confidence grows and while odor is on.
7. **Spiking network.** Alongside the rate model, all 977 neurons are leaky integrate-and-fire neurons with the Shiu et al. 2024 constants, wired by 631,412 real FlyWire synapses (each model neuron carries its whole cell type's synapses). The antennal lobe, lateral horn, Kenyon cells, APL and MBONs fire only through those synapses. ORNs, visual KCs, DANs, the central complex and neurons whose inputs are mostly outside the model fire Poisson spikes at their model rates. Learned KC to MBON weights scale the spiking synapses too. These spikes drive the glass brain and the data check; steering still comes from the rate model.

Early trials are meandering random walks that only succeed inside the plume. Across trials the value spreads backward from the cupcake through the visual KCs, and the fly walks straight toward it from anywhere.

Controls:

- The fly waits until **Train** is pressed. Train runs automatic trials at 75 simulation steps per second, with plasticity on. Test runs at 50 steps per second. The speed is time-based, so it is the same on 60 Hz and 120 Hz screens.
- **Test** freezes plasticity, lowers exploration, and runs a single trial from a new start. The fly stops at the cupcake and a banner shows the step count.
- **Reset Brain** wipes learning, places a new cupcake, and the fly waits again.
- **Click the arena** to move the cupcake. The fly has to relearn where it is.
- The **Gradient field** overlay shows a smooth gradient of learned MBON value (pink, peaking at the cupcake) and an arrow field of where the fly would steer from each spot. The arrows are the vector sum of the memory steering term (PFL3 goal) and the innate smell term (LH tropotaxis). Both are sine-shaped in heading, so their sum points along the heading where the net turn is zero. In test runs the fly walks along the arrows in open field. The remaining mismatches are near the cupcake, where it overshoots and loops back, and in the first few steps while it turns from a random start heading.

The second row shows three panels:

- **Steps to cupcake:** one bar per trial, plus the running median.
- **Brain regions right now:** live bars and a caption explaining what is active.
- **What changed with learning:** the first 5 versus the latest 5 training trials, for dopamine at sugar, avoid-MBON output, CX goal signal, DNa02 turning, DNp09 walking and odor.

Below them, **Model Vs Fly Recordings** measures the current run against published data: KC sparseness in odor and silence without it (Honegger et al. 2011; Turner et al. 2008), avoid-MBON depression at the rewarded and an unrewarded place (Hige et al. 2015), upwind running, speed and turning during and after odor (Alvarez-Salvado et al. 2018), and the dopamine burst at sugar as a prediction.

Headless check across 4 seeds, 40 training trials, 8 tests before and after training:

- An untrained fly's test runs took a median of 195-479 steps, with no timeouts.
- After training, test runs took 97-119 steps, and all 32 tests reached the cupcake.
- The dopamine burst at sugar fell from 0.69-0.92 to 0.31-0.42.
- Data check: 7-8% of KCs fire in odor and 0.0-0.1 Hz without it; flies run upwind and 29-41% faster while smelling and turn 23-49% more after losing it. Avoid-MBON drive at the rewarded place fell only 25-38%, against about 80% in flies, while the far corner fell 11-16%. Drifting back downwind after losing odor is mixed.

The full step-by-step explanation, with equations and sources, is in `explanation.md`.

The earlier actor-critic heading rule plateaued around 300 training steps and 130-190 test steps. It also mostly learned a single "go east" direction.

The page also sets each region against the literature and flags where the model diverges. For example, real place learning depends on the central complex (Ofstad et al. 2011), but here the place code sits in visual Kenyon cells.

### Glass brain

Every drawn neuron is a real FlyWire FAFB v783 neuron at its real position. Each one stands in for one model unit and flashes when that unit spikes in the spiking network. The glowing blue-grey cloud behind them is every FlyWire neuron, 137,052 of them, drawn additively on a dark background, so dense neuropil glows and the outline is the actual brain shape, optic lobes included. Ascending neurons annotated on the neck cut plane are left out of the cloud. Active neurons glow in their region colour, and firing descending neurons get green rings, with the most active named one labelled (e.g. "DNa02 R"). When the fly is idle or a test run has finished, spiking stops and the brain goes quiet. Two orthographic projections are shown: posterior (x-y) and dorsal (x-z). Lines run from a spiking neuron to its three strongest real synaptic targets. Region bars show mean spike rates in Hz.

Honest limits:

- Synapses are real counts, but scaled by cell type: each model neuron carries its whole type's synapses, so neurons of one type are more alike than real ones.
- Behaviour and learning run on the rate model. The spiking network runs on real synapses beside it.
- The central complex and descending neurons are driven at model rates, because most of their real input comes from cell types not in the model.
- The synapse gain (0.3) and PN to KC claw gain (4) are calibrated, not measured.
- MBON depression at the rewarded place is weaker than in flies.
- The cupcake-responsive glomeruli and their drive levels are approximate.

Inspired by [fly.ai](https://github.com/alextitonis/fly.ai):

- Signed, normalized input per neuron.
- Stimulus injected at sensory neurons.
- Behavior read out from descending neurons, not from a hand-coded controller.

Unlike fly.ai, this model adds dopamine-gated plasticity, because the point here is learning.

Data files: `data/connectome_projection.json`, built by `tools/build_connectome_projection.py` from the public [FlyWire annotations](https://github.com/flyconnectome/flywire_annotations), and `data/connectome_wiring.json` / `.bin`, built by `tools/build_connectome_wiring.py` from the FlyWire synapse table packaged with the [Shiu et al. 2024 model](https://github.com/philshiu/Drosophila_brain_model). See `data/README.md` for the formats.

## Offline Simulation Plan

The heavier version should live in a reproducible GitHub pipeline:

1. Choose a data source and document provenance.
2. Export or preprocess selected FlyWire / Codex / FAFB-like connectome tables.
3. Build a sparse graph of neurons and signed/weighted synapses. (Done for the browser model: `tools/build_connectome_wiring.py`.)
4. Drive sensory neurons from the arena state.
5. Run neural activity with a simple dynamical model first, then improve it.
6. Aggregate activity by region.
7. Save traces to compact JSON or NPZ.
8. Render a short MP4/WebM video for the website.

## First Neural Dynamics Model

Start with a discrete-time rate model:

```text
x[t + 1] = decay * x[t] + activation(W @ x[t] + sensory[t] + reward[t])
```

Then add plasticity only to the relevant mushroom-body reward pathway:

```text
eligibility[t + 1] = lambda * eligibility[t] + KC_activity[t]
delta = reward[t] - predicted_value[t]
MBON_weight += eta * delta * eligibility[t]
```

## Website Output

The website should eventually show:

- A short video of the full simulation.
- A synchronized arena and brain-region activity timeline.
- A clear explanation of the equations.
- Links to the code, data source, and preprocessing steps.

## References To Inspect

- FlyWire / Codex: https://codex.flywire.ai/?dataset=fafb
- FlyWire annotations: https://github.com/flyconnectome/flywire_annotations
- NeuroMechFly: https://github.com/NeLy-EPFL/NeuroMechFly
- FlyGym example: https://github.com/NathanMULLER/flygym-game
- FlyCoinRH: https://github.com/fruitflydev/flycoinrh
- fly.ai: https://github.com/alextitonis/fly.ai
