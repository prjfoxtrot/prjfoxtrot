#!/usr/bin/env python
"""
generic_lc_lut_1_cell_mask.py
=============================
Vendor-agnostic LUT‑memory fuzzer.

Technique
---------
1. Build two bitstreams whose LUT ``INIT`` vectors are bitwise complements.
2. Diff the frames → every differing bit is a LUT SRAM cell.
"""
from __future__ import annotations

import math
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from foxtrot_core.bitgen.fuzz.base import Fuzzer
from foxtrot_core.bitgen.params import build_param_set
from foxtrot_core.bitgen.logging import get_logger

log = get_logger(__name__)

_MAX_LUTS_PER_PARAMETER = 256  # matches HDL template


# ─────────────────────────────────────────────────────────────────────────────
# Private helpers
# ─────────────────────────────────────────────────────────────────────────────

def _generate_init_values(n: int, k: int, pattern: str) -> str:
    """Return a flat Verilog literal of length ``n × 2**k`` bits.

    Parameters
    ----------
    n
        Number of LUTs.
    k
        LUT input count (*K*).
    pattern
        Reference pattern literal (e.g. ``16'b0001_0110_0110_1000``).

    Raises
    ------
    ValueError
        When *pattern* does not match the expected bit‑width.
    """
    _, _, literal = pattern.partition("b")
    bits = literal.replace("_", "")
    lut_bits = 1 << k
    if len(bits) != lut_bits:
        raise ValueError(
            f"INIT pattern has {len(bits)} bits; {lut_bits} required for K={k}"
        )
    repeated = bits * n
    return f"{len(repeated)}'b{repeated}"


# ─────────────────────────────────────────────────────────────────────────────
# Analysis callback
# ─────────────────────────────────────────────────────────────────────────────

def _analyze_results(fuzzer: Fuzzer, dyn_params: List[Dict]) -> None:  # noqa: D401
    """XOR the two offset lists, write ``*.off``, and extend DB rows.

    The function expects exactly **two** parameter‑sets:
    a *base* and its bit‑wise complement.
    """
    if len(dyn_params) != 2:
        log.warning("Aborted – expected two runs, got %d", len(dyn_params))
        return

    base = next((r for r in fuzzer.results if r["param_index"] == 0), None)
    inv = next((r for r in fuzzer.results if r["param_index"] == 1), None)
    if not (base and inv):
        log.warning("Aborted – missing result rows")
        return

    xor = sorted(
        set(base["data"]["offsets"]).symmetric_difference(inv["data"]["offsets"])
    )
    log.info("→ %d differing configuration bits found", len(xor))

    k = int(dyn_params[0]["verilog_parameters"]["K"])
    activated = math.ceil(len(xor) / (1 << k))
    log.info("→ affects %d LUTs (K=%d)", activated, k)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    off_path = fuzzer.fuzzer_dir / "output" / f"lut_config_bits_{ts}.off"
    off_path.write_text("\n".join(map(str, xor)))
    log.info("Offset list written → %s", off_path)

    def _extra(res: Dict | None = None) -> Dict[str, str]:
        idx = (res or {}).get("param_index", -1)
        return {
            "pattern_type": "base" if idx == 0 else "inverted",
            "lut_config_bits_file": str(off_path),
            "lut_config_bits": ",".join(map(str, xor)),
            "activated_luts": str(activated),
        }

    fuzzer.save_results_to_db(extra_cols=_extra, dynamic_params=dyn_params)


# ─────────────────────────────────────────────────────────────────────────────
# Main driver
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:  # noqa: D401 – imperative naming
    """Build complementary parameter sets and launch the experiment."""
    fuzzer = Fuzzer(__file__)
    cfg = fuzzer.config
    vp = cfg.verilog_parameters

    n = int(vp.get("N", 64))
    k = int(vp.get("K", 4))
    chunk_luts = int(vp.get("CHUNK_LUTS", _MAX_LUTS_PER_PARAMETER))

    patterns = cfg.active_params.get("init_patterns", {})
    base_pat = patterns.get("base", {}).get("value", "16'b0001_0110_0110_1000")
    inv_pat = patterns.get("inverted", {}).get("value", "16'b1110_1001_1001_0111")

    chunk_bits = (1 << k) * chunk_luts  # per‑parameter ceiling

    base_set = build_param_set(
        0,
        chunk_bits=chunk_bits,
        chunk_keys=("INIT",),  # force always‑chunk behaviour
        N=n,
        K=k,
        CHUNK_LUTS=chunk_luts,
        INIT=_generate_init_values(n, k, base_pat),
    )

    inv_set = build_param_set(
        1,
        chunk_bits=chunk_bits,
        chunk_keys=("INIT",),
        N=n,
        K=k,
        CHUNK_LUTS=chunk_luts,
        INIT=_generate_init_values(n, k, inv_pat),
    )

    fuzzer.run_experiment(
        dynamic_params_list=[[base_set, inv_set]],
        analyze_results_func=_analyze_results,
        cleanup=False,
        num_processes=2,
    )


if __name__ == "__main__":
    main()
