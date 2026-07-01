const DIFFICULTIES = {
  easy: { rows: 9, cols: 9, mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 },
};

const boardEl = document.getElementById("board");
const mineCountEl = document.getElementById("mineCount");
const timerEl = document.getElementById("timer");
const faceBtn = document.getElementById("faceBtn");
const newGameBtn = document.getElementById("newGameBtn");
const difficultySelect = document.getElementById("difficulty");
const tabBtns = document.querySelectorAll(".tab-btn");
const gameTabEl = document.getElementById("gameTab");
const satTabEl = document.getElementById("satTab");
const satBoardEl = document.getElementById("satBoard");
const satSummaryEl = document.getElementById("satSummary");
const satWarningsEl = document.getElementById("satWarnings");
const satClausesEl = document.getElementById("satClauses");

let rows, cols, mineTotal;
let grid = [];
let cellEls = [];
let satCellEls = [];
let firstClick = true;
let gameOver = false;
let revealedCount = 0;
let flagCount = 0;
let timerInterval = null;
let seconds = 0;

// SAT 추론 캐시: 한 번 확정된 칸은 이후 계산에서 다시 열거하지 않는다.
let knownSafe = new Set();
let knownMine = new Set();
let lastSatResult = null;

function startNewGame() {
  const config = DIFFICULTIES[difficultySelect.value];
  rows = config.rows;
  cols = config.cols;
  mineTotal = config.mines;

  firstClick = true;
  gameOver = false;
  revealedCount = 0;
  flagCount = 0;
  seconds = 0;
  clearInterval(timerInterval);
  timerInterval = null;
  updateTimerDisplay();
  updateMineCount();
  faceBtn.textContent = "🙂";

  knownSafe = new Set();
  knownMine = new Set();
  lastSatResult = null;

  grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
    }))
  );

  buildBoardDOM();
}

function buildBoardDOM() {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${cols}, 28px)`;
  cellEls = Array.from({ length: rows }, () => new Array(cols));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      cellEl.dataset.row = r;
      cellEl.dataset.col = c;
      cellEl.addEventListener("click", onCellLeftClick);
      cellEl.addEventListener("contextmenu", onCellRightClick);
      cellEl.addEventListener("mousedown", onCellMouseDown);
      cellEl.addEventListener("dblclick", onCellDoubleClick);
      boardEl.appendChild(cellEl);
      cellEls[r][c] = cellEl;
    }
  }

  buildSatBoardDOM();
}

function buildSatBoardDOM() {
  satBoardEl.innerHTML = "";
  satBoardEl.style.gridTemplateColumns = `repeat(${cols}, 28px)`;
  satCellEls = Array.from({ length: rows }, () => new Array(cols));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      cellEl.dataset.row = r;
      cellEl.dataset.col = c;
      cellEl.addEventListener("click", onSatCellClick);
      cellEl.addEventListener("mousedown", onSatCellMouseDown);
      satBoardEl.appendChild(cellEl);
      satCellEls[r][c] = cellEl;
    }
  }
}

function placeMines(excludeRow, excludeCol) {
  let placed = 0;
  while (placed < mineTotal) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const tooClose = Math.abs(r - excludeRow) <= 1 && Math.abs(c - excludeCol) <= 1;
    if (grid[r][c].mine || tooClose) continue;
    grid[r][c].mine = true;
    placed++;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].mine) continue;
      grid[r][c].adjacent = countAdjacentMines(r, c);
    }
  }
}

function countAdjacentMines(row, col) {
  let count = 0;
  forEachNeighbor(row, col, (r, c) => {
    if (grid[r][c].mine) count++;
  });
  return count;
}

function forEachNeighbor(row, col, callback) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols) callback(r, c);
    }
  }
}

function onCellLeftClick(e) {
  if (gameOver) return;
  const row = Number(e.currentTarget.dataset.row);
  const col = Number(e.currentTarget.dataset.col);
  openCell(row, col);
}

function openCell(row, col) {
  const cell = grid[row][col];
  if (cell.flagged || cell.revealed) return;

  if (firstClick) {
    placeMines(row, col);
    firstClick = false;
    startTimer();
  }

  if (cell.mine) {
    revealCell(row, col);
    endGame(false);
    return;
  }

  revealCell(row, col);
  if (cell.adjacent === 0) {
    floodFill(row, col);
  }

  checkWin();
  refreshSatIfActive();
}

function onSatCellClick(e) {
  if (gameOver) return;
  const row = Number(e.currentTarget.dataset.row);
  const col = Number(e.currentTarget.dataset.col);
  openCell(row, col);
}

function onSatCellMouseDown(e) {
  if (gameOver) return;
  const row = Number(e.currentTarget.dataset.row);
  const col = Number(e.currentTarget.dataset.col);

  if (e.buttons === 3) {
    e.preventDefault();
    chordReveal(row, col);
    return;
  }

  if (e.button === 2) {
    e.preventDefault();
    toggleFlag(row, col);
  }
}

function onCellRightClick(e) {
  e.preventDefault();
}

function onCellMouseDown(e) {
  if (gameOver) return;
  const row = Number(e.currentTarget.dataset.row);
  const col = Number(e.currentTarget.dataset.col);

  if (e.buttons === 3) {
    // 좌우 버튼 동시 클릭(코드)
    e.preventDefault();
    chordReveal(row, col);
    return;
  }

  if (e.button === 2) {
    // 우클릭을 누르는 즉시 깃발 배치/해제
    e.preventDefault();
    toggleFlag(row, col);
  }
}

function toggleFlag(row, col) {
  const cell = grid[row][col];
  if (cell.revealed) return;

  cell.flagged = !cell.flagged;
  flagCount += cell.flagged ? 1 : -1;
  cellEls[row][col].classList.toggle("flag", cell.flagged);
  updateMineCount();
  refreshSatIfActive();
}

function onCellDoubleClick(e) {
  if (gameOver) return;
  const row = Number(e.currentTarget.dataset.row);
  const col = Number(e.currentTarget.dataset.col);
  chordReveal(row, col);
}

function chordReveal(row, col) {
  const cell = grid[row][col];
  if (!cell.revealed || cell.adjacent === 0) return;

  let flagCountAround = 0;
  forEachNeighbor(row, col, (r, c) => {
    if (grid[r][c].flagged) flagCountAround++;
  });
  if (flagCountAround !== cell.adjacent) return;

  let hitMine = false;
  forEachNeighbor(row, col, (r, c) => {
    const neighbor = grid[r][c];
    if (neighbor.revealed || neighbor.flagged) return;
    revealCell(r, c);
    if (neighbor.mine) {
      hitMine = true;
    } else if (neighbor.adjacent === 0) {
      floodFill(r, c);
    }
  });

  if (hitMine) {
    endGame(false);
  } else {
    checkWin();
  }
  refreshSatIfActive();
}

function revealCell(row, col) {
  const cell = grid[row][col];
  if (cell.revealed || cell.flagged) return;
  cell.revealed = true;
  revealedCount++;

  const cellEl = cellEls[row][col];
  cellEl.classList.add("revealed");

  if (cell.mine) {
    cellEl.classList.add("mine");
  } else if (cell.adjacent > 0) {
    cellEl.textContent = cell.adjacent;
    cellEl.classList.add(`n${cell.adjacent}`);
  }
}

function floodFill(startRow, startCol) {
  const stack = [[startRow, startCol]];
  while (stack.length) {
    const [row, col] = stack.pop();
    forEachNeighbor(row, col, (r, c) => {
      const neighbor = grid[r][c];
      if (neighbor.revealed || neighbor.flagged || neighbor.mine) return;
      revealCell(r, c);
      if (neighbor.adjacent === 0) stack.push([r, c]);
    });
  }
}

function checkWin() {
  if (revealedCount === rows * cols - mineTotal) {
    endGame(true);
  }
}

function endGame(won) {
  gameOver = true;
  clearInterval(timerInterval);
  faceBtn.textContent = won ? "😎" : "💀";

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell.mine && !cell.flagged) {
        cellEls[r][c].classList.add("revealed", "mine");
      }
    }
  }
  refreshSatIfActive();
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    updateTimerDisplay();
  }, 1000);
}

function updateTimerDisplay() {
  timerEl.textContent = String(Math.min(seconds, 999)).padStart(3, "0");
}

function updateMineCount() {
  const remaining = mineTotal - flagCount;
  mineCountEl.textContent = String(remaining).padStart(3, "0");
}

// --- SAT 스타일 추론(경계 변수 CSP 완전 열거) ---
// 실제 SAT 솔버는 아니지만, "이 칸이 지뢰다"라는 절을 추가했을 때
// UNSAT/SAT 여부를 확인하는 것과 동일한 결과를 계산한다.
// 플레이어가 꽂은 깃발은 틀릴 수 있으므로 추론에는 전혀 쓰지 않고,
// 오직 열린 숫자 칸(진실)에서 나온 제약과, 지금까지 이 함수 스스로
// 확정한 결과(knownSafe/knownMine 캐시)만 근거로 삼는다.
const varKey = (r, c) => `${r},${c}`;

function computeSatInference() {
  const rawConstraints = [];
  const boundarySet = new Set();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.revealed || cell.adjacent === 0) continue;

      const vars = [];
      let required = cell.adjacent;
      forEachNeighbor(r, c, (nr, nc) => {
        const key = varKey(nr, nc);
        if (grid[nr][nc].revealed) return;
        boundarySet.add(key); // 표시용 - 이미 확정된 칸도 아직 안 열렸으면 계속 표시
        if (knownMine.has(key)) {
          required -= 1; // 이미 확정된 지뢰 - 솔버에는 다시 넣지 않고 카운트만 반영
          return;
        }
        if (knownSafe.has(key)) return; // 이미 확정된 안전 칸 - 솔버에서 제외
        vars.push(key);
      });
      if (vars.length === 0) continue;

      rawConstraints.push({ vars, required, clue: [r, c] });
    }
  }

  // 패널 표시용 스냅샷(추론 전 상태)
  const displayConstraints = rawConstraints.map((c) => ({
    vars: [...c.vars],
    required: c.required,
    clue: c.clue,
  }));

  // Phase 1: 단일 제약 규칙 + 부분집합 규칙을 고정점까지 반복 적용.
  // (요구 인원 0 → 나머지 전부 안전 / 요구 인원 = 칸 수 → 나머지 전부 지뢰,
  //  그리고 한 제약이 다른 제약의 부분집합이면 그 차집합에도 같은 규칙 적용)
  const constraints = rawConstraints.map((c) => ({
    vars: new Set(c.vars),
    required: c.required,
  }));

  let changed = true;
  while (changed) {
    changed = false;

    for (const cons of constraints) {
      if (cons.vars.size === 0) continue;
      if (cons.required === 0) {
        cons.vars.forEach((k) => {
          if (!knownSafe.has(k)) {
            knownSafe.add(k);
            changed = true;
          }
        });
        cons.vars.clear();
      } else if (cons.required === cons.vars.size) {
        cons.vars.forEach((k) => {
          if (!knownMine.has(k)) {
            knownMine.add(k);
            changed = true;
          }
        });
        cons.vars.clear();
      }
    }

    for (let i = 0; i < constraints.length; i++) {
      const a = constraints[i];
      if (a.vars.size === 0) continue;
      for (let j = 0; j < constraints.length; j++) {
        if (i === j) continue;
        const b = constraints[j];
        if (b.vars.size === 0 || a.vars.size >= b.vars.size) continue;

        let isSubset = true;
        for (const k of a.vars) {
          if (!b.vars.has(k)) {
            isSubset = false;
            break;
          }
        }
        if (!isSubset) continue;

        const diffVars = [...b.vars].filter((k) => !a.vars.has(k));
        const diffRequired = b.required - a.required;
        if (diffRequired === 0) {
          diffVars.forEach((k) => {
            if (!knownSafe.has(k)) {
              knownSafe.add(k);
              changed = true;
            }
          });
        } else if (diffRequired === diffVars.length) {
          diffVars.forEach((k) => {
            if (!knownMine.has(k)) {
              knownMine.add(k);
              changed = true;
            }
          });
        }
      }
    }

    if (changed) {
      for (const cons of constraints) {
        for (const k of [...cons.vars]) {
          if (knownMine.has(k)) {
            cons.vars.delete(k);
            cons.required -= 1;
          } else if (knownSafe.has(k)) {
            cons.vars.delete(k);
          }
        }
      }
    }
  }

  // Phase 2: 단순 규칙으로 못 뺀 나머지(모호한) 변수들을, 제약을 공유하는
  // 성분(connected component) 단위로 묶어 전체 경우의 수를 완전 열거한다.
  const remaining = constraints
    .filter((c) => c.vars.size > 0)
    .map((c) => ({ vars: [...c.vars], required: c.required }));

  const parent = new Map();
  remaining.forEach((c) => c.vars.forEach((k) => parent.set(k, k)));
  function find(x) {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  remaining.forEach((c) => {
    for (let i = 1; i < c.vars.length; i++) union(c.vars[0], c.vars[i]);
  });

  const groups = new Map();
  parent.forEach((_, k) => {
    const root = find(k);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(k);
  });

  const MAX_NODES = 2000000; // 이론상 병적으로 큰 성분이 나올 때의 최후 안전장치
  let truncated = false;

  groups.forEach((varKeys) => {
    const varIndex = new Map(varKeys.map((k, i) => [k, i]));
    const relevantConstraints = remaining
      .filter((c) => c.vars.some((k) => varIndex.has(k)))
      .map((c) => ({ idx: c.vars.map((k) => varIndex.get(k)), required: c.required }));

    const n = varKeys.length;
    const assignment = new Array(n).fill(-1);
    const sawMine = new Array(n).fill(false);
    const sawSafe = new Array(n).fill(false);
    let nodeCount = 0;
    let aborted = false;

    function isPartialValid() {
      for (const cons of relevantConstraints) {
        let assignedMines = 0;
        let unassigned = 0;
        for (const i of cons.idx) {
          if (assignment[i] === 1) assignedMines++;
          else if (assignment[i] === -1) unassigned++;
        }
        if (assignedMines > cons.required) return false;
        if (assignedMines + unassigned < cons.required) return false;
      }
      return true;
    }

    function backtrack(pos) {
      if (aborted) return;
      nodeCount++;
      if (nodeCount > MAX_NODES) {
        aborted = true;
        return;
      }
      if (pos === n) {
        for (let i = 0; i < n; i++) {
          if (assignment[i] === 1) sawMine[i] = true;
          else sawSafe[i] = true;
        }
        return;
      }
      for (const val of [0, 1]) {
        assignment[pos] = val;
        if (isPartialValid()) backtrack(pos + 1);
        assignment[pos] = -1;
        if (aborted) return;
      }
    }

    backtrack(0);

    if (aborted) {
      truncated = true;
      return;
    }

    varKeys.forEach((k, i) => {
      if (sawMine[i] && !sawSafe[i]) knownMine.add(k);
      else if (sawSafe[i] && !sawMine[i]) knownSafe.add(k);
    });
  });

  const safeCells = new Set([...boundarySet].filter((k) => knownSafe.has(k)));
  const mineCells = new Set([...boundarySet].filter((k) => knownMine.has(k)));

  // 깃발 불일치 경고: 플레이어가 깃발을 꽂았지만 추론상 100% 안전으로 확정된 칸
  const flagWarnings = [];
  boundarySet.forEach((k) => {
    if (!safeCells.has(k)) return;
    const [r, c] = k.split(",").map(Number);
    if (grid[r][c].flagged) flagWarnings.push([r, c]);
  });

  return {
    constraints: displayConstraints,
    boundarySet,
    safeCells,
    mineCells,
    truncated,
    flagWarnings,
  };
}

function renderSatBoard() {
  if (!satCellEls.length) return;
  const result = computeSatInference();
  lastSatResult = result;

  const flagWarningSet = new Set(result.flagWarnings.map(([r, c]) => varKey(r, c)));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      const el = satCellEls[r][c];
      el.className = "cell";
      el.textContent = "";

      if (cell.revealed) {
        el.classList.add("revealed");
        if (cell.mine) {
          el.classList.add("mine");
        } else if (cell.adjacent > 0) {
          el.textContent = cell.adjacent;
          el.classList.add(`n${cell.adjacent}`);
        }
      } else if (cell.flagged) {
        el.classList.add("flag");
        if (flagWarningSet.has(varKey(r, c))) el.classList.add("flag-wrong");
      } else {
        const key = varKey(r, c);
        if (result.mineCells.has(key)) el.classList.add("sat-mine");
        else if (result.safeCells.has(key)) el.classList.add("sat-safe");
      }
    }
  }

  satSummaryEl.textContent =
    `경계 변수: ${result.boundarySet.size}개\n` +
    `제약조건: ${result.constraints.length}개\n` +
    `확정 안전: ${result.safeCells.size}개 (클릭해서 열기)\n` +
    `확정 지뢰: ${result.mineCells.size}개` +
    (result.truncated ? `\n(변수가 매우 많은 영역은 계산을 생략함)` : "");

  satWarningsEl.textContent = result.flagWarnings.length
    ? result.flagWarnings
        .map(([r, c]) => `⚠ (${r},${c}) 깃발이 잘못됐습니다 - 실제로는 안전한 칸입니다.`)
        .join("\n")
    : "";

  satClausesEl.textContent =
    result.constraints
      .map(
        (cons) =>
          `(${cons.clue[0]},${cons.clue[1]}) → 주변 미확인 ${cons.vars.length}칸 중 ${cons.required}개 지뢰`
      )
      .join("\n") || "표시할 제약조건이 없습니다. 먼저 게임 탭에서 칸을 열어보세요.";
}

function refreshSatIfActive() {
  if (satTabEl.classList.contains("active")) renderSatBoard();
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const isSat = btn.dataset.tab === "sat";
    gameTabEl.classList.toggle("active", !isSat);
    satTabEl.classList.toggle("active", isSat);
    if (isSat) renderSatBoard();
  });
});

document.addEventListener("contextmenu", (e) => e.preventDefault());

faceBtn.addEventListener("click", startNewGame);
newGameBtn.addEventListener("click", startNewGame);
difficultySelect.addEventListener("change", startNewGame);

startNewGame();
