# Projection Tools

`build_connectome_projection.py` turns the public FlyWire neuron annotation table into `../data/connectome_projection.json`. It needs only the Python standard library.

```bash
curl -LO https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv
python3 tools/build_connectome_projection.py Supplemental_file1_neuron_annotations.tsv
```

The TSV is about 32 MB and should not be committed. The output is `connectome_projection.json` (about 130 KB) plus `brain_context.bin` (about 820 KB, every neuron for the glass cloud). Pass `--context N` to sample fewer.

What it selects (sampling is deterministic, seed 240917):

- ORNs and uniglomerular PNs from matching glomeruli, including the vinegar/fruit-responsive ones (DM1, DM4, DP1m, VA2, ...)
- AL local neurons and lateral horn neurons
- olfactory KCs (KCg-m, KCab, KCa'b') and visual KCs (KCg-d, KCab-p), plus APL
- PAM and PPL1 dopamine neurons
- all MBONs, split into approach (PPL1 compartments) and avoidance (PAM compartments) groups
- EPG, PEN, FC2 and PFL3 central complex neurons
- DNa01/DNa02 (turning), DNp09/DNb05 (forward walking) and other descending neurons

## Real synapses

`build_connectome_wiring.py` extracts the real FlyWire synapses onto the 977 model neurons into `../data/connectome_wiring.json` and `../data/connectome_wiring.bin`. It needs `pandas` and `pyarrow`, plus the annotation TSV above and `Connectivity_783.parquet` (about 100 MB, also not to be committed) from the [Shiu et al. 2024 whole-brain model](https://github.com/philshiu/Drosophila_brain_model):

```bash
curl -LO https://github.com/philshiu/Drosophila_brain_model/raw/main/Connectivity_783.parquet
python3 tools/build_connectome_wiring.py Supplemental_file1_neuron_annotations.tsv Connectivity_783.parquet
```

Each model neuron stands in for every real neuron of its cell type and side (ORNs and PNs by glomerulus). The real synapses from each presynaptic type are split across that type's model neurons, in proportion to their own direct synapses where they have some, evenly where none connects directly. Signs come from the predicted neurotransmitter (acetylcholine +, GABA and glutamate -). The current output has 34,833 model connections standing for 631,412 real synapses.
