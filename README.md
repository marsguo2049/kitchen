# Robo Kitchen

Robo Kitchen is a 2D operations-research teaching prototype in which two robots cooperate to fulfil timed kitchen orders on a fixed discrete grid. The page compares three meaningfully different scheduling strategies through user-configured, on-demand simulation experiments.

## What is modelled

- **Simulation:** orders, deadlines, precedence constraints, shared workstations, cooking time, robot state, and four-direction movement.
- **Routing:** breadth-first search (BFS) finds a shortest feasible path to a workstation; one-step position reservations prevent two robots from entering the same cell.
- **Scheduling:** the active comparison contains a sequential baseline, a single-stove pipeline with distance auction, and a rolling dual-stove resource-aware heuristic.
- **Experiment runner:** choose a 30–600 second horizon, demand pressure, and evaluation objective; results are generated only when the experiment is run and can be exported as Markdown.
- **Audio:** the optional soundtrack is generated in the browser from an original note pattern. No music or audio asset from *Overcooked* is included.

Every dish follows:

`collect ingredients → chop → load pot → cook → collect plate → plate → serve`

## Active strategies

| Strategy | Method | Main decision rule | Scope |
| --- | --- | --- | --- |
| A · Baseline | Sequential EDF | Earliest deadline first, fixed robot roles, next order after delivery | Reproducible baseline |
| B · Pipeline | Pipeline + distance auction | Prepare the next order while cooking and assign work by estimated travel | Combines former V2 and V3 |
| C · Dual stove | Rolling window + resource dispatch | Use both stoves, stage plates beside pots, and keep free robots preparing future work | Combines former V4 and V5 |

The earlier V1–V5 labels are retained as project history, but the interface no longer treats every incremental feature as an independent competitor. This avoids redundant comparisons.

## Objectives and score

Every report retains all metrics. The selected primary objective only controls ranking:

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

The interface no longer shows a precomputed “standard 120-second” table. The user sets the horizon and runs all three strategies from the same deterministic initial map, robot positions, and order queue. The simulator performs exactly two decisions per simulated second. The 1×/2× control changes playback speed only, so it does not change the decision budget.

After a run, the complete parameters, ranking, metrics, delivery sequence, score definition, and strategy notes can be exported as a `.md` report.

## Modes

- **Automatic dispatch** is the default, with the rolling dual-stove strategy preselected.
- **Manual experience** preserves the same kitchen and process as a human-control comparison.
- **Standard / rush demand** changes order deadlines and cooking pressure.

Changing the scheduling strategy or demand mode resets the scenario so comparisons begin from the same initial state. Changing only the ranking objective re-sorts the existing experiment results without rerunning the simulation.

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

The regression suite checks the immutable 9×8 map, all three strategies in both demand modes, completion without deadlock, cross-order preparation, dual-stove use, plate staging, configurable horizons, the explicit late-delivery penalty, and Markdown export contents.

## Current recipe scope and roadmap

The interface names three recipes—tomato soup, mushroom soup, and garden stew—but all currently share the same two-ingredient precedence structure. They therefore represent recipe variants, not three fundamentally different production processes.

Future versions may add recipes with different ingredient counts and processing routes, multiple cooking appliances, and switchable maps. These are intentionally left out of V6.1 so the current experiment remains controlled and interpretable.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` validates the simulation, builds a static site, and deploys it through GitHub Pages on every push to `main`.

Live site: https://marsguo2049.github.io/kitchen/

## License — noncommercial only

Copyright 2026 Mars Guo.

This project is **source-available, not OSI-approved open source**. It uses the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0): learning, research, experimentation, and other permitted noncommercial uses are allowed; commercial use is prohibited.

Before using, adapting, or redistributing the project, please [open a GitHub issue](https://github.com/marsguo2049/kitchen/issues) to tell the author how you intend to use it. Keep both `LICENSE` and `NOTICE.md` with any copy.
