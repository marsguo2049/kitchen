"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Ingredient = "tomato" | "mushroom";
type RecipeId = "tomato-soup" | "mushroom-soup" | "garden-stew";
type Mode = "auto" | "manual";
type Difficulty = "training" | "rush";
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
type JobStage = "fetch" | "cut" | "pot" | "loaded";
type PrepJob = { ingredient: Ingredient; stage: JobStage };
type AutoCycle = {
  orderId: number;
  recipe: RecipeId;
  phase: "prep" | "cook" | "serve";
  jobs: [PrepJob, PrepJob];
  potKey: "left-pot";
};
type Metrics = { travel: number; idle: number; conflicts: number; replans: number };
type GameState = {
  robots: [Robot, Robot];
  activeRobot: 0 | 1;
  cutBoards: Record<string, CutBoard>;
  pots: Record<string, Pot>;
  counters: Record<string, CarryItem>;
  orders: Order[];
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
  cycle: AutoCycle | null;
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
      { id: 0, name: "阿橙", shortName: "A", color: "coral", row: 2, col: 3, carrying: null, task: "等待任务", target: "—" },
      { id: 1, name: "小青", shortName: "B", color: "teal", row: 5, col: 5, carrying: null, task: "等待任务", target: "—" },
    ],
    activeRobot: 0,
    cutBoards: { "left-cut": null, "right-cut": null },
    pots: { "left-pot": { ingredients: [], recipe: null, cookLeft: 0, ready: false }, "right-pot": { ingredients: [], recipe: null, cookLeft: 0, ready: false } },
    counters: { "pass-top": null, "pass-bottom": null },
    orders: [makeOrder(1, difficulty), makeOrder(2, difficulty), makeOrder(3, difficulty)],
    score: 0, delivered: 0, combo: 0, timeLeft: ROUND_SECONDS, running, paused: false, ended: false,
    message: running ? "调度器启动，正在读取订单队列。" : "系统就绪，启动后由算法自动完成全部任务。",
    decision: "等待订单触发滚动规划。", nextOrderId: 4, cycle: null,
    metrics: { travel: 0, idle: 0, conflicts: 0, replans: 0 },
  };
}
function cloneGame(previous: GameState): GameState {
  return {
    ...previous,
    robots: previous.robots.map((robot) => ({ ...robot, carrying: robot.carrying ? { ...robot.carrying } : null })) as [Robot, Robot],
    cutBoards: Object.fromEntries(Object.entries(previous.cutBoards).map(([key, value]) => [key, value ? { ...value } : null])),
    pots: Object.fromEntries(Object.entries(previous.pots).map(([key, value]) => [key, { ...value, ingredients: [...value.ingredients] }])),
    counters: { ...previous.counters }, orders: previous.orders.map((order) => ({ ...order })),
    cycle: previous.cycle ? { ...previous.cycle, jobs: previous.cycle.jobs.map((job) => ({ ...job })) as [PrepJob, PrepJob] } : null,
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
function startCycle(game: GameState) {
  const selected = [...game.orders].sort((a, b) => a.remaining - b.remaining)[0];
  if (!selected) return;
  const ingredients = RECIPES[selected.recipe].ingredients;
  game.cycle = { orderId: selected.id, recipe: selected.recipe, phase: "prep", jobs: [{ ingredient: ingredients[0], stage: "fetch" }, { ingredient: ingredients[1], stage: "fetch" }], potKey: "left-pot" };
  game.metrics.replans += 1;
  game.decision = `选择剩余时间最短的 #${selected.id} ${RECIPES[selected.recipe].shortName}；两份原料并行处理。`;
  game.message = `滚动规划 #${selected.id}：阿橙负责${ingredientName(ingredients[0])}，小青负责${ingredientName(ingredients[1])}。`;
}
function finishDelivery(game: GameState, recipe: RecipeId, difficulty: Difficulty) {
  const index = game.orders.findIndex((order) => order.recipe === recipe);
  const matched = index >= 0 ? game.orders[index] : null;
  const combo = game.combo + 1;
  const earned = matched ? 100 + matched.remaining * 3 + Math.min(combo - 1, 4) * 25 : 60;
  const orders = index >= 0 ? game.orders.filter((_, orderIndex) => orderIndex !== index) : [...game.orders];
  orders.push(makeOrder(game.nextOrderId, difficulty));
  game.orders = orders;
  game.nextOrderId += 1; game.score += earned; game.delivered += 1; game.combo = combo;
  game.message = `订单交付，+${earned} 分。调度器将根据新队列重新规划。`;
  game.decision = "完成一次滚动时域，释放工位并重新计算订单优先级。";
  game.cycle = null;
  game.robots.forEach((robot) => { robot.task = "等待重规划"; robot.target = "调度器"; robot.carrying = null; });
}
function autoStep(previous: GameState, difficulty: Difficulty) {
  if (!previous.running || previous.paused || previous.ended) return previous;
  const game = cloneGame(previous);
  if (!game.cycle) startCycle(game);
  const cycle = game.cycle;
  if (!cycle) return game;
  const reserved = new Set<string>();
  if (cycle.phase === "prep") {
    for (const id of [0, 1] as const) {
      const robot = game.robots[id];
      const job = cycle.jobs[id];
      const ingredientStation = job.ingredient === "tomato" ? "0-2" : "0-6";
      const boardKey = id === 0 ? "left-cut" : "right-cut";
      const boardStation = id === 0 ? "2-0" : "2-8";
      if (job.stage === "fetch") {
        if (advanceTo(game, id, ingredientStation, `前往取${ingredientName(job.ingredient)}`, reserved)) {
          robot.carrying = { kind: "raw", ingredient: job.ingredient }; job.stage = "cut";
          game.message = `${robot.name} 已取${ingredientName(job.ingredient)}，前往专属切配台。`;
        }
      } else if (job.stage === "cut") {
        if (advanceTo(game, id, boardStation, `切配${ingredientName(job.ingredient)}`, reserved)) {
          const board = game.cutBoards[boardKey];
          if (!board && robot.carrying?.kind === "raw") {
            game.cutBoards[boardKey] = { ingredient: job.ingredient, progress: 0 }; robot.carrying = null;
          } else if (board && board.progress < 3) {
            board.progress += 1;
            game.message = `${robot.name} 切配进度 ${board.progress}/3。`;
          } else if (board?.progress === 3 && !robot.carrying) {
            robot.carrying = { kind: "chopped", ingredient: job.ingredient }; game.cutBoards[boardKey] = null; job.stage = "pot";
          }
        }
      } else if (job.stage === "pot") {
        if (advanceTo(game, id, "4-0", "将切配原料送往主灶台", reserved) && robot.carrying?.kind === "chopped") {
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
      cycle.phase = "cook"; game.decision = "两份原料已汇合；烹饪与取盘并行，减少机器人空闲。";
      game.message = `${RECIPES[cycle.recipe].shortName} 开始烹饪，小青立即提前取盘。`;
    }
  } else if (cycle.phase === "cook") {
    const assistant = game.robots[1];
    // Keep the one-cell stove entrance free even when robot A happened to be
    // the last loader. Monitoring does not require occupying the service cell.
    if (advanceTo(game, 0, "3-4", "远程监控锅具并清空入口", reserved)) {
      game.robots[0].task = "远程监控锅具";
      game.robots[0].target = "中央待命区";
      game.metrics.idle += 1;
    }
    if (!assistant.carrying) {
      if (advanceTo(game, 1, "7-2", "提前领取空盘", reserved)) assistant.carrying = { kind: "plate" };
    } else if (assistant.carrying.kind === "plate" && game.pots[cycle.potKey].ready) {
      if (advanceTo(game, 1, "4-0", "前往主锅装盘", reserved)) {
        assistant.carrying = { kind: "dish", recipe: cycle.recipe };
        game.pots[cycle.potKey] = { ingredients: [], recipe: null, cookLeft: 0, ready: false };
        cycle.phase = "serve"; game.decision = "烹饪完成，装盘机器人沿最短可行路径前往交付点。";
      }
    } else { assistant.task = "持盘等待出锅"; assistant.target = `主锅 ${game.pots[cycle.potKey].cookLeft}s`; game.metrics.idle += 1; }
  } else {
    const server = game.robots[1];
    game.robots[0].task = "清空工位 / 待命"; game.robots[0].target = "下一订单";
    if (advanceTo(game, 1, "7-6", "运送成品至交付口", reserved) && server.carrying?.kind === "dish") finishDelivery(game, server.carrying.recipe, difficulty);
  }
  return game;
}
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

export default function Home() {
  const [mode, setMode] = useState<Mode>("auto");
  const [difficulty, setDifficulty] = useState<Difficulty>("training");
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [game, setGame] = useState<GameState>(() => createInitialState("training"));
  const resetGame = useCallback((nextDifficulty = difficulty, start = false) => setGame(createInitialState(nextDifficulty, start)), [difficulty]);
  const selectMode = (nextMode: Mode) => { setMode(nextMode); setGame(createInitialState(difficulty)); };

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
    const timer = window.setInterval(() => setGame((previous) => autoStep(previous, difficulty)), speed === 1 ? 520 : 260);
    return () => window.clearInterval(timer);
  }, [difficulty, game.ended, game.running, mode, speed]);
  useEffect(() => {
    if (!game.running || game.paused || game.ended) return;
    const timer = window.setInterval(() => setGame((previous) => {
      if (!previous.running || previous.paused) return previous;
      const next = cloneGame(previous); next.timeLeft = Math.max(0, next.timeLeft - 1);
      for (const pot of Object.values(next.pots)) if (pot.recipe && !pot.ready) { pot.cookLeft = Math.max(0, pot.cookLeft - 1); pot.ready = pot.cookLeft === 0; }
      next.orders = next.orders.map((order) => ({ ...order, remaining: Math.max(0, order.remaining - 1) }));
      if (next.timeLeft === 0) { next.running = false; next.ended = true; next.message = `本轮完成：${next.delivered} 道菜，团队得分 ${next.score}。`; }
      return next;
    }), 1000);
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
          <div className="order-list">{game.orders.map((order, index) => { const recipe = RECIPES[order.recipe]; const activeOrder = game.cycle?.orderId === order.id; return (
            <article className={`order-card ${activeOrder ? "selected" : ""} ${order.remaining < 14 ? "urgent" : ""}`} key={order.id}>
              <div className="ticket-number">#{order.id}</div><div className="dish-icon" style={{ background: recipe.color }}>{recipe.icon}</div>
              <div className="order-copy"><strong>{recipe.name}</strong><span>{recipe.ingredients.map(ingredientName).join(" + ")}</span><div className="order-timer"><i style={{ width: `${order.remaining / order.maxTime * 100}%` }} /></div></div><b>{order.remaining}s</b>
              {activeOrder && <em className="planning-tag">规划中</em>}
            </article>); })}</div>
          <div className="decision-card"><span>当前决策</span><strong>{game.decision}</strong><p>每次交付后重新计算，不锁死整轮计划。</p></div>
          <div className="mode-picker"><span>订单压力</span><div><button className={difficulty === "training" ? "active" : ""} onClick={() => { setDifficulty("training"); resetGame("training"); }}>标准到达</button><button className={difficulty === "rush" ? "active" : ""} onClick={() => { setDifficulty("rush"); resetGame("rush"); }}>高峰到达</button></div></div>
        </aside>

        <section className="kitchen-column">
          <div className="kitchen-frame">
            <div className="kitchen-label"><span>GRID 01 · V1.0</span><strong>{mode === "auto" ? "顺序订单基准策略" : "手动对照实验"}</strong><em className={game.paused ? "paused" : ""}>{game.running ? (game.paused ? "已暂停" : "运行中") : "待启动"}</em></div>
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
            {!game.running && <div className="start-overlay"><div className="start-card"><p>{game.ended ? "SHIFT COMPLETE" : mode === "auto" ? "AUTONOMOUS DISPATCH" : "MANUAL BENCHMARK"}</p><h2>{game.ended ? `完成 ${game.delivered} 道菜` : mode === "auto" ? "让两台机器人自己协作" : "亲自控制两台机器人"}</h2><span>{mode === "auto" ? "算法负责订单排序、任务分配、路径规划与避碰。" : "作为对照策略，观察人工操作与自动调度的差异。"}</span><button onClick={() => resetGame(difficulty, true)}>{game.ended ? "再运行一次" : "启动系统"}<b>→</b></button></div></div>}
          </div>
        </section>

        <aside className="controls-panel panel">
          {mode === "auto" ? <>
            <div className="panel-title-row"><div><p className="section-kicker">DISPATCHER</p><h2>调度控制台</h2></div><span className="algorithm-pill">启发式</span></div>
            <div className="auto-actions"><button className="primary-action auto-button" onClick={() => game.running ? setGame((previous) => ({ ...previous, paused: !previous.paused })) : resetGame(difficulty, true)}><span>{game.running ? (game.paused ? "继续运行" : "暂停运行") : "启动自动调度"}</span><small>{game.running ? "保留当前任务与位置" : "从当前订单队列开始"}</small><kbd>{game.paused ? "▶" : "Ⅱ"}</kbd></button><div className="speed-picker"><span>仿真速度</span><button className={speed === 1 ? "active" : ""} onClick={() => setSpeed(1)}>1×</button><button className={speed === 2 ? "active" : ""} onClick={() => setSpeed(2)}>2×</button></div></div>
            <div className="robot-cards">{game.robots.map((robot) => <article key={robot.id} className={`robot-card ${robot.color}`}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>机器人 {robot.shortName}</small><strong>{robot.task}</strong><em>目标：{robot.target} · {itemLabel(robot.carrying)}</em></span><span className="status-dot" /></article>)}</div>
            <div className="metric-grid"><div><span>累计移动</span><strong>{game.metrics.travel}</strong><small>格</small></div><div><span>避碰等待</span><strong>{game.metrics.conflicts}</strong><small>次</small></div><div><span>空闲时间</span><strong>{game.metrics.idle}</strong><small>步</small></div><div><span>滚动规划</span><strong>{game.metrics.replans}</strong><small>次</small></div></div>
            <div className="method-card"><p>VERSION 1 · BASELINE</p><strong>顺序订单协作启发式</strong><ol><li><i>1</i><span>最早截止订单优先</span></li><li><i>2</i><span>单个订单内并行备料</span></li><li><i>3</i><span>BFS 最短路 + 单步位置预留</span></li><li><i>4</i><span>交付后再规划下一订单</span></li></ol><em>V1.0 一次只处理一道菜，作为后续跨订单并行调度的基准；不声称得到全局最优解。</em></div>
          </> : <>
            <div className="panel-title-row"><div><p className="section-kicker">MANUAL MODE</p><h2>手动体验</h2></div><span className="team-count">对照组</span></div>
            <div className="robot-cards">{game.robots.map((robot) => <button key={robot.id} className={`robot-card ${robot.color} ${game.activeRobot === robot.id ? "active" : ""}`} onClick={() => setGame((previous) => ({ ...previous, activeRobot: robot.id }))}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>机器人 {robot.shortName}</small><strong>{robot.name}</strong><em>{itemLabel(robot.carrying)}</em></span></button>)}</div>
            <div className="control-block"><div className="block-heading"><strong>棋盘移动</strong><span>WASD / 方向键</span></div><div className="dpad"><button className="up" onClick={() => manualMove(-1, 0)}>↑</button><button className="left" onClick={() => manualMove(0, -1)}>←</button><button className="center" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}>↔</button><button className="right" onClick={() => manualMove(0, 1)}>→</button><button className="down" onClick={() => manualMove(1, 0)}>↓</button></div></div>
            <div className="action-stack"><button className="primary-action" onClick={manualInteract}><span>操作</span><small>拿取 / 切配 / 烹饪 / 交付</small><kbd>E</kbd></button><button className="switch-action" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}><span>切换机器人</span><small>Q / Tab</small><kbd>Q</kbd></button></div>
            <div className="method-card manual-note"><p>为什么保留手动模式？</p><strong>它是自动调度的直观基准</strong><em>同样的订单、厨房与时间限制下，可以比较人工决策与算法策略的完成量、移动距离和等待。</em></div>
          </>}
        </aside>
      </section>
      <footer><span><i /> 双机器人离散事件仿真</span><p>目标：减少订单延误、总移动与资源空闲，同时满足工序先后与避碰约束。</p><span>SEQUENTIAL BASELINE · V1.0.0</span></footer>
    </main>
  );
}
