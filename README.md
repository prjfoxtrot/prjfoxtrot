<!-- badges — swap shields.io for GitHub built‑ins once published -->

<p align="center">
  <img src="https://raw.githubusercontent.com/prjfoxtrot/prjfoxtrot/main/media/foxtrot.png"
       width="120"
       alt="Foxtrot logo">
</p>
<h1 align="center">Project Foxtrot</h1>

<div align="center">

*A vendor-agnostic, machine-learning framework to help transform raw FPGA bitstreams back into human-readable netlists.*

<!-- CI status 
<a href="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/ci.yml">
  <img src="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/ci.yml/badge.svg" alt="CI status">
</a> 
-->

<!-- Release packaging (VSIX & wheels) -->
<a href="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/release-extension.yml">
  <img src="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/release-extension.yml/badge.svg?" alt="Package & Release status">
</a>

<!-- Pre-built VSIX -->
<a href="https://github.com/prjfoxtrot/prjfoxtrot/releases/latest/download/foxtrot-latest.vsix">
  <img src="https://img.shields.io/badge/VS%20Code%20ext-latest-blue?logo=visualstudiocode" alt="Download latest VSIX">
</a>

<!-- Code scanning 
<a href="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/codeql-analysis.yml">
  <img src="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/codeql-analysis.yml/badge.svg" alt="CodeQL analysis">
</a>
-->

<!-- Latest tag (uses shields until GitHub adds a native one) -->
<a href="https://github.com/prjfoxtrot/prjfoxtrot/releases">
  <img src="https://img.shields.io/github/v/release/prjfoxtrot/prjfoxtrot?include_prereleases" alt="Latest release">
</a>

<!-- Licence -->
<a href="LICENSE">
  <img src="https://img.shields.io/badge/License-Apache%202.0-green.svg" alt="License: Apache-2.0">
</a>

<!-- Coverage 
<a href="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/coverage.yml">
  <img src="https://github.com/prjfoxtrot/prjfoxtrot/actions/workflows/coverage.yml/badge.svg" alt="Coverage">
</a>
-->

</div>


---


> **Project Foxtrot** unifies the complete FPGA bitstream reverse-engineering loop  
> **BitGen → BitMap → FabMap → BitLearn → NetRec**.  

> Project Foxtrot provides tool and techniques to abstract the mapping process from bitstream to netlist elements. This involves clustering of the configuration data and then training lightweight neural networks that translate raw bits into netlist objects. 

---

## Table of Contents

1. [Requirements](#requirements)
2. [Directory map](#directory-map)
3. [Quick start](#quick-start)
4. [Datasets](#datasets)
5. [End-to-End workflow](#end-to-end-workflow)
6. [Commands & UI](#commands--ui)
7. [Configuration](#configuration)
8. [GPU & extras](#gpu--extras)
9. [Contributing](#contributing)
10. [Versioning](#versioning)
11. [Roadmap](#roadmap)
12. [License](#license)

---
## Requirements

**Supported OS:** Linux — tested on **Ubuntu 22.04 LTS (x86_64)**.

| Tool        | Version               | Notes                                                                 |
| ----------- | --------------------- | --------------------------------------------------------------------- |
| **VS Code** | ≥ 1.101.0             | Install **Python** and **Jupyter** extensions for notebook support.   |
| **Node.js** | ≥ 18 LTS              | Builds front-end TypeScript.                                          |
| **Python**  | 3.9 – 3.12 *(3.10+ recommended)* | The extension creates/uses a workspace-local virtual-env.     |
| **Git**     | any                   | Clone Foxtrot repositories.                                           |


---

## Directory map

```text
prjfoxtrot/
├─ src/                     # all TypeScript sources
│  ├─ extension.ts          # activate() / deactivate()
│  ├─ commands/
│  ├─ domains/              # bitgen, bitmap, fabmap, …
│  └─ utils/
├─ media/                   # icons & logos
├─ plugins-bundled/         # *.whl copied at package-time
├─ default-workspace/       # workspace skeleton
├─ .vscode/                 # shared launch & task configs
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ CHANGELOG.md
├─ README.md
├─ LICENSE
├─ .gitignore
└─ (tooling) .eslintrc.json, .prettierrc, .vscodeignore, …
```

**Default workspace layout (pointer-based config):**

```text
foxtrot-workspace/
├─ edas/<tool>/<ver>/eda.toml           # tool path & flags (single source of truth)
├─ parts/<vendor>/<family>/<part>/      # part.toml, pinout.json, (fabric.json optional)
├─ fuzzers/...                          # parameter-sweep scripts & templates
├─ projects/
│  ├─ bitmap/…                          # notebooks & Parquet caches
│  ├─ fabmap/…
│  └─ bitlearn/…
├─ project_settings.toml                # pointers: active_part, active_eda, active_fuzzer, db_path
└─ bitstreams.db                        # created as you run fuzzer(s)
```

## Quick start

### A · Install latest pre-built VSIX

```bash
curl -L https://github.com/prjfoxtrot/prjfoxtrot/releases/latest/download/foxtrot-latest.vsix \
  -o /tmp/foxtrot-latest.vsix && \
code --install-extension /tmp/foxtrot-latest.vsix
```

In VS Code, open **Extensions** and confirm “Foxtrot” is installed.

---

### B · Dev-Mode (no packaging)

```bash
git clone https://github.com/prjfoxtrot/prjfoxtrot.git
cd prjfoxtrot
npm ci
npm run compile
code .     # press F5 → “Extension Development Host”
```

---

### C · Package & install your own VSIX

```bash
git clone https://github.com/prjfoxtrot/prjfoxtrot.git
cd prjfoxtrot
npm ci && npm run compile
npm run vscode:package
code --install-extension foxtrot-*.vsix
```

---

## Datasets

**Scope:** AMD-Xilinx 7-Series **6-input LUTs**, split by slice type (**SLICEL** and **SLICEM**).
**Hosting:** Hugging Face Hub submodule (≈ **22 GB** total). Datasets are *not* pulled on a plain `git clone`.

### What’s included

| File                              | Slice  | Origin                                 |         Count | Format     |    Size\* |
| --------------------------------- | ------ | -------------------------------------- | ------------: | ---------- | --------: |
| `lut_dataset_SLICEL.json`         | SLICEL | **Fuzzed** with BitGen                 |    **90,000** | JSON       |  \~873 MB |
| `lut_dataset_SLICEM.json`         | SLICEM | **Fuzzed** with BitGen                 |    **90,000** | JSON       |  \~374 MB |
| `synthetic_lut_dataset_SLICEL.7z` | SLICEL | **Synthetic** (uniform random configs) | **1,000,000** | 7z archive | \~9.14 GB |
| `synthetic_lut_dataset_SLICEM.7z` | SLICEM | **Synthetic** (uniform random configs) | **1,000,000** | 7z archive | \~9.14 GB |

\*Sizes are approximate; see the dataset page for current values.

**Design choices & rationale**

* **Two slice types → two datasets.** SLICEL and SLICEM are treated as *different components* during training and evaluation. Do not merge them unless your model is slice-aware.
* **Synthetic sets (1M / slice).** Generated after identifying the function of each configuration bit per slice type, then sampling **1,000,000** valid configurations **uniformly at random**. An *exhaustive* 6-LUT truth-table space is $2^{64}$ (≈1.84e19) and is therefore infeasible; the synthetic sets provide broad coverage for testing.
* **Fuzzed sets (90k / slice).** Produced by the BitGen fuzzing pipeline. These reflect *real toolchains* and serve as a training set.

### Where the data lives

Hugging Face dataset (public tree):
`https://huggingface.co/datasets/prjfoxtrot/prjfoxtrot-datasets/tree/main`

This repository vendors the dataset as a **git submodule** under:

```
default-workspace/projects/bitlearn/0-template/data/raw
```

### Getting the data

**Recommended — fast & space‑safe (skip download on checkout, pull only what you need)**

From the repo root:

```bash
# 1) Fetch the submodule without auto-downloading any LFS files
GIT_LFS_SKIP_SMUDGE=1 git submodule update --init --checkout \
  default-workspace/projects/bitlearn/0-template/data/raw

# 2) Enter the dataset submodule and enable LFS (once per machine)
cd default-workspace/projects/bitlearn/0-template/data/raw
git lfs install

# (Optional but helpful) Speed knobs for slow networks
git config lfs.concurrenttransfers 8
git config lfs.activitytimeout 300

# 3) See what LFS files exist and their sizes—no downloads yet
git lfs ls-files -s

# 4) Pull lightweight training datasets
git lfs pull --include="*.json"

# 5) When ready (and with enough space), pull the big test datasets
git lfs pull --include="*.7z"

# (Optional) Pull by slice/pattern (one at a time)
# git lfs pull --include="*SLICEL*.7z"
# git lfs pull --include="*SLICEM*.7z"
```

> Tip: total size is \~22 GB for all archives. Use `du -sh .` to watch disk usage as you go.

**Alternative A — Code first, pull all datasets later**

```bash
git submodule update --init default-workspace/projects/bitlearn/0-template/data/raw
cd default-workspace/projects/bitlearn/0-template/data/raw
git lfs pull
```

**Alternative B — One shot (code + submodules)**

```bash
git clone --recurse-submodules https://github.com/prjfoxtrot/prjfoxtrot.git
cd prjfoxtrot/default-workspace/projects/bitlearn/0-template/data/raw
git lfs pull
```

**Alternative C — Direct from Hugging Face (no repo)**

```bash
# Requires Git LFS
git lfs clone https://huggingface.co/datasets/prjfoxtrot/prjfoxtrot-datasets
```

---

## End-to-End Workflow

### 1 · Create a Foxtrot workspace (wizard)

```
⇧⌘P → Foxtrot: New Workspace → choose a folder (e.g. ~/foxtrot-workspace)
```

This copies the default skeleton, creates a **workspace-local `.venv/`**, and writes settings.

**Pointer-style `project_settings.toml` (created by the wizard):**

```toml
[project]
active_part   = "parts/amd/artix7/XC7A100TCSG324"
active_eda    = "edas/vivado/2024"
active_fuzzer = "fuzzers/1-generic/1-lc/1-lut/generic-lc-lut-1-cell_mask/script/generic-lc-lut-1-cell_mask.py"
db_path       = "bitstreams.db"
```

> **Hint:** After the wizard creates `.venv/`, make sure VS Code is actually using it. Run `Ctrl+Shift+P → Python: Create Environment → Venv → Use Existing`

---

### 2 · Install Python packages (core + EDA plugin\[s])

Choose one:

#### A · Clone & build locally

```bash
# next to the existing prjfoxtrot repo (../prjfoxtrot)
mkdir -p prjfoxtrot/plugins-bundled
git clone https://github.com/prjfoxtrot/foxtrot-core.git
git clone https://github.com/prjfoxtrot/foxtrot-vivado-2024.git
git clone https://github.com/prjfoxtrot/foxtrot-quartus-ii90.git
# …clone other plugins as needed…

for pkg in foxtrot-core foxtrot-vivado-2024 foxtrot-quartus-ii90; do
  cd "$pkg"
  python -m venv .venv && source .venv/bin/activate
  python -m pip install --upgrade build
  python -m build --wheel
  cp dist/*.whl ../prjfoxtrot/plugins-bundled/
  cd ..
done
```

#### B · Install latest from **GitHub**

```bash
pip install \
  "foxtrot-core[analysis] @ git+https://github.com/prjfoxtrot/foxtrot-core.git" \
  "foxtrot-vivado-2024 @ git+https://github.com/prjfoxtrot/foxtrot-vivado-2024.git" \
  "foxtrot-quartus-ii90 @ git+https://github.com/prjfoxtrot/foxtrot-quartus-ii90.git"
  # …clone other plugins as needed…
```

*(See [GPU & extras](#gpu--extras) for GPU-accelerated installs.)*

#### C · Wizard-driven install (recommended for VSIX users)

After opening the Foxtrot VSCode extension, click **Foxtrot: New Workspace**—the wizard will fetch and install the latest wheels for `foxtrot-core` and all plugins automatically.

Also, if needed, from the Command Palette in your new workspace:

```
Foxtrot: Reinstall Packages
```

This installs `foxtrot-core` and lets you pick one or more `foxtrot-*` plugins from GitHub Releases into the workspace `.venv/`.

---

### 3 · Install the vendor EDA tool (Foxtrot doesn’t ship these)

| Tool           | Min version | Linux note                                 |
| -------------- | ----------- | ------------------------------------------ |
| **Vivado**     | 2024.x      | Native Linux binary                        |
| **Quartus II** | 9.0 (Web)   | Windows binary — run via **WINE** on Linux |

---

### 4 · Point Foxtrot at the tool (edit `eda.toml`)

Open the pointer file referenced by `active_eda` in `project_settings.toml` and set the executable:

**Vivado (Linux)** — `edas/vivado/2024/eda.toml`

```toml
[eda]
plugin          = "vivado_2024"
tcl_executable  = "/opt/Xilinx/Vivado/2024.2/bin/vivado"
use_wine        = false
wine_executable = "/usr/bin/wine"
```

**Quartus II 9.0 (via WINE on Linux)** — `edas/quartus/ii90/eda.toml`

```toml
[eda]
plugin          = "quartus_ii90"
tcl_executable  = "/home/you/opt/altera/90/quartus/bin/quartus_sh.exe"
use_wine        = true
wine_executable = "/usr/bin/wine"
```

> `active_eda` in `project_settings.toml` points to the folder containing `eda.toml`.  
> The `plugin` string must match the installed plugin’s entry-point name (group `foxtrot.plugins`).

---

### 5 · Verify plugin discovery & preflight

From the workspace terminal (inside `.venv/`):

```bash
python -m foxtrot_core bitgen plugins
# expect: vivado_2024 and/or quartus_ii90

python -m foxtrot_core bitgen inspect -w .
# shows resolved fuzzer script, plugin, part pointers, etc.

python -m foxtrot_core bitgen doctor -w .
# validates part folder, pinout.json, eda.toml, TCL path, DB folder permissions
```

---

### 6 · Select & tweak a fuzzer

* Choose one LUT fuzzer in *Fuzzers* view.
* Adjust `config/base_params.json` (copy helpers for 4‑ or 5‑input LUTs).
* Press **▶ Run** – outputs land in `output/` & are indexed in `bitstream.db`.

### 7 · Bitmap phase

1. Grab `.off` mask from fuzzer output.
2. Open `projects/bitmap/0-template/foxtrot_bitmap_tutorial.ipynb`.
3. Follow notebook to cluster bits & find frame length (see bitmap README).

### 8 · FabMap phase

* Notebook: `projects/fabmap/0-template/foxtrot_fabmap_tutorial.ipynb`.
* Feed frame length + additional `.off` files with sparse LUTs.
* Align bit groups to LAB/Slice coords using placement data in `bitstream.db`.

### 9 · BitLearn phase

Open `projects/bitlearn/0-template/foxtrot_bitlearn_tutorial.ipynb`, import the
labelled masks + randomised bitstreams into `data/raw/`, then train models.

> *Inference* / Net‑Rec UI is planned – Bit‑Learn currently ships a test harness
> with ground‑truth datasets (AMD-Xilinx 7‑Series FPGAs).

---

## Commands & UI

| Command ID                   | Palette title (`⇧⌘P`)            | Purpose                             |
| ---------------------------- | -------------------------------- | ----------------------------------- |
| `foxtrot.createWorkspace`    | **Foxtrot: New Workspace**       | Scaffold new workspace              |
| `foxtrot.openWorkspace`      | **Foxtrot: Open Workspace…**     | Re‑open existing Foxtrot folder     |
| `foxtrot.runActiveFuzzer`    | **Foxtrot: Run Active Fuzzer**   | Execute selected fuzzer             |
| `foxtrot.reinstallPackages`  | **Foxtrot: Reinstall Packages**  | Re‑build & re‑install wheels        |
| `foxtrot.view.switch`        | **Foxtrot: Switch Phase**        | Cycle Bit‑Gen ↔ Bit‑Map ↔ …         |

Activity Bar views: *Welcome*, *BitGen*, *BitMap*, *FabMap*, *BitLearn*, *NetRec*.
>Currently, only the BitGen View is implemented within the VSCode Extension.

---

## Configuration

`File → Preferences → Settings → Foxtrot`

| Setting key                    | Default                   | Meaning                                                                                              |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `foxtrot.pythonPath`           | `python`                  | Interpreter used to launch `foxtrot_core`                                                            |
| `foxtrot.activeEDA`            | *(managed)*               | Last EDA plug-in used                                                                                |
| `foxtrot.activeFuzzer`         | *(managed)*               | Last fuzzer chosen                                                                                   |
| `foxtrot.activePart`           | *(managed)*               | Last FPGA part selected                                                                              |
| `foxtrot.installSource`        | `ask`                     | Install wheels from: ask, GitHub latest release, or bundled                                          |
| `foxtrot.enablePackagePicker`  | `true`                    | When installing from GitHub, show a multi-select of `foxtrot-*` packages                             |
| `foxtrot.useNvidiaIndexForGpu` | `false`                   | If enabled, adds `--extra-index-url` using `foxtrot.nvidiaExtraIndexUrl` while installing GPU extras |
| `foxtrot.nvidiaExtraIndexUrl`  | `https://pypi.nvidia.com` | Index URL used when the above toggle is on                                                           |

Settings are stored at **resource scope**; each workspace keeps its own config.

---

## GPU & extras

Foxtrot’s Python backend (`foxtrot-core`) uses **extras** to opt into GPU or data-science stacks. You can install CPU-only now and add GPU later.

### Option A — TensorFlow GPU (Linux, CUDA 12.x wheels)

Installs `tensorflow[and-cuda]` wheels that bundle the CUDA runtime for Linux.

```bash
# GitHub (latest)
pip install "foxtrot-core[analysis,gpu] @ git+https://github.com/prjfoxtrot/foxtrot-core.git"
```

> Ensure your NVIDIA driver supports **CUDA 12.x**.

### Option B — RAPIDS for GPU clustering (cuDF / cuML / CuPy)

Requires the **NVIDIA PyPI index** and a CUDA-12.x-compatible driver.

```bash
# GitHub (latest)
pip install --extra-index-url https://pypi.nvidia.com \
  "foxtrot-core[analysis,rapids] @ git+https://github.com/prjfoxtrot/foxtrot-core.git"
```

### Option C — Full stack (TF GPU + RAPIDS)

```bash
# GitHub (latest)
pip install --extra-index-url https://pypi.nvidia.com \
  "foxtrot-core[analysis,gpu,rapids] @ git+https://github.com/prjfoxtrot/foxtrot-core.git"
```

### Option D — CPU analysis only (add pieces later)

```bash
# GitHub (latest)
pip install "foxtrot-core[analysis] @ git+https://github.com/prjfoxtrot/foxtrot-core.git"
```

Add GPU later if needed:

```bash
# TensorFlow GPU only
pip install "tensorflow[and-cuda]"

# RAPIDS only (requires NVIDIA index)
pip install --extra-index-url https://pypi.nvidia.com cudf-cu12 cuml-cu12 cupy-cuda12x
```

---

## Contributing

### 1 · Fork & clone

```bash
git clone https://github.com/<your-user>/prjfoxtrot.git
cd prjfoxtrot
```

Create a **feature branch** off `main`:

```bash
git switch -c feat/<topic>          # or fix/<issue-id>, docs/<area>, …
```

---

### 2 · Install the dev tool-chain

| Layer         | One-time setup                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extension** | `npm ci`  → installs Node/TypeScript dependencies.                                                                                                      |
| **Python**    | If you also hack on *foxtrot-core* or a plugin: <br>`cd ../foxtrot-core && python -m venv .venv && source .venv/bin/activate && pip install -e .[dev]` |

The `[dev]` extra brings in **ruff**, **black**, **pytest**, etc.

---

### 3 · Live hacking

| Task                      | Command / action            |
| ------------------------- | --------------------------- |
| Recompile TS on save      | `npm run watch`             |
| Launch Extension Dev Host | Press **F5** in VS Code     |
| Run Python tests (core)   | `pytest` (in the core repo) |

---

### 4 · Pre-commit checklist

1. **Format & lint**

   ```bash
   npm run lint:fix          # eslint + prettier
   ruff check . --fix        # python
   black .                   # python formatter
   ```

2. **Build**

   ```bash
   npm run compile           # TS should compile cleanly
   ```

3. **Commit** using *Conventional Commits*:

   ```
   feat(renderer): add FABMAP scatter view
   fix(core): guard against empty DB on startup (#42)
   ```

4. **Push & open a PR** — GitHub Actions re-runs lint + tests.

---

### 5 · PR etiquette

* Keep changes focused and under ≈ 400 LoC when possible.
* Draft PRs are welcome — they trigger CI and invite early feedback.
* Ensure the PR description explains **why** the change is needed, not just *what* it does.

### 6 · Tagging

| Artefact             | Tag format     | Example                         |
| -------------------- | -------------- | ------------------------------- |
| VS Code extension    | `prjfoxtrot-vX.Y.Z`       | `prjfoxtrot-v0.1.0`                        |
| Python wheels/sdists | `<pkg>-vX.Y.Z` | `foxtrot-vivado-2024-v0.1.0`    |

### 7 · Release workflow

1. **Cut a release branch**

   ```bash
   git switch -c release/prjfoxtrot-v0.1.1              # or release/foxtrot-vivado-2024-v0.2.0
   ```

2. Bump the `version` field (`package.json` or `pyproject.toml`) and move
   `[Unreleased]` notes in `CHANGELOG.md` under a new heading.

3. Open a PR → review → **merge**.

4. **Tag** on the release branch (annotated & signed recommended) **and push only the tag**:

   ```bash
   # VSCODE extension
   git tag -a prjfoxtrot-v0.1.1 -m "Foxtrot VS Code 0.1.1"
   git push origin prjfoxtrot-v0.1.1

   # python package
   git tag -a foxtrot-vivado-2024-v0.2.0 -m "foxtrot-vivado-2024 0.2.0"
   git push origin foxtrot-vivado-2024-v0.2.0
   ```

5. **Verify** the tag appears on GitHub (Tags tab). This guarantees the CI job
   runs with `refs/tags/<name>` rather than a commit SHA.

6. **GitHub Actions** builds the VSIX / wheels and uploads them to a published
   release.

7. CI finishes – the release is already public under **Releases / Latest**.

8. On `main`, add a fresh `[Unreleased]` section in `CHANGELOG.md` and push.

---

## Versioning

Foxtrot follows [Semantic Versioning 2.0](https://semver.org/).

* While we’re < 1.0, **minor** bumps (`0.X.Y`) *may* break APIs.
* From 1.0 onwards, only **major** bumps may break APIs.

Upgrade hints are documented in each `CHANGELOG.md`.

---

## Roadmap

* **End‑to‑end tests** – integrate vendor tools in CI via containerised runners.

---

## License

Foxtrot‑VSCode is licensed under the **Apache License 2.0** (SPDX: `Apache‑2.0`). See the repository‑root [`LICENSE`](LICENSE) file for details.

