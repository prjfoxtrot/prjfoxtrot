#!/usr/bin/env python
"""
generic_lc_lut_4_rand_all.py
============================

Random‑All LUT‑initialisation fuzzer
-----------------------------------
Vendor‑agnostic (tested on Xilinx 7‑Series) fuzzer that builds a **single, very long
LUT chain** (``N`` LUTs, ``K`` inputs each) and fills every LUT with either:

* one of the user‑supplied *static* ``INIT`` patterns (for the first
  ``len(static_init_values)`` LUTs), or
* a freshly generated **pseudo‑random** ``INIT`` pattern.

The procedure is repeated ``num_values`` times to gather statistics on
arbitrary LUT contents.
"""
from __future__ import annotations

import random
from typing import Dict, List

from foxtrot_core.bitgen.fuzz.base import Fuzzer
from foxtrot_core.bitgen.params import build_param_set

# ──────────────────────────────────────────────────────────────────────────────
# Helper utilities
# ──────────────────────────────────────────────────────────────────────────────

def _plain_bits(pattern: str, k: int) -> str:
    """Return *pattern* stripped of the ``'b`` prefix and underscores."""
    bits = pattern.split("b")[-1].replace("_", "")
    if len(bits) != (1 << k):
        raise ValueError(
            f"Pattern '{pattern}' has {len(bits)} bits; expected {1 << k} for K={k}"
        )
    return bits


def _build_flat_init_literal(n: int, k: int, static_patterns: List[str]) -> str:
    """Return a single Verilog literal that initialises an ``N``‑deep LUT chain."""
    lut_bits = 1 << k
    static_bits = [_plain_bits(pat, k) for pat in static_patterns]

    if len(static_bits) > n:
        raise ValueError("More static patterns than LUTs in the chain")

    # Fill the remainder of the chain with random INIT patterns
    while len(static_bits) < n:
        rnd = "".join(random.choice("01") for _ in range(lut_bits))
        static_bits.append(rnd)

    # Concatenate in reverse order so LUT N‑1 becomes the MSB slice
    flat_bits = "".join(reversed(static_bits))
    return f"{len(flat_bits)}'b{flat_bits}"


# ──────────────────────────────────────────────────────────────────────────────
# Analysis callback
# ──────────────────────────────────────────────────────────────────────────────

def analyze_results(fuzzer: Fuzzer, dynamic_params: List[Dict]) -> None:
    """Compute statistics after each experiment group and extend the DB rows."""

    # Exactly one parameter set per group
    param_set = dynamic_params[0]

    # Find the corresponding successful result row
    result = next(
        (
            r
            for r in fuzzer.results
            if r.get("success")
            and r["params"]["verilog_parameters"] == param_set["verilog_parameters"]
        ),
        None,
    )
    if result is None:
        print("[ANALYSIS] Skipped – no successful result for this group.")
        return

    offsets: List[int] = result["data"]["offsets"]
    total_bits = len(offsets)
    total_luts = param_set["verilog_parameters"]["N"]

    print("\nRandom‑All LUT‑Chain analysis")
    print(f"  Chain length      : {total_luts} LUTs")
    print(f"  Config bits found : {total_bits}")
    print(f"  Avg. bits per LUT : {total_bits / total_luts:.2f}")

    static_cnt = len(
        fuzzer.config.active.get("design_parameters", {}).get("static_init_values", [])
    )

    def extra_cols(_: Dict | None = None) -> Dict[str, str]:  # schema + per‑row
        return {
            "total_luts": str(total_luts),
            "total_bits": str(total_bits),
            "bits_per_lut": f"{total_bits / total_luts:.2f}",
            "static_luts": str(static_cnt),
        }

    fuzzer.save_results_to_db(extra_cols=extra_cols, dynamic_params=dynamic_params)


# ──────────────────────────────────────────────────────────────────────────────
# Main driver
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:  # noqa: D401 – imperative mood
    """Run *num_values* random‑INIT experiments in parallel."""

    fuzzer = Fuzzer(__file__)
    fuzzer.config.design_name = "base"

    cfg = fuzzer.config
    vp = cfg.verilog_parameters

    n = int(vp.get("N", 1152))
    k = int(vp.get("K", 4))
    chunk_luts = int(vp.get("CHUNK_LUTS", 256))
    iterations = cfg.active.get("num_values", 1)
    static_init = cfg.active.get("design_parameters", {}).get("static_init_values", [])

    # One *group* per iteration (exactly one run inside each group)
    groups: List[List[Dict]] = []
    chunk_bits = (1 << k) * chunk_luts  # size cap per HDL template

    for idx in range(iterations):
        flat_init = _build_flat_init_literal(n, k, static_init)
        param_set = build_param_set(
            idx,
            chunk_bits=chunk_bits,
            chunk_keys=("INIT",),  # force the INIT vector to be chunked automatically
            N=n,
            K=k,
            CHUNK_LUTS=chunk_luts,
            INIT=flat_init,
        )
        groups.append([param_set])

    fuzzer.run_experiment(
        dynamic_params_list=groups,
        analyze_results_func=analyze_results,
        cleanup=False,
        num_processes=max(1, iterations),
    )


if __name__ == "__main__":
    main()
