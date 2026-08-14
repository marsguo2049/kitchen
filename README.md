# Robo Kitchen

Robo Kitchen V7 is a 2D operations-research teaching prototype in which two robots cooperate to fulfil timed kitchen orders. Users can compare three scheduling strategies across three kitchen layouts and three genuinely different recipe workflows through on-demand simulation experiments.

## What is modelled

- **Simulation:** orders, deadlines, recipe precedence graphs, equipment compatibility, processing times, robot state, and four-direction movement.
- **Routing:** breadth-first search (BFS) finds a shortest feasible path to a workstation; one-step position reservations prevent two robots from entering the same cell.
- **Scheduling:** the active comparison contains a sequential baseline, a single-resource pipeline with distance auction, and a rolling compatibility-aware resource heuristic. The selected objective actively changes their online priorities.
- **Experiment runner:** choose a 30–600 second horizon, demand pressure, and evaluation objective; results are generated only when the experiment is run and can be exported as Markdown.
- **Audio:** the optional soundtrack is generated in the browser from an original note pattern. No music or audio asset from *Overcooked* is included.

V7 contains three workflows: Garden Salad (`chop → mix`), Tomato Mushroom Soup (`chop → simmer`), and Mushroom Skillet (`prep → grill`). They use different ingredients, cutting work, processing time, and compatible equipment.

## Formal model

This is an online, discrete-time scheduling simulation with policy-based heuristics. The notation below formalizes the implemented state, constraints, and evaluation measures; the application does not build a static MILP or claim global optimality.

### Sets and parameters

| Symbol | Meaning | Implemented value |
| --- | --- | --- |
| `R` | Robots | `{A, B}` |
| `O / O_t` | All released orders / active orders at decision time `t` | Three active orders; one replacement is released after each delivery |
| `𝒮` | Kitchen scenarios | Compact `8×9`, U-shape `9×11`, zoned `10×13` |
| `V_s, E_s` | Scenario-specific walkable cells and four-neighbour edges | No diagonal movement; static walls and stations |
| `K` | Shared processing resources | Two cutting boards and two capability-constrained processing resources |
| `G_i` | Recipe precedence graph for order `i` | Mix, simmer, or grill workflow |
| `H` | Experiment horizon | User-selected `30–600` seconds |
| `D_i` | Order allowance | `70 s` standard / `46 s` rush |
| `τ_ij` | Operation work/time | Recipe-specific cut actions and processing duration |
| `a_jk` | Equipment compatibility | 1 when resource `k` can execute operation `j` |

`δ(p,s)` denotes the BFS shortest-path distance from robot position `p` to a walkable service cell adjacent to station `s`.

### Online decisions and state

- `p_rt`: grid position of robot `r` at decision step `t`;
- `x_rijt = 1` when robot `r` executes job `j` of order `i` at step `t` (`job.robotId` in the implementation);
- `z_ikt = 1` when order `i` occupies stove `k` at step `t` (`plan.potKey`);
- `u_ijt`: process state of an ingredient job: fetch, cut, pot, or loaded;
- `y_i = 1` when order `i` is delivered within horizon `H`;
- `C_i`: delivery time of order `i`.

These are descriptive online decisions and state variables, not variables submitted together to a mathematical-programming solver.

### Constraints

Movement and collision avoidance:

`p_r,t+1 ∈ N(p_rt) ∪ {p_rt}`, and `p_At ≠ p_Bt`.

Robot and processing-resource capacity:

`Σ_i,j x_rijt ≤ 1` for every robot and decision step, and `Σ_i z_ikt ≤ 1` for every stove and step.

Each robot carries at most one item. A cutting board and pass position store at most one item, a processing resource handles at most one recipe, and `z_ikt ≤ a_jk` enforces equipment compatibility. Every order respects its recipe DAG.

### Objectives and score

For release time `r_i`, due time `d_i = r_i + D_i`, and tardiness `L_i = max(0, C_i - d_i)`:

- throughput: `Q = Σ_i y_i` (maximize);
- total tardiness: `T = Σ_i y_i L_i` (minimize);
- travel: `M = Σ_r,t ||p_r,t+1 - p_rt||_1` (minimize);
- score: `S = Σ_i g_i` (maximize);
- balanced ranking: `lex max (Q, -T, S, -M)`.

The delivery reward is

- on time: `g_i = 100 + 3(d_i-C_i) + 25 min(k_i-1, 4)`;
- late: `g_i = max(20, 100 - 5L_i)`;

where `k_i` is the consecutive on-time delivery count. A late delivery resets the combo. The selected objective is a live scheduling parameter: it changes order priority, rolling-window sequencing, and robot-job assignment before it is also used to rank experiment outputs. The policies remain transparent heuristics; changing the objective does not retrain a model or invoke a global optimization solver.

### Policy rules

- **A — sequential objective baseline:** selects an order with the active objective vector `v_f(i)`, keeps fixed robot/board roles, and processes one order at a time.
- **B — pipeline auction:** uses the same objective-guided order priority, then enumerates ingredient and cutting-board assignments with `c(r,g,b,k) = δ(p_r,s_g) + δ(s_g,b) + δ(b,k)`. One future ingredient is prefetched while the current dish cooks.
- **C — rolling resource scheduling:** enumerates the current order-window permutations, matches recipes to compatible equipment, and assigns free robots with `h_f(r,i,j)`, whose distance, urgency, and processing-time weights depend on objective `f`.

The C-policy sequencing estimates (`19`, `21`, or `22`, plus a `2`-unit recipe-change allowance) are priority surrogates only; they are not the simulator's physical processing times.

## Active strategies

| Strategy | Method | Main decision rule | Scope |
| --- | --- | --- | --- |
| A · Baseline | Sequential objective priority | Active objective vector, fixed robot roles, next order after delivery | Reproducible baseline |
| B · Pipeline | Pipeline + distance auction | Prepare the next order while cooking and assign work by estimated travel | Combines former V2 and V3 |
| C · Dual resource | Rolling window + compatibility dispatch | Use both resources, stage plates, and keep free robots preparing future work | Current strongest heuristic |

The earlier V1–V5 labels are retained as project history, but the interface no longer treats every incremental feature as an independent competitor. This avoids redundant comparisons.

## Objectives and score

Every report retains all metrics. The selected primary objective controls both online scheduling and final ranking:

- maximize completed orders;
- maximize score;
- minimize total tardiness;
- minimize robot travel;
- balanced lexicographic order: maximize completion, then minimize tardiness, maximize score, and minimize travel.

Score is explicit:

- On-time delivery: `100 + remaining seconds × 3 + combo bonus`.
- Consecutive on-time deliveries add 25 points each, capped at 100.
- Late delivery: `100 − late seconds × 5`, with a minimum of 20 points; lateness resets the combo.

Score is not a substitute for throughput or tardiness. A strategy can complete more orders but receive a lower score if its deliveries are late.

## Experiment protocol

The interface no longer shows a precomputed “standard 120-second” table. The user sets the horizon and runs all three strategies from the same deterministic initial map, robot positions, and order queue. The simulator performs exactly two decisions per simulated second. Playback defaults to 2×, with 1×, 4×, and 8× alternatives; these controls change wall-clock playback only, not the decision budget.

After a run, the complete parameters, ranking, metrics, delivery sequence, score definition, and strategy notes can be exported as a `.md` report.

## Modes

- **Automatic dispatch** is the default, with rolling resource scheduling preselected.
- **Manual experience** preserves the same kitchen and process as a human-control comparison.
- **Standard / rush demand** changes order deadlines and cooking pressure.

Changing the scheduling strategy, demand mode, or objective resets the scenario so a changed priority rule is evaluated from the same initial state. The interface and exported report can be switched completely between Chinese and English.

## Run locally

```bash
npm install
npm run dev:pages
```

## Validation

```bash
npm run test:flow
npm run build:pages
```

The regression suite checks all 18 strategy × pressure × layout combinations, station reachability, immutable map geometry, recipe/equipment differences, completion without deadlock, cross-order preparation, dual-resource use, plate staging, configurable horizons, score penalties, English runtime text, and Markdown reports.

## V7 scope and roadmap

V7 deliberately uses a parameterized real-kitchen abstraction rather than game-like arbitrary maps. The compact galley (`6.0×5.4 m`), medium U-shape (`8.2×6.6 m`), and large zoned kitchen (`11.5×8.4 m`) preserve recognizable kitchen structure while varying distance, congestion, and zoning. These are interpretable scenario parameters, not measurements from a calibrated physical site.

The next version will scale the robot set from the fixed pair to `R={1,…,m}` (initially 2–6) and expand collision, carrying, and capacity constraints. Seeded layout and recipe generators follow after the multi-robot model is stable, so results remain reproducible and causally interpretable.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` validates the simulation, builds a static site, and deploys it through GitHub Pages on every push to `main`.

Live site: https://marsguo2049.github.io/kitchen/

## License — noncommercial only

Copyright 2026 Mars Guo.

This project is **source-available, not OSI-approved open source**. It uses the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0): learning, research, experimentation, and other permitted noncommercial uses are allowed; commercial use is prohibited.

Before using, adapting, or redistributing the project, please [open a GitHub issue](https://github.com/marsguo2049/kitchen/issues) to tell the author how you intend to use it. Keep both `LICENSE` and `NOTICE.md` with any copy.
