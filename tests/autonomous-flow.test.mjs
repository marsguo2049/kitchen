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
  for (const id of ["baseline", "pipeline", "dual"]) assert.match(page, new RegExp(`${id}: \\{`));
  assert.match(page, /className="algorithm-selector"/);
  assert.match(page, /运行三种策略/);
  assert.match(page, /导出 MD/);
});

test("repository declares noncommercial licensing and usage notification", () => {
  const license = fs.readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  const notice = fs.readFileSync(new URL("../NOTICE.md", import.meta.url), "utf8");
  assert.match(license, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(notice, /Commercial use is not permitted/);
  assert.match(notice, /github\.com\/marsguo2049\/kitchen\/issues/);
});

test("playback speed does not change the simulated decision budget", () => {
  const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /500 \/ speed/);
  assert.match(page, /tickRef\.current % 2 === 0/);
  assert.match(page, /mode !== "manual"[^]*setInterval\(\(\) => setGame\(\(previous\) => advanceClock\(previous\)\), 1000\)/);
});

function loadSimulationHarness() {
  const pageSource = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const pureSource = pageSource
    .slice(0, pageSource.indexOf("export default function Home"))
    .replace(/^"use client";\s*/m, "")
    .replace(/^import .*?;\s*/m, "");
  const harnessSource = `${pureSource}\n;globalThis.__simulation = { createInitialState, autoStep, cloneGame, advanceClock, runSimulation, experimentMarkdown, deliveryReward, exactWindowSequence, ALGORITHM_IDS };`;
  const javascript = ts.transpileModule(harnessSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { console };
  vm.runInNewContext(javascript, context);
  return context.__simulation;
}

for (const difficulty of ["training", "rush"]) {
  for (const algorithm of ["baseline", "pipeline", "dual"]) test(`${algorithm} autonomous ${difficulty} flow completes two orders without deadlock`, () => {
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

      const pots = Object.values(state.pots);
      const mainPot = state.pots["left-pot"];
      sawTwoIngredients ||= pots.some((pot) => pot.ingredients.length === 2);
      sawCooking ||= pots.some((pot) => Boolean(pot.recipe));
      sawPlate ||= state.robots.some((robot) => robot.carrying?.kind === "plate");
      sawDish ||= state.robots.some((robot) => robot.carrying?.kind === "dish");
      sawCrossOrderPrep ||= Boolean(state.prefetch);

      const signature = JSON.stringify({
        robots: state.robots.map(({ row, col, carrying, task }) => ({ row, col, carrying, task })),
        jobs: state.cycle?.jobs ?? state.smartPlans?.map((plan) => plan.jobs),
        phase: state.cycle?.phase ?? state.smartPlans?.map((plan) => plan.phase),
        pots: state.pots,
        prefetch: state.prefetch,
        delivered: state.delivered,
      });
      unchangedSteps = signature === lastSignature ? unchangedSteps + 1 : 0;
      lastSignature = signature;
      assert.ok(unchangedSteps < 12, `simulation stopped making progress: ${signature}`);
    }

    assert.equal(sawTwoIngredients, true, "both ingredients should reach a pot");
    assert.equal(sawCooking, true, "a pot should start cooking");
    assert.equal(sawPlate, true, "a robot should fetch a plate while cooking");
    assert.equal(sawDish, true, "the cooked recipe should be plated");
    assert.ok(state.delivered >= 2, `expected two deliveries, got ${state.delivered}`);
    if (algorithm !== "baseline") assert.equal(sawCrossOrderPrep, true, `${algorithm} should overlap work across orders`);
  });
}

test("dual strategy actually uses both stoves and stages plates before food is ready", () => {
  const { createInitialState, autoStep, advanceClock } = loadSimulationHarness();
  let state = createInitialState("training", true);
  let sawTwoPlans = false;
  let sawRightPot = false;
  let sawStagedPlate = false;
  let sawPrepWhileCooking = false;
  for (let step = 1; step <= 360 && state.delivered < 3; step += 1) {
    state = autoStep(state, "training", "dual");
    if (step % 2 === 0) state = advanceClock(state);
    sawTwoPlans ||= state.smartPlans.length >= 2;
    sawRightPot ||= Boolean(state.pots["right-pot"].recipe || state.pots["right-pot"].ingredients.length);
    sawStagedPlate ||= state.smartPlans.some((plan) => plan.plateStaged && plan.phase === "cook");
    sawPrepWhileCooking ||= state.smartPlans.some((plan) => plan.phase === "cook") &&
      (state.prefetch !== null || state.smartPlans.some((plan) => plan.phase === "prep"));
  }
  assert.equal(sawTwoPlans, true, "dual strategy should keep two orders in process");
  assert.equal(sawRightPot, true, "dual strategy should use the spare stove");
  assert.equal(sawStagedPlate, true, "dual strategy should stage a plate beside a cooking pot");
  assert.equal(sawPrepWhileCooking, true, "dual strategy should prepare work while another dish cooks");
  assert.ok(state.delivered >= 3, `expected three dual-strategy deliveries, got ${state.delivered}`);
});

test("on-demand experiments support arbitrary horizons and meaningful strategy differences", () => {
  const { runSimulation } = loadSimulationHarness();
  const short = runSimulation("dual", "training", 60);
  const long = runSimulation("dual", "training", 180);
  const training = Object.fromEntries(["baseline", "pipeline", "dual"].map((algorithm) => [algorithm, runSimulation(algorithm, "training", 120)]));
  assert.ok(long.delivered > short.delivered, "a longer experiment horizon should permit more deliveries");
  assert.ok(training.pipeline.delivered >= training.baseline.delivered, "pipeline should not reduce baseline throughput");
  assert.ok(training.dual.delivered >= training.pipeline.delivered, "dual-stove strategy should not reduce pipeline throughput");
});

test("scoring rule rewards punctual work and penalizes lateness explicitly", () => {
  const { deliveryReward } = loadSimulationHarness();
  const onTime = deliveryReward({ remaining: 10 }, 2);
  const late = deliveryReward({ remaining: -10 }, 3);
  assert.equal(onTime.earned, 180);
  assert.equal(onTime.combo, 3);
  assert.equal(late.earned, 50);
  assert.equal(late.combo, 0);
});

test("Markdown report contains parameters, objectives, score formula and all metrics", () => {
  const { runSimulation, experimentMarkdown } = loadSimulationHarness();
  const batch = { duration: 90, difficulty: "rush", objective: "balanced", createdAt: "2026-08-13 10:00:00", results: ["baseline", "pipeline", "dual"].map((algorithm) => runSimulation(algorithm, "rush", 90)) };
  const markdown = experimentMarkdown(batch);
  assert.match(markdown, /仿真时长：90 秒/);
  assert.match(markdown, /主要评价目标：综合字典序/);
  assert.match(markdown, /逾期秒数 × 5/);
  assert.match(markdown, /\| 排名 \| 策略 \| 方法 \| 完成 \| 得分 \|/);
});
