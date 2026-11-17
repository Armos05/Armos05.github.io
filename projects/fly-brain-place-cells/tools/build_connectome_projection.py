#!/usr/bin/env python3
"""
Build the website's glass-brain projection from real FlyWire FAFB annotations.

Input: the public FlyWire neuron annotation table (Schlegel et al. 2024,
Supplemental file 1), which lists every proofread neuron in the FAFB v783
brain with a position (4 x 4 x 40 nm voxels), class, cell type and side:

  https://github.com/flyconnectome/flywire_annotations
  supplemental_files/Supplemental_file1_neuron_annotations.tsv

Output: ../data/connectome_projection.json containing

  - `context_file` (brain_context.bin): every proofread neuron in the brain
    (optic lobes included) as little-endian uint16 x/y/z triplets. The browser
    draws them as a glowing cloud, so the glass brain is the real brain shape.
  - `nodes`: the real neurons that stand in for each unit of the browser
    circuit model (ORNs, uniglomerular PNs, LNs, LH neurons, Kenyon cells,
    APL, PAM / PPL1 dopamine neurons, MBONs, EPG / PEN / FC2 / PFL3 central
    complex neurons, descending neurons). Each keeps its FlyWire root id.

Wiring between the model units is built in the browser from known class-to-
class projections (ORN -> PN by glomerulus, PN -> KC random sparse, KC -> MBON,
...). It is not read from the FlyWire synapse table yet; that is the next step
of the offline pipeline.

Standard library only:

  python3 tools/build_connectome_projection.py path/to/annotations.tsv
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import struct
from pathlib import Path

VOXEL_NM = (4.0, 4.0, 40.0)
SEED = 240917

# Glomeruli with (approximate) strong responses to vinegar / fermenting fruit /
# yeast volatiles, i.e. what a cupcake would smell like to a fly. Values are the
# relative drive used by the browser model, not measured firing rates.
CUPCAKE_GLOMERULI = {
    "DM1": 1.0,
    "DM4": 0.95,
    "DP1m": 0.85,
    "VA2": 0.8,
    "DM2": 0.75,
    "DM3": 0.6,
    "DM5": 0.5,
    "VM7d": 0.45,
    "DL1": 0.35,
    "VA3": 0.3,
}

# MBONs in PPL1-innervated compartments (gamma1pedc, gamma2alpha'1, alpha'2alpha2,
# alpha3, alpha'1, alpha2p3p) are treated as approach MBONs; the rest sit in
# PAM compartments and are treated as avoidance MBONs. Approximate split.
APPROACH_MBONS = {"MBON11", "MBON12", "MBON13", "MBON14", "MBON15", "MBON18", "MBON19"}

OLFACTORY_KC = ("KCg-m", "KCab", "KCapbp-m", "KCapbp-ap1", "KCapbp-ap2")
VISUAL_KC = ("KCg-d", "KCab-p")


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def position(row: dict[str, str]) -> tuple[float, float, float] | None:
    try:
        return tuple(float(row[key]) * VOXEL_NM[i] / 1000.0 for i, key in enumerate(("pos_x", "pos_y", "pos_z")))
    except (KeyError, ValueError):
        return None


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[int(q * (len(ordered) - 1))]


def glomerulus_of_orn(cell_type: str) -> str | None:
    return cell_type[4:] if cell_type.startswith("ORN_") else None


def glomerulus_of_pn(cell_type: str) -> str | None:
    match = re.match(r"^([A-Z]{1,2}\d?[a-z]{0,2})_(ad|l|v|lv|il)PN\d?$", cell_type)
    return match.group(1) if match else None


def pick(rows: list[dict[str, str]], count: int, rng: random.Random) -> list[dict[str, str]]:
    rows = list(rows)
    rng.shuffle(rows)
    return rows[:count]


def pick_balanced(rows: list[dict[str, str]], count: int, rng: random.Random) -> list[dict[str, str]]:
    left = [row for row in rows if row["side"] == "left"]
    right = [row for row in rows if row["side"] == "right"]
    half = count // 2
    return pick(left, half, rng) + pick(right, count - half, rng)


def build(rows: list[dict[str, str]], context_count: int) -> tuple[dict, bytes]:
    rng = random.Random(SEED)
    rows = [row for row in rows if position(row)]
    points = [position(row) for row in rows]

    lows = [percentile([p[i] for p in points], 0.001) for i in range(3)]
    highs = [percentile([p[i] for p in points], 0.999) for i in range(3)]
    spans = [highs[i] - lows[i] for i in range(3)]

    def normalized(row: dict[str, str]) -> tuple[float, float, float]:
        p = position(row)
        return tuple(min(1.0, max(0.0, (p[i] - lows[i]) / spans[i])) for i in range(3))

    selected: list[tuple[str, str, dict[str, str], dict]] = []

    def add(group: str, region: str, chosen: list[dict[str, str]], **extra) -> None:
        for row in chosen:
            selected.append((group, region, row, dict(extra)))

    by_class: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_class.setdefault(row["cell_class"], []).append(row)

    # Olfactory periphery and antennal lobe, matched by glomerulus.
    orn_by_glom: dict[str, list[dict[str, str]]] = {}
    for row in by_class.get("olfactory", []):
        glom = glomerulus_of_orn(row["cell_type"])
        if glom and row["side"] in ("left", "right"):
            orn_by_glom.setdefault(glom, []).append(row)

    pn_by_glom: dict[str, list[dict[str, str]]] = {}
    for row in by_class.get("ALPN", []):
        glom = glomerulus_of_pn(row["cell_type"])
        if glom:
            pn_by_glom.setdefault(glom, []).append(row)

    shared = sorted(set(orn_by_glom) & set(pn_by_glom))
    others = [glom for glom in shared if glom not in CUPCAKE_GLOMERULI]
    rng.shuffle(others)
    glomeruli = [glom for glom in CUPCAKE_GLOMERULI if glom in shared] + others[:22]

    for glom in glomeruli:
        drive = CUPCAKE_GLOMERULI.get(glom, 0.0)
        add("orn", "orn", pick_balanced(orn_by_glom[glom], 4, rng), glom=glom, drive=drive)
        add("pn", "al", pick_balanced(pn_by_glom[glom], 2, rng), glom=glom, drive=drive)

    add("ln", "al", pick_balanced(by_class.get("ALLN", []), 24, rng))
    add("lh", "lh", pick_balanced(by_class.get("LHLN", []) + by_class.get("LHCENT", []), 36, rng))

    # Mushroom body.
    kcs = by_class.get("Kenyon_Cell", [])
    add("kc_olf", "mb", pick_balanced([r for r in kcs if r["cell_type"] in OLFACTORY_KC], 200, rng))
    add("kc_vis", "mb", pick_balanced([r for r in kcs if r["cell_type"] in VISUAL_KC], 140, rng))
    add("apl", "mb", [r for r in rows if r["cell_type"] == "APL"])

    add("pam", "dan", pick_balanced([r for r in by_class.get("DAN", []) if r["cell_type"].startswith("PAM")], 48, rng))
    add("ppl1", "dan", [r for r in rows if r["cell_type"].startswith("PPL1")])

    for row in by_class.get("MBON", []):
        types = set(row["cell_type"].split(","))
        group = "mbon_ap" if types & APPROACH_MBONS else "mbon_av"
        add(group, "mbon", [row])

    # Central complex compass and steering.
    add("epg", "cx", [r for r in rows if r["cell_type"] == "EPG"])
    add("pen", "cx", [r for r in rows if r["cell_type"].startswith("PEN")])
    add("fc2", "cx", pick([r for r in rows if r["cell_type"].startswith("FC2")], 32, rng))
    add("pfl3", "cx", [r for r in rows if r["cell_type"] == "PFL3"])

    # Descending output.
    add("dna02", "dn", [r for r in rows if r["cell_type"] in ("DNa02", "DNa01")])
    add("dnp09", "dn", [r for r in rows if r["cell_type"] in ("DNp09", "DNb05")])
    named = {"DNa02", "DNa01", "DNp09", "DNb05"}
    add("dn", "dn", pick_balanced([r for r in rows if r["super_class"] == "descending" and r["cell_type"] not in named], 70, rng))

    nodes = []
    for group, region, row, extra in selected:
        x, y, z = normalized(row)
        node = {
            "x": round(x, 4),
            "y": round(y, 4),
            "z": round(z, 4),
            "region": region,
            "group": group,
            "side": row["side"],
            "cell_type": row["cell_type"],
            "body_id": row["root_id"],
        }
        node.update(extra)
        nodes.append(node)

    # Ascending neurons enter from the neck; many are annotated on the cut plane
    # itself (one z section), which would draw as a flat bar. Leave them out of
    # the glass cloud.
    z_counts: dict[str, int] = {}
    for row in rows:
        z_counts[row["pos_z"]] = z_counts.get(row["pos_z"], 0) + 1
    cut_planes = {z for z, n in z_counts.items() if n > 1000}
    cloud = [row for row in rows if not (row["pos_z"] in cut_planes and "ascending" in row["super_class"])]
    context_rows = cloud if context_count <= 0 else pick(cloud, context_count, rng)
    context = bytearray()
    for row in context_rows:
        context += struct.pack("<3H", *(round(value * 65535) for value in normalized(row)))

    return {
        "source": "FlyWire FAFB v783 neuron positions",
        "dataset": "flyconnectome/flywire_annotations Supplemental_file1_neuron_annotations.tsv",
        "created_by": "tools/build_connectome_projection.py",
        "notes": (
            "Positions are real FlyWire neuron positions (pos_x/y/z), normalized per axis. "
            "x: fly left -> right, y: dorsal -> ventral, z: anterior -> posterior. "
            "Model wiring is class-based and generated in the browser, not read from the synapse table."
        ),
        "extent_um": [round(span, 1) for span in spans],
        "total_neurons": len(rows),
        "context_file": "brain_context.bin",
        "context_count": len(context_rows),
        "context_scale": 65535,
        "nodes": nodes,
    }, bytes(context)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("annotations", type=Path, help="Supplemental_file1_neuron_annotations.tsv")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "data" / "connectome_projection.json")
    parser.add_argument("--context", type=int, default=0, help="neurons in the glass cloud (0 = every neuron)")
    args = parser.parse_args()

    projection, context = build(read_rows(args.annotations), args.context)
    args.out.write_text(json.dumps(projection, separators=(",", ":")), encoding="utf-8")
    (args.out.parent / projection["context_file"]).write_bytes(context)
    counts: dict[str, int] = {}
    for node in projection["nodes"]:
        counts[node["group"]] = counts.get(node["group"], 0) + 1
    print(f"wrote {args.out} with {len(projection['nodes'])} circuit neurons and {projection['context_count']} context neurons")
    print(counts)


if __name__ == "__main__":
    main()
