"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Ingredient = "tomato" | "mushroom" | "lettuce" | "protein";
type RecipeId = "garden-salad" | "tomato-soup" | "mushroom-skillet";
type MapId = "compact" | "ushape" | "zoned";
type Equipment = "mix" | "stove" | "grill";
type Mode = "auto" | "manual";
type Difficulty = "training" | "rush";
type AlgorithmId = "baseline" | "pipeline" | "dual";
type Language = "zh" | "en";
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
type CutBoard = { ingredient: Ingredient; progress: number; required: number } | null;
type Pot = { ingredients: Ingredient[]; recipe: RecipeId | null; cookLeft: number; ready: boolean };
type Order = { id: number; recipe: RecipeId; remaining: number; maxTime: number };
type JobStage = "fetch" | "cut" | "buffer" | "pot" | "loaded";
type BoardKey = "left-cut" | "right-cut";
type BoardStation = string;
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
  potStation: string;
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
  potStation: string;
  phase: "prep" | "cook" | "ready" | "serve";
  jobs: [SmartJob, SmartJob];
  plateStaged: boolean;
  serverId: 0 | 1 | null;
};
type Metrics = { travel: number; idle: number; conflicts: number; replans: number; tardiness: number };
type GameState = {
  mapId: MapId;
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
  | { type: "ingredient"; ingredient: Ingredient; label: string; labelEn: string; icon: string }
  | { type: "cut"; key: string; label: string; labelEn: string; icon: string }
  | { type: "stove"; key: string; label: string; labelEn: string; icon: string; capabilities: Equipment[] }
  | { type: "plates"; label: string; labelEn: string; icon: string }
  | { type: "serve"; label: string; labelEn: string; icon: string }
  | { type: "bin"; label: string; labelEn: string; icon: string }
  | { type: "counter"; key: string; label: string; labelEn: string; icon: string };

const DEFAULT_ROUND_SECONDS = 120;
const normalizeDuration = (value: string | number) => Math.max(30, Math.min(600, Math.round(Number(value) / 10) * 10 || 30));
const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const RECIPES: Record<RecipeId, { name: string; nameEn: string; shortName: string; shortNameEn: string; icon: string; ingredients: [Ingredient, Ingredient]; color: string; equipment: Equipment; cutActions: number; processTime: { training: number; rush: number }; process: string; processEn: string; estimated: number }> = {
  "garden-salad": { name: "鲜蔬沙拉", nameEn: "Garden Salad", shortName: "沙拉", shortNameEn: "Salad", icon: "🥗", ingredients: ["lettuce", "tomato"], color: "#63b98c", equipment: "mix", cutActions: 2, processTime: { training: 2, rush: 3 }, process: "切配 → 混合", processEn: "chop → mix", estimated: 15 },
  "tomato-soup": { name: "番茄蘑菇汤", nameEn: "Tomato Mushroom Soup", shortName: "番茄汤", shortNameEn: "Tomato Soup", icon: "🍅", ingredients: ["tomato", "mushroom"], color: "#ef6a54", equipment: "stove", cutActions: 3, processTime: { training: 8, rush: 11 }, process: "切配 → 炖煮", processEn: "chop → simmer", estimated: 21 },
  "mushroom-skillet": { name: "蘑菇香煎主菜", nameEn: "Mushroom Skillet", shortName: "香煎主菜", shortNameEn: "Skillet", icon: "🍳", ingredients: ["protein", "mushroom"], color: "#d18d4f", equipment: "grill", cutActions: 2, processTime: { training: 6, rush: 8 }, process: "切配 → 煎制", processEn: "prep → grill", estimated: 19 },
};
const ALGORITHMS: Record<AlgorithmId, { code: string; name: string; nameEn: string; shortName: string; shortNameEn: string; kind: string; kindEn: string; steps: string[]; stepsEn: string[]; note: string; noteEn: string }> = {
  baseline: {
    code: "A",
    name: "顺序目标基线",
    nameEn: "Sequential Priority Baseline",
    shortName: "顺序基线",
    shortNameEn: "Sequential",
    kind: "基准启发式",
    kindEn: "Baseline heuristic",
    steps: ["所选目标引导订单优先级", "单个订单内双机器人并行", "固定切配角色 + BFS 最短路", "交付后才启动下一订单"],
    stepsEn: ["Objective-guided order priority", "Two robots work in parallel within one order", "Fixed cutting roles + BFS shortest paths", "Start the next order after delivery"],
    note: "一次只处理一道菜，是后续策略的可复现实验基线。",
    noteEn: "Processes one dish at a time as a reproducible baseline for later policies.",
  },
  pipeline: {
    code: "B",
    name: "流水竞价协作调度",
    nameEn: "Pipeline Auction Scheduling",
    shortName: "流水竞价",
    shortNameEn: "Pipeline Auction",
    kind: "分配启发式",
    kindEn: "Assignment heuristic",
    steps: ["所选目标引导订单优先级", "烹饪时预备下一单", "按距离竞价分配机器人", "切好原料暂存于传菜台"],
    stepsEn: ["Objective-guided order priority", "Prepare the next order while cooking", "Assign robots through distance-based bidding", "Stage chopped ingredients on the pass counter"],
    note: "合并原 V2 流水备料与 V3 距离竞价，作为单设备协作策略。",
    noteEn: "Combines pipeline preparation and distance auction as a single-resource collaboration policy.",
  },
  dual: {
    code: "C",
    name: "滚动双设备资源调度",
    nameEn: "Rolling Resource Scheduling",
    shortName: "双设备协同",
    shortNameEn: "Dual Resource",
    kind: "资源感知启发式",
    kindEn: "Resource-aware heuristic",
    steps: ["滚动评估当前订单窗口", "按菜谱能力匹配两台加工设备", "空盘提前放到对应设备旁", "空闲机器人继续准备后续订单"],
    stepsEn: ["Re-evaluate the active order window", "Match recipes to two capability-compatible resources", "Stage plates beside the assigned resource", "Keep free robots preparing future work"],
    note: "同时考虑订单、路径与设备能力，是当前最完整的资源感知策略。",
    noteEn: "Jointly considers orders, routes, and equipment compatibility as the most complete resource-aware policy.",
  },
};
const ALGORITHM_IDS = Object.keys(ALGORITHMS) as AlgorithmId[];
const OBJECTIVES: Record<ObjectiveId, { label: string; labelEn: string; direction: string; directionEn: string; description: string; descriptionEn: string }> = {
  throughput: { label: "最多完成", labelEn: "Max Throughput", direction: "越大越好", directionEn: "Higher is better", description: "偏向预计工时更短的订单，提高时限内完成量。", descriptionEn: "Favors shorter estimated processing times to increase completed orders within the horizon." },
  score: { label: "最高积分", labelEn: "Max Score", direction: "越大越好", directionEn: "Higher is better", description: "按预计交付积分与处理时间选择订单。", descriptionEn: "Prioritizes orders by projected delivery reward relative to processing time." },
  tardiness: { label: "最小逾期", labelEn: "Min Tardiness", direction: "越小越好", directionEn: "Lower is better", description: "优先处理预计松弛时间最小、最容易逾期的订单。", descriptionEn: "Prioritizes the least-slack orders that are most at risk of being late." },
  travel: { label: "最少移动", labelEn: "Min Travel", direction: "越小越好", directionEn: "Lower is better", description: "优先选择当前机器人取料—切配—入锅预计路程最短的订单。", descriptionEn: "Favors the order with the shortest estimated fetch–cut–stove travel from current robot positions." },
  balanced: { label: "综合字典序", labelEn: "Balanced Lexicographic", direction: "依次判定", directionEn: "Compared in order", description: "依次考虑预计完成、逾期、积分与移动。", descriptionEn: "Considers projected completion, tardiness, score, and travel in lexicographic order." },
};
type KitchenLayout = { name: string; nameEn: string; shortName: string; shortNameEn: string; description: string; descriptionEn: string; rows: number; cols: number; footprint: string; stations: Record<string, Station>; walls: Set<string>; starts: [Position, Position] };
const boundaryWalls = (rows: number, cols: number, openings: string[]) => {
  const open = new Set(openings); const walls = new Set<string>();
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
    if ((row === 0 || row === rows - 1 || col === 0 || col === cols - 1) && !open.has(`${row}-${col}`)) walls.add(`${row}-${col}`);
  }
  return walls;
};
const KITCHENS: Record<MapId, KitchenLayout> = {
  compact: {
    name: "紧凑直线厨房", nameEn: "Compact Galley", shortName: "紧凑直线", shortNameEn: "Compact", footprint: "6.0 × 5.4 m",
    description: "狭窄双通道、设备沿墙布置，重点观察避让和单点拥堵。", descriptionEn: "A narrow galley with wall-side equipment, exposing yielding and bottleneck effects.", rows: 8, cols: 9,
    stations: {
      "0-1": { type: "ingredient", ingredient: "lettuce", label: "生菜", labelEn: "Lettuce", icon: "🥬" }, "0-3": { type: "ingredient", ingredient: "tomato", label: "番茄", labelEn: "Tomato", icon: "🍅" },
      "0-5": { type: "ingredient", ingredient: "mushroom", label: "蘑菇", labelEn: "Mushroom", icon: "🍄" }, "0-7": { type: "ingredient", ingredient: "protein", label: "主料", labelEn: "Protein", icon: "🥩" },
      "2-0": { type: "cut", key: "left-cut", label: "切配 A", labelEn: "Cut A", icon: "🔪" }, "2-8": { type: "cut", key: "right-cut", label: "切配 B", labelEn: "Cut B", icon: "🔪" },
      "4-0": { type: "stove", key: "left-pot", label: "混合 / 炉灶", labelEn: "Mixer / Stove", icon: "♨", capabilities: ["mix", "stove"] }, "4-8": { type: "stove", key: "right-pot", label: "煎台 / 炉灶", labelEn: "Grill / Stove", icon: "◉", capabilities: ["grill", "stove"] },
      "3-4": { type: "counter", key: "pass-top", label: "传菜台", labelEn: "Pass", icon: "↔" }, "4-4": { type: "counter", key: "pass-bottom", label: "传菜台", labelEn: "Pass", icon: "↔" },
      "7-2": { type: "plates", label: "餐盘", labelEn: "Plates", icon: "◯" }, "7-4": { type: "bin", label: "回收", labelEn: "Bin", icon: "↻" }, "7-6": { type: "serve", label: "出餐", labelEn: "Serve", icon: "🔔" },
    }, walls: boundaryWalls(8, 9, ["0-1", "0-3", "0-5", "0-7", "2-0", "2-8", "4-0", "4-8", "7-2", "7-4", "7-6"]), starts: [{ row: 2, col: 5 }, { row: 5, col: 3 }],
  },
  ushape: {
    name: "中型 U 形厨房", nameEn: "Medium U-Shape", shortName: "U 形厨房", shortNameEn: "U-Shape", footprint: "8.2 × 6.6 m",
    description: "设备分布在三侧，共享中央通道，适合比较路径和资源竞争。", descriptionEn: "Equipment spans three sides around a shared aisle for routing and resource competition.", rows: 9, cols: 11,
    stations: {
      "0-2": { type: "ingredient", ingredient: "lettuce", label: "生菜", labelEn: "Lettuce", icon: "🥬" }, "0-4": { type: "ingredient", ingredient: "tomato", label: "番茄", labelEn: "Tomato", icon: "🍅" },
      "0-6": { type: "ingredient", ingredient: "mushroom", label: "蘑菇", labelEn: "Mushroom", icon: "🍄" }, "0-8": { type: "ingredient", ingredient: "protein", label: "主料", labelEn: "Protein", icon: "🥩" },
      "2-0": { type: "cut", key: "left-cut", label: "冷加工 A", labelEn: "Prep A", icon: "🔪" }, "2-10": { type: "cut", key: "right-cut", label: "冷加工 B", labelEn: "Prep B", icon: "🔪" },
      "5-0": { type: "stove", key: "left-pot", label: "混合 / 炉灶", labelEn: "Mixer / Stove", icon: "♨", capabilities: ["mix", "stove"] }, "5-10": { type: "stove", key: "right-pot", label: "煎台 / 炉灶", labelEn: "Grill / Stove", icon: "◉", capabilities: ["grill", "stove", "mix"] },
      "4-5": { type: "counter", key: "pass-top", label: "中央传菜", labelEn: "Central Pass", icon: "↔" }, "5-5": { type: "counter", key: "pass-bottom", label: "中央传菜", labelEn: "Central Pass", icon: "↔" },
      "8-2": { type: "plates", label: "餐盘", labelEn: "Plates", icon: "◯" }, "8-5": { type: "bin", label: "回收", labelEn: "Bin", icon: "↻" }, "8-8": { type: "serve", label: "出餐", labelEn: "Serve", icon: "🔔" },
    }, walls: boundaryWalls(9, 11, ["0-2", "0-4", "0-6", "0-8", "2-0", "2-10", "5-0", "5-10", "8-2", "8-5", "8-8"]), starts: [{ row: 3, col: 3 }, { row: 6, col: 7 }],
  },
  zoned: {
    name: "大型分区厨房", nameEn: "Large Zoned Kitchen", shortName: "分区厨房", shortNameEn: "Zoned", footprint: "11.5 × 8.4 m",
    description: "冷加工、热加工和出餐区分离，移动更长但通道容量更高。", descriptionEn: "Separated prep, hot-work, and service zones create longer routes with higher aisle capacity.", rows: 10, cols: 13,
    stations: {
      "0-2": { type: "ingredient", ingredient: "lettuce", label: "生菜", labelEn: "Lettuce", icon: "🥬" }, "0-5": { type: "ingredient", ingredient: "tomato", label: "番茄", labelEn: "Tomato", icon: "🍅" },
      "0-7": { type: "ingredient", ingredient: "mushroom", label: "蘑菇", labelEn: "Mushroom", icon: "🍄" }, "0-10": { type: "ingredient", ingredient: "protein", label: "主料", labelEn: "Protein", icon: "🥩" },
      "3-0": { type: "cut", key: "left-cut", label: "冷加工 A", labelEn: "Cold Prep A", icon: "🔪" }, "3-12": { type: "cut", key: "right-cut", label: "冷加工 B", labelEn: "Cold Prep B", icon: "🔪" },
      "6-0": { type: "stove", key: "left-pot", label: "混合 / 炉灶", labelEn: "Mixer / Stove", icon: "♨", capabilities: ["mix", "stove"] }, "6-12": { type: "stove", key: "right-pot", label: "煎台 / 炉灶", labelEn: "Grill / Stove", icon: "◉", capabilities: ["grill", "stove"] },
      "4-6": { type: "counter", key: "pass-top", label: "分区传菜", labelEn: "Zone Pass", icon: "↔" }, "5-6": { type: "counter", key: "pass-bottom", label: "分区传菜", labelEn: "Zone Pass", icon: "↔" },
      "9-3": { type: "plates", label: "餐盘", labelEn: "Plates", icon: "◯" }, "9-6": { type: "bin", label: "回收", labelEn: "Bin", icon: "↻" }, "9-9": { type: "serve", label: "出餐", labelEn: "Serve", icon: "🔔" },
    }, walls: new Set([...boundaryWalls(10, 13, ["0-2", "0-5", "0-7", "0-10", "3-0", "3-12", "6-0", "6-12", "9-3", "9-6", "9-9"]), "2-4", "2-8", "7-4", "7-8"]), starts: [{ row: 3, col: 4 }, { row: 6, col: 8 }],
  },
};
const MAP_IDS = Object.keys(KITCHENS) as MapId[];

function coord(row: number, col: number) { return `${row}-${col}`; }
function layoutOf(mapId: MapId) { return KITCHENS[mapId]; }
function stationPosition(mapId: MapId, stationKey: string) { return stationKey.split("-").map(Number) as [number, number]; }
function stationByLogicalKey(mapId: MapId, key: string) { return Object.entries(layoutOf(mapId).stations).find(([, station]) => "key" in station && station.key === key)?.[0] ?? ""; }
function stationByType(mapId: MapId, type: Station["type"]) { return Object.entries(layoutOf(mapId).stations).find(([, station]) => station.type === type)?.[0] ?? ""; }
function ingredientStation(mapId: MapId, ingredient: Ingredient) { return Object.entries(layoutOf(mapId).stations).find(([, station]) => station.type === "ingredient" && station.ingredient === ingredient)?.[0] ?? ""; }
function compatiblePotKeys(mapId: MapId, recipe: RecipeId) { return Object.entries(layoutOf(mapId).stations).filter(([, station]) => station.type === "stove" && station.capabilities.includes(RECIPES[recipe].equipment)).map(([position, station]) => ({ potKey: (station as Extract<Station, { type: "stove" }>).key as "left-pot" | "right-pot", potStation: position })); }
function isWalkable(row: number, col: number, mapId: MapId = "compact") {
  const layout = layoutOf(mapId);
  const key = coord(row, col);
  return row >= 0 && row < layout.rows && col >= 0 && col < layout.cols && !layout.walls.has(key) && !layout.stations[key];
}
function isAdjacent(robot: Position, stationKey: string, mapId: MapId = "compact") {
  const [row, col] = stationPosition(mapId, stationKey);
  return Math.abs(robot.row - row) + Math.abs(robot.col - col) === 1;
}
function nearbyStation(robot: Robot, mapId: MapId = "compact") {
  return Object.entries(layoutOf(mapId).stations).find(([key]) => isAdjacent(robot, key, mapId))?.[1] ?? null;
}
function tr(language: Language, zh: string, en: string) { return language === "zh" ? zh : en; }
function ingredientName(value: Ingredient, language: Language = "zh") { return ({ tomato: tr(language, "番茄", "tomato"), mushroom: tr(language, "蘑菇", "mushroom"), lettuce: tr(language, "生菜", "lettuce"), protein: tr(language, "主料", "protein") })[value]; }
function recipeName(recipe: RecipeId, language: Language, short = false) {
  const item = RECIPES[recipe];
  return short ? (language === "zh" ? item.shortName : item.shortNameEn) : (language === "zh" ? item.name : item.nameEn);
}
function stationLabel(station: Station | null, language: Language) { return station ? (language === "zh" ? station.label : station.labelEn) : tr(language, "工位", "station"); }
function algorithmName(id: AlgorithmId, language: Language, short = false) { const item = ALGORITHMS[id]; return short ? (language === "zh" ? item.shortName : item.shortNameEn) : (language === "zh" ? item.name : item.nameEn); }
function objectiveLabel(id: ObjectiveId, language: Language) { return language === "zh" ? OBJECTIVES[id].label : OBJECTIVES[id].labelEn; }
function itemLabel(item: CarryItem, language: Language = "zh") {
  if (!item) return tr(language, "空手", "Empty");
  if (item.kind === "plate") return tr(language, "空盘", "Plate");
  if (item.kind === "dish") return recipeName(item.recipe, language, true);
  return `${item.kind === "chopped" ? tr(language, "切好的", "Chopped ") : ""}${ingredientName(item.ingredient, language)}`;
}
function itemIcon(item: CarryItem) {
  if (!item) return "";
  if (item.kind === "plate") return "◯";
  if (item.kind === "dish") return "🍲";
  return ({ tomato: "🍅", mushroom: "🍄", lettuce: "🥬", protein: "🥩" })[item.ingredient];
}
const RUNTIME_EN: Record<string, string> = {
  "等待任务": "Waiting for task", "等待订单触发滚动规划。": "Waiting for the next rolling decision.",
  "系统就绪，启动后由算法自动完成全部任务。": "System ready. Start to let the selected policy complete all tasks.",
  "调度器启动，正在读取订单队列。": "Scheduler started and is reading the order queue.",
  "避让搭档": "Yielding to teammate", "下一订单": "Next order", "下一项可执行任务": "Next feasible task",
  "中央待命区": "Central waiting area", "交付完成，立即接取新任务": "Delivered; taking the next task",
  "传菜台缓冲区": "Pass-counter buffer", "前往选定锅具装盘": "Moving to the assigned stove to plate",
  "原料已送达，前往待命区避让": "Ingredient loaded; clearing the stove lane",
  "完成一次滚动时域，释放工位并重新计算订单优先级。": "Rolling cycle completed; resources released and priorities recalculated.",
  "将下一单原料存入缓冲台": "Stage the next ingredient on the pass counter",
  "将切配原料送往选定灶台": "Move the chopped ingredient to the assigned stove",
  "待命并保持灶台通道畅通": "Waiting while keeping the stove lane clear",
  "持盘等待出锅": "Waiting beside the stove with a plate", "提前领取空盘": "Collecting a plate in advance",
  "清空工位 / 待命": "Clear station / wait", "滚动调度器": "Rolling scheduler",
  "烹饪完成，装盘机器人沿最短可行路径前往交付点。": "Cooking finished; the plating robot follows the shortest feasible path to service.",
  "空盘已放在灶旁，转去备料": "Plate staged; returning to preparation",
  "等待下一项可执行任务": "Waiting for the next feasible task", "等待重规划": "Waiting for replanning",
  "继续下一单备料": "Continue preparing the next order", "调度器": "Scheduler", "运送成品至交付口": "Deliver the finished dish",
  "远程监控锅具": "Monitoring the stove", "远程监控锅具并清空入口": "Monitor the stove and clear its entrance",
  "释放机器人与灶台，重新计算订单、距离和工位占用。": "Release robots and stove; recalculate orders, distances, and station occupancy.",
  "预备工序": "Pre-preparation", "领取提前备好的原料": "Collect the staged ingredient",
  "两份原料已汇合；烹饪与取盘并行，减少机器人空闲。": "Both ingredients are loaded; cooking and plate collection now run in parallel.",
  "该格不可进入，请更换路线。": "That cell is blocked. Choose another route.",
  "附近没有可操作设备。": "No workstation is within interaction range.",
};
function runtimeText(value: string, language: Language) {
  if (language === "zh") return value;
  if (RUNTIME_EN[value]) return RUNTIME_EN[value];
  return value
    .replace(/^本轮完成：(\d+) 道菜，团队得分 (\d+)。$/, "Run complete: $1 dishes, team score $2.")
    .replace(/^订单交付，\+(\d+) 分。调度器将根据新队列重新规划。$/, "Order delivered, +$1. Replanning for the updated queue.")
    .replace(/^双设备订单 #(\d+) 交付，\+(\d+) 分；空闲设备立即接续新订单。$/, "Resource-scheduled order #$1 delivered, +$2; a compatible resource takes the next order.")
    .replace(/^#(\d+) 的(番茄|蘑菇|生菜|主料)已提前备好。$/, "The $2 for #$1 is staged in advance.")
    .replace(/^#(\d+) 预备原料已就绪$/, "Prefetched ingredient for #$1 is ready")
    .replace(/^#(\d+) 在(主灶|备用灶)开始烹饪；调度器同时安排空盘和下一单。$/, "#$1 started cooking on $2; the scheduler also stages a plate and future work.")
    .replace(/^策略 ([ABC]) 规划 #(\d+)：阿橙负责(番茄|蘑菇|生菜|主料)，小青负责(番茄|蘑菇|生菜|主料)。$/, "Policy $1 planned #$2: Orange handles $3 and Cyan handles $4.")
    .replace(/^策略 ([ABC]) 在烹饪窗口预取 #(\d+) 的(番茄|蘑菇|生菜|主料)。$/, "Policy $1 prefetches $3 for #$2 during processing.")
    .replace(/^选择 #(\d+)，按预计移动距离竞价分配原料与切配台。$/, "Selected #$1; ingredients and cutting boards assigned by estimated travel auction.")
    .replace(/^按(.+)目标选择 #(\d+) (.+)；两份原料并行处理。$/, "Selected #$2 ($3) under the $1 objective; both ingredients are processed in parallel.")
    .replace(/^选择剩余时间最短的 #(\d+) (.+)；两份原料并行处理。$/, "Selected urgent order #$1 ($2); both ingredients are processed in parallel.")
    .replace(/^接续 #(\d+) 的跨订单预备原料，并行完成剩余备料。$/, "Resuming the prefetched ingredient for #$1 and preparing the remainder in parallel.")
    .replace(/^滚动双设备策略同时管理 (\d+) 道在制订单；优先前置空盘、释放机器人并填满兼容设备。$/, "The rolling resource policy manages $1 active orders, stages plates, frees robots, and fills compatible resources.")
    .replace(/^双设备加工期间，(阿橙|小青)机会性准备 #(\d+) 的(番茄|蘑菇|生菜|主料)。$/, "$1 opportunistically prepares $3 for #$2 while both stations process orders.")
    .replace(/^空盘已提前放在(主灶|备用灶)旁；(阿橙|小青)无需原地等待。$/, "A plate is staged beside $1; $2 can continue other work.")
    .replace(/阿橙/g, "Orange").replace(/小青/g, "Cyan")
    .replace(/番茄汤/g, "Tomato Soup").replace(/沙拉/g, "Salad").replace(/香煎主菜/g, "Skillet")
    .replace(/最多完成/g, "Max Throughput").replace(/最高积分/g, "Max Score").replace(/最小逾期/g, "Min Tardiness").replace(/最少移动/g, "Min Travel").replace(/综合字典序/g, "Balanced Lexicographic")
    .replace(/番茄/g, "tomato").replace(/蘑菇/g, "mushroom").replace(/生菜/g, "lettuce").replace(/主料/g, "protein")
    .replace(/混合 \/ 炉灶/g, "Mixer / Stove").replace(/煎台 \/ 炉灶/g, "Grill / Stove")
    .replace(/冷加工 A/g, "Cold Prep A").replace(/冷加工 B/g, "Cold Prep B").replace(/切配 A/g, "Cut A").replace(/切配 B/g, "Cut B")
    .replace(/中央传菜/g, "Central Pass").replace(/分区传菜/g, "Zone Pass").replace(/传菜台/g, "Pass").replace(/餐盘/g, "Plates").replace(/出餐/g, "Serve").replace(/回收/g, "Bin")
    .replace(/主灶台/g, "Stove A").replace(/备用灶/g, "Stove B")
    .replace(/主灶/g, "Stove A")
    .replace(/^为 #(\d+) 取(.+)$/, "Fetch $2 for #$1").replace(/^切配 #(\d+) (.+)$/, "Cut $2 for #$1")
    .replace(/^送入 #(\d+) (.+)$/, "Load #$1 into $2").replace(/^交付 #(\d+)$/, "Deliver #$1")
    .replace(/^为 #(\d+) 提前取盘$/, "Collect a plate early for #$1").replace(/^把空盘送到 #(\d+) 灶台旁$/, "Stage a plate beside the stove for #$1")
    .replace(/^从 #(\d+) 灶台直接装盘$/, "Plate #$1 directly at the stove").replace(/^领取 #(\d+) 预备原料$/, "Collect the staged ingredient for #$1")
    .replace(/^前往取(.+)$/, "Fetch $1").replace(/^切配(.+)$/, "Cut $1").replace(/^预取下一单(.+)$/, "Prefetch $1 for the next order")
    .replace(/^提前切配(.+)$/, "Cut $1 in advance").replace(/^主锅 (\d+)s$/, "Stove $1s")
    .replace(/^(.+) 已取(.+)，前往专属切配台。$/, "$1 collected $2 and is moving to its cutting board.")
    .replace(/^(.+) 切配进度 (\d+)\/(\d+)。$/, "$1 cutting progress: $2/$3.")
    .replace(/^(.+) 已将原料送入主锅。$/, "$1 loaded an ingredient into the stove.")
    .replace(/^(.+) 开始烹饪，(.+)立即提前取盘。$/, "$1 started cooking; $2 collects a plate in advance.")
    .replace(/^正在控制 (.+)。$/, "Controlling $1.")
    .replace(/^(.+) 已操作(.+)。$/, "$1 used $2.");
}
function makeOrder(id: number, difficulty: Difficulty): Order {
  const pool: RecipeId[] = difficulty === "training"
    ? ["garden-salad", "tomato-soup", "mushroom-skillet"]
    : ["mushroom-skillet", "tomato-soup", "garden-salad", "tomato-soup"];
  const recipe = pool[(id * 7 + 1) % pool.length];
  const maxTime = difficulty === "training" ? 70 : 46;
  return { id, recipe, remaining: maxTime, maxTime };
}
function createInitialState(difficulty: Difficulty, running = false, duration = DEFAULT_ROUND_SECONDS, mapId: MapId = "compact"): GameState {
  const starts = layoutOf(mapId).starts;
  return {
    mapId,
    robots: [
      { id: 0, name: "阿橙", shortName: "A", color: "coral", ...starts[0], carrying: null, task: "等待任务", target: "—" },
      { id: 1, name: "小青", shortName: "B", color: "teal", ...starts[1], carrying: null, task: "等待任务", target: "—" },
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
function adjacentGoals(stationKey: string, mapId: MapId = "compact") {
  const [row, col] = stationPosition(mapId, stationKey);
  return DIRECTIONS.map(([dr, dc]) => ({ row: row + dr, col: col + dc })).filter((point) => isWalkable(point.row, point.col, mapId));
}
function shortestPath(start: Position, stationKey: string, blocked: Set<string>, mapId: MapId = "compact") {
  const goals = new Set(adjacentGoals(stationKey, mapId).map((point) => coord(point.row, point.col)));
  if (goals.has(coord(start.row, start.col))) return [] as Position[];
  const queue: { point: Position; path: Position[] }[] = [{ point: start, path: [] }];
  const visited = new Set([coord(start.row, start.col)]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const [dr, dc] of DIRECTIONS) {
      const next = { row: current.point.row + dr, col: current.point.col + dc };
      const key = coord(next.row, next.col);
      if (visited.has(key) || blocked.has(key) || !isWalkable(next.row, next.col, mapId)) continue;
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
  const station = layoutOf(game.mapId).stations[stationKey];
  robot.task = task;
  robot.target = station?.label ?? "工位";
  if (isAdjacent(robot, stationKey, game.mapId)) return true;
  const other = game.robots[robotId === 0 ? 1 : 0];
  const blocked = new Set([coord(other.row, other.col), ...reserved]);
  const path = shortestPath(robot, stationKey, blocked, game.mapId);
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
function positionToStationDistance(start: Position, stationKey: string, mapId: MapId = "compact") {
  if (isAdjacent(start, stationKey, mapId)) return 0;
  const path = shortestPath(start, stationKey, new Set(), mapId);
  return path.length || 99;
}
function stationToStationDistance(fromKey: string, toKey: string, mapId: MapId = "compact") {
  return Math.min(...adjacentGoals(fromKey, mapId).map((point) => positionToStationDistance(point, toKey, mapId)));
}
function assignmentCost(robot: Robot, ingredient: Ingredient, boardStation: BoardStation, potStation: string, mapId: MapId = "compact") {
  const source = ingredientStation(mapId, ingredient);
  return positionToStationDistance(robot, source, mapId)
    + stationToStationDistance(source, boardStation, mapId)
    + stationToStationDistance(boardStation, potStation, mapId);
}
function makeAssignedJobs(game: GameState, ingredients: [Ingredient, Ingredient], algorithm: AlgorithmId, potStation: string): [PrepJob, PrepJob] {
  const leftBoard = stationByLogicalKey(game.mapId, "left-cut"); const rightBoard = stationByLogicalKey(game.mapId, "right-cut");
  if (algorithm === "baseline") {
    return [
      { ingredient: ingredients[0], stage: "fetch", robotId: 0, boardKey: "left-cut", boardStation: leftBoard },
      { ingredient: ingredients[1], stage: "fetch", robotId: 1, boardKey: "right-cut", boardStation: rightBoard },
    ];
  }
  const ingredientOrders: [Ingredient, Ingredient][] = [ingredients, [ingredients[1], ingredients[0]]];
  const boardOrders: [[BoardKey, BoardStation], [BoardKey, BoardStation]][] = [
    [["left-cut", leftBoard], ["right-cut", rightBoard]],
    [["right-cut", rightBoard], ["left-cut", leftBoard]],
  ];
  let best: { cost: number; jobs: [PrepJob, PrepJob] } | null = null;
  for (const ingredientOrder of ingredientOrders) {
    for (const boardOrder of boardOrders) {
      const cost = assignmentCost(game.robots[0], ingredientOrder[0], boardOrder[0][1], potStation, game.mapId)
        + assignmentCost(game.robots[1], ingredientOrder[1], boardOrder[1][1], potStation, game.mapId);
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
  return RECIPES[recipe].estimated;
}
function projectedReward(order: Order, elapsed: number, combo = 0) {
  const slack = order.remaining - elapsed;
  return slack >= 0 ? 100 + slack * 3 + Math.min(combo, 4) * 25 : Math.max(20, 100 + slack * 5);
}
function orderTravelEstimate(game: GameState, order: Order, potStation = compatiblePotKeys(game.mapId, order.recipe)[0]?.potStation ?? stationByLogicalKey(game.mapId, "left-pot")) {
  const jobs = makeAssignedJobs(game, RECIPES[order.recipe].ingredients, "pipeline", potStation);
  return jobs.reduce((sum, job) => sum + assignmentCost(game.robots[job.robotId], job.ingredient, job.boardStation, potStation, game.mapId), 0);
}
function compareVectors(a: number[], b: number[]) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
function orderPriorityVector(game: GameState, order: Order, objective: ObjectiveId) {
  const duration = estimatedRecipeDuration(order.recipe);
  const tardiness = Math.max(0, duration - order.remaining);
  const reward = projectedReward(order, duration, game.combo);
  const travel = orderTravelEstimate(game, order);
  if (objective === "throughput") return [duration, tardiness, order.id];
  if (objective === "score") return [-reward / duration, tardiness, duration, order.id];
  if (objective === "tardiness") return [order.remaining - duration, tardiness, duration, order.id];
  if (objective === "travel") return [travel, tardiness, duration, order.id];
  return [tardiness > 0 ? 1 : 0, tardiness, -reward, duration, travel, order.id];
}
function exactWindowSequence(orders: Order[], objectiveId: ObjectiveId, previousRecipe: RecipeId | null = null) {
  let best: { vector: number[]; ids: string; sequence: Order[] } | null = null;
  for (const sequence of permutations(orders)) {
    let elapsed = 0;
    let tardiness = 0;
    let score = 0;
    let changes = 0;
    sequence.forEach((order, index) => {
      const priorRecipe = index > 0 ? sequence[index - 1].recipe : previousRecipe;
      const changeover = priorRecipe && priorRecipe !== order.recipe ? 2 : 0;
      if (changeover) changes += 1;
      elapsed += estimatedRecipeDuration(order.recipe) + changeover;
      tardiness += Math.max(0, elapsed - order.remaining);
      score += projectedReward(order, elapsed, index);
    });
    const lateOrders = sequence.filter((order, index) => {
      const completion = sequence.slice(0, index + 1).reduce((sum, item, position) => {
        const prior = position > 0 ? sequence[position - 1].recipe : previousRecipe;
        return sum + estimatedRecipeDuration(item.recipe) + (prior && prior !== item.recipe ? 2 : 0);
      }, 0);
      return completion > order.remaining;
    }).length;
    const vector = objectiveId === "throughput" ? [elapsed, lateOrders, tardiness]
      : objectiveId === "score" ? [-score, tardiness, elapsed]
        : objectiveId === "tardiness" ? [tardiness, lateOrders, elapsed]
          : objectiveId === "travel" ? [changes, elapsed, tardiness]
            : [lateOrders, tardiness, -score, elapsed, changes];
    const ids = sequence.map((order) => String(order.id).padStart(4, "0")).join("-");
    const comparison = best ? compareVectors(vector, best.vector) : -1;
    if (!best || comparison < 0 || (comparison === 0 && ids < best.ids)) best = { vector, ids, sequence };
  }
  return best?.sequence ?? [];
}
function selectOrder(game: GameState, algorithm: AlgorithmId, objective: ObjectiveId, excluded = new Set<number>()) {
  const available = game.orders.filter((order) => !excluded.has(order.id));
  if (!available.length) return null;
  if (game.prefetch && !excluded.has(game.prefetch.orderId)) {
    const committed = available.find((order) => order.id === game.prefetch?.orderId);
    if (committed) return committed;
  }
  return [...available].sort((a, b) => compareVectors(orderPriorityVector(game, a, objective), orderPriorityVector(game, b, objective)))[0];
}
function startCycle(game: GameState, algorithm: AlgorithmId, objective: ObjectiveId) {
  const selected = selectOrder(game, algorithm, objective);
  if (!selected) return;
  const ingredients = RECIPES[selected.recipe].ingredients;
  const staged = game.prefetch?.orderId === selected.id ? game.prefetch : null;
  const processingResource = compatiblePotKeys(game.mapId, selected.recipe)[0] ?? { potKey: "left-pot" as const, potStation: stationByLogicalKey(game.mapId, "left-pot") };
  const potKey = processingResource.potKey;
  const potStation = processingResource.potStation;
  let jobs: [PrepJob, PrepJob];
  if (staged) {
    const remaining = [...ingredients];
    remaining.splice(remaining.indexOf(staged.ingredient), 1);
    const resumedStage: JobStage = staged.stage === "staged" ? "buffer" : staged.stage === "counter" ? "pot" : staged.stage;
    const otherId = (staged.robotId === 0 ? 1 : 0) as 0 | 1;
    const otherBoardKey: BoardKey = staged.boardKey === "left-cut" ? "right-cut" : "left-cut";
    const otherBoardStation: BoardStation = stationByLogicalKey(game.mapId, otherBoardKey);
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
    game.decision = `按${OBJECTIVES[objective].label}目标选择 #${selected.id} ${RECIPES[selected.recipe].shortName}；两份原料并行处理。`;
  }
  const robotJobs = [...jobs].sort((a, b) => a.robotId - b.robotId);
  game.message = `策略 ${ALGORITHMS[algorithm].code} 规划 #${selected.id}：阿橙负责${ingredientName(robotJobs[0].ingredient)}，小青负责${ingredientName(robotJobs[1].ingredient)}。`;
}
function startPrefetch(game: GameState, algorithm: AlgorithmId, objective: ObjectiveId) {
  if (!game.cycle || game.prefetch || algorithm === "baseline") return;
  const selected = selectOrder(game, algorithm, objective, new Set([game.cycle.orderId]));
  if (!selected) return;
  const ingredients = RECIPES[selected.recipe].ingredients;
  const prefetcherId = game.cycle.prefetcherId;
  const boardKey: BoardKey = prefetcherId === 0 ? "left-cut" : "right-cut";
  const boardStation: BoardStation = stationByLogicalKey(game.mapId, boardKey);
  const targetProcess = compatiblePotKeys(game.mapId, selected.recipe)[0]?.potStation ?? stationByLogicalKey(game.mapId, "left-pot");
  const ingredient = [...ingredients].sort((a, b) => assignmentCost(game.robots[prefetcherId], a, boardStation, targetProcess, game.mapId) - assignmentCost(game.robots[prefetcherId], b, boardStation, targetProcess, game.mapId))[0];
  game.prefetch = { orderId: selected.id, ingredient, stage: "fetch", robotId: prefetcherId, boardKey, boardStation, counterKey: "pass-top" };
  game.decision = `策略 ${ALGORITHMS[algorithm].code} 在烹饪窗口预取 #${selected.id} 的${ingredientName(ingredient)}。`;
}
function advancePrefetch(game: GameState, reserved: Set<string>) {
  const prefetch = game.prefetch;
  if (!prefetch) return;
  const robot = game.robots[prefetch.robotId];
  const sourceStation = ingredientStation(game.mapId, prefetch.ingredient);
  if (prefetch.stage === "fetch") {
    if (advanceTo(game, prefetch.robotId, sourceStation, `预取下一单${ingredientName(prefetch.ingredient)}`, reserved)) {
      robot.carrying = { kind: "raw", ingredient: prefetch.ingredient };
      prefetch.stage = "cut";
    }
  } else if (prefetch.stage === "cut") {
    if (advanceTo(game, prefetch.robotId, prefetch.boardStation, `提前切配${ingredientName(prefetch.ingredient)}`, reserved)) {
      const board = game.cutBoards[prefetch.boardKey];
      if (!board && robot.carrying?.kind === "raw") {
        const recipe = game.orders.find((order) => order.id === prefetch.orderId)?.recipe ?? "tomato-soup";
        game.cutBoards[prefetch.boardKey] = { ingredient: prefetch.ingredient, progress: 0, required: RECIPES[recipe].cutActions };
        robot.carrying = null;
      } else if (board && board.progress < board.required) {
        board.progress += 1;
      } else if (board && board.progress === board.required && !robot.carrying) {
        robot.carrying = { kind: "chopped", ingredient: prefetch.ingredient };
        game.cutBoards[prefetch.boardKey] = null;
        prefetch.stage = "counter";
      }
    }
  } else if (prefetch.stage === "counter") {
    if (advanceTo(game, prefetch.robotId, stationByLogicalKey(game.mapId, "pass-top"), "将下一单原料存入缓冲台", reserved)) {
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
function smartOrder(game: GameState, excluded: Set<number>, objective: ObjectiveId) {
  const available = game.orders.filter((order) => !excluded.has(order.id));
  return exactWindowSequence(available, objective, game.lastRecipe)[0] ?? null;
}
function ensureSmartPlans(game: GameState, objective: ObjectiveId) {
  const occupiedPots = new Set(game.smartPlans.filter((plan) => plan.phase !== "serve").map((plan) => plan.potKey));
  const activeOrders = new Set(game.smartPlans.map((plan) => plan.orderId));
  while (occupiedPots.size < 2) {
    const stagedOrder = game.prefetch?.stage === "staged"
      ? game.orders.find((order) => order.id === game.prefetch?.orderId && !activeOrders.has(order.id)) ?? null
      : null;
    const excluded = new Set(activeOrders);
    if (game.prefetch && game.prefetch.stage !== "staged") excluded.add(game.prefetch.orderId);
    const orderedCandidates = exactWindowSequence(game.orders.filter((order) => !excluded.has(order.id)), objective, game.lastRecipe);
    const selected = stagedOrder && compatiblePotKeys(game.mapId, stagedOrder.recipe).some((resource) => !occupiedPots.has(resource.potKey))
      ? stagedOrder
      : orderedCandidates.find((order) => compatiblePotKeys(game.mapId, order.recipe).some((resource) => !occupiedPots.has(resource.potKey))) ?? null;
    if (!selected) break;
    const resource = compatiblePotKeys(game.mapId, selected.recipe).find((candidate) => !occupiedPots.has(candidate.potKey));
    if (!resource) break;
    const { potKey, potStation } = resource;
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
function assignSmartJobs(game: GameState, objective: ObjectiveId) {
  for (const robotId of [0, 1] as const) {
    if (smartRobotBusy(game, robotId)) continue;
    const activePlans = new Set(game.smartPlans.flatMap((plan) => plan.jobs.filter((job) => job.robotId !== null && job.stage !== "loaded").map(() => plan.orderId)));
    const candidates = game.smartPlans.flatMap((plan) => plan.phase === "prep"
      ? plan.jobs.filter((job) => job.robotId === null && job.stage !== "loaded").map((job) => ({ plan, job }))
      : []);
    candidates.sort((a, b) => {
      const aOrder = game.orders.find((order) => order.id === a.plan.orderId);
      const bOrder = game.orders.find((order) => order.id === b.plan.orderId);
      const aStation = a.job.stage === "buffer" ? stationByLogicalKey(game.mapId, "pass-top") : ingredientStation(game.mapId, a.job.ingredient);
      const bStation = b.job.stage === "buffer" ? stationByLogicalKey(game.mapId, "pass-top") : ingredientStation(game.mapId, b.job.ingredient);
      const distanceWeight = objective === "travel" ? 2 : 1;
      const urgencyWeight = objective === "tardiness" ? .12 : objective === "score" ? .07 : .04;
      const durationWeight = objective === "throughput" ? .08 : 0;
      const aScore = positionToStationDistance(game.robots[robotId], aStation, game.mapId) * distanceWeight + (activePlans.has(a.plan.orderId) ? 14 : 0) + (aOrder?.remaining ?? 0) * urgencyWeight + estimatedRecipeDuration(a.plan.recipe) * durationWeight;
      const bScore = positionToStationDistance(game.robots[robotId], bStation, game.mapId) * distanceWeight + (activePlans.has(b.plan.orderId) ? 14 : 0) + (bOrder?.remaining ?? 0) * urgencyWeight + estimatedRecipeDuration(b.plan.recipe) * durationWeight;
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
  game.message = `双设备订单 #${plan.orderId} 交付，+${earned} 分；空闲设备立即接续新订单。`;
  game.decision = "释放机器人与加工设备，重新计算订单、距离和工位占用。";
}
function startSmartPrefetch(game: GameState, robotId: 0 | 1, objective: ObjectiveId) {
  if (game.prefetch || game.counters["pass-top"]) return;
  const excluded = new Set(game.smartPlans.map((plan) => plan.orderId));
  const selected = smartOrder(game, excluded, objective);
  if (!selected) return;
  const boardKey: BoardKey = robotId === 0 ? "left-cut" : "right-cut";
  const boardStation: BoardStation = stationByLogicalKey(game.mapId, boardKey);
  const processStation = compatiblePotKeys(game.mapId, selected.recipe)[0]?.potStation ?? stationByLogicalKey(game.mapId, "left-pot");
  const ingredient = [...RECIPES[selected.recipe].ingredients].sort((a, b) => assignmentCost(game.robots[robotId], a, boardStation, processStation, game.mapId) - assignmentCost(game.robots[robotId], b, boardStation, processStation, game.mapId))[0];
  game.prefetch = { orderId: selected.id, ingredient, stage: "fetch", robotId, boardKey, boardStation, counterKey: "pass-top" };
  game.decision = `双设备加工期间，${game.robots[robotId].name}机会性准备 #${selected.id} 的${ingredientName(ingredient)}。`;
}
function smartStep(previous: GameState, difficulty: Difficulty, objective: ObjectiveId) {
  const game = cloneGame(previous);
  ensureSmartPlans(game, objective);
  const reserved = new Set<string>();
  const acted = new Set<0 | 1>();

  for (const plan of game.smartPlans) {
    const pot = game.pots[plan.potKey];
    if (plan.phase === "prep" && plan.jobs.every((job) => job.stage === "loaded")) {
      pot.recipe = plan.recipe;
      pot.cookLeft = RECIPES[plan.recipe].processTime[difficulty];
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
      const arrived = advanceTo(game, serverId, stationByType(game.mapId, "serve"), `交付 #${plan.orderId}`, reserved);
      acted.add(serverId);
      if (arrived) finishSmartDelivery(game, plan, serverId, difficulty);
    }
  }

  for (const plan of game.smartPlans) {
    const serverId = plan.serverId;
    if (serverId === null || acted.has(serverId) || plan.phase === "serve") continue;
    const robot = game.robots[serverId];
    if (!robot.carrying && !plan.plateStaged) {
      const arrived = advanceTo(game, serverId, stationByType(game.mapId, "plates"), `为 #${plan.orderId} 提前取盘`, reserved);
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
    const pickupStation = plan.plateStaged ? plan.potStation : stationByType(game.mapId, "plates");
    const free = ([0, 1] as const).filter((id) => !acted.has(id) && !smartRobotBusy(game, id));
    free.sort((a, b) => positionToStationDistance(game.robots[a], pickupStation, game.mapId) - positionToStationDistance(game.robots[b], pickupStation, game.mapId));
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

  assignSmartJobs(game, objective);
  for (const robotId of [0, 1] as const) {
    if (acted.has(robotId)) continue;
    const assignment = smartJobForRobot(game, robotId);
    if (!assignment) continue;
    const { plan, job } = assignment;
    const robot = game.robots[robotId];
    if (job.stage === "fetch") {
      const station = ingredientStation(game.mapId, job.ingredient);
      const arrived = advanceTo(game, robotId, station, `为 #${plan.orderId} 取${ingredientName(job.ingredient)}`, reserved);
      acted.add(robotId);
      if (arrived) { robot.carrying = { kind: "raw", ingredient: job.ingredient }; job.stage = "cut"; }
    } else if (job.stage === "buffer") {
      const arrived = advanceTo(game, robotId, stationByLogicalKey(game.mapId, "pass-top"), `领取 #${plan.orderId} 预备原料`, reserved);
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
        const boards = ([ ["left-cut", stationByLogicalKey(game.mapId, "left-cut")], ["right-cut", stationByLogicalKey(game.mapId, "right-cut")] ] as const)
          .filter(([key]) => !occupied.has(key) && !game.cutBoards[key])
          .sort((a, b) => positionToStationDistance(robot, a[1], game.mapId) - positionToStationDistance(robot, b[1], game.mapId));
        if (boards[0]) { job.boardKey = boards[0][0]; job.boardStation = boards[0][1]; }
      }
      if (job.boardKey && job.boardStation) {
        const arrived = advanceTo(game, robotId, job.boardStation, `切配 #${plan.orderId} ${ingredientName(job.ingredient)}`, reserved);
        acted.add(robotId);
        if (arrived) {
          const board = game.cutBoards[job.boardKey];
          if (!board && robot.carrying?.kind === "raw") { game.cutBoards[job.boardKey] = { ingredient: job.ingredient, progress: 0, required: RECIPES[plan.recipe].cutActions }; robot.carrying = null; }
          else if (board && board.progress < board.required) board.progress += 1;
          else if (board && board.progress === board.required && !robot.carrying) { robot.carrying = { kind: "chopped", ingredient: job.ingredient }; game.cutBoards[job.boardKey] = null; job.stage = "pot"; }
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
    if (free !== undefined) startSmartPrefetch(game, free, objective);
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
  game.decision = `滚动双设备策略同时管理 ${runningPots} 道在制订单；优先前置空盘、释放机器人并填满兼容设备。`;
  return game;
}
function autoStep(previous: GameState, difficulty: Difficulty, algorithm: AlgorithmId = "baseline", objective: ObjectiveId = "balanced") {
  if (!previous.running || previous.paused || previous.ended) return previous;
  if (algorithm === "dual") return smartStep(previous, difficulty, objective);
  const game = cloneGame(previous);
  if (!game.cycle) startCycle(game, algorithm, objective);
  const cycle = game.cycle;
  if (!cycle) return game;
  const reserved = new Set<string>();
  if (cycle.phase === "prep") {
    for (const id of [0, 1] as const) {
      const robot = game.robots[id];
      const job = cycle.jobs.find((candidate) => candidate.robotId === id)!;
      const sourceStation = ingredientStation(game.mapId, job.ingredient);
      if (job.stage === "fetch") {
        if (advanceTo(game, id, sourceStation, `前往取${ingredientName(job.ingredient)}`, reserved)) {
          robot.carrying = { kind: "raw", ingredient: job.ingredient }; job.stage = "cut";
          game.message = `${robot.name} 已取${ingredientName(job.ingredient)}，前往专属切配台。`;
        }
      } else if (job.stage === "cut") {
        if (advanceTo(game, id, job.boardStation, `切配${ingredientName(job.ingredient)}`, reserved)) {
          const board = game.cutBoards[job.boardKey];
          if (!board && robot.carrying?.kind === "raw") {
            game.cutBoards[job.boardKey] = { ingredient: job.ingredient, progress: 0, required: RECIPES[cycle.recipe].cutActions }; robot.carrying = null;
          } else if (board && board.progress < board.required) {
            board.progress += 1;
            game.message = `${robot.name} 切配进度 ${board.progress}/${board.required}。`;
          } else if (board && board.progress === board.required && !robot.carrying) {
            robot.carrying = { kind: "chopped", ingredient: job.ingredient }; game.cutBoards[job.boardKey] = null; job.stage = "pot";
          }
        }
      } else if (job.stage === "buffer") {
        if (advanceTo(game, id, stationByLogicalKey(game.mapId, "pass-top"), "领取提前备好的原料", reserved)) {
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
        if (advanceTo(game, id, stationByLogicalKey(game.mapId, "pass-top"), "原料已送达，前往待命区避让", reserved)) {
          robot.task = "待命并保持灶台通道畅通";
          robot.target = "中央待命区";
          game.metrics.idle += 1;
        }
      }
    }
    if (cycle.jobs.every((job) => job.stage === "loaded")) {
      const pot = game.pots[cycle.potKey]; pot.recipe = cycle.recipe; pot.cookLeft = RECIPES[cycle.recipe].processTime[difficulty]; pot.ready = false;
      if (algorithm === "pipeline") {
        const plates = stationByType(game.mapId, "plates"); const serve = stationByType(game.mapId, "serve");
        const serviceCosts = ([0, 1] as const).map((id) => ({
          id,
          cost: positionToStationDistance(game.robots[id], plates, game.mapId)
            + stationToStationDistance(plates, cycle.potStation, game.mapId)
            + stationToStationDistance(cycle.potStation, serve, game.mapId),
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
      if (advanceTo(game, 0, stationByLogicalKey(game.mapId, "pass-top"), "远程监控锅具并清空入口", reserved)) {
        game.robots[0].task = "远程监控锅具";
        game.robots[0].target = "中央待命区";
        game.metrics.idle += 1;
      }
    } else {
      startPrefetch(game, algorithm, objective);
      advancePrefetch(game, reserved);
    }
    if (!assistant.carrying) {
      if (advanceTo(game, cycle.serverId, stationByType(game.mapId, "plates"), "提前领取空盘", reserved)) assistant.carrying = { kind: "plate" };
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
      startPrefetch(game, algorithm, objective);
      advancePrefetch(game, reserved);
    }
    if (advanceTo(game, cycle.serverId, stationByType(game.mapId, "serve"), "运送成品至交付口", reserved) && server.carrying?.kind === "dish") finishDelivery(game, server.carrying.recipe, difficulty, cycle.orderId);
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
type ExperimentBatch = { duration: number; difficulty: Difficulty; objective: ObjectiveId; mapId: MapId; language: Language; createdAt: string; results: ExperimentResult[] };
function runSimulation(algorithm: AlgorithmId, difficulty: Difficulty, duration: number, objective: ObjectiveId = "balanced", mapId: MapId = "compact"): ExperimentResult {
  let game = createInitialState(difficulty, true, duration, mapId);
  for (let step = 1; step <= duration * 2 && !game.ended; step += 1) {
    game = autoStep(game, difficulty, algorithm, objective);
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
  const ranked = [...batch.results].sort((a, b) => compareResults(a, b, batch.objective));
  const english = batch.language === "en";
  const kitchen = KITCHENS[batch.mapId];
  const rows = ranked.map((result, index) => `| ${index + 1} | ${ALGORITHMS[result.algorithm].code} | ${english ? ALGORITHMS[result.algorithm].nameEn : ALGORITHMS[result.algorithm].name} | ${result.delivered} | ${result.score} | ${result.tardiness} | ${result.travel} | ${result.idle} | ${result.conflicts} | ${result.replans} | ${result.sequence || "—"} |`).join("\n");
  const policyNotes = ranked.map((result) => `### ${english ? "Policy" : "策略"} ${ALGORITHMS[result.algorithm].code} · ${english ? ALGORITHMS[result.algorithm].nameEn : ALGORITHMS[result.algorithm].name}\n\n${english ? ALGORITHMS[result.algorithm].noteEn : ALGORITHMS[result.algorithm].note}`).join("\n\n");
  if (english) return `# Robo Kitchen Experiment Report\n\n- Generated: ${batch.createdAt}\n- Kitchen: ${kitchen.nameEn} (${kitchen.rows} × ${kitchen.cols} grid; ${kitchen.footprint})\n- Simulation horizon: ${batch.duration} seconds\n- Order pressure: ${batch.difficulty === "training" ? "Standard" : "Rush"}\n- Active scheduling objective: ${OBJECTIVES[batch.objective].labelEn} (${OBJECTIVES[batch.objective].directionEn})\n- Decision frequency: 2 decisions per simulated second\n- Initial condition: identical selected layout, robot positions, and deterministic order stream\n\n> This report is generated on demand. Playback speed changes wall-clock playback only, not the simulation decision budget.\n\n## Model specification\n\n- Sets: robots R={A,B}; active orders O_t; scenario-specific walkable cells V_s and edges E_s; processing resources K.\n- Parameters: scenario s=${batch.mapId}; horizon H=${batch.duration}; order allowance D_i=${batch.difficulty === "training" ? 70 : 46} s; recipe-specific cutting work and processing times.\n- Recipe DAGs: salad = chop → mix; soup = chop → simmer; skillet = prep → grill. Each processing job requires compatible equipment.\n- Throughput: Q = Σ_i y_i. Total tardiness: T = Σ_i y_i max(0, C_i-d_i). Travel: M = Σ_{r,t} ||p_{r,t+1}-p_{r,t}||_1.\n- Balanced objective: lex max (Q, -T, S, -M), compared in order without a weighted sum.\n- Constraints: four-direction movement and collision avoidance; one task per robot per step; one order per processing resource; recipe precedence and equipment compatibility.\n\n> The selected objective guides live order priority, rolling-window sequencing, and robot assignment, and also ranks results. Policies A/B/C are transparent online heuristics, not a retrained model or global mathematical program.\n\n## Scoring rule\n\n- On-time delivery: 100 + 3 × seconds remaining + combo bonus (+25 per order, capped at +100).\n- Late delivery: max(20, 100 − 5 × late seconds); lateness resets the combo.\n\n| Rank | Policy | Method | Done | Score | Late (s) | Travel | Idle | Yields | Replans | Delivery order |\n| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n## Policy notes\n\n${policyNotes}\n\n## Scaling roadmap\n\nV7 provides three validated layouts and three recipe workflows. Next: scale R={1,…,m} with resource capacity and collision constraints, then add seeded scenario generation.\n\n---\nRobo Kitchen · Noncommercial teaching and research project\n`;
  return `# Robo Kitchen 实验报告\n\n- 生成时间：${batch.createdAt}\n- 厨房场景：${kitchen.name}（${kitchen.rows} × ${kitchen.cols} 网格；${kitchen.footprint}）\n- 仿真时长：${batch.duration} 秒\n- 订单压力：${batch.difficulty === "training" ? "标准压力" : "高峰压力"}\n- 当前调度目标：${OBJECTIVES[batch.objective].label}（${OBJECTIVES[batch.objective].direction}）\n- 决策频率：2 次 / 仿真秒\n- 初始条件：相同所选布局、机器人位置与确定性订单队列\n\n> 本报告按当前参数即时运行生成。速度按钮只改变播放速度，不改变仿真决策预算。\n\n## 模型口径\n\n- 集合：机器人 R={A,B}；动态订单 O_t；场景对应的可行走格点 V_s 与边 E_s；加工资源 K。\n- 关键参数：场景 s=${batch.mapId}；时长 H=${batch.duration}；订单时限 D_i=${batch.difficulty === "training" ? 70 : 46} 秒；切配工作量与加工时间由菜谱决定。\n- 菜谱工序图：沙拉为切配→混合，汤品为切配→炖煮，煎制主菜为备料→煎制；任务只能分配给能力兼容的设备。\n- 完成量 Q=Σ_i y_i；累计逾期 T=Σ_i y_i max(0,C_i-d_i)；移动量 M=Σ_{r,t}||p_{r,t+1}-p_{r,t}||_1。\n- 综合目标：lex max (Q, -T, S, -M)，依次比较，不做加权求和。\n- 约束：四方向移动与避碰；每台机器人每步一个任务；每个加工设备最多一个订单；满足工序先后与设备兼容。\n\n> 所选目标会同时引导实时订单优先级、滚动窗口排序和机器人任务分配，并用于结果排名。A/B/C 是透明在线启发式，不重新训练模型，也不求解全局数学规划。\n\n## 积分规则\n\n- 准时交付：100 + 剩余秒数 × 3 + 连续准时奖励（每单 +25，最高 +100）。\n- 逾期交付：max(20, 100 − 逾期秒数 × 5)，并中断连续准时奖励。\n\n| 排名 | 策略 | 方法 | 完成 | 得分 | 逾期(s) | 移动(格) | 空闲步 | 避让 | 调度 | 交付顺序 |\n| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n## 策略说明\n\n${policyNotes}\n\n## 扩展路线\n\nV7 已提供三种经可达性验证的布局与三条菜谱工序。下一步扩展 R={1,…,m}，同步处理设备容量与避碰，再加入带随机种子的场景生成。\n\n---\nRobo Kitchen · 非商用教学与研究项目\n`;
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

function ModelView({ language }: { language: Language }) {
  if (language === "en") return (
    <section className="model-view" aria-labelledby="model-title">
      <header className="model-hero">
        <div><p className="section-kicker">MODEL &amp; POLICY</p><h2 id="model-title">From kitchen animation to online scheduling</h2><p>At every decision step, the system reads orders, robots, and workstation states, then chooses which order to process, who performs each job, which resource to use, and where to move next. The selected objective actively guides these online priorities.</p></div>
        <span className="model-badge">Heuristic simulation · not a global optimizer</span>
        <div className="model-facts" aria-label="Model summary"><span><b>3</b> layouts</span><span><b>3</b> recipe DAGs</span><span><b>2</b> robots</span><span><b>2</b> processing resources</span><span><b>2</b> decisions / second</span></div>
      </header>
      <div className="model-section-grid">
        <article className="model-card"><div className="model-card-heading"><i>1</i><div><span>SETS</span><h3>Sets</h3></div></div><dl className="definition-list"><div><dt>𝒮</dt><dd>Kitchen scenarios {"{compact, U-shape, zoned}"}</dd></div><div><dt>R</dt><dd>Robot set {"{A, B}"}</dd></div><div><dt>O / O<sub>t</sub></dt><dd>Released orders / three active orders at time t</dd></div><div><dt>V<sub>s</sub>, E<sub>s</sub></dt><dd>Scenario-specific walkable cells and four-neighbour edges</dd></div><div><dt>K, G<sub>i</sub></dt><dd>Equipment resources / recipe precedence DAG for order i</dd></div></dl></article>
        <article className="model-card"><div className="model-card-heading"><i>2</i><div><span>PARAMETERS</span><h3>Parameters</h3></div></div><dl className="definition-list"><div><dt>H</dt><dd>Experiment horizon, 30–600 seconds</dd></div><div><dt>D<sub>i</sub></dt><dd>Order allowance: 70 s standard; 46 s rush</dd></div><div><dt>τ<sub>ij</sub></dt><dd>Recipe-specific prep and processing time</dd></div><div><dt>a<sub>jk</sub></dt><dd>1 when equipment k can execute operation j</dd></div><div><dt>δ<sub>s</sub>(p,k)</dt><dd>BFS distance under scenario s</dd></div></dl></article>
        <article className="model-card wide"><div className="model-card-heading"><i>3</i><div><span>ONLINE DECISIONS &amp; STATE</span><h3>Online decisions and state</h3></div></div><div className="variable-grid"><div><code>p<sub>rt</sub></code><p>Grid position of robot r at decision step t.</p><small>UI: robot position</small></div><div><code>x<sub>rijt</sub></code><p>1 if robot r performs job j of order i at t.</p><small>Code: job.robotId</small></div><div><code>z<sub>ikt</sub></code><p>1 if order i occupies processing resource k at t.</p><small>Code: plan.potKey</small></div><div><code>u<sub>ijt</sub></code><p>Job stage: fetch, prep, process, or loaded.</p><small>Code: job.stage</small></div><div><code>y<sub>i</sub></code><p>1 if order i is delivered within horizon H.</p><small>UI: completed orders</small></div><div><code>C<sub>i</sub></code><p>Delivery time used for punctuality, tardiness, and score.</p><small>UI: tardiness / team score</small></div></div><p className="model-clarifier">These symbols describe the online decisions implemented by the page. They are not a static variable set submitted to a MILP solver.</p></article>
      </div>
      <article className="model-card constraints-card"><div className="model-card-heading"><i>4</i><div><span>CONSTRAINTS</span><h3>Core constraints</h3></div></div><div className="constraint-grid"><div><b>Grid movement and collision avoidance</b><div className="formula-line">p<sub>r,t+1</sub> ∈ N<sub>s</sub>(p<sub>rt</sub>) ∪ {"{"}p<sub>rt</sub>{"}"}<br/>p<sub>At</sub> ≠ p<sub>Bt</sub></div><p>No diagonal moves, walls, or workstation cells. Target cells are reserved each step to prevent collisions.</p></div><div><b>Robot and resource capacity</b><div className="formula-line">∑<sub>i,j</sub> x<sub>rijt</sub> ≤ 1<br/>∑<sub>i</sub> z<sub>ikt</sub> ≤ 1</div><p>Each robot carries at most one item; each resource processes at most one order.</p></div><div><b>Precedence and compatibility</b><div className="formula-line sequence-formula">j ≺<sub>Gᵢ</sub> j′ · z<sub>ikt</sub> ≤ a<sub>jk</sub></div><p>Salad mixes, soup simmers, and the skillet dish grills; every processing job uses compatible equipment.</p></div><div><b>Order timing</b><div className="formula-line">L<sub>i</sub> = max(0, C<sub>i</sub> − d<sub>i</sub>)<br/>d<sub>i</sub> = r<sub>i</sub> + D<sub>i</sub></div><p>A replacement order is released immediately after delivery, keeping three active orders.</p></div></div></article>
      <article className="model-card objectives-card"><div className="model-card-heading"><i>5</i><div><span>OBJECTIVES</span><h3>Scheduling objectives and score</h3></div></div><p className="model-intro">The objective is a live scheduling parameter. It changes order sequencing and robot-job priorities in every policy; the experiment then runs all policies under that same objective and ranks their resulting metrics.</p><div className="objective-formulas"><div><span>Throughput</span><div className="formula-line">Q = ∑<sub>i∈O</sub> y<sub>i</sub></div><small>maximize</small></div><div><span>Total tardiness</span><div className="formula-line">T = ∑<sub>i∈O</sub> y<sub>i</sub>L<sub>i</sub></div><small>minimize</small></div><div><span>Travel</span><div className="formula-line">M = ∑<sub>r,t</sub> ‖p<sub>r,t+1</sub>−p<sub>rt</sub>‖<sub>1</sub></div><small>minimize</small></div><div><span>Balanced</span><div className="formula-line">lex max (Q, −T, S, −M)</div><small>ordered comparison, no weighted sum</small></div></div><details className="formula-details" open><summary>Score function S = ∑ g<sub>i</sub></summary><div className="score-formula"><div><b>On time</b><span>g<sub>i</sub> = 100 + 3(d<sub>i</sub>−C<sub>i</sub>) + 25 min(k<sub>i</sub>−1, 4)</span></div><div><b>Late</b><span>g<sub>i</sub> = max(20, 100 − 5L<sub>i</sub>)</span></div></div><p>kᵢ is the consecutive on-time delivery count. Each on-time order adds 25 combo points up to 100; a late order resets the combo.</p></details></article>
      <article className="model-card policy-card"><div className="model-card-heading"><i>6</i><div><span>ROUTING &amp; POLICIES</span><h3>Routing and three policies</h3></div></div><div className="policy-flow"><section><header><i>0</i><div><b>Shared routing layer</b><span>BFS shortest feasible path</span></div></header><p>All policies use the selected scenario's four-neighbour graph. A robot advances one cell per decision step.</p><details className="formula-details"><summary>Path formula</summary><div className="formula-line">δ<sub>s</sub>(p,k) = min<sub>P∈𝒫<sub>s</sub>(p,N(k))</sub> |P|</div></details></section><section><header><i>A</i><div><b>Sequential baseline</b><span>One order at a time</span></div></header><p>The selected objective determines the next order; robot and cutting-board roles remain fixed until delivery.</p><details className="formula-details"><summary>Objective-guided priority</summary><div className="formula-line compact-formula">i* = arg min<sub>i∈O<sub>t</sub></sub> v<sub>f</sub>(i)</div></details></section><section><header><i>B</i><div><b>Pipeline auction</b><span>Single-resource assignment</span></div></header><p>Enumerates ingredient and board assignments and prepares one future ingredient during processing.</p><details className="formula-details"><summary>Assignment cost</summary><div className="formula-line compact-formula">c(r,g,b,k)=δ<sub>s</sub>(p<sub>r</sub>,s<sub>g</sub>)+δ<sub>s</sub>(s<sub>g</sub>,b)+δ<sub>s</sub>(b,k)</div></details></section><section><header><i>C</i><div><b>Rolling resource scheduling</b><span>Compatibility-aware heuristic</span></div></header><p>Enumerates the active order window, matches recipes to compatible resources, stages plates, and dynamically assigns free robots.</p><details className="formula-details"><summary>Rolling sequence</summary><div className="formula-line compact-formula">π* = arg min<sub>π∈Π(O<sub>t</sub>)</sub> V<sub>f</sub>(π)</div></details><details className="formula-details"><summary>Robot-job score</summary><div className="formula-line compact-formula">h<sub>f</sub>(r,i,j)=w<sub>d,f</sub>δ<sub>s</sub>(p<sub>r</sub>,s<sub>j</sub>)+14I<sub>active(i)</sub>+w<sub>q,f</sub>q<sub>i</sub>+w<sub>p,f</sub>τ̂<sub>i</sub></div></details></section></div></article>
      <article className="model-card roadmap-card"><div className="model-card-heading"><i>7</i><div><span>SCALING ROADMAP</span><h3>Next model extensions</h3></div></div><div className="constraint-grid"><div><b>Layouts · V7 complete</b><p>Three reachable layouts represent compact, U-shaped, and zoned kitchen archetypes.</p></div><div><b>Recipe DAGs · V7 complete</b><p>Three workflows vary ingredients, work content, processing times, and equipment requirements.</p></div><div><b>Scalable robot fleet · next</b><p>Replace the fixed pair with R={"{"}1,…,m{"}"} and expand collision, carrying, and resource-capacity constraints.</p></div><div><b>Seeded generator · later</b><p>Store seeds and scenario files so generated experiments remain reproducible.</p></div></div></article>
      <aside className="model-boundary"><b>Model boundary</b><p>V7 is a parameterized real-kitchen abstraction: its footprints and equipment capabilities are interpretable, but it is not calibrated to a specific physical site or robot. A/B/C are deterministic online heuristics, not global optimizers.</p></aside>
    </section>
  );
  return (
    <section className="model-view" aria-labelledby="model-title">
      <header className="model-hero">
        <div>
          <p className="section-kicker">MODEL &amp; POLICY</p>
          <h2 id="model-title">从厨房动画到在线调度模型</h2>
          <p>系统每个决策步读取订单、机器人和工位状态，再决定“做哪一单、谁去做、使用哪个工位、下一步走到哪里”。所选目标会直接引导这些在线优先级，A/B/C 是三种不同复杂度的启发式策略。</p>
        </div>
        <span className="model-badge">启发式仿真 · 非全局优化器</span>
        <div className="model-facts" aria-label="模型摘要">
          <span><b>3</b> 种布局</span><span><b>3</b> 条菜谱工序</span><span><b>2</b> 台机器人</span><span><b>2</b> 个加工资源</span><span><b>2</b> 次决策 / 秒</span>
        </div>
      </header>

      <div className="model-section-grid">
        <article className="model-card">
          <div className="model-card-heading"><i>1</i><div><span>SETS</span><h3>集合</h3></div></div>
          <dl className="definition-list">
            <div><dt>𝒮</dt><dd>厨房场景集合 {"{紧凑、U 形、分区}"}</dd></div>
            <div><dt>R</dt><dd>机器人集合 {"{A, B}"}</dd></div>
            <div><dt>O / O<sub>t</sub></dt><dd>实验内释放的全部订单 / 时刻 t 的 3 个在队订单</dd></div>
            <div><dt>V<sub>s</sub>, E<sub>s</sub></dt><dd>场景 s 的可行走格点与四邻接边</dd></div>
            <div><dt>K, G<sub>i</sub></dt><dd>加工设备集合 / 订单 i 的菜谱工序图</dd></div>
          </dl>
        </article>

        <article className="model-card">
          <div className="model-card-heading"><i>2</i><div><span>PARAMETERS</span><h3>参数</h3></div></div>
          <dl className="definition-list">
            <div><dt>H</dt><dd>实验时长，30–600 秒</dd></div>
            <div><dt>D<sub>i</sub></dt><dd>订单时限：标准 70 秒；高峰 46 秒</dd></div>
            <div><dt>τ<sub>ij</sub></dt><dd>菜谱对应的切配工作量与加工时间</dd></div>
            <div><dt>a<sub>jk</sub></dt><dd>设备 k 能执行工序 j 时为 1</dd></div>
            <div><dt>δ<sub>s</sub>(p,k)</dt><dd>场景 s 中位置 p 到工位 k 的 BFS 距离</dd></div>
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
          <div><b>机器人与设备容量</b><div className="formula-line" aria-label="每台机器人每步至多执行一个任务，每个加工设备至多处理一个订单">∑<sub>i,j</sub> x<sub>rijt</sub> ≤ 1<br/>∑<sub>i</sub> z<sub>ikt</sub> ≤ 1</div><p>机器人一次只携带一件物品；切配台、传菜位和加工设备各有独立占用状态。</p></div>
          <div><b>工序先后与设备兼容</b><div className="formula-line sequence-formula">j ≺<sub>Gᵢ</sub> j′ · z<sub>ikt</sub> ≤ a<sub>jk</sub></div><p>沙拉需要混合、汤品需要炖煮、主菜需要煎制；加工任务只能进入能力兼容的设备。</p></div>
          <div><b>订单时间</b><div className="formula-line" aria-label="逾期等于交付时间减截止时间与零的最大值">L<sub>i</sub> = max(0, C<sub>i</sub> − d<sub>i</sub>)<br/>d<sub>i</sub> = r<sub>i</sub> + D<sub>i</sub></div><p>rᵢ 是订单进入队列的时刻；交付后立即补入新订单，因此队列始终保持 3 单。</p></div>
        </div>
      </article>

      <article className="model-card objectives-card">
        <div className="model-card-heading"><i>5</i><div><span>OBJECTIVES</span><h3>评价目标与积分</h3></div></div>
        <p className="model-intro">目标是实时调度参数：它会改变每种策略的订单排序与机器人接单优先级；实验再让三种策略在同一目标下运行，并按对应指标比较结果。</p>
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
            <header><i>A</i><div><b>顺序优先级基线</b><span>基准启发式</span></div></header>
            <p>由所选目标确定下一订单；固定阿橙/左切配台与小青/右切配台；当前订单交付后才处理下一单。</p>
            <details className="formula-details"><summary>查看目标引导规则</summary><div className="formula-line">i* = arg min<sub>i∈O<sub>t</sub></sub> v<sub>f</sub>(i)</div><p>完成量看预计工时，积分看预计收益率，逾期看松弛时间，移动看预计路径成本，综合目标使用字典序向量。</p></details>
          </section>
          <section>
            <header><i>B</i><div><b>流水竞价协作</b><span>单设备分配启发式</span></div></header>
            <p>使用同一目标引导的订单优先级，再枚举两份原料与两个切配台的分配；烹饪期间预切下一单的一份原料并存入传菜台。</p>
            <details className="formula-details"><summary>查看分配成本</summary><div className="formula-line compact-formula">c(r,g,b,k)=δ(p<sub>r</sub>,s<sub>g</sub>)+δ(s<sub>g</sub>,b)+δ(b,k)<br/>(σ*,β*)=arg min ∑<sub>r∈R</sub>c(r,σ<sub>r</sub>,β<sub>r</sub>,k)</div><p>σ 是原料分配，β 是切配台分配；页面枚举所有 2×2 组合并取总移动距离最小者。</p></details>
          </section>
          <section>
            <header><i>C</i><div><b>滚动双设备调度</b><span>资源感知启发式</span></div></header>
            <p>对当前最多 3 个订单精确枚举顺序，再按菜谱能力匹配两台加工设备；机器人按距离与状态接任务，并提前把餐盘送到设备旁。</p>
            <details className="formula-details"><summary>查看滚动排序</summary><div className="formula-line compact-formula">π* = arg min<sub>π∈Π(O<sub>t</sub>)</sub> V<sub>f</sub>(π)</div><p>V<sub>f</sub> 是由预计完成时间、逾期、预计积分和换菜次数组成的目标专属字典序向量；19/21/22 仍只是小窗口排序代理。</p></details>
            <details className="formula-details"><summary>查看机器人接单分数</summary><div className="formula-line compact-formula">h<sub>f</sub>(r,i,j)=w<sub>d,f</sub>δ(p<sub>r</sub>,s<sub>j</sub>)+14I<sub>active(i)</sub>+w<sub>q,f</sub>q<sub>i</sub>+w<sub>p,f</sub>τ̂<sub>i</sub></div><p>目标 f 会调整距离、紧迫度和预计工时的权重；14 仍用于鼓励两台机器人分散到不同在制订单。</p></details>
          </section>
        </div>
      </article>

      <article className="model-card roadmap-card">
        <div className="model-card-heading"><i>7</i><div><span>SCALING ROADMAP</span><h3>下一阶段的模型扩展</h3></div></div>
        <div className="constraint-grid"><div><b>三种布局 · V7 已完成</b><p>紧凑直线、U 形与分区厨房均通过工位可达性验证。</p></div><div><b>三条菜谱工序 · V7 已完成</b><p>原料、工作量、加工时间与设备能力均有真实差异。</p></div><div><b>可扩展机器人队伍 · 下一步</b><p>把固定双机器人扩展为 R={"{"}1,…,m{"}"}，同步扩展避碰、携带和资源容量约束。</p></div><div><b>随机种子生成器 · 后续</b><p>保存种子和场景文件，让生成式实验仍可公平重复比较。</p></div></div>
      </article>

      <aside className="model-boundary">
        <b>模型边界</b>
        <p>V7 是参数化的现实厨房抽象：尺寸和设备能力具有可解释性，但尚未针对某个真实场地或机器人标定。A/B/C 是确定性在线启发式，不宣称全局最优，也不直接等同于物理控制器。</p>
      </aside>
    </section>
  );
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("zh");
  const [pageView, setPageView] = useState<PageView>("simulator");
  const [mode, setMode] = useState<Mode>("auto");
  const [difficulty, setDifficulty] = useState<Difficulty>("training");
  const [mapId, setMapId] = useState<MapId>("compact");
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("dual");
  const [labView, setLabView] = useState<LabView>("run");
  const [speed, setSpeed] = useState<1 | 2 | 4 | 8>(2);
  const [musicOn, setMusicOn] = useState(false);
  const [roundSeconds, setRoundSeconds] = useState(DEFAULT_ROUND_SECONDS);
  const [durationDraft, setDurationDraft] = useState(String(DEFAULT_ROUND_SECONDS));
  const [objective, setObjective] = useState<ObjectiveId>("balanced");
  const [experiment, setExperiment] = useState<ExperimentBatch | null>(null);
  const [experimentRunning, setExperimentRunning] = useState(false);
  const [game, setGame] = useState<GameState>(() => createInitialState("training", false, DEFAULT_ROUND_SECONDS, "compact"));
  const audioRef = useRef<KitchenAudio | null>(null);
  const deliveredRef = useRef(0);
  const tickRef = useRef(0);
  const resetGame = useCallback((nextDifficulty = difficulty, start = false, duration = roundSeconds, nextMapId = mapId) => {
    tickRef.current = 0;
    setGame(createInitialState(nextDifficulty, start, duration, nextMapId));
  }, [difficulty, mapId, roundSeconds]);
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
    setExperiment(null);
    resetGame(difficulty);
  };
  const changeMap = (nextMapId: MapId) => {
    setMapId(nextMapId);
    setExperiment(null);
    resetGame(difficulty, false, roundSeconds, nextMapId);
  };
  const runExperiment = () => {
    const duration = normalizeDuration(durationDraft);
    setRoundSeconds(duration);
    setDurationDraft(String(duration));
    setExperimentRunning(true);
    window.setTimeout(() => {
      const results = ALGORITHM_IDS.map((id) => runSimulation(id, difficulty, duration, objective, mapId));
      setExperiment({ duration, difficulty, objective, mapId, language, createdAt: new Date().toLocaleString(language === "zh" ? "zh-CN" : "en-GB", { hour12: false }), results });
      setExperimentRunning(false);
    }, 30);
  };
  const exportExperiment = () => {
    if (!experiment) return;
    const blob = new Blob([experimentMarkdown(experiment)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `robo-kitchen-${experiment.mapId}-${experiment.duration}s-${experiment.difficulty}.md`;
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
      if (!isWalkable(row, col, previous.mapId) || (other.row === row && other.col === col)) { game.message = "该格不可进入，请更换路线。"; return game; }
      robot.row = row; robot.col = col; game.metrics.travel += 1; game.message = `正在控制 ${robot.name}。`; return game;
    });
  }, [mode]);
  const manualInteract = useCallback(() => {
    if (mode !== "manual") return;
    setGame((previous) => {
      if (!previous.running) return previous;
      const game = cloneGame(previous); const robot = game.robots[game.activeRobot];
      const entry = Object.entries(layoutOf(previous.mapId).stations).find(([key]) => isAdjacent(robot, key, previous.mapId));
      if (!entry) { game.message = "附近没有可操作设备。"; return game; }
      const [, station] = entry;
      if (station.type === "ingredient" && !robot.carrying) robot.carrying = { kind: "raw", ingredient: station.ingredient };
      else if (station.type === "cut") {
        const board = game.cutBoards[station.key];
        if (!board && robot.carrying?.kind === "raw") { game.cutBoards[station.key] = { ingredient: robot.carrying.ingredient, progress: 0, required: 3 }; robot.carrying = null; }
        else if (board && board.progress < board.required && !robot.carrying) board.progress += 1;
        else if (board && board.progress === board.required && !robot.carrying) { robot.carrying = { kind: "chopped", ingredient: board.ingredient }; game.cutBoards[station.key] = null; }
      } else if (station.type === "stove") {
        const pot = game.pots[station.key];
        if (robot.carrying?.kind === "chopped" && !pot.recipe && pot.ingredients.length < 2) {
          const carriedIngredient = robot.carrying.ingredient;
          pot.ingredients.push(carriedIngredient); robot.carrying = null;
          if (pot.ingredients.length === 2) {
            const signature = [...pot.ingredients].sort().join("-");
            const recipeId = (Object.keys(RECIPES) as RecipeId[]).find((id) => [...RECIPES[id].ingredients].sort().join("-") === signature && station.capabilities.includes(RECIPES[id].equipment));
            if (recipeId) { pot.recipe = recipeId; pot.cookLeft = RECIPES[recipeId].processTime[difficulty]; }
            else { pot.ingredients.pop(); robot.carrying = { kind: "chopped", ingredient: carriedIngredient }; game.message = "该设备与菜谱不兼容。"; return game; }
          }
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
      let next = autoStep(previous, difficulty, algorithm, objective);
      tickRef.current += 1;
      if (tickRef.current % 2 === 0) next = advanceClock(next);
      return next;
    }), 500 / speed);
    return () => window.clearInterval(timer);
  }, [algorithm, difficulty, game.ended, game.paused, game.running, mode, objective, speed]);
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

  const kitchen = layoutOf(game.mapId);
  const cells = useMemo(() => Array.from({ length: kitchen.rows * kitchen.cols }, (_, index) => ({ row: Math.floor(index / kitchen.cols), col: index % kitchen.cols })), [kitchen.cols, kitchen.rows]);
  const active = game.robots[game.activeRobot];
  const movementShare = game.metrics.travel + game.metrics.idle ? Math.round(game.metrics.travel / (game.metrics.travel + game.metrics.idle) * 100) : 0;
  const selectedMethod = ALGORITHMS[algorithm];
  const selectedMethodName = algorithmName(algorithm, language);
  const selectedMethodShort = algorithmName(algorithm, language, true);
  const robotName = (robot: Robot) => robot.id === 0 ? tr(language, "阿橙", "Orange") : tr(language, "小青", "Cyan");
  const rankedExperiment = experiment ? [...experiment.results].sort((a, b) => compareResults(a, b, experiment.objective)) : [];

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><span>R</span><span>K</span></div><div><p className="eyebrow">AUTONOMOUS GRID KITCHEN</p><h1>ROBO KITCHEN <span>{tr(language, "双机器人协作调度", "Collaborative robot scheduling")}</span></h1></div></div>
        <div className="mode-tabs" role="tablist" aria-label={tr(language, "页面视图", "Page view")}>
          <button role="tab" aria-selected={pageView === "simulator" && mode === "auto"} className={pageView === "simulator" && mode === "auto" ? "active" : ""} onClick={() => selectMode("auto")}><i>✦</i> {tr(language, "自动调度", "Auto Scheduling")}</button>
          <button role="tab" aria-selected={pageView === "simulator" && mode === "manual"} className={pageView === "simulator" && mode === "manual" ? "active" : ""} onClick={() => selectMode("manual")}><i>✥</i> {tr(language, "手动体验", "Manual Mode")}</button>
          <button role="tab" aria-selected={pageView === "model"} className={pageView === "model" ? "active" : ""} onClick={() => setPageView("model")}><i>∑</i> {tr(language, "模型与算法", "Model & Algorithms")}</button>
        </div>
        <div className="top-actions"><div className="language-picker" aria-label="Language"><button className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")}>{language === "zh" ? "中" : "ZH"}</button><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button></div><button className={`music-button ${musicOn ? "active" : ""}`} aria-label={musicOn ? tr(language, "关闭音乐", "Turn music off") : tr(language, "开启音乐", "Turn music on")} aria-pressed={musicOn} onClick={toggleMusic} title={tr(language, "原创程序化厨房配乐", "Original procedural kitchen soundtrack")}><span aria-hidden>{musicOn ? "♫" : "♪"}</span><span className="music-label">{musicOn ? tr(language, "音乐开", "Music on") : tr(language, "音乐关", "Music off")}</span></button><button className="restart-button" onClick={() => resetGame(difficulty, true)}>{tr(language, "重新开始", "Restart")}</button></div>
      </header>

      {pageView === "simulator" ? <><section className="score-strip" aria-label={tr(language, "运行指标", "Run metrics")}>
        <div><span>{tr(language, "剩余时间", "Time left")}</span><strong className={game.timeLeft <= 20 ? "danger" : ""}>{formatTime(game.timeLeft)}</strong></div>
        <div><span>{tr(language, "完成订单", "Completed")}</span><strong>{game.delivered}</strong></div>
        <div><span>{tr(language, "团队得分", "Team score")}</span><strong>{game.score.toLocaleString()}</strong></div>
        <div><span>{tr(language, "移动步占比", "Move share")}</span><strong>{movementShare}%</strong></div>
      </section>

      <section className="workspace">
        <aside className="orders-panel panel">
          <div className="panel-title-row"><div><p className="section-kicker">ORDER QUEUE</p><h2>{tr(language, "订单队列", "Order Queue")}</h2></div><span className="live-pill"><i /> {tr(language, "实时", "Live")}</span></div>
          <div className="order-list">{game.orders.map((order) => { const recipe = RECIPES[order.recipe]; const activeOrder = game.cycle?.orderId === order.id || game.smartPlans.some((plan) => plan.orderId === order.id); const prefetchedOrder = game.prefetch?.orderId === order.id; return (
            <article className={`order-card ${activeOrder ? "selected" : ""} ${prefetchedOrder ? "prefetching" : ""} ${order.remaining < 14 ? "urgent" : ""}`} key={order.id}>
              <div className="ticket-number">#{order.id}</div><div className="dish-icon" style={{ background: recipe.color }}>{recipe.icon}</div>
              <div className="order-copy"><strong>{recipeName(order.recipe, language)}</strong><span>{recipe.ingredients.map((item) => ingredientName(item, language)).join(" + ")} · {language === "zh" ? recipe.process : recipe.processEn}</span><div className="order-timer"><i style={{ width: `${Math.max(0, Math.min(100, order.remaining / order.maxTime * 100))}%` }} /></div></div><b>{order.remaining >= 0 ? `${order.remaining}s` : `${tr(language, "逾期", "Late")} ${-order.remaining}s`}</b>
              {activeOrder && <em className="planning-tag">{tr(language, "执行中", "Active")}</em>}{prefetchedOrder && !activeOrder && <em className="planning-tag prefetch-tag">{tr(language, "预备中", "Prefetch")}</em>}
            </article>); })}</div>
          <div className="decision-card"><span>{tr(language, "策略", "Policy")} {selectedMethod.code} · {tr(language, "当前决策", "Current decision")}</span><strong>{runtimeText(game.decision, language)}</strong></div>
          <div className="mode-picker"><span>{tr(language, "订单压力", "Order pressure")}</span><div><button className={difficulty === "training" ? "active" : ""} onClick={() => { setDifficulty("training"); setExperiment(null); resetGame("training"); }}>{tr(language, "标准", "Standard")}</button><button className={difficulty === "rush" ? "active" : ""} onClick={() => { setDifficulty("rush"); setExperiment(null); resetGame("rush"); }}>{tr(language, "高峰", "Rush")}</button></div></div>
        </aside>

        <section className="kitchen-column">
          <div className="kitchen-frame">
            <div className="kitchen-label"><span>{kitchen.rows} × {kitchen.cols} · {kitchen.footprint}</span><strong>{language === "zh" ? kitchen.name : kitchen.nameEn}</strong><em className={game.paused ? "paused" : ""}>{game.running ? (game.paused ? tr(language, "已暂停", "Paused") : tr(language, "运行中", "Running")) : tr(language, "待启动", "Ready")}</em></div>
            <div className={`kitchen-grid map-${game.mapId}`} style={{ gridTemplateColumns: `repeat(${kitchen.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${kitchen.rows}, minmax(0, 1fr))`, aspectRatio: `${kitchen.cols} / ${kitchen.rows}` }}>{cells.map(({ row, col }) => {
              const key = coord(row, col); const station = kitchen.stations[key]; const robot = game.robots.find((candidate) => candidate.row === row && candidate.col === col); const isWall = kitchen.walls.has(key);
              let status = "";
              if (station?.type === "cut") { const board = game.cutBoards[station.key]; status = board ? (board.progress === board.required ? "✓" : `${board.progress}/${board.required}`) : ""; }
              if (station?.type === "stove") { const pot = game.pots[station.key]; const staged = game.smartPlans.some((plan) => plan.potKey === station.key && plan.plateStaged); const potStatus = pot.ready ? tr(language, "熟", "Ready") : pot.recipe ? `${pot.cookLeft}s` : pot.ingredients.length ? `${pot.ingredients.length}/2` : ""; status = `${potStatus}${staged ? tr(language, "·盘", "·plate") : ""}`; }
              if (station?.type === "counter") status = itemIcon(game.counters[station.key]);
              return <div className={`cell ${isWall ? "wall" : ""} ${station ? `station ${station.type}` : "floor"}`} key={key}>
                {station && <><span className="station-icon">{station.icon}</span><small>{stationLabel(station, language)}</small>{status && <b className="station-status">{status}</b>}</>}
                {robot && <div className={`robot ${robot.color} ${mode === "manual" && game.activeRobot === robot.id ? "active" : ""}`}><span className="antenna"/><span className="face"><i/><i/></span><strong>{robot.shortName}</strong>{robot.carrying && <em className="carried">{itemIcon(robot.carrying)}</em>}<span className="task-bubble">{runtimeText(robot.task, language)}</span></div>}
              </div>;
            })}</div>
            <div className="message-bar"><span className={`mini-robot ${active.color}`}>{mode === "auto" ? "AI" : active.shortName}</span><p>{runtimeText(game.message, language)}</p><strong>{mode === "auto" ? `${tr(language, "调度", "Plans")} ${game.metrics.replans}` : nearbyStation(active, game.mapId) ? stationLabel(nearbyStation(active, game.mapId), language) : tr(language, "移动中", "Moving")}</strong></div>
            {!game.running && <div className="start-overlay"><div className="start-card"><p>{game.ended ? tr(language, "本轮完成", "Run complete") : mode === "auto" ? `${tr(language, "策略", "Policy")} ${selectedMethod.code} · ${tr(language, "自动调度", "Auto scheduling")}` : tr(language, "手动对照", "Manual comparison")}</p><h2>{game.ended ? `${tr(language, "完成", "Completed")} ${game.delivered} ${tr(language, "道菜", "dishes")}` : mode === "auto" ? selectedMethodName : tr(language, "亲自控制两台机器人", "Control both robots")}</h2><span>{mode === "auto" ? (language === "zh" ? selectedMethod.note : selectedMethod.noteEn) : tr(language, "使用同一组订单与时间限制，对照人工操作和自动调度。", "Use the same orders and time limit to compare manual control with automated scheduling.")}</span><button onClick={() => resetGame(difficulty, true)}>{game.ended ? tr(language, "按当前策略再运行", "Run this policy again") : tr(language, "启动系统", "Start system")}<b>→</b></button></div></div>}
          </div>
        </section>

        <aside className="controls-panel panel">
          {mode === "auto" ? <>
            <div className="panel-title-row"><div><p className="section-kicker">SCHEDULING LAB</p><h2>{tr(language, "调度实验", "Scheduling Lab")}</h2></div></div>
            <section className="scenario-selector" aria-label={tr(language, "厨房场景", "Kitchen scenario")}><div className="scenario-heading"><span>{tr(language, "厨房场景", "Kitchen scenario")}</span><small>{kitchen.footprint}</small></div><div className="scenario-grid">{MAP_IDS.map((id) => { const option = KITCHENS[id]; return <button className={mapId === id ? "active" : ""} aria-pressed={mapId === id} key={id} onClick={() => changeMap(id)}><strong>{language === "zh" ? option.shortName : option.shortNameEn}</strong><small>{option.rows} × {option.cols}</small></button>; })}</div><p>{language === "zh" ? kitchen.description : kitchen.descriptionEn}</p></section>
            <div className="algorithm-selector" role="radiogroup" aria-label={tr(language, "选择自动调度策略", "Select scheduling policy")}>{ALGORITHM_IDS.map((id) => <button role="radio" aria-checked={algorithm === id} className={algorithm === id ? "active" : ""} key={id} onClick={() => selectAlgorithm(id)}><b>{ALGORITHMS[id].code}</b><span>{algorithmName(id, language, true)}</span></button>)}</div>
            <label className="live-objective"><span>{tr(language, "调度目标", "Scheduling objective")}</span><select value={objective} onChange={(event) => changeObjective(event.target.value as ObjectiveId)}>{(Object.keys(OBJECTIVES) as ObjectiveId[]).map((id) => <option value={id} key={id}>{objectiveLabel(id, language)}</option>)}</select><small>{language === "zh" ? OBJECTIVES[objective].description : OBJECTIVES[objective].descriptionEn}</small></label>
            <div className="lab-tabs" role="tablist" aria-label={tr(language, "调度实验视图", "Scheduling lab view")}><button role="tab" aria-selected={labView === "run"} className={labView === "run" ? "active" : ""} onClick={() => setLabView("run")}>{tr(language, "实时运行", "Live Run")}</button><button role="tab" aria-selected={labView === "experiment"} className={labView === "experiment" ? "active" : ""} onClick={() => setLabView("experiment")}>{tr(language, "策略对比", "Policy Comparison")}</button></div>
            {labView === "run" ? <div className="lab-view">
              <div className="auto-actions"><button className="primary-action auto-button" onClick={() => game.running ? setGame((previous) => ({ ...previous, paused: !previous.paused })) : resetGame(difficulty, true)}><span>{game.running ? (game.paused ? tr(language, "继续运行", "Resume") : tr(language, "暂停运行", "Pause")) : tr(language, "启动自动调度", "Start auto scheduling")}</span><small>{roundSeconds} {tr(language, "秒", "seconds")} · {tr(language, "固定 2 次决策/秒", "fixed 2 decisions/s")}</small><kbd>{game.paused ? "▶" : "Ⅱ"}</kbd></button><div className="speed-picker"><span>{tr(language, "播放速度", "Playback speed")}</span>{([1, 2, 4, 8] as const).map((value) => <button className={speed === value ? "active" : ""} onClick={() => setSpeed(value)} key={value}>{value}×{value === 2 && <small>{tr(language, "标准", "normal")}</small>}</button>)}</div></div>
              <div className="robot-cards compact">{game.robots.map((robot) => <article key={robot.id} className={`robot-card ${robot.color}`}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>{robotName(robot)} · {itemLabel(robot.carrying, language)}</small><strong>{runtimeText(robot.task, language)}</strong><em>{tr(language, "目标：", "Target: ")}{runtimeText(robot.target, language)}</em></span><span className="status-dot" /></article>)}</div>
              <div className="metric-grid"><div><span>{tr(language, "移动", "Travel")}</span><strong>{game.metrics.travel}</strong><small>{tr(language, "格", "cells")}</small></div><div><span>{tr(language, "避让", "Conflicts")}</span><strong>{game.metrics.conflicts}</strong><small>{tr(language, "次", "times")}</small></div><div><span>{tr(language, "逾期", "Late")}</span><strong>{game.metrics.tardiness}</strong><small>{tr(language, "秒", "s")}</small></div><div><span>{tr(language, "调度", "Plans")}</span><strong>{game.metrics.replans}</strong><small>{tr(language, "次", "times")}</small></div></div>
            </div> : <div className="experiment-card lab-view">
              <div className="experiment-fields"><label><span>{tr(language, "仿真时长", "Simulation horizon")}</span><div><input aria-label={tr(language, "仿真时长（秒）", "Simulation horizon in seconds")} type="number" min="30" max="600" step="10" inputMode="numeric" value={durationDraft} onChange={(event) => setDurationDraft(event.target.value)} onBlur={(event) => commitDuration(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}/><b>{tr(language, "秒", "s")}</b></div></label><label><span>{tr(language, "本次调度目标", "Objective used")}</span><strong>{objectiveLabel(objective, language)}</strong></label></div>
              <p className="objective-note">{tr(language, "三种策略都会在上方所选目标下重新运行；目标既影响调度，也用于结果排名。", "All three policies rerun under the selected objective; it guides scheduling and ranks the resulting metrics.")}</p>
              <div className="experiment-actions"><button className="run-experiment" disabled={experimentRunning} onClick={runExperiment}>{experimentRunning ? tr(language, "正在运行…", "Running…") : tr(language, "运行三种策略", "Run all policies")}</button><button className="export-button" disabled={!experiment} onClick={exportExperiment}>{tr(language, "导出 MD", "Export MD")}</button></div>
              {experiment ? <><div className="experiment-meta"><span>{language === "zh" ? KITCHENS[experiment.mapId].shortName : KITCHENS[experiment.mapId].shortNameEn} · {experiment.duration} {tr(language, "秒", "s")} · {experiment.difficulty === "training" ? tr(language, "标准压力", "Standard pressure") : tr(language, "高峰压力", "Rush pressure")}</span><strong>{objectiveLabel(experiment.objective, language)}</strong></div><div className="experiment-results" aria-label={tr(language, "策略实验排名", "Policy experiment ranking")}>{rankedExperiment.map((result, index) => <button className="experiment-result" key={result.algorithm} onClick={() => { selectAlgorithm(result.algorithm); setLabView("run"); }}><i>{index + 1}</i><b>{tr(language, "策略", "Policy")} {ALGORITHMS[result.algorithm].code}<small>{algorithmName(result.algorithm, language, true)}</small></b><span><small>{tr(language, "完成", "Done")}</small><strong>{result.delivered}</strong></span><span><small>{tr(language, "积分", "Score")}</small><strong>{result.score}</strong></span><span><small>{tr(language, "逾期", "Late")}</small><strong>{result.tardiness}s</strong></span><span><small>{tr(language, "移动", "Travel")}</small><strong>{result.travel}</strong></span></button>)}</div></> : <div className="empty-experiment"><b>{tr(language, "尚未运行", "Not run yet")}</b><span>{tr(language, "设置时长和目标，再运行三种策略。", "Set a horizon and objective, then run all three policies.")}</span></div>}
              <details className="score-details"><summary>{tr(language, "积分与目标定义", "Score and objective definitions")}</summary><p>{tr(language, "准时交付 = 100 + 剩余秒数×3 + 连击奖励；连续准时每单增加 25 分，最高 100 分。逾期每秒扣 5 分，单笔最低 20 分，连击归零。", "On-time reward = 100 + 3 × seconds remaining + combo bonus. Each consecutive on-time order adds 25 points up to 100. Lateness costs 5 points per second, with a 20-point floor, and resets the combo.")}</p></details>
            </div>}
            <details className="method-details"><summary>{tr(language, "策略", "Policy")} {selectedMethod.code} · {tr(language, "调度逻辑", "Scheduling logic")} <span>＋</span></summary><div className="method-card"><p>{tr(language, "策略", "Policy")} {selectedMethod.code} · {language === "zh" ? selectedMethod.kind : selectedMethod.kindEn}</p><strong>{selectedMethodName}</strong><ol>{(language === "zh" ? selectedMethod.steps : selectedMethod.stepsEn).map((step, index) => <li key={step}><i>{index + 1}</i><span>{step}</span></li>)}</ol><em>{language === "zh" ? selectedMethod.note : selectedMethod.noteEn}</em></div></details>
          </> : <>
            <div className="panel-title-row"><div><p className="section-kicker">MANUAL MODE</p><h2>{tr(language, "手动体验", "Manual Mode")}</h2></div><span className="team-count">{tr(language, "对照组", "Control")}</span></div>
            <div className="robot-cards">{game.robots.map((robot) => <button key={robot.id} className={`robot-card ${robot.color} ${game.activeRobot === robot.id ? "active" : ""}`} onClick={() => setGame((previous) => ({ ...previous, activeRobot: robot.id }))}><span className="avatar"><i/><i/><b>{robot.shortName}</b></span><span className="robot-meta"><small>{tr(language, "机器人", "Robot")} {robot.shortName}</small><strong>{robotName(robot)}</strong><em>{itemLabel(robot.carrying, language)}</em></span></button>)}</div>
            <div className="control-block"><div className="block-heading"><strong>{tr(language, "棋盘移动", "Grid movement")}</strong><span>WASD / {tr(language, "方向键", "arrow keys")}</span></div><div className="dpad"><button className="up" onClick={() => manualMove(-1, 0)}>↑</button><button className="left" onClick={() => manualMove(0, -1)}>←</button><button className="center" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}>↔</button><button className="right" onClick={() => manualMove(0, 1)}>→</button><button className="down" onClick={() => manualMove(1, 0)}>↓</button></div></div>
            <div className="action-stack"><button className="primary-action" onClick={manualInteract}><span>{tr(language, "操作", "Interact")}</span><small>{tr(language, "拿取 / 切配 / 烹饪 / 交付", "Pick up / cut / cook / serve")}</small><kbd>E</kbd></button><button className="switch-action" onClick={() => setGame((previous) => ({ ...previous, activeRobot: previous.activeRobot === 0 ? 1 : 0 }))}><span>{tr(language, "切换机器人", "Switch robot")}</span><small>Q / Tab</small><kbd>Q</kbd></button></div>
            <div className="method-card manual-note"><p>{tr(language, "为什么保留手动模式？", "Why keep manual mode?")}</p><strong>{tr(language, "它是自动调度的直观基准", "It is an intuitive baseline for automation")}</strong><em>{tr(language, "同样的订单、厨房与时间限制下，可以比较人工决策与算法策略的完成量、移动距离和等待。", "Under the same orders, kitchen, and time limit, manual decisions can be compared with automated policies on throughput, travel, and waiting.")}</em></div>
          </>}
        </aside>
      </section></> : <ModelView language={language} />}
      <footer><span><i /> {tr(language, "3 种策略 · 5 项目标 · 离散事件仿真", "3 policies · 5 objectives · discrete-event simulation")}</span><p>{tr(language, "原创程序化配乐 · 仅供学习与研究，禁止商用。", "Original procedural soundtrack · learning and research only; commercial use prohibited.")}<a href="https://github.com/marsguo2049/kitchen/blob/main/LICENSE" target="_blank" rel="noreferrer">{tr(language, "许可", "License")}</a><a href="https://github.com/marsguo2049/kitchen/issues/new" target="_blank" rel="noreferrer">{tr(language, "使用告知", "Notify use")}</a></p><span>POLYFORM NONCOMMERCIAL 1.0.0</span></footer>
    </main>
  );
}
