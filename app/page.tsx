"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Ingredient = "tomato" | "mushroom";
type RecipeId = "tomato-soup" | "mushroom-soup" | "garden-stew";
type Mode = "auto" | "manual";
type Difficulty = "training" | "rush";
type AlgorithmId = "v1" | "v2" | "v3" | "v4";
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
const ROUND_SECONDS = 120;
const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const RECIPES: Record<RecipeId, { name: string; shortName: string; icon: string; ingredients: [Ingredient, Ingredient]; color: string }> = {
  "tomato-soup": { name: "双番茄浓汤", shortName: "番茄汤", icon: "🍅", ingredients: ["tomato", "tomato"], color: "#ef6a54" },
  "mushroom-soup": { name: "奶油蘑菇汤", shortName: "蘑菇汤", icon: "🍄", ingredients: ["mushroom", "mushroom"], color: "#9b7358" },
  "garden-stew": { name: "田园双拼炖菜", shortName: "双拼炖菜", icon: "🥘", ingredients: ["tomato", "mushroom"], color: "#e49c3f" },
};
const ALGORITHMS: Record<AlgorithmId, { version: string; name: string; shortName: string; kind: string; steps: string[]; note: string }> = {
  v1: {
    version: "V1",
    name: "顺序 EDF 基线",
    shortName: "顺序基线",
    kind: "基准启发式",
    steps: ["最早截止订单优先", "单个订单内双机器人并行", "固定切配角色 + BFS 最短路", "交付后才启动下一订单"],
    note: "一次只处理一道菜，是后续策略的可复现实验基线。",
  },
  v2: {
    version: "V2",
    name: "跨订单流水调度",
    shortName: "流水备料",
    kind: "流水启发式",
    steps: ["沿用最早截止订单优先", "当前菜烹饪时预取下一单", "切好原料暂存于传菜台", "交付后直接衔接已备原料"],
    note: "把烹饪等待转化为下一订单的准备时间，减少跨订单空档。",
  },
  v3: {
    version: "V3",
    name: "距离竞价协作调度",
    shortName: "任务竞价",
    kind: "分配启发式",
    steps: ["保留 V2 跨订单流水", "机器人对原料任务提交距离成本", "枚举两种原料与切配台分工", "选择总预计移动最短的分配"],
    note: "角色不再固定；竞价只优化当前任务分配，不声称全局最优。",
  },
  v4: {
    version: "V4",
    name: "小窗口穷举优化",
    shortName: "滚动穷举",
    kind: "精确子问题",
    steps: ["枚举当前三单的全部顺序", "评估完工、逾期与换型代价", "结合 V3 距离竞价分工", "每次交付后重新求解窗口"],
    note: "对当前简化的三订单排序子问题精确；不代表完整厨房仿真的全局最优解。",
  },
};
const ALGORITHM_IDS = Object.keys(ALGORITHMS) as AlgorithmId[];
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
function createInitialState(difficulty: Difficulty, running = false): GameState {
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
    score: 0, delivered: 0, combo: 0, timeLeft: ROUND_SECONDS, running, paused: false, ended: false,
    message: running ? "调度器启动，正在读取订单队列。" : "系统就绪，启动后由算法自动完成全部任务。",
    decision: "等待订单触发滚动规划。", nextOrderId: 4, lastRecipe: null, cycle: null, prefetch: null,
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
  if (algorithm === "v1" || algorithm === "v2") {
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
  if (algorithm === "v4") return exactWindowSequence(available, game.lastRecipe)[0] ?? null;
  return [...available].sort((a, b) => a.remaining - b.remaining || a.id - b.id)[0];
}
function startCycle(game: GameState, algorithm: AlgorithmId) {
  const selected = selectOrder(game, algorithm);
  if (!selected) return;
  const ingredients = RECIPES[selected.recipe].ingredients;
  const staged = game.prefetch?.orderId === selected.id ? game.prefetch : null;
  let potKey: "left-pot" | "right-pot" = "left-pot";
  let potStation: "4-0" | "4-8" = "4-0";
  if (algorithm === "v4") {
    const candidates = ([
      ["left-pot", "4-0"],
      ["right-pot", "4-8"],
    ] as const).map(([candidateKey, candidateStation]) => {
      const candidateJobs = makeAssignedJobs(game, ingredients, algorithm, candidateStation);
      const prepCost = candidateJobs.reduce((sum, job) => sum + assignmentCost(game.robots[job.robotId], job.ingredient, job.boardStation, candidateStation), 0);
      const serveCost = stationToStationDistance("7-2", candidateStation) + stationToStationDistance(candidateStation, "7-6");
      return { key: candidateKey, station: candidateStation, cost: prepCost + serveCost };
    }).sort((a, b) => a.cost - b.cost || a.key.localeCompare(b.key));
    potKey = candidates[0].key;
    potStation = candidates[0].station;
  }
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
  if (algorithm === "v4") {
    const sequence = exactWindowSequence(game.orders, game.lastRecipe).map((order) => `#${order.id}`).join(" → ");
    game.decision = `穷举当前订单窗口，选择序列 ${sequence}；执行首单 #${selected.id}，使用${potKey === "left-pot" ? "左" : "右"}灶。`;
  } else if (staged) {
    game.decision = `接续 #${selected.id} 的跨订单预备原料，并行完成剩余备料。`;
  } else if (algorithm === "v3") {
    game.decision = `选择 #${selected.id}，按预计移动距离竞价分配原料与切配台。`;
  } else {
    game.decision = `选择剩余时间最短的 #${selected.id} ${RECIPES[selected.recipe].shortName}；两份原料并行处理。`;
  }
  const robotJobs = [...jobs].sort((a, b) => a.robotId - b.robotId);
  game.message = `${ALGORITHMS[algorithm].version} 规划 #${selected.id}：阿橙负责${ingredientName(robotJobs[0].ingredient)}，小青负责${ingredientName(robotJobs[1].ingredient)}。`;
}
function startPrefetch(game: GameState, algorithm: AlgorithmId) {
  if (!game.cycle || game.prefetch || algorithm === "v1") return;
  const selected = selectOrder(game, algorithm, new Set([game.cycle.orderId]));
  if (!selected) return;
  const ingredients = RECIPES[selected.recipe].ingredients;
  const prefetcherId = game.cycle.prefetcherId;
  const boardKey: BoardKey = prefetcherId === 0 ? "left-cut" : "right-cut";
  const boardStation: BoardStation = prefetcherId === 0 ? "2-0" : "2-8";
  const ingredient = algorithm === "v2"
    ? ingredients[0]
    : [...ingredients].sort((a, b) => assignmentCost(game.robots[prefetcherId], a, boardStation) - assignmentCost(game.robots[prefetcherId], b, boardStation))[0];
  game.prefetch = { orderId: selected.id, ingredient, stage: "fetch", robotId: prefetcherId, boardKey, boardStation, counterKey: "pass-top" };
  game.decision = `${ALGORITHMS[algorithm].version} 在烹饪窗口预取 #${selected.id} 的${ingredientName(ingredient)}。`;
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
function finishDelivery(game: GameState, recipe: RecipeId, difficulty: Difficulty, orderId?: number) {
  const index = orderId === undefined
    ? game.orders.findIndex((order) => order.recipe === recipe)
    : game.orders.findIndex((order) => order.id === orderId);
  const matched = index >= 0 ? game.orders[index] : null;
  const combo = game.combo + 1;
  const earned = matched ? 100 + Math.max(0, matched.remaining) * 3 + Math.min(combo - 1, 4) * 25 : 60;
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
function autoStep(previous: GameState, difficulty: Difficulty, algorithm: AlgorithmId = "v1") {
  if (!previous.running || previous.paused || previous.ended) return previous;
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
      if (algorithm === "v3" || algorithm === "v4") {
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
    if (algorithm === "v1") {
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
    if (algorithm === "v1") {
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
type BenchmarkResult = { algorithm: AlgorithmId; delivered: number; score: number; travel: number; idle: number; conflicts: number; tardiness: number; sequence: string };
function runBenchmark(algorithm: AlgorithmId, difficulty: Difficulty): BenchmarkResult {
  let game = createInitialState(difficulty, true);
  for (let step = 1; step <= ROUND_SECONDS * 2 && !game.ended; step += 1) {
    game = autoStep(game, difficulty, algorithm);
    if (step % 2 === 0) game = advanceClock(game);
  }
  return { algorithm, delivered: game.delivered, score: game.score, travel: game.metrics.travel, idle: game.metrics.idle, conflicts: game.metrics.conflicts, tardiness: game.metrics.tardiness, sequence: game.history.slice(0, 4).map((id) => `#${id}`).join(" › ") };
}
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

export default function Home() {
  const [mode, setMode] = useState<Mode>("auto");
  const [difficulty, setDifficulty] = useState<Difficulty>("training");
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("v1");
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [game, setGame] = useState<GameState>(() => createInitialState("training"));
  const resetGame = useCallback((nextDifficulty = difficulty, start = false) => setGame(createInitialState(nextDifficulty, start)), [difficulty]);
  const selectMode = (nextMode: Mode) => { setMode(nextMode); setGame(createInitialState(difficulty)); };
  const selectAlgorithm = (nextAlgorithm: AlgorithmId) => {
    setAlgorithm(nextAlgorithm);
    setGame(createInitialState(difficulty));
  };

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
    if (mode !== "auto" || !game.running || game.ended) return;
    const timer = window.setInterval(() => setGame((previous) => autoStep(previous, difficulty, algorithm)), speed === 1 ? 520 : 260);
    return () => window.clearInterval(timer);
  }, [algorithm, difficulty, game.ended, game.running, mode, speed]);
  useEffect(() => {
    if (!game.running || game.paused || game.ended) return;
    const timer = window.setInterval(() => setGame((previous) => advanceClock(previous)), 1000);
    return () => window.clearInterval(timer);
  }, [game.ended, game.paused, game.running]);
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
  const utilization = game.metrics.travel + game.metrics.idle ? Math.round(game.metrics.travel / (game.metrics.travel + game.metrics.idle) * 100) : 0;
  const benchmarkResults = useMemo(() => ALGORITHM_IDS.map((id) => runBenchmark(id, difficulty)), [difficulty]);
  const selectedMethod = ALGORITHMS[algorithm];

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><span>R</span><span>K</span></div><div><p className="eyebrow">AUTONOMOUS GRID KITCHEN</p><h1>ROBO KITCHEN <span>双机器人协作调度</span></h1></div></div>
        <div className="mode-tabs" role="tablist" aria-label="运行模式">
          <button role="tab" aria-selected={mode === "auto"} className={mode === "auto" ? "active" : ""} onClick={() => selectMode("auto")}><i>✦</i> 自动调度</button>
          <button role="tab" aria-selected={mode === "manual"} className={mode === "manual" ? "active" : ""} onClick={() => selectMode("manual")}><i>✥</i> 手动体验</button>
        </div>
        <button className="restart-button" onClick={() => resetGame(difficulty, true)}>重新开始</button>
      </header>

      <section className="score-strip" aria-label="运行指标">
        <div><span>剩余时间</span><strong className={game.timeLeft <= 20 ? "danger" : ""}>{formatTime(game.timeLeft)}</strong></div>
        <div><span>完成订单</span><strong>{game.delivered}</strong></div>
        <div><span>团队得分</span><strong>{game.score.toLocaleString()}</strong></div>
        <div><span>移动利用率</span><strong>{utilization}%</strong></div>
      </section>

      <section className="workspace">
        <aside className="orders-panel panel">
          <div className="panel-title-row"><div><p className="section-kicker">ORDER QUEUE</p><h2>订单与优先级</h2></div><span className="live-pill"><i /> 动态</span></div>
          <div className="order-list">{game.orders.map((order) => { const recipe = RECIPES[order.recipe]; const activeOrder = game.cycle?.orderId === order.id; const prefetchedOrder = game.prefetch?.orderId === order.id; return (
            <article className={`order-card ${activeOrder ? "selected" : ""} ${prefetchedOrder ? "prefetching" : ""} ${order.remaining < 14 ? "urgent" : ""}`} key={order.id}>
              <div className="ticket-number">#{order.id}</div><div className="dish-icon" style={{ background: recipe.color }}>{recipe.icon}</div>
              <div className="order-copy"><strong>{recipe.name}</strong><span>{recipe.ingredients.map(ingredientName).join(" + ")}</span><div className="order-timer"><i style={{ width: `${Math.max(0, Math.min(100, order.remaining / order.maxTime * 100))}%` }} /></div></div><b>{order.remaining >= 0 ? `${order.remaining}s` : `逾期 ${-order.remaining}s`}</b>
              {activeOrder && <em className="planning-tag">执行中</em>}{prefetchedOrder && !activeOrder && <em className="planning-tag prefetch-tag">预备中</em>}
            </article>); })}</div>
          <div className="decision-card"><span>{selectedMethod.version} · 当前决策</span><strong>{game.decision}</strong><p>算法切换会重置同一组确定性订单，便于公平观察策略差异。</p></div>
          <div className="mode-picker"><span>订单压力</span><div><button className={difficulty === "training" ? "active" : ""} onClick={() => { setDifficulty("training"); resetGame("training"); }}>标准到达</button><button className={difficulty === "rush" ? "active" : ""} onClick={() => { setDifficulty("rush"); resetGame("rush"); }}>高峰到达</button></div></div>
        </aside>

        <section className="kitchen-column">
          <div className="kitchen-frame">
            <div className="kitchen-label"><span>GRID 01 · {mode === "auto" ? selectedMethod.version : "MANUAL"}</span><strong>{mode === "auto" ? selectedMethod.name : "手动对照实验"}</strong><em className={game.paused ? "paused" : ""}>{game.running ? (game.paused ? "已暂停" : "运行中") : "待启动"}</em></div>
            <div className="kitchen-grid">{cells.map(({ row, col }) => {
              const key = coord(row, col); const station = STATIONS[key]; const robot = game.robots.find((candidate) => candidate.row === row && candidate.col === col); const isWall = WALLS.has(key);
              let status = "";
              if (station?.type === "cut") { const board = game.cutBoards[station.key]; status = board ? (board.progress === 3 ? "✓" : `${board.progress}/3`) : ""; }
              if (station?.type === "stove") { const pot = game.pots[station.key]; status = pot.ready ? "熟" : pot.recipe ? `${pot.cookLeft}s` : pot.ingredients.length ? `${pot.ingredients.length}/2` : ""; }
              if (station?.type === "counter") status = itemIcon(game.counters[station.key]);
              return <div className={`cell ${isWall ? "wall" : ""} ${station ? `station ${station.type}` : "floor"}`} key={key}>
                {station && <><span className="station-icon">{station.icon}</span><small>{station.label}</small>{status && <b className="station-status">{status}</b>}</>}
                {robot && <div className={`robot ${robot.color} ${mode === "manual" && game.activeRobot === robot.id ? "active" : ""}`}><span className="antenna"/><span className="face"><i/><i/></span><strong>{robot.shortName}</strong>{robot.carrying && <em className="carried">{itemIcon(robot.carrying)}</em>}<span className="task-bubble">{robot.task}</span></div>}
              </div>;
            })}</div>
            <div className="message-bar"><span className={`mini-robot ${active.color}`}>{mode === "auto" ? "AI" : active.shortName}</span><p>{game.message}</p><strong>{mode === "auto" ? `重规划 ${game.metrics.replans} 次` : (nearbyStation(active)?.label ?? "移动中")}</strong></div>
            {!game.running && <div className="start-overlay"><div className="start-card"><p>{game.ended ? "SHIFT COMPLETE" : mode === "auto" ? `${selectedMethod.version} · AUTONOMOUS DISPATCH` : "MANUAL BENCHMARK"}</p><h2>{game.ended ? `完成 ${game.delivered} 道菜` : mode === "auto" ? selectedMethod.name : "亲自控制两台机器人"}</h2><span>{mode === "auto" ? selectedMethod.note : "作为对照策略，观察人工操作与自动调度的差异。"}</span><button onClick={() => resetGame(difficulty, true)}>{game.ended ? "按当前算法再运行" : "启动系统"}<b>→</b></button></div></div>}
          </div>
        </section>

        <aside className="controls-panel panel">
          {mode === "auto" ? <>
            <div className="panel-title-row"><div><p className="section-kicker">ALGORITHM LAB</p><h2>算法实验台</h2></div><span className="algorithm-pill">{selectedMethod.kind}</span></div>
            <div className="algorithm-selector" role="radiogroup" aria-label="选择自动调度算法">{ALGORITHM_IDS.map((id) => <button role="radio" aria-checked={algorithm === id} className={algorithm === id ? "active" : ""} key={id} onClick={() => selectAlgorithm(id)}><b>{ALGORITHMS[id].version}</b><span>{ALGORITHMS[id].shortName}</span></button>)}</div>
            <div className="auto-actions"><button className="primary-action auto-button" onClick={() => game.running ? setGame((previous) => ({ ...previous, paused: !previous.paused })) : resetGame(difficulty, true)}><span>{game.running ? (game.paused ? "继续运行" : "暂停运行") : "启动自动调度"}</span><small>{game.running ? "保留当前任务与位置" : "从当前订单队列开始"}</small><kbd>{game.paused ? "▶" : "Ⅱ"}</kbd></button><div className="speed-picker"><span>仿真速度</span><button className={speed === 1 ? "active" : ""} onClick={() => setSpeed(1)}>1×</button><button className={speed === 2 ? "active" : ""} onClick={() => setSpeed(2)}>2×</button></div></div>
            <div className="robot-cards">{game.robots.map((robot) => <article key={robot.id} className={`robot-card ${robot.color}`}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>机器人 {robot.shortName}</small><strong>{robot.task}</strong><em>目标：{robot.target} · {itemLabel(robot.carrying)}</em></span><span className="status-dot" /></article>)}</div>
            <div className="metric-grid"><div><span>累计移动</span><strong>{game.metrics.travel}</strong><small>格</small></div><div><span>避碰等待</span><strong>{game.metrics.conflicts}</strong><small>次</small></div><div><span>累计逾期</span><strong>{game.metrics.tardiness}</strong><small>秒</small></div><div><span>滚动规划</span><strong>{game.metrics.replans}</strong><small>次</small></div></div>
            <div className="benchmark-card"><div className="benchmark-heading"><span>标准化 120 秒结果</span><small>{difficulty === "training" ? "标准到达" : "高峰到达"}</small></div><div className="benchmark-table"><span>算法</span><span>完成</span><span>得分</span><span>逾期</span>{benchmarkResults.map((result) => <button key={result.algorithm} className={algorithm === result.algorithm ? "active" : ""} onClick={() => selectAlgorithm(result.algorithm)}><b>{ALGORITHMS[result.algorithm].version}</b><strong>{result.delivered}</strong><em>{result.score}</em><small>{result.tardiness}s</small><i>{result.sequence || "—"}</i></button>)}</div><p>固定初始订单与 2 次决策步/秒；第二行显示交付顺序。结果来自同一离散事件仿真，不是预设文案。</p></div>
            <div className="method-card"><p>{selectedMethod.version} · {selectedMethod.kind.toUpperCase()}</p><strong>{selectedMethod.name}</strong><ol>{selectedMethod.steps.map((step, index) => <li key={step}><i>{index + 1}</i><span>{step}</span></li>)}</ol><em>{selectedMethod.note}</em></div>
          </> : <>
            <div className="panel-title-row"><div><p className="section-kicker">MANUAL MODE</p><h2>手动体验</h2></div><span className="team-count">对照组</span></div>
            <div className="robot-cards">{game.robots.map((robot) => <button key={robot.id} className={`robot-card ${robot.color} ${game.activeRobot === robot.id ? "active" : ""}`} onClick={() => setGame((previous) => ({ ...previous, activeRobot: robot.id }))}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>机器人 {robot.shortName}</small><strong>{robot.name}</strong><em>{itemLabel(robot.carrying)}</em></span></button>)}</div>
            <div className="control-block"><div className="block-heading"><strong>棋盘移动</strong><span>WASD / 方向键</span></div><div className="dpad"><button className="up" onClick={() => manualMove(-1, 0)}>↑</button><button className="left" onClick={() => manualMove(0, -1)}>←</button><button className="center" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}>↔</button><button className="right" onClick={() => manualMove(0, 1)}>→</button><button className="down" onClick={() => manualMove(1, 0)}>↓</button></div></div>
            <div className="action-stack"><button className="primary-action" onClick={manualInteract}><span>操作</span><small>拿取 / 切配 / 烹饪 / 交付</small><kbd>E</kbd></button><button className="switch-action" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}><span>切换机器人</span><small>Q / Tab</small><kbd>Q</kbd></button></div>
            <div className="method-card manual-note"><p>为什么保留手动模式？</p><strong>它是自动调度的直观基准</strong><em>同样的订单、厨房与时间限制下，可以比较人工决策与算法策略的完成量、移动距离和等待。</em></div>
          </>}
        </aside>
      </section>
      <footer><span><i /> 双机器人离散事件仿真 · V1–V4</span><p>仅供学习与研究参考，禁止商业使用；使用或改编前请通过 GitHub Issue 告知作者。</p><span>POLYFORM NONCOMMERCIAL 1.0.0</span></footer>
    </main>
  );
}
