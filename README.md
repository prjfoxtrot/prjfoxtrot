<!-- badges — swap shields.io for GitHub built‑ins once published -->

<p align="center">
  <img src="https://raw.githubusercontent.com/prjfoxtrot/prjfoxtrot/main/media/foxtrot.png"
       width="120"
       alt="Foxtrot logo">
</p>
<h1 align="center">Project Foxtrot</h1>

<div align="center">

*A vendor-agnostic, machine-learning framework to help transform raw FPGA bitstreams back into human-readable netlists.*

<b>Early-access — install locally or run in Dev-Mode</b>

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

> Project Foxtrot provides tool that can help abstract the mapping process from bitstream to netlist elements. This involves a combination of techniques that include clustering the configuration data then training lightweight neural networks that translate raw bits into netlist objects. 

---

## Table of Contents

1. [Requirements](#requirements)
2. [Directory map](#directory-map)
3. [Quick start](#quick-start)
4. [End‑to‑End workflow](#end-to-end-workflow)
5. [Commands & UI](#commands--ui)
6. [Configuration](#configuration)
7. [Development workflow](#development-workflow)
8. [Contributing](#contributing)
9. [Versioning](#versioning)
10. [License](#license)

---

## Requirements

| Tool        | Version            | Notes                                                |
| ----------- | ------------------ | ---------------------------------------------------- |
| **VS Code** | ≥ 1.101.0          | Install the **Python** and **Jupyter** extensions for notebook support  |
| **Node.js** | ≥ 18 LTS           | Builds front‑end TypeScript                          |
| **Python**  | 3.11 (recommended) | Workspace‑local virtual‑env is created automatically |
| **Git**     | any                | Clone Foxtrot repositories                           |

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

## Quick start

### A · Install latest pre-built VSIX + auto-install plugins

```bash
curl -L https://github.com/prjfoxtrot/prjfoxtrot/releases/latest/download/foxtrot-latest.vsix \
  -o /tmp/foxtrot-latest.vsix && \
code --install-extension /tmp/foxtrot-latest.vsix
```

1. In VS Code, open the **Extensions** view and verify “Foxtrot” is installed.
2. Run **Foxtrot: New Workspace** from the Command Palette (⇧⌘P).
3. The wizard will scaffold your workspace and **automatically pip-install** the latest `foxtrot-core` and all published plugins from GitHub Releases.

---

### B · Dev-Mode (no packaging)

```bash
git clone https://github.com/prjfoxtrot/prjfoxtrot.git
cd prjfoxtrot
npm ci               # install JS/TS deps
npm run compile      # transpile TypeScript
code .               # press F5 → “Extension Development Host”
```

Once the Extension Development Host opens, you can iterate on the code and run the **Foxtrot: New Workspace** command to test end-to-end.

---

### C · Package & install your own VSIX

```bash
cd prjfoxtrot
npm ci && npm run compile
npm run vscode:package      # creates out/foxtrot-<ver>.vsix
code --install-extension out/foxtrot-<ver>.vsix
```

*(This matches the “Install from a VSIX you built” flow. After installation, run **Foxtrot: New Workspace** as above.)*

---

## End-to-End Workflow

### 0 · Acquire `foxtrot-core` & plugins

Choose one of the following:

#### A · Clone & build locally

```bash
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/prjfoxtrot/prjfoxtrot.git          # Extension
git clone https://github.com/prjfoxtrot/foxtrot-core.git       # Core
git clone https://github.com/prjfoxtrot/foxtrot-vivado-2024.git # Example plugin
# …clone other plugins as needed…

# Build each package and bundle the wheel
for pkg in foxtrot-core foxtrot-vivado-2024; do
  cd "$pkg"
  python -m venv .venv && source .venv/bin/activate
  python -m pip install --upgrade build
  python -m build                         # creates dist/*.whl
  cp dist/*.whl ../prjfoxtrot/plugins-bundled/
  cd ..
done
```

#### B · Install from GitHub (latest version)

Instead of downloading `.whl` files, you can directly install `foxtrot-core` and `foxtrot-vivado-2024` from the GitHub repositories:

```bash
python -m pip install --upgrade pip
pip install \
  "git+https://github.com/prjfoxtrot/foxtrot-core.git#egg=foxtrot-core[analysis]" \
  "git+https://github.com/prjfoxtrot/foxtrot-vivado-2024.git#egg=foxtrot-vivado-2024" \
  "git+https://github.com/prjfoxtrot/foxtrot-quartus-ii90.git#egg=foxtrot-quartus-ii90"
# …add other plugins similarly…
```

This will always install the latest commit from each repository.

* If you have a **CUDA-capable GPU** and want to use GPU-accelerated analysis, you can install `foxtrot-core` with the `[analysis,gpu]` extra, which includes GPU support dependencies:

```bash
pip install \
  "git+https://github.com/prjfoxtrot/foxtrot-core.git#egg=foxtrot-core[analysis,gpu]"
```

> **Note**: The `[analysis,gpu]` installation will only work if your system has a CUDA-capable GPU and the required software installed (e.g., RAPIDS, CUDA).

#### C · Wizard-driven install

If you followed **Quick start A**, skip cloning/packages.
After installing the pre-built VSIX, run **Foxtrot: New Workspace**—the wizard will fetch and install the latest wheels for `foxtrot-core` and all plugins automatically.

---

### 1 · Compile the extension & launch Dev Host

*(Only required if you’re iterating on the extension source — skip if you used the released VSIX in Quick start A or C.)*

```bash
cd ~/dev/prjfoxtrot
npm ci && npm run compile
code .   # press F5 → “Extension Development Host”
```

---

### 2 · Create a Foxtrot workspace

```text
# In the Dev Host or your regular VS Code:
⇧⌘P → Foxtrot: New Workspace → select a directory (e.g. ~/foxtrot-workspace)
```

This copies `default-workspace/`, creates a `.venv/`, installs all required wheels, and writes the VS Code settings for you.

> **Tip:** After updating any plugin wheel locally, run **Foxtrot: Reinstall Packages** to refresh the workspace environment.

---

### 3 · Explore the workspace

```text
foxtrot-workspace/
├─ devices/<mfg>/<family>/<part>/    # pinout.json, part.toml, fabric.json
├─ edas/<tool>/<ver>/eda.toml        # tool paths & flags
├─ fuzzers/…                         # fuzzer templates & outputs
├─ projects/
│  ├─ bitmap/…                       # Bit-Map notebooks & caches
│  ├─ fabmap/…                       # Fab-Map tutorials
│  └─ bitlearn/…                     # Bit-Learn datasets & models
├─ project_settings.toml             # active tool/fuzzer
└─ part_settings.toml                # active FPGA part
```

> **Temporary manual switch‑over:** till the UI toggle is finished, copy the
> desired `eda.toml` → `project_settings.toml` and `part.toml` →
> `part_settings.toml`, then select the same options via the side‑bar.

### 4 · Select & tweak a fuzzer

* Choose one LUT fuzzer in *Fuzzers* view.
* Adjust `config/base_params.json` (copy helpers for 4‑ or 5‑input LUTs).
* Press **▶ Run** – outputs land in `output/` & are indexed in `bitstream.db`.

### 5 · Bitmap phase

1. Grab `.off` mask from fuzzer output.
2. Open `projects/bitmap/0-template/foxtrot_bitmap_tutorial.ipynb`.
3. Follow notebook to cluster bits & find frame length (see bitmap README).

### 6 · Fab‑Map phase

* Notebook: `projects/fabmap/0-template/foxtrot_fabmap_tutorial.ipynb`.
* Feed frame length + additional `.off` files with sparse LUTs.
* Align bit groups to LAB/Slice coords using placement data in `bitstream.db`.

### 7 · Dataset build & training (Bit‑Learn)

Open `projects/bitlearn/0-template/foxtrot_bitlearn_tutorial.ipynb`, import the
labelled masks + randomised bitstreams into `data/raw/`, then train models.

> *Inference* / Net‑Rec UI is planned – Bit‑Learn currently ships a test harness
> with ground‑truth datasets (7‑Series, Flex10K).

### 8 · EDA tool prerequisites

| Tool           | Min version | `eda.toml` path example                                           |
| -------------- | ----------- | ----------------------------------------------------------------- |
| **Vivado**     | 2024.x      | `Xilinx/Vivado/2024.x/bin/vivado`                                 |
| **Quartus II** | 9.0         | `altera/90/quartus/bin/quartus_sh.exe` (`use_wine=true` on Linux) |

---

## Commands & UI

| Command ID                   | Palette title (`⇧⌘P`)            | Purpose                             |
| ---------------------------- | -------------------------------- | ----------------------------------- |
| `foxtrot.createWorkspace`    | **Foxtrot: New Workspace**       | Scaffold new workspace              |
| `foxtrot.openWorkspace`      | **Foxtrot: Open Workspace…**     | Re‑open existing Foxtrot folder     |
| `foxtrot.runActiveFuzzer`    | **Foxtrot: Run Active Fuzzer**   | Execute selected fuzzer             |
| `foxtrot.reinstallPackages`  | **Foxtrot: Reinstall Packages**  | Re‑build & re‑install wheels        |
| `foxtrot.view.switch`        | **Foxtrot: Switch Phase**        | Cycle Bit‑Gen ↔ Bit‑Map ↔ …         |

The **Activity Bar** adds a Foxtrot icon with views *Welcome*, *Bit‑Gen*,
*Bit‑Map*, *Fab‑Map*, *Bit‑Learn*, *Net‑Rec*.

---

## Configuration

`File → Preferences → Settings → Foxtrot`

| Setting key            | Default     | Meaning                        |
| ---------------------- | ----------- | ------------------------------ |
| `foxtrot.pythonPath`   | `python`    | Interpreter to run Foxtrot CLI |
| `foxtrot.activePlugin` | *(managed)* | Last EDA plug‑in used          |
| `foxtrot.activeFuzzer` | *(managed)* | Last fuzzer chosen             |
| `foxtrot.activePart`   | *(managed)* | Last FPGA part selected        |

Settings are stored at **resource scope** so every workspace keeps its own
config.

---

## Development workflow

| Task                    | NPM / tox script         |
| ----------------------- | ------------------------ |
| Compile TypeScript once | `npm run compile`        |
| Watch & re‑compile      | `npm run watch`          |
| Lint + format           | `npm run lint:fix`       |
| Build Python wheels     | `npm run build:python`   |
| Package VSIX            | `npm run vscode:package` |
| Run unit tests (TS)     | `npm test`               |
| Run Python tests        | `tox -e py311`           |

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
   feat(renderer): add FAB-MAP scatter view
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

### Versioning

Foxtrot follows [Semantic Versioning 2.0](https://semver.org/).

* While we’re < 1.0, **minor** bumps (`0.X.Y`) *may* break APIs.
* From 1.0 onwards, only **major** bumps may break APIs.

Upgrade hints are documented in each `CHANGELOG.md`.

---

## License

Foxtrot‑VSCode is licensed under the **Apache License 2.0** (SPDX: `Apache‑2.0`). See the repository‑root [`LICENSE`](../LICENSE) file for details.

