# Robo Kitchen

Robo Kitchen is a 2D operations-research teaching prototype in which two robots cooperate to fulfil timed kitchen orders on a discrete grid.

The project separates three ideas clearly:

- **simulation** represents orders, precedence constraints, shared workstations, cooking time and robot movement;
- **routing** uses breadth-first search (BFS) to find a shortest feasible grid path;
- **scheduling** uses an explainable heuristic to choose an order and assign its two ingredient-preparation jobs.

The current method is a baseline heuristic, not an exact optimizer and not a claim of global optimality.

## Version 1.0 — Sequential baseline

Version 1.0 selects the order with the earliest remaining deadline, prepares its two ingredients in parallel, cooks and delivers that dish, and only then replans for the next order.

This deliberately simple policy provides a reproducible baseline for later versions:

1. earliest-deadline order selection;
2. parallel ingredient preparation by the two robots;
3. BFS shortest-path movement;
4. one-step position reservation for collision avoidance;
5. event-triggered replanning after delivery.

Its known limitation is that work from different orders is not overlapped. Future algorithms can be compared against V1.0 on completed orders, lateness, travel, idle time and conflict waits.

## Kitchen process

Each dish follows the same precedence chain:

`collect ingredients → chop → load pot → cook → collect plate → plate → serve`

The robots move only in four directions. They cannot occupy the same grid cell, walk through equipment, or skip a processing stage. The main stove has a single service cell, so a robot must clear the entrance after loading an ingredient.

## Modes

- **Automatic dispatch** is the default mode and visualises the scheduling decisions, robot tasks, targets and operating metrics.
- **Manual experience** retains the same kitchen and orders as an intuitive comparison baseline.

## Run locally

```bash
npm install
npm run dev:pages
```

## Validation

The automated flow regression covers both standard and rush demand. It checks that the simulation completes at least two consecutive orders without deadlock and observes every major stage: two ingredients in the pot, cooking, plate collection, plating and delivery.

```bash
node --test tests/autonomous-flow.test.mjs
```

## Roadmap

- V1.1: clearer experiment summaries and repeatable scenario seeds
- V2: overlap preparation across multiple orders
- V3: compare fixed roles, auction-based assignment and rolling-horizon scheduling
- V4: formulate a small exact MILP benchmark for optimality-gap experiments

## GitHub Pages

The repository includes a GitHub Actions workflow. In **Settings → Pages**, choose **GitHub Actions** as the source; pushes to `main` will publish the site automatically.
