import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("the kitchen layouts keep immutable tracks while supporting three selectable scenarios", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const KITCHENS: Record<MapId, KitchenLayout>/);
  for (const id of ["compact", "ushape", "zoned"]) assert.match(page, new RegExp(`${id}: \\{`));
  assert.match(page, /gridTemplateColumns: `repeat\(\$\{kitchen\.cols\}/);
  assert.match(page, /gridTemplateRows: `repeat\(\$\{kitchen\.rows\}/);
  assert.match(css, /\.robot\s*\{[^}]*position:\s*absolute/s);
  for (const id of ["baseline", "pipeline", "dual"]) assert.match(page, new RegExp(`${id}: \\{`));
  assert.match(page, /className="scenario-selector"/);
  assert.match(page, /className="algorithm-selector"/);
  assert.match(page, /运行三种策略/);
  assert.match(page, /导出 MD/);
  assert.match(page, /className="experiment-result"/);
  assert.match(page, /tr\(language, "移动", "Travel"\)/);
  assert.match(page, /目标既影响调度，也用于结果排名/);
  assert.match(page, /模型与算法/);
  assert.match(page, /在线决策与状态变量/);
  assert.match(page, /lex max \(Q, −T, S, −M\)/);
  assert.match(page, /启发式仿真 · 非全局优化器/);
  assert.match(page, /δ\(p,s\) = min/);
  assert.match(page, /Scheduling objective/);
  assert.match(page, /\(\[1, 2, 4, 8\] as const\)/);
  assert.match(page, /Model & Algorithms/);
  assert.doesNotMatch(page, /算法实验台|标准到达|高峰到达|移动利用率/);
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
  assert.match(page, /useState<1 \| 2 \| 4 \| 8>\(2\)/);
  assert.match(page, /\(\[1, 2, 4, 8\] as const\)/);
  assert.match(page, /tickRef\.current % 2 === 0/);
  assert.match(page, /mode !== "manual"[^]*setInterval\(\(\) => setGame\(\(previous\) => advanceClock\(previous\)\), 1000\)/);
});

function loadSimulationHarness() {
  const pageSource = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const pureSource = pageSource
    .slice(0, pageSource.indexOf("export default function Home"))
    .replace(/\nfunction ModelView[\s\S]*$/, "")
    .replace(/^"use client";\s*/m, "")
    .replace(/^import .*?;\s*/m, "");
  const harnessSource = `${pureSource}\n;globalThis.__simulation = { createInitialState, autoStep, cloneGame, advanceClock, runSimulation, experimentMarkdown, deliveryReward, exactWindowSequence, selectOrder, runtimeText, ALGORITHM_IDS, MAP_IDS, KITCHENS, RECIPES, shortestPath, adjacentGoals };`;
  const javascript = ts.transpileModule(harnessSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { console };
  vm.runInNewContext(javascript, context);
  return context.__simulation;
}

for (const mapId of ["compact", "ushape", "zoned"]) {
for (const difficulty of ["training", "rush"]) {
  for (const algorithm of ["baseline", "pipeline", "dual"]) test(`${algorithm} autonomous ${difficulty} flow completes two orders on ${mapId} without deadlock`, () => {
    const { createInitialState, autoStep, advanceClock } = loadSimulationHarness();
    let state = createInitialState(difficulty, true, 300, mapId);
    let lastSignature = "";
    let unchangedSteps = 0;
    let sawTwoIngredients = false;
    let sawCooking = false;
    let sawPlate = false;
    let sawDish = false;
    let sawCrossOrderPrep = false;

    for (let step = 1; step <= 900 && state.delivered < 2 && !state.ended; step += 1) {
      state = autoStep(state, difficulty, algorithm);
      if (step % 2 === 0) state = advanceClock(state);

      const pots = Object.values(state.pots);
      const mainPot = state.pots["left-pot"];
      sawTwoIngredients ||= pots.some((pot) => pot.ingredients.length === 2);
      sawCooking ||= pots.some((pot) => Boolean(pot.recipe));
      sawPlate ||= state.robots.some((robot) => robot.carrying?.kind === "plate");
      sawDish ||= state.robots.some((robot) => robot.carrying?.kind === "dish");
      sawCrossOrderPrep ||= Boolean(state.prefetch) || state.smartPlans.length >= 2;

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
}

test("all stations in all layouts are reachable from both robot starts", () => {
  const { MAP_IDS, KITCHENS, shortestPath, adjacentGoals } = loadSimulationHarness();
  for (const mapId of MAP_IDS) {
    const kitchen = KITCHENS[mapId];
    for (const stationKey of Object.keys(kitchen.stations)) {
      assert.ok(adjacentGoals(stationKey, mapId).length > 0, `${mapId} station ${stationKey} needs an interaction cell`);
      for (const start of kitchen.starts) assert.ok(shortestPath(start, stationKey, new Set(), mapId).length > 0, `${mapId} station ${stationKey} must be reachable`);
    }
  }
});

test("the three recipes use different processes, equipment, and work parameters", () => {
  const { RECIPES } = loadSimulationHarness();
  assert.deepEqual(new Set(Object.values(RECIPES).map((recipe) => recipe.equipment)).size, 3);
  assert.deepEqual(new Set(Object.values(RECIPES).map((recipe) => recipe.processEn)).size, 3);
  assert.ok(Object.values(RECIPES).some((recipe) => recipe.cutActions === 2));
  assert.ok(Object.values(RECIPES).some((recipe) => recipe.cutActions === 3));
});

test("dual strategy uses both compatible resources and stages plates before food is ready", () => {
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
  assert.equal(sawRightPot, true, "dual strategy should use the second processing resource");
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
  assert.ok(training.dual.delivered >= training.pipeline.delivered, "dual-resource strategy should not reduce pipeline throughput");
});

test("the live objective changes the order selected by the scheduler", () => {
  const { createInitialState, selectOrder } = loadSimulationHarness();
  const state = createInitialState("training", true);
  state.orders = [
    { id: 1, recipe: "mushroom-skillet", remaining: 5, maxTime: 70 },
    { id: 2, recipe: "garden-salad", remaining: 50, maxTime: 70 },
    { id: 3, recipe: "tomato-soup", remaining: 50, maxTime: 70 },
  ];
  assert.equal(selectOrder(state, "baseline", "tardiness").id, 1, "least-slack objective should protect the urgent order");
  assert.equal(selectOrder(state, "baseline", "throughput").id, 2, "throughput objective should choose the shortest estimated recipe");
});

test("English mode translates runtime decisions, tasks, and targets", () => {
  const { createInitialState, autoStep, advanceClock, runtimeText } = loadSimulationHarness();
  const han = /[\u3400-\u9fff]/;
  for (const algorithm of ["baseline", "pipeline", "dual"]) {
    let state = createInitialState("training", true);
    for (let step = 1; step <= 240 && !state.ended; step += 1) {
      state = autoStep(state, "training", algorithm, "balanced");
      if (step % 2 === 0) state = advanceClock(state);
      for (const value of [state.message, state.decision, ...state.robots.flatMap((robot) => [robot.task, robot.target])]) {
        assert.equal(han.test(runtimeText(value, "en")), false, `${algorithm} left untranslated runtime text: ${value}`);
      }
    }
  }
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

test("Markdown reports are complete and fully localized", () => {
  const { runSimulation, experimentMarkdown } = loadSimulationHarness();
  const batch = { duration: 90, difficulty: "rush", objective: "balanced", mapId: "compact", language: "zh", createdAt: "2026-08-13 10:00:00", results: ["baseline", "pipeline", "dual"].map((algorithm) => runSimulation(algorithm, "rush", 90, "balanced", "compact")) };
  const markdown = experimentMarkdown(batch);
  assert.match(markdown, /仿真时长：90 秒/);
  assert.match(markdown, /当前调度目标：综合字典序/);
  assert.match(markdown, /厨房场景：紧凑直线厨房/);
  assert.match(markdown, /逾期秒数 × 5/);
  assert.match(markdown, /## 模型口径/);
  assert.match(markdown, /lex max \(Q, -T, S, -M\)/);
  assert.match(markdown, /同时引导实时订单优先级/);
  assert.match(markdown, /\| 排名 \| 策略 \| 方法 \| 完成 \| 得分 \|/);
  const english = experimentMarkdown({ ...batch, language: "en" });
  assert.match(english, /# Robo Kitchen Experiment Report/);
  assert.match(english, /Active scheduling objective: Balanced Lexicographic/);
  assert.match(english, /guides live order priority/);
  assert.equal(/[\u3400-\u9fff]/.test(english), false, "English report should not contain Chinese text");
});
