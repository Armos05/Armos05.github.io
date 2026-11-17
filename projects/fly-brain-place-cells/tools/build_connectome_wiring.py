#!/usr/bin/env python3
"""
Extract the real FlyWire synapses onto the browser model's neurons.

Inputs:

  - ../data/connectome_projection.json, written by build_connectome_projection.py
    (the 977 model neurons and their FlyWire root ids).
  - The FlyWire neuron annotation table (Schlegel et al. 2024, Supplemental
    file 1), for every neuron's cell type and side.
  - Connectivity_783.parquet from the Shiu et al. 2024 whole-brain LIF model
    (github.com/philshiu/Drosophila_brain_model): one row per connected pair of
    FAFB v783 neurons with its synapse count and a sign from the predicted
    neurotransmitter (acetylcholine +, GABA / glutamate -).

Most model populations are a sample of a real cell type (4 of ~50 DM1 ORNs,
200 of ~2,000 Kenyon cells), so each model neuron stands in for every real
neuron of its type on its side. For each model neuron and each presynaptic
type, all real synapses from that type are split across the type's model
neurons: in proportion to their own synapses where they have some, evenly
where none of them connects directly. PNs are typed by glomerulus and ORNs
by glomerulus, so a Kenyon cell gets its full real input from each glomerulus.

Outputs:

  - ../data/connectome_wiring.bin: one record per model connection, as
    little-endian (uint16 pre, uint16 post, float32 signed synapses).
  - ../data/connectome_wiring.json: metadata, and for each model neuron the
    fraction of its real input synapses that come from types in the model.

Needs pandas and pyarrow to read the parquet file:

  python3 tools/build_connectome_wiring.py annotations.tsv Connectivity_783.parquet
"""

from __future__ import annotations

import argparse
import csv
import json
import struct
from collections import defaultdict
from pathlib import Path

import pandas as pd

from build_connectome_projection import glomerulus_of_orn, glomerulus_of_pn

DATA = Path(__file__).resolve().parent.parent / "data"


def type_keys(annotations: Path) -> dict[int, str]:
    """Cell type plus side for every neuron; ORNs and uniglomerular PNs by glomerulus."""
    keys = {}
    with annotations.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            cell_type = row["cell_type"]
            glom = glomerulus_of_orn(cell_type) or (glomerulus_of_pn(cell_type) if row["cell_class"] == "ALPN" else None)
            if glom:
                name = ("ORN_" if cell_type.startswith("ORN_") else "PN_") + glom
            else:
                name = cell_type or row["hemibrain_type"] or row["root_id"]
            keys[int(row["root_id"])] = f"{name}|{row['side']}"
    return keys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("annotations", type=Path, help="Supplemental_file1_neuron_annotations.tsv")
    parser.add_argument("connectivity", type=Path, help="Connectivity_783.parquet")
    parser.add_argument("--projection", type=Path, default=DATA / "connectome_projection.json")
    args = parser.parse_args()

    nodes = json.loads(args.projection.read_text(encoding="utf-8"))["nodes"]
    index = {int(node["body_id"]): i for i, node in enumerate(nodes)}
    keys = type_keys(args.annotations)

    members: dict[str, list[int]] = defaultdict(list)
    for root, i in index.items():
        members[keys.get(root, str(root))].append(i)

    con = pd.read_parquet(args.connectivity, columns=["Presynaptic_ID", "Postsynaptic_ID", "Connectivity", "Excitatory x Connectivity"])
    into = con[con.Postsynaptic_ID.isin(index)].copy()
    into["post"] = into.Postsynaptic_ID.map(index)
    into["type"] = into.Presynaptic_ID.map(lambda root: keys.get(root, str(root)))
    into["pre"] = into.Presynaptic_ID.map(index)

    totals = into.groupby("post").Connectivity.sum()
    represented = into[into["type"].isin(members)]
    covered = represented.groupby("post").Connectivity.sum()

    edges: dict[tuple[int, int], float] = defaultdict(float)
    for (post, key), group in represented.groupby(["post", "type"]):
        signed_total = float(group["Excitatory x Connectivity"].sum())
        direct = group[group.pre.notna()]
        if len(direct):
            weight = float(direct.Connectivity.sum())
            for pre, count in zip(direct.pre.astype(int), direct.Connectivity):
                edges[(pre, int(post))] += signed_total * count / weight
        else:
            share = signed_total / len(members[key])
            for pre in members[key]:
                edges[(pre, int(post))] += share

    binary = bytearray()
    for (pre, post), weight in edges.items():
        if pre != post and abs(weight) >= 0.05:
            binary += struct.pack("<HHf", pre, post, weight)

    (DATA / "connectome_wiring.bin").write_bytes(bytes(binary))
    direct = into[into.pre.notna()]
    meta = {
        "source": "FlyWire FAFB v783 synapses",
        "dataset": "philshiu/Drosophila_brain_model Connectivity_783.parquet (Shiu et al. 2024)",
        "created_by": "tools/build_connectome_wiring.py",
        "notes": (
            "edges_file: uint16 pre, uint16 post, float32 signed synapses, indices into connectome_projection.json nodes. "
            "Each model neuron stands in for all real neurons of its cell type and side. "
            "Sign from predicted neurotransmitter (ACh +, GABA/Glu -). "
            "coverage: fraction of each node's real input synapses from cell types in the model."
        ),
        "edges_file": "connectome_wiring.bin",
        "edge_count": len(binary) // 8,
        "direct_connections": len(direct),
        "direct_synapses": int(direct.Connectivity.sum()),
        "represented_synapses": int(covered.sum()),
        "coverage": [round(float(covered.get(i, 0)) / max(1, int(totals.get(i, 0))), 3) for i in range(len(nodes))],
    }
    (DATA / "connectome_wiring.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {meta['edge_count']} model connections standing for {meta['represented_synapses']} real synapses "
        f"({meta['direct_connections']} direct connections, {meta['direct_synapses']} synapses, between model neurons)"
    )


if __name__ == "__main__":
    main()
