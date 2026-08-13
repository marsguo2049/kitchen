"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Ingredient = "tomato" | "mushroom";
type RecipeId = "tomato-soup" | "mushroom-soup" | "garden-stew";
type Mode = "auto" | "manual";
type Difficulty = "training" | "rush";
type AlgorithmId = "baseline" | "pipeline" | "dual";
type PageView = "simulator" | "model";
type LabView = "run" | "experiment";
type ObjectiveId = "throughput" | "score" | "tardiness" | "travel" | "balanced";
type CarryItem =
  | { kind: "raw"; ingredient: Ingredient }
  | { kind: "chopped"; ingredient: Ingredient }
  | { kind: "plate" }
  | { kind: "dish"; recipe: RecipeId }
  | null;
type Position = { row: number; col: number };
type Robot = Position & {
  id: 0 | 1;
  name: string;
  shortName: string;
  color: "coral" | "teal";
  carrying: CarryItem;
  task: string;
  target: string;
};
type CutBoard = { ingredient: Ingredient; progress: number } | null;
type Pot = { ingredients: Ingredient[]; recipe: RecipeId | null; cookLeft: number; ready: boolean };
type Order = { id: number; recipe: RecipeId; remaining: number; maxTime: number };
type JobStage = "fetch" | "cut" | "buffer" | "pot" | "loaded";
type BoardKey = "left-cut" | "right-cut";
type BoardStation = "2-0" | "2-8";
type PrepJob = { ingredient: Ingredient; stage: JobStage; robotId: 0 | 1; boardKey: BoardKey; boardStation: BoardStation; bufferKey?: "pass-top" };
type Prefetch = {
  orderId: number;
  ingredient: Ingredient;
  stage: "fetch" | "cut" | "counter" | "staged";
  robotId: 0 | 1;
  boardKey: BoardKey;
  boardStation: BoardStation;
  counterKey: "pass-top";
};
type AutoCycle = {
  orderId: number;
  recipe: RecipeId;
  phase: "prep" | "cook" | "serve";
  jobs: [PrepJob, PrepJob];
  potKey: "left-pot" | "right-pot";
  potStation: "4-0" | "4-8";
  serverId: 0 | 1;
  prefetcherId: 0 | 1;
};
type SmartJob = {
  ingredient: Ingredient;
  stage: JobStage;
  robotId: 0 | 1 | null;
  boardKey?: BoardKey;
  boardStation?: BoardStation;
  bufferKey?: "pass-top";
};
type SmartPlan = {
  orderId: number;
  recipe: RecipeId;
  potKey: "left-pot" | "right-pot";
  potStation: "4-0" | "4-8";
  phase: "prep" | "cook" | "ready" | "serve";
  jobs: [SmartJob, SmartJob];
  plateStaged: boolean;
  serverId: 0 | 1 | null;
};
type Metrics = { travel: number; idle: number; conflicts: number; replans: number; tardiness: number };
type GameState = {
  robots: [Robot, Robot];
  activeRobot: 0 | 1;
  cutBoards: Record<string, CutBoard>;
  pots: Record<string, Pot>;
  counters: Record<string, CarryItem>;
  orders: Order[];
  history: number[];
  score: number;
  delivered: number;
  combo: number;
  timeLeft: number;
  running: boolean;
  paused: boolean;
  ended: boolean;
  message: string;
  decision: string;
  nextOrderId: number;
  lastRecipe: RecipeId | null;
  cycle: AutoCycle | null;
  prefetch: Prefetch | null;
  smartPlans: SmartPlan[];
  metrics: Metrics;
};
type Station =
  | { type: "ingredient"; ingredient: Ingredient; label: string; icon: string }
  | { type: "cut"; key: string; label: string; icon: string }
  | { type: "stove"; key: string; label: string; icon: string }
  | { type: "plates"; label: string; icon: string }
  | { type: "serve"; label: string; icon: string }
  | { type: "bin"; label: string; icon: string }
  | { type: "counter"; key: string; label: string; icon: string };

const ROWS = 8;
const COLS = 9;
const DEFAULT_ROUND_SECONDS = 120;
const normalizeDuration = (value: string | number) => Math.max(30, Math.min(600, Math.round(Number(value) / 10) * 10 || 30));
const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const RECIPES: Record<RecipeId, { name: string; shortName: string; icon: string; ingredients: [Ingredient, Ingredient]; color: string }> = {
  "tomato-soup": { name: "双番茄浓汤", shortName: "番茄汤", icon: "🍅", ingredients: ["tomato", "tomato"], color: "#ef6a54" },
  "mushroom-soup": { name: "奶油蘑菇汤", shortName: "蘑菇汤", icon: "🍄", ingredients: ["mushroom", "mushroom"], color: "#9b7358" },
  "garden-stew": { name: "田园双拼炖菜", shortName: "双拼炖菜", icon: "🥘", ingredients: ["tomato", "mushroom"], color: "#e49c3f" },
};
const ALGORITHMS: Record<AlgorithmId, { code: string; name: string; shortName: string; kind: string; steps: string[]; note: string }> = {
  baseline: {
    code: "A",
    name: "顺序 EDF 基线",
    shortName: "顺序基线",
    kind: "基准启发式",
    steps: ["最早截止订单优先", "单个订单内双机器人并行", "固定切配角色 + BFS 最短路", "交付后才启动下一订单"],
    note: "一次只处理一道菜，是后续策略的可复现实验基线。",
  },
  pipeline: {
    code: "B",
    name: "流水竞价协作调度",
    shortName: "流水竞价",
    kind: "分配启发式",
    steps: ["最早截止订单优先", "烹饪时预备下一单", "按距离竞价分配机器人", "切好原料暂存于传菜台"],
    note: "合并原 V2 流水备料与 V3 距离竞价，作为单灶协作策略。",
  },
  dual: {
    code: "C",
    name: "滚动双灶资源调度",
    shortName: "双灶协同",
    kind: "资源感知启发式",
    steps: ["滚动评估当前订单窗口", "两口灶同时承接不同订单", "空盘提前放到对应灶台旁", "空闲机器人继续准备后续订单"],
    note: "合并原 V4 滚动排序与 V5 资源调度，是当前最完整的双灶策略。",
  },
};
const ALGORITHM_IDS = Object.keys(ALGORITHMS) as AlgorithmId[];
const OBJECTIVES: Record<ObjectiveId, { label: string; direction: string; description: string }> = {
  throughput: { label: "最多完成", direction: "越大越好", description: "优先比较时限内完成的订单数。" },
  score: { label: "最高积分", direction: "越大越好", description: "比较交付基础分、准时奖励与连击奖励之和。" },
  tardiness: { label: "最小逾期", direction: "越小越好", description: "比较所有已交付订单的累计逾期秒数。" },
  travel: { label: "最少移动", direction: "越小越好", description: "比较两台机器人累计移动格数。" },
  balanced: { label: "综合字典序", direction: "依次判定", description: "先最大完成量，再最小逾期、最大积分、最少移动。" },
};
const STATIONS: Record<string, Station> = {
  "0-2": { type: "ingredient", ingredient: "tomato", label: "番茄", icon: "🍅" },
  "0-6": { type: "ingredient", ingredient: "mushroom", label: "蘑菇", icon: "🍄" },
  "2-0": { type: "cut", key: "left-cut", label: "切配 A", icon: "🔪" },
  "2-8": { type: "cut", key: "right-cut", label: "切配 B", icon: "🔪" },
  "4-0": { type: "stove", key: "left-pot", label: "主灶台", icon: "♨" },
  "4-8": { type: "stove", key: "right-pot", label: "备用灶", icon: "♨" },
  "3-4": { type: "counter", key: "pass-top", label: "传菜台", icon: "↔" },
  "4-4": { type: "counter", key: "pass-bottom", label: "传菜台", icon: "↔" },
  "7-2": { type: "plates", label: "餐盘", icon: "◯" },
  "7-4": { type: "bin", label: "回收", icon: "↻" },
  "7-6": { type: "serve", label: "出餐", icon: "🔔" },
};
const WALLS = new Set([
  "0-0", "0-1", "0-3", "0-4", "0-5", "0-7", "0-8",
  "1-0", "1-8", "3-0", "3-8", "5-0", "5-8", "6-0", "6-8",
  "7-0", "7-1", "7-3", "7-5", "7-7", "7-8",
]);
const STATION_POSITIONS = Object.fromEntries(Object.entries(STATIONS).map(([key]) => [key, key.split("-").map(Number)]));

function coord(row: number, col: number) { return `${row}-${col}`; }
function isWalkable(row: number, col: number) {
  const key = coord(row, col);
  return row >= 0 && row < ROWS && col >= 0 && col < COLS && !WALLS.has(key) && !STATIONS[key];
}
function isAdjacent(robot: Position, stationKey: string) {
  const [row, col] = STATION_POSITIONS[stationKey] as number[];
  return Math.abs(robot.row - row) + Math.abs(robot.col - col) === 1;
}
function nearbyStation(robot: Robot) {
  return Object.entries(STATIONS).find(([key]) => isAdjacent(robot, key))?.[1] ?? null;
}
function ingredientName(value: Ingredient) { return value === "tomato" ? "番茄" : "蘑菇"; }
function itemLabel(item: CarryItem) {
  if (!item) return "空手";
  if (item.kind === "plate") return "空盘";
  if (item.kind === "dish") return RECIPES[item.recipe].shortName;
  return `${item.kind === "chopped" ? "切好的" : ""}${ingredientName(item.ingredient)}`;
}
function itemIcon(item: CarryItem) {
  if (!item) return "";
  if (item.kind === "plate") return "◯";
  if (item.kind === "dish") return "🍲";
  return item.ingredient === "tomato" ? "🍅" : "🍄";
}
function makeOrder(id: number, difficulty: Difficulty): Order {
  const pool: RecipeId[] = difficulty === "training"
    ? ["tomato-soup", "mushroom-soup", "garden-stew"]
    : ["garden-stew", "tomato-soup", "garden-stew", "mushroom-soup"];
  const recipe = pool[(id * 7 + 1) % pool.length];
  const maxTime = difficulty === "training" ? 70 : 46;
  return { id, recipe, remaining: maxTime, maxTime };
}
function createInitialState(difficulty: Difficulty, running = false, duration = DEFAULT_ROUND_SECONDS): GameState {
  return {
    robots: [
      { id: 0, name: "阿橙", shortName: "A", color: "coral", row: 2, col: 5, carrying: null, task: "等待任务", target: "—" },
      { id: 1, name: "小青", shortName: "B", color: "teal", row: 5, col: 3, carrying: null, task: "等待任务", target: "—" },
    ],
    activeRobot: 0,
    cutBoards: { "left-cut": null, "right-cut": null },
    pots: { "left-pot": { ingredients: [], recipe: null, cookLeft: 0, ready: false }, "right-pot": { ingredients: [], recipe: null, cookLeft: 0, ready: false } },
    counters: { "pass-top": null, "pass-bottom": null },
    orders: [makeOrder(1, difficulty), makeOrder(2, difficulty), makeOrder(3, difficulty)], history: [],
    score: 0, delivered: 0, combo: 0, timeLeft: duration, running, paused: false, ended: false,
    message: running ? "调度器启动，正在读取订单队列。" : "系统就绪，启动后由算法自动完成全部任务。",
    decision: "等待订单触发滚动规划。", nextOrderId: 4, lastRecipe: null, cycle: null, prefetch: null, smartPlans: [],
    metrics: { travel: 0, idle: 0, conflicts: 0, replans: 0, tardiness: 0 },
  };
}
function cloneGame(previous: GameState): GameState {
  return {
    ...previous,
    robots: previous.robots.map((robot) => ({ ...robot, carrying: robot.carrying ? { ...robot.carrying } : null })) as [Robot, Robot],
    cutBoards: Object.fromEntries(Object.entries(previous.cutBoards).map(([key, value]) => [key, value ? { ...value } : null])),
    pots: Object.fromEntries(Object.entries(previous.pots).map(([key, value]) => [key, { ...value, ingredients: [...value.ingredients] }])),
    counters: { ...previous.counters }, orders: previous.orders.map((order) => ({ ...order })), history: [...previous.history],
    cycle: previous.cycle ? { ...previous.cycle, jobs: previous.cycle.jobs.map((job) => ({ ...job })) as [PrepJob, PrepJob] } : null,
    prefetch: previous.prefetch ? { ...previous.prefetch } : null,
    smartPlans: previous.smartPlans.map((plan) => ({ ...plan, jobs: plan.jobs.map((job) => ({ ...job })) as [SmartJob, SmartJob] })),
    metrics: { ...previous.metrics },
  };
}
function adjacentGoals(stationKey: string) {
  const [row, col] = STATION_POSITIONS[stationKey] as number[];
  return DIRECTIONS.map(([dr, dc]) => ({ row: row + dr, col: col + dc })).filter((point) => isWalkable(point.row, point.col));
}
function shortestPath(start: Position, stationKey: string, blocked: Set<string>) {
  const goals = new Set(adjacentGoals(stationKey).map((point) => coord(point.row, point.col)));
  if (goals.has(coord(start.row, start.col))) return [] as Position[];
  const queue: { point: Position; path: Position[] }[] = [{ point: start, path: [] }];
  const visited = new Set([coord(start.row, start.col)]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const [dr, dc] of DIRECTIONS) {
      const next = { row: current.point.row + dr, col: current.point.col + dc };
      const key = coord(next.row, next.col);
      if (visited.has(key) || blocked.has(key) || !isWalkable(next.row, next.col)) continue;
      const path = [...current.path, next];
      if (goals.has(key)) return path;
      visited.add(key);
      queue.push({ point: next, path });
    }
  }
  return [] as Position[];
}
function advanceTo(game: GameState, robotId: 0 | 1, stationKey: string, task: string, reserved: Set<string>) {
  const robot = game.robots[robotId];
  const station = STATIONS[stationKey];
  robot.task = task;
  robot.target = station?.label ?? "工位";
  if (isAdjacent(robot, stationKey)) return true;
  const other = game.robots[robotId === 0 ? 1 : 0];
  const blocked = new Set([coord(other.row, other.col), ...reserved]);
  const path = shortestPath(robot, stationKey, blocked);
  if (!path.length) {
    game.metrics.idle += 1;
    game.metrics.conflicts += 1;
    robot.task = "避让搭档";
    return false;
  }
  const next = path[0];
  robot.row = next.row; robot.col = next.col;
  reserved.add(coord(next.row, next.col));
  game.metrics.travel += 1;
  return false;
}
function positionToStationDistance(start: Position, stationKey: string) {
  if (isAdjacent(start, stationKey)) return 0;
  const path = shortestPath(start, stationKey, new Set());
  return path.length || 99;
}
function stationToStationDistance(fromKey: string, toKey: string) {
  return Math.min(...adjacentGoals(fromKey).map((point) => positionToStationDistance(point, toKey)));
}
function assignmentCost(robot: Robot, ingredient: Ingredient, boardStation: BoardStation, potStation: "4-0" | "4-8" = "4-0") {
  const ingredientStation = ingredient === "tomato" ? "0-2" : "0-6";
  return positionToStationDistance(robot, ingredientStation)
    + stationToStationDistance(ingredientStation, boardStation)
    + stationToStationDistance(boardStation, potStation);
}
function makeAssignedJobs(game: GameState, ingredients: [Ingredient, Ingredient], algorithm: AlgorithmId, potStation: "4-0" | "4-8"): [PrepJob, PrepJob] {
  if (algorithm === "baseline") {
    return [
      { ingredient: ingredients[0], stage: "fetch", robotId: 0, boardKey: "left-cut", boardStation: "2-0" },
      { ingredient: ingredients[1], stage: "fetch", robotId: 1, boardKey: "right-cut", boardStation: "2-8" },
    ];
  }
  const ingredientOrders: [Ingredient, Ingredient][] = [ingredients, [ingredients[1], ingredients[0]]];
  const boardOrders: [[BoardKey, BoardStation], [BoardKey, BoardStation]][] = [
    [["left-cut", "2-0"], ["right-cut", "2-8"]],
    [["right-cut", "2-8"], ["left-cut", "2-0"]],
  ];
  let best: { cost: number; jobs: [PrepJob, PrepJob] } | null = null;
  for (const ingredientOrder of ingredientOrders) {
    for (const boardOrder of boardOrders) {
      const cost = assignmentCost(game.robots[0], ingredientOrder[0], boardOrder[0][1], potStation)
        + assignmentCost(game.robots[1], ingredientOrder[1], boardOrder[1][1], potStation);
      const jobs: [PrepJob, PrepJob] = [
        { ingredient: ingredientOrder[0], stage: "fetch", robotId: 0, boardKey: boardOrder[0][0], boardStation: boardOrder[0][1] },
        { ingredient: ingredientOrder[1], stage: "fetch", robotId: 1, boardKey: boardOrder[1][0], boardStation: boardOrder[1][1] },
      ];
      if (!best || cost < best.cost) best = { cost, jobs };
    }
  }
  return best!.jobs;
}
function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail]));
}
function estimatedRecipeDuration(recipe: RecipeId) {
  return recipe === "garden-stew" ? 19 : recipe === "tomato-soup" ? 21 : 22;
}
function exactWindowSequence(orders: Order[], previousRecipe: RecipeId | null = null) {
  let best: { objective: number; ids: string; sequence: Order[] } | null = null;
  for (const sequence of permutations(orders)) {
    let elapsed = 0;
    let objective = 0;
    sequence.forEach((order, index) => {
      const priorRecipe = index > 0 ? sequence[index - 1].recipe : previousRecipe;
      const changeover = priorRecipe && priorRecipe !== order.recipe ? 2 : 0;
      elapsed += estimatedRecipeDuration(order.recipe) + changeover;
      objective += Math.max(0, elapsed - order.remaining) * 25 + elapsed;
    });
    const ids = sequence.map((order) => String(order.id).padStart(4, "0")).join("-");
    if (!best || objective < best.objective || (objective === best.objective && ids < best.ids)) best = { objective, ids, sequence };
  }
  return best?.sequence ?? [];
}
function selectOrder(game: GameState, algorithm: AlgorithmId, excluded = new Set<number>()) {
  const available = game.orders.filter((order) => !excluded.has(order.id));
  if (!available.length) return null;
  if (game.prefetch && !excluded.has(game.prefetch.orderId)) {
    const committed = available.find((order) => order.id === game.prefetch?.orderId);
    if (committed) return committed;
  }
  return [...available].sort((a, b) => a.remaining - b.remaining || a.id - b.id)[0];
}
function startCycle(game: GameState, algorithm: AlgorithmId) {
  const selected = selectOrder(game, algorithm);
  if (!selected) return;
  const ingredients = RECIPES[selected.recipe].ingredients;
  const staged = game.prefetch?.orderId === selected.id ? game.prefetch : null;
  let potKey: "left-pot" | "right-pot" = "left-pot";
  let potStation: "4-0" | "4-8" = "4-0";
  let jobs: [PrepJob, PrepJob];
  if (staged) {
    const remaining = [...ingredients];
    remaining.splice(remaining.indexOf(staged.ingredient), 1);
    const resumedStage: JobStage = staged.stage === "staged" ? "buffer" : staged.stage === "counter" ? "pot" : staged.stage;
    const otherId = (staged.robotId === 0 ? 1 : 0) as 0 | 1;
    const otherBoardKey: BoardKey = staged.boardKey === "left-cut" ? "right-cut" : "left-cut";
    const otherBoardStation: BoardStation = staged.boardStation === "2-0" ? "2-8" : "2-0";
    jobs = [
      { ingredient: staged.ingredient, stage: resumedStage, robotId: staged.robotId, boardKey: staged.boardKey, boardStation: staged.boardStation, bufferKey: staged.stage === "staged" ? staged.counterKey : undefined },
      { ingredient: remaining[0], stage: "fetch", robotId: otherId, boardKey: otherBoardKey, boardStation: otherBoardStation },
    ];
    game.prefetch = null;
  } else {
    jobs = makeAssignedJobs(game, ingredients, algorithm, potStation);
  }
  game.cycle = { orderId: selected.id, recipe: selected.recipe, phase: "prep", jobs, potKey, potStation, serverId: 1, prefetcherId: 0 };
  game.metrics.replans += 1;
  if (staged) {
    game.decision = `接续 #${selected.id} 的跨订单预备原料，并行完成剩余备料。`;
  } else if (algorithm === "pipeline") {
    game.decision = `选择 #${selected.id}，按预计移动距离竞价分配原料与切配台。`;
  } else {
    game.decision = `选择剩余时间最短的 #${selected.id} ${RECIPES[selected.recipe].shortName}；两份原料并行处理。`;
  }
  const robotJobs = [...jobs].sort((a, b) => a.robotId - b.robotId);
  game.message = `策略 ${ALGORITHMS[algorithm].code} 规划 #${selected.id}：阿橙负责${ingredientName(robotJobs[0].ingredient)}，小青负责${ingredientName(robotJobs[1].ingredient)}。`;
}
function startPrefetch(game: GameState, algorithm: AlgorithmId) {
  if (!game.cycle || game.prefetch || algorithm === "baseline") return;
  const selected = selectOrder(game, algorithm, new Set([game.cycle.orderId]));
  if (!selected) return;
  const ingredients = RECIPES[selected.recipe].ingredients;
  const prefetcherId = game.cycle.prefetcherId;
  const boardKey: BoardKey = prefetcherId === 0 ? "left-cut" : "right-cut";
  const boardStation: BoardStation = prefetcherId === 0 ? "2-0" : "2-8";
  const ingredient = [...ingredients].sort((a, b) => assignmentCost(game.robots[prefetcherId], a, boardStation) - assignmentCost(game.robots[prefetcherId], b, boardStation))[0];
  game.prefetch = { orderId: selected.id, ingredient, stage: "fetch", robotId: prefetcherId, boardKey, boardStation, counterKey: "pass-top" };
  game.decision = `策略 ${ALGORITHMS[algorithm].code} 在烹饪窗口预取 #${selected.id} 的${ingredientName(ingredient)}。`;
}
function advancePrefetch(game: GameState, reserved: Set<string>) {
  const prefetch = game.prefetch;
  if (!prefetch) return;
  const robot = game.robots[prefetch.robotId];
  const ingredientStation = prefetch.ingredient === "tomato" ? "0-2" : "0-6";
  if (prefetch.stage === "fetch") {
    if (advanceTo(game, prefetch.robotId, ingredientStation, `预取下一单${ingredientName(prefetch.ingredient)}`, reserved)) {
      robot.carrying = { kind: "raw", ingredient: prefetch.ingredient };
      prefetch.stage = "cut";
    }
  } else if (prefetch.stage === "cut") {
    if (advanceTo(game, prefetch.robotId, prefetch.boardStation, `提前切配${ingredientName(prefetch.ingredient)}`, reserved)) {
      const board = game.cutBoards[prefetch.boardKey];
      if (!board && robot.carrying?.kind === "raw") {
        game.cutBoards[prefetch.boardKey] = { ingredient: prefetch.ingredient, progress: 0 };
        robot.carrying = null;
      } else if (board && board.progress < 3) {
        board.progress += 1;
      } else if (board?.progress === 3 && !robot.carrying) {
        robot.carrying = { kind: "chopped", ingredient: prefetch.ingredient };
        game.cutBoards[prefetch.boardKey] = null;
        prefetch.stage = "counter";
      }
    }
  } else if (prefetch.stage === "counter") {
    if (advanceTo(game, prefetch.robotId, "3-4", "将下一单原料存入缓冲台", reserved)) {
      if (!game.counters[prefetch.counterKey] && robot.carrying?.kind === "chopped") {
        game.counters[prefetch.counterKey] = robot.carrying;
        robot.carrying = null;
        prefetch.stage = "staged";
        game.message = `#${prefetch.orderId} 的${ingredientName(prefetch.ingredient)}已提前备好。`;
      } else {
        game.metrics.idle += 1;
      }
    }
  } else {
    robot.task = `#${prefetch.orderId} 预备原料已就绪`;
    robot.target = "传菜台缓冲区";
    game.metrics.idle += 1;
  }
}
function deliveryReward(order: Order | null, previousCombo: number) {
  if (!order) return { earned: 60, combo: 0 };
  const onTime = order.remaining >= 0;
  const combo = onTime ? previousCombo + 1 : 0;
  const timeComponent = onTime ? order.remaining * 3 : -Math.min(80, -order.remaining * 5);
  const comboBonus = onTime ? Math.min(combo - 1, 4) * 25 : 0;
  return { earned: Math.max(20, 100 + timeComponent + comboBonus), combo };
}
function finishDelivery(game: GameState, recipe: RecipeId, difficulty: Difficulty, orderId?: number) {
  const index = orderId === undefined
    ? game.orders.findIndex((order) => order.recipe === recipe)
    : game.orders.findIndex((order) => order.id === orderId);
  const matched = index >= 0 ? game.orders[index] : null;
  const { combo, earned } = deliveryReward(matched, game.combo);
  const orders = index >= 0 ? game.orders.filter((_, orderIndex) => orderIndex !== index) : [...game.orders];
  orders.push(makeOrder(game.nextOrderId, difficulty));
  game.orders = orders;
  game.nextOrderId += 1; game.score += earned; game.delivered += 1; game.combo = combo; game.lastRecipe = recipe;
  if (matched) game.history.push(matched.id);
  game.metrics.tardiness += matched ? Math.max(0, -matched.remaining) : 0;
  game.message = `订单交付，+${earned} 分。调度器将根据新队列重新规划。`;
  game.decision = "完成一次滚动时域，释放工位并重新计算订单优先级。";
  game.cycle = null;
  game.robots.forEach((robot) => {
    const keepsPrefetch = game.prefetch && robot.id === game.prefetch.robotId && game.prefetch.stage !== "staged";
    robot.task = keepsPrefetch ? "继续下一单备料" : "等待重规划";
    robot.target = keepsPrefetch ? "预备工序" : "调度器";
    if (!keepsPrefetch) robot.carrying = null;
  });
}
function smartOrder(game: GameState, excluded: Set<number>) {
  const available = game.orders.filter((order) => !excluded.has(order.id));
  return exactWindowSequence(available, game.lastRecipe)[0] ?? null;
}
function ensureSmartPlans(game: GameState) {
  const occupiedPots = new Set(game.smartPlans.filter((plan) => plan.phase !== "serve").map((plan) => plan.potKey));
  const activeOrders = new Set(game.smartPlans.map((plan) => plan.orderId));
  while (occupiedPots.size < 2) {
    const stagedOrder = game.prefetch?.stage === "staged"
      ? game.orders.find((order) => order.id === game.prefetch?.orderId && !activeOrders.has(order.id)) ?? null
      : null;
    const excluded = new Set(activeOrders);
    if (game.prefetch && game.prefetch.stage !== "staged") excluded.add(game.prefetch.orderId);
    const selected = stagedOrder ?? smartOrder(game, excluded);
    if (!selected) break;
    const [potKey, potStation] = !occupiedPots.has("left-pot")
      ? ["left-pot", "4-0"] as const
      : ["right-pot", "4-8"] as const;
    const ingredients = [...RECIPES[selected.recipe].ingredients] as [Ingredient, Ingredient];
    let jobs: [SmartJob, SmartJob] = [
      { ingredient: ingredients[0], stage: "fetch", robotId: null },
      { ingredient: ingredients[1], stage: "fetch", robotId: null },
    ];
    if (stagedOrder && game.prefetch) {
      const staged = game.prefetch;
      const remaining = [...ingredients];
      remaining.splice(remaining.indexOf(staged.ingredient), 1);
      jobs = [
        { ingredient: staged.ingredient, stage: "buffer", robotId: null, bufferKey: staged.counterKey },
        { ingredient: remaining[0], stage: "fetch", robotId: null },
      ];
      game.prefetch = null;
    }
    game.smartPlans.push({ orderId: selected.id, recipe: selected.recipe, potKey, potStation, phase: "prep", jobs, plateStaged: false, serverId: null });
    occupiedPots.add(potKey);
    activeOrders.add(selected.id);
    game.metrics.replans += 1;
  }
}
function smartJobForRobot(game: GameState, robotId: 0 | 1) {
  for (const plan of game.smartPlans) {
    const job = plan.jobs.find((candidate) => candidate.robotId === robotId && candidate.stage !== "loaded");
    if (job) return { plan, job };
  }
  return null;
}
function smartRobotBusy(game: GameState, robotId: 0 | 1) {
  if (game.robots[robotId].carrying) return true;
  if (smartJobForRobot(game, robotId)) return true;
  if (game.prefetch?.robotId === robotId && game.prefetch.stage !== "staged") return true;
  return game.smartPlans.some((plan) => plan.serverId === robotId);
}
function assignSmartJobs(game: GameState) {
  for (const robotId of [0, 1] as const) {
    if (smartRobotBusy(game, robotId)) continue;
    const activePlans = new Set(game.smartPlans.flatMap((plan) => plan.jobs.filter((job) => job.robotId !== null && job.stage !== "loaded").map(() => plan.orderId)));
    const candidates = game.smartPlans.flatMap((plan) => plan.phase === "prep"
      ? plan.jobs.filter((job) => job.robotId === null && job.stage !== "loaded").map((job) => ({ plan, job }))
      : []);
    candidates.sort((a, b) => {
      const aOrder = game.orders.find((order) => order.id === a.plan.orderId);
      const bOrder = game.orders.find((order) => order.id === b.plan.orderId);
      const aStation = a.job.stage === "buffer" ? "3-4" : a.job.ingredient === "tomato" ? "0-2" : "0-6";
      const bStation = b.job.stage === "buffer" ? "3-4" : b.job.ingredient === "tomato" ? "0-2" : "0-6";
      const aScore = positionToStationDistance(game.robots[robotId], aStation) + (activePlans.has(a.plan.orderId) ? 14 : 0) + (aOrder?.remaining ?? 0) * .04;
      const bScore = positionToStationDistance(game.robots[robotId], bStation) + (activePlans.has(b.plan.orderId) ? 14 : 0) + (bOrder?.remaining ?? 0) * .04;
      return aScore - bScore || a.plan.orderId - b.plan.orderId;
    });
    if (candidates[0]) candidates[0].job.robotId = robotId;
  }
}
function finishSmartDelivery(game: GameState, plan: SmartPlan, robotId: 0 | 1, difficulty: Difficulty) {
  const index = game.orders.findIndex((order) => order.id === plan.orderId);
  const matched = index >= 0 ? game.orders[index] : null;
  const { combo, earned } = deliveryReward(matched, game.combo);
  const orders = index >= 0 ? game.orders.filter((_, orderIndex) => orderIndex !== index) : [...game.orders];
  orders.push(makeOrder(game.nextOrderId, difficulty));
  game.orders = orders;
  game.nextOrderId += 1;
  game.score += earned;
  game.delivered += 1;
  game.combo = combo;
  game.lastRecipe = plan.recipe;
  if (matched) game.history.push(matched.id);
  game.metrics.tardiness += matched ? Math.max(0, -matched.remaining) : 0;
  game.smartPlans = game.smartPlans.filter((candidate) => candidate !== plan);
  const robot = game.robots[robotId];
  robot.carrying = null;
  robot.task = "交付完成，立即接取新任务";
  robot.target = "滚动调度器";
  game.message = `双灶订单 #${plan.orderId} 交付，+${earned} 分；空闲灶台立即接续新订单。`;
  game.decision = "释放机器人与灶台，重新计算订单、距离和工位占用。";
}
function startSmartPrefetch(game: GameState, robotId: 0 | 1) {
  if (game.prefetch || game.counters["pass-top"]) return;
  const excluded = new Set(game.smartPlans.map((plan) => plan.orderId));
  const selected = smartOrder(game, excluded);
  if (!selected) return;
  const boardKey: BoardKey = robotId === 0 ? "left-cut" : "right-cut";
  const boardStation: BoardStation = robotId === 0 ? "2-0" : "2-8";
  const ingredient = [...RECIPES[selected.recipe].ingredients].sort((a, b) => assignmentCost(game.robots[robotId], a, boardStation) - assignmentCost(game.robots[robotId], b, boardStation))[0];
  game.prefetch = { orderId: selected.id, ingredient, stage: "fetch", robotId, boardKey, boardStation, counterKey: "pass-top" };
  game.decision = `两口灶烹饪期间，${game.robots[robotId].name}机会性准备 #${selected.id} 的${ingredientName(ingredient)}。`;
}
function smartStep(previous: GameState, difficulty: Difficulty) {
  const game = cloneGame(previous);
  ensureSmartPlans(game);
  const reserved = new Set<string>();
  const acted = new Set<0 | 1>();

  for (const plan of game.smartPlans) {
    const pot = game.pots[plan.potKey];
    if (plan.phase === "prep" && plan.jobs.every((job) => job.stage === "loaded")) {
      pot.recipe = plan.recipe;
      pot.cookLeft = difficulty === "training" ? 8 : 11;
      pot.ready = false;
      plan.phase = "cook";
      plan.jobs.forEach((job) => { job.robotId = null; });
      game.message = `#${plan.orderId} 在${plan.potKey === "left-pot" ? "主灶" : "备用灶"}开始烹饪；调度器同时安排空盘和下一单。`;
    }
    if (plan.phase === "cook" && pot.ready) plan.phase = "ready";
  }

  for (const plan of [...game.smartPlans]) {
    const serverId = plan.serverId;
    if (serverId === null || acted.has(serverId)) continue;
    const robot = game.robots[serverId];
    if (robot.carrying?.kind === "dish" && plan.phase === "serve") {
      const arrived = advanceTo(game, serverId, "7-6", `交付 #${plan.orderId}`, reserved);
      acted.add(serverId);
      if (arrived) finishSmartDelivery(game, plan, serverId, difficulty);
    }
  }

  for (const plan of game.smartPlans) {
    const serverId = plan.serverId;
    if (serverId === null || acted.has(serverId) || plan.phase === "serve") continue;
    const robot = game.robots[serverId];
    if (!robot.carrying && !plan.plateStaged) {
      const arrived = advanceTo(game, serverId, "7-2", `为 #${plan.orderId} 提前取盘`, reserved);
      acted.add(serverId);
      if (arrived) robot.carrying = { kind: "plate" };
    } else if (robot.carrying?.kind === "plate") {
      const arrived = advanceTo(game, serverId, plan.potStation, `把空盘送到 #${plan.orderId} 灶台旁`, reserved);
      acted.add(serverId);
      if (arrived) {
        const pot = game.pots[plan.potKey];
        if (pot.ready) {
          robot.carrying = { kind: "dish", recipe: plan.recipe };
          game.pots[plan.potKey] = { ingredients: [], recipe: null, cookLeft: 0, ready: false };
          plan.phase = "serve";
        } else {
          robot.carrying = null;
          plan.plateStaged = true;
          plan.serverId = null;
          robot.task = "空盘已放在灶旁，转去备料";
          robot.target = "下一项可执行任务";
          game.message = `空盘已提前放在${plan.potKey === "left-pot" ? "主灶" : "备用灶"}旁；${robot.name}无需原地等待。`;
        }
      }
    } else if (plan.plateStaged && plan.phase === "ready") {
      const arrived = advanceTo(game, serverId, plan.potStation, `从 #${plan.orderId} 灶台直接装盘`, reserved);
      acted.add(serverId);
      if (arrived) {
        robot.carrying = { kind: "dish", recipe: plan.recipe };
        game.pots[plan.potKey] = { ingredients: [], recipe: null, cookLeft: 0, ready: false };
        plan.phase = "serve";
      }
    }
  }

  for (const plan of game.smartPlans) {
    if (plan.phase !== "ready" && plan.phase !== "cook") continue;
    if (plan.serverId !== null || (plan.plateStaged && plan.phase !== "ready")) continue;
    const pickupStation = plan.plateStaged ? plan.potStation : "7-2";
    const free = ([0, 1] as const).filter((id) => !acted.has(id) && !smartRobotBusy(game, id));
    free.sort((a, b) => positionToStationDistance(game.robots[a], pickupStation) - positionToStationDistance(game.robots[b], pickupStation));
    const serverId = free[0];
    if (serverId === undefined) continue;
    plan.serverId = serverId;
    const robot = game.robots[serverId];
    const arrived = advanceTo(game, serverId, pickupStation, plan.plateStaged ? `从 #${plan.orderId} 灶台直接装盘` : `为 #${plan.orderId} 提前取盘`, reserved);
    acted.add(serverId);
    if (arrived && plan.plateStaged) {
      robot.carrying = { kind: "dish", recipe: plan.recipe };
      game.pots[plan.potKey] = { ingredients: [], recipe: null, cookLeft: 0, ready: false };
      plan.phase = "serve";
    } else if (arrived) robot.carrying = { kind: "plate" };
  }

  assignSmartJobs(game);
  for (const robotId of [0, 1] as const) {
    if (acted.has(robotId)) continue;
    const assignment = smartJobForRobot(game, robotId);
    if (!assignment) continue;
    const { plan, job } = assignment;
    const robot = game.robots[robotId];
    if (job.stage === "fetch") {
      const station = job.ingredient === "tomato" ? "0-2" : "0-6";
      const arrived = advanceTo(game, robotId, station, `为 #${plan.orderId} 取${ingredientName(job.ingredient)}`, reserved);
      acted.add(robotId);
      if (arrived) { robot.carrying = { kind: "raw", ingredient: job.ingredient }; job.stage = "cut"; }
    } else if (job.stage === "buffer") {
      const arrived = advanceTo(game, robotId, "3-4", `领取 #${plan.orderId} 预备原料`, reserved);
      acted.add(robotId);
      if (arrived) {
        const buffered = game.counters[job.bufferKey ?? "pass-top"];
        if (buffered?.kind === "chopped" && buffered.ingredient === job.ingredient) {
          robot.carrying = buffered;
          game.counters[job.bufferKey ?? "pass-top"] = null;
          job.stage = "pot";
        }
      }
    } else if (job.stage === "cut") {
      if (!job.boardKey || !job.boardStation) {
        const occupied = new Set(game.smartPlans.flatMap((candidatePlan) => candidatePlan.jobs.filter((candidate) => candidate !== job && candidate.stage === "cut" && candidate.boardKey).map((candidate) => candidate.boardKey!)));
        const boards = ([ ["left-cut", "2-0"], ["right-cut", "2-8"] ] as const)
          .filter(([key]) => !occupied.has(key) && !game.cutBoards[key])
          .sort((a, b) => positionToStationDistance(robot, a[1]) - positionToStationDistance(robot, b[1]));
        if (boards[0]) { job.boardKey = boards[0][0]; job.boardStation = boards[0][1]; }
      }
      if (job.boardKey && job.boardStation) {
        const arrived = advanceTo(game, robotId, job.boardStation, `切配 #${plan.orderId} ${ingredientName(job.ingredient)}`, reserved);
        acted.add(robotId);
        if (arrived) {
          const board = game.cutBoards[job.boardKey];
          if (!board && robot.carrying?.kind === "raw") { game.cutBoards[job.boardKey] = { ingredient: job.ingredient, progress: 0 }; robot.carrying = null; }
          else if (board && board.progress < 3) board.progress += 1;
          else if (board?.progress === 3 && !robot.carrying) { robot.carrying = { kind: "chopped", ingredient: job.ingredient }; game.cutBoards[job.boardKey] = null; job.stage = "pot"; }
        }
      }
    } else if (job.stage === "pot") {
      const arrived = advanceTo(game, robotId, plan.potStation, `送入 #${plan.orderId} ${plan.potKey === "left-pot" ? "主灶" : "备用灶"}`, reserved);
      acted.add(robotId);
      if (arrived && robot.carrying?.kind === "chopped") {
        game.pots[plan.potKey].ingredients.push(robot.carrying.ingredient);
        robot.carrying = null;
        job.stage = "loaded";
        job.robotId = null;
      }
    }
  }

  const canPrefetch = game.smartPlans.filter((plan) => plan.phase === "cook" || plan.phase === "ready").length >= 1;
  if (canPrefetch && !game.prefetch) {
    const free = ([0, 1] as const).find((id) => !acted.has(id) && !smartRobotBusy(game, id));
    if (free !== undefined) startSmartPrefetch(game, free);
  }
  if (game.prefetch && game.prefetch.stage !== "staged") {
    const id = game.prefetch.robotId;
    if (!acted.has(id) && !smartJobForRobot(game, id)) {
      advancePrefetch(game, reserved);
      acted.add(id);
    }
  }
  for (const id of [0, 1] as const) if (!acted.has(id) && !smartRobotBusy(game, id)) {
    game.robots[id].task = "等待下一项可执行任务";
    game.robots[id].target = "滚动调度器";
    game.metrics.idle += 1;
  }
  const runningPots = game.smartPlans.filter((plan) => plan.phase !== "serve").length;
  game.decision = `滚动双灶策略同时管理 ${runningPots} 道在制订单；优先前置空盘、释放机器人并填满空闲灶台。`;
  return game;
}
function autoStep(previous: GameState, difficulty: Difficulty, algorithm: AlgorithmId = "baseline") {
  if (!previous.running || previous.paused || previous.ended) return previous;
  if (algorithm === "dual") return smartStep(previous, difficulty);
  const game = cloneGame(previous);
  if (!game.cycle) startCycle(game, algorithm);
  const cycle = game.cycle;
  if (!cycle) return game;
  const reserved = new Set<string>();
  if (cycle.phase === "prep") {
    for (const id of [0, 1] as const) {
      const robot = game.robots[id];
      const job = cycle.jobs.find((candidate) => candidate.robotId === id)!;
      const ingredientStation = job.ingredient === "tomato" ? "0-2" : "0-6";
      if (job.stage === "fetch") {
        if (advanceTo(game, id, ingredientStation, `前往取${ingredientName(job.ingredient)}`, reserved)) {
          robot.carrying = { kind: "raw", ingredient: job.ingredient }; job.stage = "cut";
          game.message = `${robot.name} 已取${ingredientName(job.ingredient)}，前往专属切配台。`;
        }
      } else if (job.stage === "cut") {
        if (advanceTo(game, id, job.boardStation, `切配${ingredientName(job.ingredient)}`, reserved)) {
          const board = game.cutBoards[job.boardKey];
          if (!board && robot.carrying?.kind === "raw") {
            game.cutBoards[job.boardKey] = { ingredient: job.ingredient, progress: 0 }; robot.carrying = null;
          } else if (board && board.progress < 3) {
            board.progress += 1;
            game.message = `${robot.name} 切配进度 ${board.progress}/3。`;
          } else if (board?.progress === 3 && !robot.carrying) {
            robot.carrying = { kind: "chopped", ingredient: job.ingredient }; game.cutBoards[job.boardKey] = null; job.stage = "pot";
          }
        }
      } else if (job.stage === "buffer") {
        if (advanceTo(game, id, "3-4", "领取提前备好的原料", reserved)) {
          const buffered = game.counters[job.bufferKey ?? "pass-top"];
          if (buffered?.kind === "chopped" && buffered.ingredient === job.ingredient) {
            robot.carrying = buffered;
            game.counters[job.bufferKey ?? "pass-top"] = null;
            job.stage = "pot";
          } else {
            game.metrics.idle += 1;
          }
        }
      } else if (job.stage === "pot") {
        if (advanceTo(game, id, cycle.potStation, "将切配原料送往选定灶台", reserved) && robot.carrying?.kind === "chopped") {
          game.pots[cycle.potKey].ingredients.push(robot.carrying.ingredient); robot.carrying = null; job.stage = "loaded";
          game.message = `${robot.name} 已将原料送入主锅。`;
        }
      } else {
        // The main stove has a single service cell (4,1). A robot that has
        // loaded its ingredient must actively clear that cell, otherwise its
        // partner can never deliver the second ingredient.
        if (advanceTo(game, id, "3-4", "原料已送达，前往待命区避让", reserved)) {
          robot.task = "待命并保持灶台通道畅通";
          robot.target = "中央待命区";
          game.metrics.idle += 1;
        }
      }
    }
    if (cycle.jobs.every((job) => job.stage === "loaded")) {
      const pot = game.pots[cycle.potKey]; pot.recipe = cycle.recipe; pot.cookLeft = difficulty === "training" ? 8 : 11; pot.ready = false;
      if (algorithm === "pipeline") {
        const serviceCosts = ([0, 1] as const).map((id) => ({
          id,
          cost: positionToStationDistance(game.robots[id], "7-2")
            + stationToStationDistance("7-2", cycle.potStation)
            + stationToStationDistance(cycle.potStation, "7-6"),
        })).sort((a, b) => a.cost - b.cost || a.id - b.id);
        cycle.serverId = serviceCosts[0].id;
        cycle.prefetcherId = (cycle.serverId === 0 ? 1 : 0) as 0 | 1;
      }
      cycle.phase = "cook"; game.decision = "两份原料已汇合；烹饪与取盘并行，减少机器人空闲。";
      game.message = `${RECIPES[cycle.recipe].shortName} 开始烹饪，${game.robots[cycle.serverId].name}立即提前取盘。`;
    }
  } else if (cycle.phase === "cook") {
    const assistant = game.robots[cycle.serverId];
    if (algorithm === "baseline") {
      if (advanceTo(game, 0, "3-4", "远程监控锅具并清空入口", reserved)) {
        game.robots[0].task = "远程监控锅具";
        game.robots[0].target = "中央待命区";
        game.metrics.idle += 1;
      }
    } else {
      startPrefetch(game, algorithm);
      advancePrefetch(game, reserved);
    }
    if (!assistant.carrying) {
      if (advanceTo(game, cycle.serverId, "7-2", "提前领取空盘", reserved)) assistant.carrying = { kind: "plate" };
    } else if (assistant.carrying.kind === "plate" && game.pots[cycle.potKey].ready) {
      if (advanceTo(game, cycle.serverId, cycle.potStation, "前往选定锅具装盘", reserved)) {
        assistant.carrying = { kind: "dish", recipe: cycle.recipe };
        game.pots[cycle.potKey] = { ingredients: [], recipe: null, cookLeft: 0, ready: false };
        cycle.phase = "serve"; game.decision = "烹饪完成，装盘机器人沿最短可行路径前往交付点。";
      }
    } else { assistant.task = "持盘等待出锅"; assistant.target = `主锅 ${game.pots[cycle.potKey].cookLeft}s`; game.metrics.idle += 1; }
  } else {
    const server = game.robots[cycle.serverId];
    if (algorithm === "baseline") {
      game.robots[0].task = "清空工位 / 待命"; game.robots[0].target = "下一订单";
    } else {
      startPrefetch(game, algorithm);
      advancePrefetch(game, reserved);
    }
    if (advanceTo(game, cycle.serverId, "7-6", "运送成品至交付口", reserved) && server.carrying?.kind === "dish") finishDelivery(game, server.carrying.recipe, difficulty, cycle.orderId);
  }
  return game;
}
function advanceClock(previous: GameState) {
  if (!previous.running || previous.paused) return previous;
  const next = cloneGame(previous);
  next.timeLeft = Math.max(0, next.timeLeft - 1);
  for (const pot of Object.values(next.pots)) if (pot.recipe && !pot.ready) {
    pot.cookLeft = Math.max(0, pot.cookLeft - 1);
    pot.ready = pot.cookLeft === 0;
  }
  next.orders = next.orders.map((order) => ({ ...order, remaining: order.remaining - 1 }));
  if (next.timeLeft === 0) {
    next.running = false;
    next.ended = true;
    next.message = `本轮完成：${next.delivered} 道菜，团队得分 ${next.score}。`;
  }
  return next;
}
type ExperimentResult = { algorithm: AlgorithmId; delivered: number; score: number; travel: number; idle: number; conflicts: number; tardiness: number; replans: number; sequence: string };
type ExperimentBatch = { duration: number; difficulty: Difficulty; objective: ObjectiveId; createdAt: string; results: ExperimentResult[] };
function runSimulation(algorithm: AlgorithmId, difficulty: Difficulty, duration: number): ExperimentResult {
  let game = createInitialState(difficulty, true, duration);
  for (let step = 1; step <= duration * 2 && !game.ended; step += 1) {
    game = autoStep(game, difficulty, algorithm);
    if (step % 2 === 0) game = advanceClock(game);
  }
  return { algorithm, delivered: game.delivered, score: game.score, travel: game.metrics.travel, idle: game.metrics.idle, conflicts: game.metrics.conflicts, tardiness: game.metrics.tardiness, replans: game.metrics.replans, sequence: game.history.map((id) => `#${id}`).join(" → ") };
}
function compareResults(a: ExperimentResult, b: ExperimentResult, objective: ObjectiveId) {
  if (objective === "score") return b.score - a.score || b.delivered - a.delivered;
  if (objective === "tardiness") return a.tardiness - b.tardiness || b.delivered - a.delivered;
  if (objective === "travel") return a.travel - b.travel || b.delivered - a.delivered;
  if (objective === "balanced") return b.delivered - a.delivered || a.tardiness - b.tardiness || b.score - a.score || a.travel - b.travel;
  return b.delivered - a.delivered || b.score - a.score;
}
function experimentMarkdown(batch: ExperimentBatch) {
  const pressure = batch.difficulty === "training" ? "标准压力" : "高峰压力";
  const ranked = [...batch.results].sort((a, b) => compareResults(a, b, batch.objective));
  const rows = ranked.map((result, index) => `| ${index + 1} | ${ALGORITHMS[result.algorithm].code} | ${ALGORITHMS[result.algorithm].name} | ${result.delivered} | ${result.score} | ${result.tardiness} | ${result.travel} | ${result.idle} | ${result.conflicts} | ${result.replans} | ${result.sequence || "—"} |`).join("\n");
  return `# Robo Kitchen 实验报告\n\n- 生成时间：${batch.createdAt}\n- 仿真时长：${batch.duration} 秒\n- 订单压力：${pressure}\n- 主要评价目标：${OBJECTIVES[batch.objective].label}（${OBJECTIVES[batch.objective].direction}）\n- 决策频率：2 次 / 仿真秒\n- 初始条件：相同地图、机器人位置与确定性订单队列\n\n> 本报告由页面按当前参数运行后生成，不是预先写入的结果。速度按钮只改变播放速度，不改变每个仿真秒的决策次数。\n\n## 模型口径\n\n- 集合：机器人 R={A,B}；动态订单队列 O_t；可行走格点 V 与四邻接边 E；工位集合 K。\n- 关键参数：实验时长 H=${batch.duration}；订单时限 D_i=${batch.difficulty === "training" ? 70 : 46} 秒；切配 3 次动作；烹饪 ${batch.difficulty === "training" ? 8 : 11} 秒。\n- 完成量：Q = Σ_i y_i。\n- 累计逾期：T = Σ_i y_i max(0, C_i-d_i)。\n- 移动量：M = Σ_{r,t} ||p_{r,t+1}-p_{r,t}||_1。\n- 综合目标：lex max (Q, -T, S, -M)，依次比较，不做加权求和。\n- 约束：四方向移动与机器人避碰；每台机器人每步至多执行一个任务；每口灶至多处理一个订单；取料→切配→入锅→烹饪→装盘→交付。\n\n> 当前 A/B/C 是固定在线启发式。页面选择的评价目标只改变实验结果排名，不会针对该目标重新训练或求解策略。\n\n## 积分规则\n\n- 准时交付：100 基础分 + 剩余秒数 × 3 + 连续准时奖励（每单 +25，最高 +100）。\n- 逾期交付：100 基础分 − 逾期秒数 × 5，单笔最低 20 分，并中断连续准时奖励。\n- 积分不会替代其他目标；报告同时保留完成量、逾期和移动量。\n\n| 排名 | 策略 | 方法 | 完成 | 得分 | 逾期(s) | 移动(格) | 空闲步 | 避让 | 调度 | 交付顺序 |\n| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n## 策略说明\n\n${ranked.map((result) => `### 策略 ${ALGORITHMS[result.algorithm].code} · ${ALGORITHMS[result.algorithm].name}\n\n${ALGORITHMS[result.algorithm].note}`).join("\n\n")}\n\n## 后续扩展\n\n当前三种菜名共享同一类两原料工序。后续版本可加入不同工序长度、菜谱、地图和设备布局，但不属于本次实验。\n\n---\nRobo Kitchen · 非商用教学与研究项目\n`;
}
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

type KitchenAudio = { stop: () => void; ding: () => void };
function startKitchenAudio(): KitchenAudio {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = .085;
  master.connect(context.destination);
  const melody = [392, 494, 587, 494, 440, 523, 659, 523, 349, 440, 523, 440, 330, 392, 494, 392];
  let cursor = 0;
  const note = (frequency: number, duration: number, volume: number, delay = 0, type: OscillatorType = "triangle") => {
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + .015);
    gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(gain); gain.connect(master);
    oscillator.start(start); oscillator.stop(start + duration + .02);
  };
  const beat = () => {
    const frequency = melody[cursor % melody.length];
    note(frequency, .19, .26);
    if (cursor % 4 === 0) note(frequency / 2, .32, .18, 0, "sine");
    if (cursor % 2 === 1) note(880, .045, .035, .09, "square");
    cursor += 1;
  };
  void context.resume();
  beat();
  const timer = window.setInterval(beat, 270);
  return {
    stop: () => { window.clearInterval(timer); void context.close(); },
    ding: () => { note(784, .25, .34); note(1047, .36, .3, .11); },
  };
}

function ModelView() {
  return (
    <section className="model-view" aria-labelledby="model-title">
      <header className="model-hero">
        <div>
          <p className="section-kicker">MODEL &amp; POLICY</p>
          <h2 id="model-title">从厨房动画到在线调度模型</h2>
          <p>系统每个决策步读取订单、机器人和工位状态，再决定“做哪一单、谁去做、使用哪个工位、下一步走到哪里”。数学模型定义问题边界，A/B/C 是三种在线启发式策略。</p>
        </div>
        <span className="model-badge">启发式仿真 · 非全局优化器</span>
        <div className="model-facts" aria-label="模型摘要">
          <span><b>9 × 8</b> 固定网格</span><span><b>2</b> 台机器人</span><span><b>2</b> 个切配台</span><span><b>2</b> 口灶</span><span><b>2</b> 次决策 / 秒</span>
        </div>
      </header>

      <div className="model-section-grid">
        <article className="model-card">
          <div className="model-card-heading"><i>1</i><div><span>SETS</span><h3>集合</h3></div></div>
          <dl className="definition-list">
            <div><dt>R</dt><dd>机器人集合 {"{A, B}"}</dd></div>
            <div><dt>O / O<sub>t</sub></dt><dd>实验内释放的全部订单 / 时刻 t 的 3 个在队订单</dd></div>
            <div><dt>V, E</dt><dd>可行走格点与四邻接边</dd></div>
            <div><dt>K</dt><dd>切配台、灶台、传菜台、餐盘与出餐口</dd></div>
            <div><dt>G<sub>i</sub></dt><dd>订单 i 所需的两份原料任务</dd></div>
          </dl>
        </article>

        <article className="model-card">
          <div className="model-card-heading"><i>2</i><div><span>PARAMETERS</span><h3>参数</h3></div></div>
          <dl className="definition-list">
            <div><dt>H</dt><dd>实验时长，30–600 秒</dd></div>
            <div><dt>D<sub>i</sub></dt><dd>订单时限：标准 70 秒；高峰 46 秒</dd></div>
            <div><dt>τ<sub>cut</sub></dt><dd>每份原料需 3 次切配动作</dd></div>
            <div><dt>τ<sub>cook</sub></dt><dd>烹饪时间：标准 8 秒；高峰 11 秒</dd></div>
            <div><dt>δ(p, s)</dt><dd>从位置 p 到工位 s 相邻服务格的 BFS 距离</dd></div>
          </dl>
        </article>

        <article className="model-card wide">
          <div className="model-card-heading"><i>3</i><div><span>ONLINE DECISIONS &amp; STATE</span><h3>在线决策与状态变量</h3></div></div>
          <div className="variable-grid">
            <div><code>p<sub>rt</sub></code><p>机器人 r 在决策步 t 所在的网格坐标。</p><small>页面：机器人位置</small></div>
            <div><code>x<sub>rijt</sub></code><p>若机器人 r 在 t 执行订单 i 的任务 j，则为 1。</p><small>代码：job.robotId</small></div>
            <div><code>z<sub>ikt</sub></code><p>若订单 i 在 t 占用灶台 k，则为 1。</p><small>代码：plan.potKey</small></div>
            <div><code>u<sub>ijt</sub></code><p>原料任务的工序状态：取料、切配、入锅或完成。</p><small>代码：job.stage</small></div>
            <div><code>y<sub>i</sub></code><p>订单 i 是否在实验时限 H 内完成交付。</p><small>页面：完成订单</small></div>
            <div><code>C<sub>i</sub></code><p>订单 i 的交付时刻；用于计算准时、逾期与积分。</p><small>页面：逾期 / 团队得分</small></div>
          </div>
          <p className="model-clarifier">这些符号用于准确描述页面正在做的在线决策，并不是预先建立后交给 MILP 求解器的一组静态变量。</p>
        </article>
      </div>

      <article className="model-card constraints-card">
        <div className="model-card-heading"><i>4</i><div><span>CONSTRAINTS</span><h3>核心约束</h3></div></div>
        <div className="constraint-grid">
          <div><b>棋盘移动与避碰</b><div className="formula-line" aria-label="下一位置只能停留或移动到四邻接格，两个机器人不能占据同一格">p<sub>r,t+1</sub> ∈ N(p<sub>rt</sub>) ∪ {"{"}p<sub>rt</sub>{"}"}<br/>p<sub>At</sub> ≠ p<sub>Bt</sub></div><p>不能斜走、穿墙或进入工位格；每步还会预留目标格，避免同时相撞。</p></div>
          <div><b>机器人与设备容量</b><div className="formula-line" aria-label="每台机器人每步至多执行一个任务，每口灶至多处理一个订单">∑<sub>i,j</sub> x<sub>rijt</sub> ≤ 1<br/>∑<sub>i</sub> z<sub>ikt</sub> ≤ 1</div><p>机器人一次只携带一件物品；切配台、传菜位和灶台各有独立占用状态。</p></div>
          <div><b>工序先后关系</b><div className="formula-line sequence-formula" aria-label="取料之后切配，切配之后入锅，之后烹饪、装盘和交付">取料 ≺ 切配 ≺ 入锅 ≺ 烹饪 ≺ 装盘 ≺ 交付</div><p>每锅必须集齐两份已切原料才开始烹饪，成品必须配有餐盘才能交付。</p></div>
          <div><b>订单时间</b><div className="formula-line" aria-label="逾期等于交付时间减截止时间与零的最大值">L<sub>i</sub> = max(0, C<sub>i</sub> − d<sub>i</sub>)<br/>d<sub>i</sub> = r<sub>i</sub> + D<sub>i</sub></div><p>rᵢ 是订单进入队列的时刻；交付后立即补入新订单，因此队列始终保持 3 单。</p></div>
        </div>
      </article>

      <article className="model-card objectives-card">
        <div className="model-card-heading"><i>5</i><div><span>OBJECTIVES</span><h3>评价目标与积分</h3></div></div>
        <p className="model-intro">实验对同一初始状态分别运行三种固定策略，再按所选目标排序。目标选择不会反过来修改策略，只影响结果名次。</p>
        <div className="objective-formulas">
          <div><span>完成量</span><div className="formula-line">Q = ∑<sub>i∈O</sub> y<sub>i</sub></div><small>越大越好</small></div>
          <div><span>累计逾期</span><div className="formula-line">T = ∑<sub>i∈O</sub> y<sub>i</sub>L<sub>i</sub></div><small>越小越好</small></div>
          <div><span>移动量</span><div className="formula-line">M = ∑<sub>r,t</sub> ‖p<sub>r,t+1</sub>−p<sub>rt</sub>‖<sub>1</sub></div><small>越小越好</small></div>
          <div><span>综合排序</span><div className="formula-line">lex max (Q, −T, S, −M)</div><small>依次比较，不做加权求和</small></div>
        </div>
        <details className="formula-details" open>
          <summary>积分函数 S = ∑ g<sub>i</sub></summary>
          <div className="score-formula">
            <div><b>准时</b><span>g<sub>i</sub> = 100 + 3(d<sub>i</sub>−C<sub>i</sub>) + 25 min(k<sub>i</sub>−1, 4)</span></div>
            <div><b>逾期</b><span>g<sub>i</sub> = max(20, 100 − 5L<sub>i</sub>)</span></div>
          </div>
          <p>kᵢ 是截至订单 i 的连续准时交付次数；连击每单增加 25 分、最高 100 分，逾期后归零。未匹配订单的兜底交付为 60 分，但自动策略正常情况下按订单编号匹配。</p>
        </details>
      </article>

      <article className="model-card policy-card">
        <div className="model-card-heading"><i>6</i><div><span>ROUTING &amp; POLICIES</span><h3>路径与三种调度策略</h3></div></div>
        <div className="policy-flow">
          <section>
            <header><i>0</i><div><b>公共路径层</b><span>BFS 最短可行路</span></div></header>
            <p>所有策略使用同一个四邻接路网。机器人每个决策步沿当前最短路前进一步。</p>
            <details className="formula-details"><summary>查看路径公式</summary><div className="formula-line">δ(p,s) = min<sub>P∈𝒫(p,N(s))</sub> |P|</div><p>N(s) 是工位 s 周围可操作的相邻格；另一机器人和本步已预留格会临时从路网中移除。</p></details>
          </section>
          <section>
            <header><i>A</i><div><b>顺序 EDF 基线</b><span>基准启发式</span></div></header>
            <p>选剩余时间最少的订单；固定阿橙/左切配台与小青/右切配台；当前订单交付后才处理下一单。</p>
            <details className="formula-details"><summary>查看选择规则</summary><div className="formula-line">i* = arg min<sub>i∈O<sub>t</sub></sub> (q<sub>i</sub>(t), i)</div><p>qᵢ(t)=dᵢ−t 是当前剩余时限；订单编号用于确定性破同。</p></details>
          </section>
          <section>
            <header><i>B</i><div><b>流水竞价协作</b><span>单灶分配启发式</span></div></header>
            <p>仍按 EDF 选单，但枚举两份原料与两个切配台的分配；烹饪期间预切下一单的一份原料并存入传菜台。</p>
            <details className="formula-details"><summary>查看分配成本</summary><div className="formula-line compact-formula">c(r,g,b,k)=δ(p<sub>r</sub>,s<sub>g</sub>)+δ(s<sub>g</sub>,b)+δ(b,k)<br/>(σ*,β*)=arg min ∑<sub>r∈R</sub>c(r,σ<sub>r</sub>,β<sub>r</sub>,k)</div><p>σ 是原料分配，β 是切配台分配；页面枚举所有 2×2 组合并取总移动距离最小者。</p></details>
          </section>
          <section>
            <header><i>C</i><div><b>滚动双灶调度</b><span>资源感知启发式</span></div></header>
            <p>对当前最多 3 个订单精确枚举顺序，填满两口空闲灶；机器人按距离与工位状态动态接任务，并提前把餐盘送到灶旁。</p>
            <details className="formula-details"><summary>查看滚动排序</summary><div className="formula-line compact-formula">π* = arg min<sub>π∈Π(O<sub>t</sub>)</sub> ∑<sub>h</sub>[25 max(0, Ĉ<sub>πh</sub>−q<sub>πh</sub>) + Ĉ<sub>πh</sub>]</div><p>Ĉ 是从当前时刻起的估计完成时间：田园炖菜 19、番茄汤 21、蘑菇汤 22 个估计单位，换菜加 2；这是小窗口排序代理，不是仿真真实加工时长。</p></details>
            <details className="formula-details"><summary>查看机器人接单分数</summary><div className="formula-line compact-formula">h(r,i,j)=δ(p<sub>r</sub>,s<sub>j</sub>)+14I<sub>active(i)</sub>+0.04q<sub>i</sub></div><p>分数越小越优；14 鼓励两台机器人分散到不同在制订单，0.04qᵢ 让临期订单更优先。</p></details>
          </section>
        </div>
      </article>

      <aside className="model-boundary">
        <b>模型边界</b>
        <p>这是确定性订单流上的离散时间仿真与在线启发式比较。A/B/C 没有针对每个实验目标重新训练或求解，因此结果只说明这些固定策略在当前地图、时限和工序参数下的表现；它不宣称全局最优，也不直接代表真实厨房机器人控制器。</p>
      </aside>
    </section>
  );
}

export default function Home() {
  const [pageView, setPageView] = useState<PageView>("simulator");
  const [mode, setMode] = useState<Mode>("auto");
  const [difficulty, setDifficulty] = useState<Difficulty>("training");
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("dual");
  const [labView, setLabView] = useState<LabView>("run");
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [musicOn, setMusicOn] = useState(false);
  const [roundSeconds, setRoundSeconds] = useState(DEFAULT_ROUND_SECONDS);
  const [durationDraft, setDurationDraft] = useState(String(DEFAULT_ROUND_SECONDS));
  const [objective, setObjective] = useState<ObjectiveId>("balanced");
  const [experiment, setExperiment] = useState<ExperimentBatch | null>(null);
  const [experimentRunning, setExperimentRunning] = useState(false);
  const [game, setGame] = useState<GameState>(() => createInitialState("training", false, DEFAULT_ROUND_SECONDS));
  const audioRef = useRef<KitchenAudio | null>(null);
  const deliveredRef = useRef(0);
  const tickRef = useRef(0);
  const resetGame = useCallback((nextDifficulty = difficulty, start = false, duration = roundSeconds) => {
    tickRef.current = 0;
    setGame(createInitialState(nextDifficulty, start, duration));
  }, [difficulty, roundSeconds]);
  const selectMode = (nextMode: Mode) => { setPageView("simulator"); setMode(nextMode); resetGame(difficulty); };
  const selectAlgorithm = (nextAlgorithm: AlgorithmId) => {
    setAlgorithm(nextAlgorithm);
    resetGame(difficulty);
  };
  const commitDuration = (value: string | number = durationDraft) => {
    const duration = normalizeDuration(value);
    setRoundSeconds(duration);
    setDurationDraft(String(duration));
    setExperiment(null);
    resetGame(difficulty, false, duration);
  };
  const changeObjective = (nextObjective: ObjectiveId) => {
    setObjective(nextObjective);
    setExperiment((previous) => previous ? { ...previous, objective: nextObjective } : null);
  };
  const runExperiment = () => {
    const duration = normalizeDuration(durationDraft);
    setRoundSeconds(duration);
    setDurationDraft(String(duration));
    setExperimentRunning(true);
    window.setTimeout(() => {
      const results = ALGORITHM_IDS.map((id) => runSimulation(id, difficulty, duration));
      setExperiment({ duration, difficulty, objective, createdAt: new Date().toLocaleString("zh-CN", { hour12: false }), results });
      setExperimentRunning(false);
    }, 30);
  };
  const exportExperiment = () => {
    if (!experiment) return;
    const blob = new Blob([experimentMarkdown(experiment)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `robo-kitchen-${experiment.duration}s-${experiment.difficulty}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const toggleMusic = () => {
    if (audioRef.current) {
      audioRef.current.stop(); audioRef.current = null; setMusicOn(false);
    } else {
      audioRef.current = startKitchenAudio(); setMusicOn(true);
    }
  };

  useEffect(() => () => audioRef.current?.stop(), []);
  useEffect(() => {
    if (game.delivered > deliveredRef.current) audioRef.current?.ding();
    deliveredRef.current = game.delivered;
  }, [game.delivered]);

  const manualMove = useCallback((dr: number, dc: number) => {
    if (mode !== "manual") return;
    setGame((previous) => {
      if (!previous.running || previous.ended) return previous;
      const game = cloneGame(previous); const robot = game.robots[game.activeRobot]; const other = game.robots[game.activeRobot === 0 ? 1 : 0];
      const row = robot.row + dr; const col = robot.col + dc;
      if (!isWalkable(row, col) || (other.row === row && other.col === col)) { game.message = "该格不可进入，请更换路线。"; return game; }
      robot.row = row; robot.col = col; game.metrics.travel += 1; game.message = `正在控制 ${robot.name}。`; return game;
    });
  }, [mode]);
  const manualInteract = useCallback(() => {
    if (mode !== "manual") return;
    setGame((previous) => {
      if (!previous.running) return previous;
      const game = cloneGame(previous); const robot = game.robots[game.activeRobot];
      const entry = Object.entries(STATIONS).find(([key]) => isAdjacent(robot, key));
      if (!entry) { game.message = "附近没有可操作设备。"; return game; }
      const [, station] = entry;
      if (station.type === "ingredient" && !robot.carrying) robot.carrying = { kind: "raw", ingredient: station.ingredient };
      else if (station.type === "cut") {
        const board = game.cutBoards[station.key];
        if (!board && robot.carrying?.kind === "raw") { game.cutBoards[station.key] = { ingredient: robot.carrying.ingredient, progress: 0 }; robot.carrying = null; }
        else if (board && board.progress < 3 && !robot.carrying) board.progress += 1;
        else if (board?.progress === 3 && !robot.carrying) { robot.carrying = { kind: "chopped", ingredient: board.ingredient }; game.cutBoards[station.key] = null; }
      } else if (station.type === "stove") {
        const pot = game.pots[station.key];
        if (robot.carrying?.kind === "chopped" && !pot.recipe && pot.ingredients.length < 2) {
          pot.ingredients.push(robot.carrying.ingredient); robot.carrying = null;
          if (pot.ingredients.length === 2) { const sorted = [...pot.ingredients].sort().join("-"); pot.recipe = sorted === "tomato-tomato" ? "tomato-soup" : sorted === "mushroom-mushroom" ? "mushroom-soup" : "garden-stew"; pot.cookLeft = 9; }
        } else if (robot.carrying?.kind === "plate" && pot.ready && pot.recipe) { robot.carrying = { kind: "dish", recipe: pot.recipe }; game.pots[station.key] = { ingredients: [], recipe: null, cookLeft: 0, ready: false }; }
      } else if (station.type === "plates" && !robot.carrying) robot.carrying = { kind: "plate" };
      else if (station.type === "serve" && robot.carrying?.kind === "dish") finishDelivery(game, robot.carrying.recipe, difficulty);
      else if (station.type === "bin") robot.carrying = null;
      else if (station.type === "counter") { const held = game.counters[station.key]; if (!held && robot.carrying) { game.counters[station.key] = robot.carrying; robot.carrying = null; } else if (held && !robot.carrying) { robot.carrying = held; game.counters[station.key] = null; } }
      game.message = `${robot.name} 已操作${station.label}。`; return game;
    });
  }, [difficulty, mode]);

  useEffect(() => {
    if (mode !== "auto" || !game.running || game.paused || game.ended) return;
    const timer = window.setInterval(() => setGame((previous) => {
      let next = autoStep(previous, difficulty, algorithm);
      tickRef.current += 1;
      if (tickRef.current % 2 === 0) next = advanceClock(next);
      return next;
    }), 500 / speed);
    return () => window.clearInterval(timer);
  }, [algorithm, difficulty, game.ended, game.paused, game.running, mode, speed]);
  useEffect(() => {
    if (mode !== "manual" || !game.running || game.paused || game.ended) return;
    const timer = window.setInterval(() => setGame((previous) => advanceClock(previous)), 1000);
    return () => window.clearInterval(timer);
  }, [game.ended, game.paused, game.running, mode]);
  useEffect(() => {
    if (mode !== "manual") return;
    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["arrowup", "w"].includes(key)) manualMove(-1, 0);
      else if (["arrowdown", "s"].includes(key)) manualMove(1, 0);
      else if (["arrowleft", "a"].includes(key)) manualMove(0, -1);
      else if (["arrowright", "d"].includes(key)) manualMove(0, 1);
      else if (["e", " "].includes(key)) manualInteract();
      else if (["q", "tab"].includes(key)) setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }));
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [manualInteract, manualMove, mode]);

  const cells = useMemo(() => Array.from({ length: ROWS * COLS }, (_, index) => ({ row: Math.floor(index / COLS), col: index % COLS })), []);
  const active = game.robots[game.activeRobot];
  const movementShare = game.metrics.travel + game.metrics.idle ? Math.round(game.metrics.travel / (game.metrics.travel + game.metrics.idle) * 100) : 0;
  const selectedMethod = ALGORITHMS[algorithm];
  const rankedExperiment = experiment ? [...experiment.results].sort((a, b) => compareResults(a, b, experiment.objective)) : [];

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><span>R</span><span>K</span></div><div><p className="eyebrow">AUTONOMOUS GRID KITCHEN</p><h1>ROBO KITCHEN <span>双机器人协作调度</span></h1></div></div>
        <div className="mode-tabs" role="tablist" aria-label="页面视图">
          <button role="tab" aria-selected={pageView === "simulator" && mode === "auto"} className={pageView === "simulator" && mode === "auto" ? "active" : ""} onClick={() => selectMode("auto")}><i>✦</i> 自动调度</button>
          <button role="tab" aria-selected={pageView === "simulator" && mode === "manual"} className={pageView === "simulator" && mode === "manual" ? "active" : ""} onClick={() => selectMode("manual")}><i>✥</i> 手动体验</button>
          <button role="tab" aria-selected={pageView === "model"} className={pageView === "model" ? "active" : ""} onClick={() => setPageView("model")}><i>∑</i> 模型与算法</button>
        </div>
        <div className="top-actions"><button className={`music-button ${musicOn ? "active" : ""}`} aria-label={musicOn ? "关闭音乐" : "开启音乐"} aria-pressed={musicOn} onClick={toggleMusic} title="原创程序化厨房配乐"><span aria-hidden>{musicOn ? "♫" : "♪"}</span><span className="music-label">{musicOn ? "音乐开" : "音乐关"}</span></button><button className="restart-button" onClick={() => resetGame(difficulty, true)}>重新开始</button></div>
      </header>

      {pageView === "simulator" ? <><section className="score-strip" aria-label="运行指标">
        <div><span>剩余时间</span><strong className={game.timeLeft <= 20 ? "danger" : ""}>{formatTime(game.timeLeft)}</strong></div>
        <div><span>完成订单</span><strong>{game.delivered}</strong></div>
        <div><span>团队得分</span><strong>{game.score.toLocaleString()}</strong></div>
        <div><span>移动步占比</span><strong>{movementShare}%</strong></div>
      </section>

      <section className="workspace">
        <aside className="orders-panel panel">
          <div className="panel-title-row"><div><p className="section-kicker">ORDER QUEUE</p><h2>订单队列</h2></div><span className="live-pill"><i /> 实时</span></div>
          <div className="order-list">{game.orders.map((order) => { const recipe = RECIPES[order.recipe]; const activeOrder = game.cycle?.orderId === order.id || game.smartPlans.some((plan) => plan.orderId === order.id); const prefetchedOrder = game.prefetch?.orderId === order.id; return (
            <article className={`order-card ${activeOrder ? "selected" : ""} ${prefetchedOrder ? "prefetching" : ""} ${order.remaining < 14 ? "urgent" : ""}`} key={order.id}>
              <div className="ticket-number">#{order.id}</div><div className="dish-icon" style={{ background: recipe.color }}>{recipe.icon}</div>
              <div className="order-copy"><strong>{recipe.name}</strong><span>{recipe.ingredients.map(ingredientName).join(" + ")}</span><div className="order-timer"><i style={{ width: `${Math.max(0, Math.min(100, order.remaining / order.maxTime * 100))}%` }} /></div></div><b>{order.remaining >= 0 ? `${order.remaining}s` : `逾期 ${-order.remaining}s`}</b>
              {activeOrder && <em className="planning-tag">执行中</em>}{prefetchedOrder && !activeOrder && <em className="planning-tag prefetch-tag">预备中</em>}
            </article>); })}</div>
          <div className="decision-card"><span>策略 {selectedMethod.code} · 当前决策</span><strong>{game.decision}</strong></div>
          <div className="mode-picker"><span>订单压力</span><div><button className={difficulty === "training" ? "active" : ""} onClick={() => { setDifficulty("training"); setExperiment(null); resetGame("training"); }}>标准</button><button className={difficulty === "rush" ? "active" : ""} onClick={() => { setDifficulty("rush"); setExperiment(null); resetGame("rush"); }}>高峰</button></div></div>
        </aside>

        <section className="kitchen-column">
          <div className="kitchen-frame">
            <div className="kitchen-label"><span>GRID 01 · {mode === "auto" ? `策略 ${selectedMethod.code}` : "手动"}</span><strong>{mode === "auto" ? selectedMethod.name : "手动对照实验"}</strong><em className={game.paused ? "paused" : ""}>{game.running ? (game.paused ? "已暂停" : "运行中") : "待启动"}</em></div>
            <div className="kitchen-grid">{cells.map(({ row, col }) => {
              const key = coord(row, col); const station = STATIONS[key]; const robot = game.robots.find((candidate) => candidate.row === row && candidate.col === col); const isWall = WALLS.has(key);
              let status = "";
              if (station?.type === "cut") { const board = game.cutBoards[station.key]; status = board ? (board.progress === 3 ? "✓" : `${board.progress}/3`) : ""; }
              if (station?.type === "stove") { const pot = game.pots[station.key]; const staged = game.smartPlans.some((plan) => plan.potKey === station.key && plan.plateStaged); const potStatus = pot.ready ? "熟" : pot.recipe ? `${pot.cookLeft}s` : pot.ingredients.length ? `${pot.ingredients.length}/2` : ""; status = `${potStatus}${staged ? "·盘" : ""}`; }
              if (station?.type === "counter") status = itemIcon(game.counters[station.key]);
              return <div className={`cell ${isWall ? "wall" : ""} ${station ? `station ${station.type}` : "floor"}`} key={key}>
                {station && <><span className="station-icon">{station.icon}</span><small>{station.label}</small>{status && <b className="station-status">{status}</b>}</>}
                {robot && <div className={`robot ${robot.color} ${mode === "manual" && game.activeRobot === robot.id ? "active" : ""}`}><span className="antenna"/><span className="face"><i/><i/></span><strong>{robot.shortName}</strong>{robot.carrying && <em className="carried">{itemIcon(robot.carrying)}</em>}<span className="task-bubble">{robot.task}</span></div>}
              </div>;
            })}</div>
            <div className="message-bar"><span className={`mini-robot ${active.color}`}>{mode === "auto" ? "AI" : active.shortName}</span><p>{game.message}</p><strong>{mode === "auto" ? `调度 ${game.metrics.replans} 次` : (nearbyStation(active)?.label ?? "移动中")}</strong></div>
            {!game.running && <div className="start-overlay"><div className="start-card"><p>{game.ended ? "本轮完成" : mode === "auto" ? `策略 ${selectedMethod.code} · 自动调度` : "手动对照"}</p><h2>{game.ended ? `完成 ${game.delivered} 道菜` : mode === "auto" ? selectedMethod.name : "亲自控制两台机器人"}</h2><span>{mode === "auto" ? selectedMethod.note : "使用同一组订单与时间限制，对照人工操作和自动调度。"}</span><button onClick={() => resetGame(difficulty, true)}>{game.ended ? "按当前策略再运行" : "启动系统"}<b>→</b></button></div></div>}
          </div>
        </section>

        <aside className="controls-panel panel">
          {mode === "auto" ? <>
            <div className="panel-title-row"><div><p className="section-kicker">SCHEDULING LAB</p><h2>调度实验</h2></div></div>
            <div className="algorithm-selector" role="radiogroup" aria-label="选择自动调度策略">{ALGORITHM_IDS.map((id) => <button role="radio" aria-checked={algorithm === id} className={algorithm === id ? "active" : ""} key={id} onClick={() => selectAlgorithm(id)}><b>{ALGORITHMS[id].code}</b><span>{ALGORITHMS[id].shortName}</span></button>)}</div>
            <div className="lab-tabs" role="tablist" aria-label="调度实验视图"><button role="tab" aria-selected={labView === "run"} className={labView === "run" ? "active" : ""} onClick={() => setLabView("run")}>实时运行</button><button role="tab" aria-selected={labView === "experiment"} className={labView === "experiment" ? "active" : ""} onClick={() => setLabView("experiment")}>策略对比</button></div>
            {labView === "run" ? <div className="lab-view">
              <div className="auto-actions"><button className="primary-action auto-button" onClick={() => game.running ? setGame((previous) => ({ ...previous, paused: !previous.paused })) : resetGame(difficulty, true)}><span>{game.running ? (game.paused ? "继续运行" : "暂停运行") : "启动自动调度"}</span><small>{roundSeconds} 秒 · 固定 2 次决策/秒</small><kbd>{game.paused ? "▶" : "Ⅱ"}</kbd></button><div className="speed-picker"><span>播放速度</span><button className={speed === 1 ? "active" : ""} onClick={() => setSpeed(1)}>1×</button><button className={speed === 2 ? "active" : ""} onClick={() => setSpeed(2)}>2×</button></div></div>
              <div className="robot-cards compact">{game.robots.map((robot) => <article key={robot.id} className={`robot-card ${robot.color}`}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>{robot.name} · {itemLabel(robot.carrying)}</small><strong>{robot.task}</strong><em>目标：{robot.target}</em></span><span className="status-dot" /></article>)}</div>
              <div className="metric-grid"><div><span>移动</span><strong>{game.metrics.travel}</strong><small>格</small></div><div><span>避让</span><strong>{game.metrics.conflicts}</strong><small>次</small></div><div><span>逾期</span><strong>{game.metrics.tardiness}</strong><small>秒</small></div><div><span>调度</span><strong>{game.metrics.replans}</strong><small>次</small></div></div>
            </div> : <div className="experiment-card lab-view">
              <div className="experiment-fields"><label><span>仿真时长</span><div><input aria-label="仿真时长（秒）" type="number" min="30" max="600" step="10" inputMode="numeric" value={durationDraft} onChange={(event) => setDurationDraft(event.target.value)} onBlur={(event) => commitDuration(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}/><b>秒</b></div></label><label><span>排名目标</span><select value={objective} onChange={(event) => changeObjective(event.target.value as ObjectiveId)}>{Object.entries(OBJECTIVES).map(([id, item]) => <option value={id} key={id}>{item.label}</option>)}</select></label></div>
              <p className="objective-note">{OBJECTIVES[objective].description} 只改变排名，不改变仿真结果。</p>
              <div className="experiment-actions"><button className="run-experiment" disabled={experimentRunning} onClick={runExperiment}>{experimentRunning ? "正在运行…" : "运行三种策略"}</button><button className="export-button" disabled={!experiment} onClick={exportExperiment}>导出 MD</button></div>
              {experiment ? <><div className="experiment-meta"><span>{experiment.duration} 秒 · {experiment.difficulty === "training" ? "标准压力" : "高峰压力"}</span><strong>{OBJECTIVES[experiment.objective].label}</strong></div><div className="experiment-results" aria-label="策略实验排名">{rankedExperiment.map((result, index) => <button className="experiment-result" key={result.algorithm} onClick={() => { selectAlgorithm(result.algorithm); setLabView("run"); }}><i>{index + 1}</i><b>策略 {ALGORITHMS[result.algorithm].code}<small>{ALGORITHMS[result.algorithm].shortName}</small></b><span><small>完成</small><strong>{result.delivered}</strong></span><span><small>积分</small><strong>{result.score}</strong></span><span><small>逾期</small><strong>{result.tardiness}s</strong></span><span><small>移动</small><strong>{result.travel}</strong></span></button>)}</div></> : <div className="empty-experiment"><b>尚未运行</b><span>设置时长和目标，再运行三种策略。</span></div>}
              <details className="score-details"><summary>积分与目标定义</summary><p>准时交付 = 100 + 剩余秒数×3 + 连击奖励；连续准时每单增加 25 分，最高 100 分。逾期每秒扣 5 分，单笔最低 20 分，连击归零。完成量、积分、累计逾期和移动量彼此独立。</p></details>
            </div>}
            <details className="method-details"><summary>策略 {selectedMethod.code} · 调度逻辑 <span>＋</span></summary><div className="method-card"><p>策略 {selectedMethod.code} · {selectedMethod.kind}</p><strong>{selectedMethod.name}</strong><ol>{selectedMethod.steps.map((step, index) => <li key={step}><i>{index + 1}</i><span>{step}</span></li>)}</ol><em>{selectedMethod.note}</em></div></details>
          </> : <>
            <div className="panel-title-row"><div><p className="section-kicker">MANUAL MODE</p><h2>手动体验</h2></div><span className="team-count">对照组</span></div>
            <div className="robot-cards">{game.robots.map((robot) => <button key={robot.id} className={`robot-card ${robot.color} ${game.activeRobot === robot.id ? "active" : ""}`} onClick={() => setGame((previous) => ({ ...previous, activeRobot: robot.id }))}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>机器人 {robot.shortName}</small><strong>{robot.name}</strong><em>{itemLabel(robot.carrying)}</em></span></button>)}</div>
            <div className="control-block"><div className="block-heading"><strong>棋盘移动</strong><span>WASD / 方向键</span></div><div className="dpad"><button className="up" onClick={() => manualMove(-1, 0)}>↑</button><button className="left" onClick={() => manualMove(0, -1)}>←</button><button className="center" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}>↔</button><button className="right" onClick={() => manualMove(0, 1)}>→</button><button className="down" onClick={() => manualMove(1, 0)}>↓</button></div></div>
            <div className="action-stack"><button className="primary-action" onClick={manualInteract}><span>操作</span><small>拿取 / 切配 / 烹饪 / 交付</small><kbd>E</kbd></button><button className="switch-action" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}><span>切换机器人</span><small>Q / Tab</small><kbd>Q</kbd></button></div>
            <div className="method-card manual-note"><p>为什么保留手动模式？</p><strong>它是自动调度的直观基准</strong><em>同样的订单、厨房与时间限制下，可以比较人工决策与算法策略的完成量、移动距离和等待。</em></div>
          </>}
        </aside>
      </section></> : <ModelView />}
      <footer><span><i /> 3 种策略 · 5 项目标 · 离散事件仿真</span><p>原创程序化配乐 · 仅供学习与研究，禁止商用。<a href="https://github.com/marsguo2049/kitchen/blob/main/LICENSE" target="_blank" rel="noreferrer">许可</a><a href="https://github.com/marsguo2049/kitchen/issues/new" target="_blank" rel="noreferrer">使用告知</a></p><span>POLYFORM NONCOMMERCIAL 1.0.0</span></footer>
    </main>
  );
}
