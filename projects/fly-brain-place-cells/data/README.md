# Glass Brain Data

The website loads this file at runtime:

```text
data/connectome_projection.json
```

It is generated from the public FlyWire FAFB v783 neuron annotations by `tools/build_connectome_projection.py`, and it holds:

- `nodes`: 977 real FlyWire neurons. Each one stands in for one unit of the browser circuit model (`group`), keeps its FlyWire `body_id` (root id) and `cell_type`, and sits at its real position.
- `brain_context.bin` (named by `context_file`): every FlyWire neuron (137,052, leaving out ascending neurons pinned to the neck cut plane) as little-endian uint16 x/y/z triplets scaled by `context_scale` (65535). About 820 KB. The page draws them as the glowing glass cloud.
- `extent_um`: the physical span of each normalized axis, so the projections keep the correct aspect ratio.

Axes: `x` runs from the fly's left to its right, `y` from dorsal to ventral, and `z` from anterior to posterior. Positions are FlyWire `pos_x/y/z` (4 x 4 x 40 nm voxels), normalized per axis.

The page also loads the real wiring, written by `tools/build_connectome_wiring.py` from the FlyWire v783 synapse table as packaged by Shiu et al. 2024:

- `connectome_wiring.bin` (named by `edges_file`, about 280 KB): one 8-byte record per model connection, little-endian `uint16 pre`, `uint16 post`, `float32 signed synapses`. `pre` and `post` index `nodes` in `connectome_projection.json`. The sign comes from the predicted neurotransmitter.
- `connectome_wiring.json`: metadata (`edge_count`, `represented_synapses`, `direct_connections`, `direct_synapses`) and `coverage`, one number per node: the fraction of that neuron's real input synapses that come from cell types in the model. Neurons below 0.5 (for example PFL3 and the descending neurons) are driven at model rates instead of being simulated from synapses.

Each model neuron carries the synapses of all real neurons of its cell type and side, so the counts are type-level totals, not single-neuron counts.

If the wiring fails to load, the browser falls back to class-level rules (ORN to PN by glomerulus, random 6-claw PN to KC, and so on) and the Stage label says "FlyWire positions" instead of "FlyWire synapses".

If the fetch fails (for example when the page is opened from `file://`), the page falls back to approximate built-in anatomy and the Stage label says "Offline anatomy".

`connectome_projection.sample.json` shows the shape, and `connectome_projection.schema.json` is the contract.

Data: FlyWire (Dorkenwald et al. 2024; Schlegel et al. 2024), CC BY 4.0. Synapse table: Shiu et al. 2024.
