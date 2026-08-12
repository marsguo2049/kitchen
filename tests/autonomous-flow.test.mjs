import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("the kitchen grid has immutable row and column tracks", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns:\s*repeat\(9,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.robot\s*\{[^}]*position:\s*absolute/s);
});

function loadSimulationHarness() {
  const pageSource = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const pureSource = pageSource
    .slice(0, pageSource.indexOf("export default function Home"))
    .replace(/^"use client";\s*/m, "")
    .replace(/^import .*?;\s*/m, "");
  const harnessSource = `${pureSource}\n;globalThis.__simulation = { createInitialState, autoStep, cloneGame };`;
  const javascript = ts.transpileModule(harnessSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { console };
  vm.runInNewContext(javascript, context);
  return context.__simulation;
}

function advanceClock(state, cloneGame) {
  const next = cloneGame(state);
  next.timeLeft = Math.max(0, next.timeLeft - 1);
  for (const pot of Object.values(next.pots)) {
    if (pot.recipe && !pot.ready) {
      pot.cookLeft = Math.max(0, pot.cookLeft - 1);
      pot.ready = pot.cookLeft === 0;
    }
  }
  next.orders = next.orders.map((order) => ({
    ...order,
    remaining: Math.max(0, order.remaining - 1),
  }));
  if (next.timeLeft === 0) {
    next.running = false;
    next.ended = true;
  }
  return next;
}

for (const difficulty of ["training", "rush"]) {
  test(`autonomous ${difficulty} flow completes two orders without deadlock`, () => {
    const { createInitialState, autoStep, cloneGame } = loadSimulationHarness();
    let state = createInitialState(difficulty, true);
    let lastSignature = "";
    let unchangedSteps = 0;
    let sawTwoIngredients = false;
    let sawCooking = false;
    let sawPlate = false;
    let sawDish = false;

    for (let step = 1; step <= 360 && state.delivered < 2 && !state.ended; step += 1) {
      state = autoStep(state, difficulty);
      if (step % 2 === 0) state = advanceClock(state, cloneGame);

      const mainPot = state.pots["left-pot"];
      sawTwoIngredients ||= mainPot.ingredients.length === 2;
      sawCooking ||= Boolean(mainPot.recipe);
      sawPlate ||= state.robots.some((robot) => robot.carrying?.kind === "plate");
      sawDish ||= state.robots.some((robot) => robot.carrying?.kind === "dish");

      const signature = JSON.stringify({
        robots: state.robots.map(({ row, col, carrying, task }) => ({ row, col, carrying, task })),
        jobs: state.cycle?.jobs,
        phase: state.cycle?.phase,
        pot: mainPot,
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
  });
}
