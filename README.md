# Robo Kitchen

Robo Kitchen is a 2D operations-research teaching prototype in which two robots cooperate to fulfil timed kitchen orders on a fixed discrete grid. The page lets the user run the same deterministic scenario with four scheduling algorithms and compare throughput, score, tardiness, travel, waiting, and delivery sequence.

## What is modelled

- **Simulation:** orders, deadlines, precedence constraints, shared workstations, cooking time, robot state, and four-direction movement.
- **Routing:** breadth-first search (BFS) finds a shortest feasible path to a workstation; one-step position reservations prevent two robots from entering the same cell.
- **Scheduling:** V1–V3 are explainable heuristics. V4 exactly enumerates the current three-order sequencing subproblem, but is not a claim of global optimality for the full kitchen simulation.

Every dish follows:

`collect ingredients → chop → load pot → cook → collect plate → plate → serve`

## Algorithms

| Version | Method | Main decision rule | Scope |
| --- | --- | --- | --- |
| V1 | Sequential EDF baseline | Earliest deadline first; fixed robot roles; next order starts after delivery | Baseline heuristic |
| V2 | Cross-order pipeline | While one dish cooks, prepare and buffer an ingredient for the next order | Pipeline heuristic |
| V3 | Distance auction | Enumerate robot–ingredient–cutting-board assignments and choose the least estimated travel | Assignment heuristic |
| V4 | Exact short-window search | Enumerate all current three-order sequences, then combine the best sequence with V3 assignment | Exact only for the stated surrogate subproblem |

The algorithms are deliberately cumulative: V2 adds pipeline overlap to V1, V3 adds flexible task allocation to V2, and V4 adds rolling exact sequencing to V3.

## Standardized comparison

The interface computes these results from the actual simulation using a fixed initial queue, a 120-second horizon, and two decision steps per simulated second. It does not display a hand-written result table.

Representative deterministic results:

| Demand | Algorithm | Completed | Score | Total tardiness | First deliveries |
| --- | --- | ---: | ---: | ---: | --- |
| Standard | V1 | 4 | 739 | 19 s | #1 → #2 → #3 → #4 |
| Standard | V2 | 4 | 742 | 12 s | #1 → #2 → #3 → #4 |
| Standard | V3 | 5 | 972 | 0 s | #1 → #2 → #3 → #4 |
| Standard | V4 | 5 | 972 | 0 s | #1 → #2 → #3 → #4 |
| Rush | V1 | 4 | 607 | 91 s | #1 → #2 → #3 → #4 |
| Rush | V2 | 4 | 607 | 82 s | #1 → #2 → #3 → #4 |
| Rush | V3 | 4 | 610 | 70 s | #1 → #2 → #3 → #4 |
| Rush | V4 | 4 | 610 | 70 s | #1 → #3 → #2 → #4 |

Equal objective values are valid ties. For example, V3 and V4 produce the same rush score and tardiness here, while V4 selects a different sequence. This is useful experimental evidence rather than a reason to force artificial numerical differences.

## Modes

- **Automatic dispatch** is the default. Select V1, V2, V3, or V4 before starting a run.
- **Manual experience** preserves the same kitchen and process as a human-control comparison.
- **Standard / rush demand** changes order deadlines and cooking pressure.

Changing the algorithm or demand mode resets the scenario so comparisons begin from the same initial state.

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

The regression suite checks the immutable 9×8 map, all four algorithms in both demand modes, two-order completion without deadlock, cross-order preparation in V2–V4, and meaningful benchmark differences.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` validates the simulation, builds a static site, and deploys it through GitHub Pages on every push to `main`.

Live site: https://marsguo2049.github.io/kitchen/

## License — noncommercial only

Copyright 2026 Mars Guo.

This project is **source-available, not OSI-approved open source**. It uses the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0): learning, research, experimentation, and other permitted noncommercial uses are allowed; commercial use is prohibited.

Before using, adapting, or redistributing the project, please [open a GitHub issue](https://github.com/marsguo2049/kitchen/issues) to tell the author how you intend to use it. Keep both `LICENSE` and `NOTICE.md` with any copy.
