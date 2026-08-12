import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("the kitchen grid has immutable row and column tracks", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns:\s*repeat\(9,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.robot\s*\{[^}]*position:\s*absolute/s);
  for (const id of ["v1", "v2", "v3", "v4"]) assert.match(page, new RegExp(`${id}: \\{`));
  assert.match(page, /className="algorithm-selector"/);
});

function loadSimulationHarness() {
  const pageSource = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const pureSource = pageSource
    .slice(0, pageSource.indexOf("export default function Home"))
    .replace(/^"use client";\s*/m, "")
    .replace(/^import .*?;\s*/m, "");
  const harnessSource = `${pureSource}\n;globalThis.__simulation = { createInitialState, autoStep, cloneGame, advanceClock, runBenchmark, exactWindowSequence, ALGORITHM_IDS };`;
  const javascript = ts.transpileModule(harnessSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { console };
  vm.runInNewContext(javascript, context);
  return context.__simulation;
}

for (const difficulty of ["training", "rush"]) {
  for (const algorithm of ["v1", "v2", "v3", "v4"]) test(`${algorithm} autonomous ${difficulty} flow completes two orders without deadlock`, () => {
    const { createInitialState, autoStep, advanceClock } = loadSimulationHarness();
    let state = createInitialState(difficulty, true);
    let lastSignature = "";
    let unchangedSteps = 0;
    let sawTwoIngredients = false;
    let sawCooking = false;
    let sawPlate = false;
    let sawDish = false;
    let sawCrossOrderPrep = false;

    for (let step = 1; step <= 360 && state.delivered < 2 && !state.ended; step += 1) {
      state = autoStep(state, difficulty, algorithm);
      if (step % 2 === 0) state = advanceClock(state);

      const mainPot = state.pots["left-pot"];
      sawTwoIngredients ||= mainPot.ingredients.length === 2;
      sawCooking ||= Boolean(mainPot.recipe);
      sawPlate ||= state.robots.some((robot) => robot.carrying?.kind === "plate");
      sawDish ||= state.robots.some((robot) => robot.carrying?.kind === "dish");
      sawCrossOrderPrep ||= Boolean(state.prefetch);

      const signature = JSON.stringify({
        robots: state.robots.map(({ row, col, carrying, task }) => ({ row, col, carrying, task })),
        jobs: state.cycle?.jobs,
        phase: state.cycle?.phase,
        pot: mainPot,
        prefetch: state.prefetch,
        delivered: state.delivered,
      });
      unchangedSteps = signature === lastSignature ? unchangedSteps + 1 : 0;
      lastSignature = signature;
      assert.ok(unchangedSteps < 12, `simulation stopped making progress: ${signature}`);
    }

    assert.equal(sawTwoIngredients, true, "both ingredients should reach the main pot");
    assert.equal(sawCooking, true, "the main pot should start cooking");
    assert.equal(sawPlate, true, "a robot should fetch a plate while cooking");
    assert.equal(sawDish, true, "the cooked recipe should be plated");
    assert.ok(state.delivered >= 2, `expected two deliveries, got ${state.delivered}`);
    if (algorithm !== "v1") assert.equal(sawCrossOrderPrep, true, `${algorithm} should overlap work across orders`);
  });
}

test("standardized benchmark exposes meaningful V1–V4 differences", () => {
  const { runBenchmark } = loadSimulationHarness();
  const training = Object.fromEntries(["v1", "v2", "v3", "v4"].map((algorithm) => [algorithm, runBenchmark(algorithm, "training")]));
  const rush = Object.fromEntries(["v1", "v2", "v3", "v4"].map((algorithm) => [algorithm, runBenchmark(algorithm, "rush")]));
  assert.ok(training.v2.tardiness < training.v1.tardiness, "pipeline should reduce training tardiness");
  assert.ok(training.v3.delivered > training.v2.delivered, "distance auction should improve training throughput");
  assert.ok(rush.v3.tardiness < rush.v2.tardiness, "distance auction should reduce rush tardiness");
  assert.notEqual(rush.v4.sequence, rush.v3.sequence, "exact window search should choose a different rush sequence");
});
