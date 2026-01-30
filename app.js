/* =========================
   app.js (V2) — PARTIE 1/2
   ========================= */

/* ==========
   CONFIG
   ========== */

const TEAM_LEADS = [
  { id: "chef1", name: "Chef 1", pinHint: "PIN par défaut : 1111", defaultPin: "1111" },
  { id: "chef2", name: "Chef 2", pinHint: "PIN par défaut : 2222", defaultPin: "2222" },
  { id: "chef3", name: "Chef 3", pinHint: "PIN par défaut : 3333", defaultPin: "3333" },
  { id: "chef4", name: "Chef 4", pinHint: "PIN par défaut : 4444", defaultPin: "4444" },
  { id: "chef5", name: "Chef 5", pinHint: "PIN par défaut : 5555", defaultPin: "5555" },
  { id: "chef6", name: "Chef 6", pinHint: "PIN par défaut : 6666", defaultPin: "6666" },
];

const MANAGER = { id: "manager", name: "Manager", pinHint: "PIN par défaut : 9999", defaultPin: "9999" };

const WEEKLY_BASE_HOURS = 39;

// Règles avancées (paramétrables ensuite)
const RULES = {
  overtimeMultiplier: 1.25,      // exemple : majoration heures sup (affichage)
  nightMultiplier: 1.20,         // majoration heures de nuit (si saisies)
  holidayMultiplier: 2.0,        // majoration férié travaillé (si travail un jour férié)
  countPaidLeaveAsHours: 0,      // si tu veux valoriser congés à 7.8/j, mets 7.8
  countRTTAsHours: 0,
  countSickAsHours: 0,
};

const LS_PREFIX = "heures_app_v2";
const LS_PIN_PREFIX = `${LS_PREFIX}:pin:`;
const LS_MGR_IMPORTS = `${LS_PREFIX}:mgr:imports`;

const ENTRY_TYPES = {
  work: { label: "Travail", badge: "work" },
  leave: { label: "Congé", badge: "leave" },
  rest: { label: "Repos", badge: "rest" },
  rtt: { label: "RTT", badge: "rest" },
  sick:{ label: "Maladie", badge: "leave" },
};

/* ==========
   DOM
   ========== */
const $ = (sel) => document.querySelector(sel);

/* ==========
   UTILS
   ========== */
function pad2(n){ return String(n).padStart(2, "0"); }
function ymd(date){
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
}
function parseYmd(s){
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}
function mondayStart(date){
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 dim .. 6 sam
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}
function clampNumber(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function fmtHours(n){
  const r = Math.round(n * 100) / 100;
  return (Math.abs(r - Math.round(r)) < 1e-9) ? String(Math.round(r)) : String(r);
}
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function formatMonthLabel(d){
  const fmt = new Intl.DateTimeFormat("fr-FR", { month:"long", year:"numeric" });
  const s = fmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2,"0")).join("");
}

/* ==========
   Jours fériés FR (fixes + Pâques)
   - Suffisant pour règle avancée "férié travaillé"
   ========== */
function easterSunday(year){
  // Algorithme de Butcher (Gregorian)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l) / 451);
  const month = Math.floor((h + l - 7*m + 114) / 31); // 3=March,4=April
  const day = ((h + l - 7*m + 114) % 31) + 1;
  return new Date(year, month-1, day);
}
function frHolidaysSet(year){
  const s = new Set();
  const add = (d) => s.add(ymd(d));

  // Fixes
  add(new Date(year,0,1));   // 1 Jan
  add(new Date(year,4,1));   // 1 May
  add(new Date(year,4,8));   // 8 May
  add(new Date(year,6,14));  // 14 Jul
  add(new Date(year,7,15));  // 15 Aug
  add(new Date(year,10,1));  // 1 Nov
  add(new Date(year,10,11)); // 11 Nov
  add(new Date(year,11,25)); // 25 Dec

  // Mobiles
  const easter = easterSunday(year);
  add(addDays(easter, 1));   // Lundi de Pâques
  add(addDays(easter, 39));  // Ascension
  add(addDays(easter, 50));  // Lundi de Pentecôte

  return s;
}

/* ==========
   DATA
   ========== */
function storageKey(teamId){ return `${LS_PREFIX}:team:${teamId}`; }

function loadTeamData(teamId){
  const raw = localStorage.getItem(storageKey(teamId));
  if (!raw) return { entries: {} };
  try{
    const parsed = JSON.parse(raw);
    if (!parsed.entries || typeof parsed.entries !== "object") parsed.entries = {};
    return parsed;
  }catch{
    return { entries: {} };
  }
}
function saveTeamData(teamId, data){
  localStorage.setItem(storageKey(teamId), JSON.stringify(data));
}
function getEntry(data, key){ return data.entries[key] || null; }
function setEntry(data, key, entry){ data.entries[key] = entry; }
function deleteEntry(data, key){ delete data.entries[key]; }

function loadManagerImports(){
  const raw = localStorage.getItem(LS_MGR_IMPORTS);
  if (!raw) return {}; // {chefId: {entries:{...}}}
  try{
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  }catch{
    return {};
  }
}
function saveManagerImports(obj){
  localStorage.setItem(LS_MGR_IMPORTS, JSON.stringify(obj));
}

/* ==========
   STATE
   ========== */
const ALL_TABS = [...TEAM_LEADS, MANAGER];

let currentTab = TEAM_LEADS[0];      // chef ou manager
let currentMonth = startOfMonth(new Date());
let unlocked = new Set();            // tabs unlocked
let teamData = loadTeamData(currentTab.id);

let modalDate = null;
let modalType = "work";

/* ==========
   INIT PINS
   ========== */
async function initPins(){
  for (const t of ALL_TABS){
    const k = LS_PIN_PREFIX + t.id;
    let h = localStorage.getItem(k);
    if (!h){
      h = await sha256Hex(String(t.defaultPin));
      localStorage.setItem(k, h);
    }
  }
}

/* ==========
   CALCULS
   ========== */
function entryBadge(entry){
  if (!entry) return "";
  const meta = ENTRY_TYPES[entry.type] || ENTRY_TYPES.work;
  return `<span class="badge ${meta.badge}">${meta.label}</span>`;
}

function monthKeys(monthDate){
  const m0 = startOfMonth(monthDate);
  const m1 = endOfMonth(monthDate);
  const keys = [];
  for (let d = new Date(m0); d <= m1; d = addDays(d, 1)){
    keys.push(ymd(d));
  }
  return keys;
}

function sumWorkHours(data, keys){
  let total = 0;
  for (const k of keys){
    const e = getEntry(data, k);
    if (e?.type === "work") total += clampNumber(e.hours);
    if (e?.type === "leave") total += RULES.countPaidLeaveAsHours;
    if (e?.type === "rtt") total += RULES.countRTTAsHours;
    if (e?.type === "sick") total += RULES.countSickAsHours;
  }
  return total;
}

function sumNightHours(data, keys){
  let total = 0;
  for (const k of keys){
    const e = getEntry(data, k);
    if (e?.type === "work") total += clampNumber(e.nightHours || 0);
  }
  return total;
}

function sumHolidayWorkedHours(data, keys, holidaysSet){
  let total = 0;
  for (const k of keys){
    const e = getEntry(data, k);
    if (e?.type === "work" && holidaysSet.has(k)) total += clampNumber(e.hours);
  }
  return total;
}

function weeklyBucketsForRange(data, startDate, endDate){
  // returns weeks between [startDate..endDate], each week key = monday ymd
  const start = mondayStart(startDate);
  const end = addDays(mondayStart(endDate), 6);
  const weeks = [];
  for (let w = new Date(start); w <= end; w = addDays(w, 7)){
    const wkStart = new Date(w);
    const wkEnd = addDays(wkStart, 6);
    const keys = [];
    for (let d = new Date(wkStart); d <= wkEnd; d = addDays(d, 1)){
      keys.push(ymd(d));
    }
    const work = sumWorkHours(data, keys);
    const overtime = Math.max(0, work - WEEKLY_BASE_HOURS);
    weeks.push({ wkStart, wkEnd, keys, work, overtime });
  }
  return weeks;
}

function monthOvertimeByWeekStartInMonth(data, monthDate){
  // règle simple et stable : on prend les semaines dont le lundi est dans le mois affiché
  const m0 = startOfMonth(monthDate);
  const m1 = endOfMonth(monthDate);
  const firstMonday = mondayStart(m0);
  const lastMonday = mondayStart(m1);

  let totalOver = 0;
  for (let w = new Date(firstMonday); w <= lastMonday; w = addDays(w, 7)){
    if (w.getMonth() !== monthDate.getMonth()) continue;
    const wk = weeklyBucketsForRange(data, w, addDays(w, 6))[0];
    totalOver += wk.overtime;
  }
  return totalOver;
}

function yearOvertime(data, year){
  // sum overtime per week (lun->dim) for that year based on week monday in year
  const entries = data.entries || {};
  const keys = Object.keys(entries).filter(k => k.startsWith(year + "-"));
  const byWeek = new Map();
  for (const k of keys){
    const e = entries[k];
    if (!e) continue;
    const d = parseYmd(k);
    const mon = mondayStart(d);
    if (mon.getFullYear() !== year) continue;
    const wkKey = ymd(mon);
    const addH =
      (e.type === "work") ? clampNumber(e.hours) :
      (e.type === "leave") ? RULES.countPaidLeaveAsHours :
      (e.type === "rtt") ? RULES.countRTTAsHours :
      (e.type === "sick") ? RULES.countSickAsHours :
      0;
    byWeek.set(wkKey, (byWeek.get(wkKey) || 0) + addH);
  }
  let over = 0;
  for (const hrs of byWeek.values()){
    over += Math.max(0, hrs - WEEKLY_BASE_HOURS);
  }
  return over;
}

function ytdTotals(data, year){
  const entries = data.entries || {};
  const keys = Object.keys(entries).filter(k => k.startsWith(year + "-"));
  let total = 0;
  let night = 0;
  let holidayWorked = 0;
  const holidays = frHolidaysSet(year);

  for (const k of keys){
    const e = entries[k];
    if (!e) continue;
    if (e.type === "work"){
      total += clampNumber(e.hours);
      night += clampNumber(e.nightHours || 0);
      if (holidays.has(k)) holidayWorked += clampNumber(e.hours);
    }
    if (e.type === "leave") total += RULES.countPaidLeaveAsHours;
    if (e.type === "rtt") total += RULES.countRTTAsHours;
    if (e.type === "sick") total += RULES.countSickAsHours;
  }

  const overtime = yearOvertime(data, year);

  // “montants” indicatifs en équivalent-heures majorées
  const overtimePremiumHours = overtime * (RULES.overtimeMultiplier - 1);
  const nightPremiumHours = night * (RULES.nightMultiplier - 1);
  const holidayPremiumHours = holidayWorked * (RULES.holidayMultiplier - 1);

  return { total, overtime, night, holidayWorked, overtimePremiumHours, nightPremiumHours, holidayPremiumHours };
}
/* =========================
   app.js (V2) — PARTIE 2/2
   ========================= */

/* ==========
   RENDER
   ========== */
function renderTabs(){
  const tabs = $("#tabs");
  tabs.innerHTML = "";

  for (const t of ALL_TABS){
    const b = document.createElement("button");
    b.className = "tab" + (t.id === currentTab.id ? " active" : "");
    b.textContent = t.name;
    b.addEventListener("click", async () => {
      if (t.id === currentTab.id) return;
      await switchTab(t);
    });
    tabs.appendChild(b);
  }
}

function renderMonthLabel(){
  $("#monthLabel").textContent = formatMonthLabel(currentMonth);
  $("#mgrMonthLabel").textContent = formatMonthLabel(currentMonth);
}

function renderCalendar(){
  const grid = $("#calGrid");
  grid.innerHTML = "";

  const m0 = startOfMonth(currentMonth);
  const m1 = endOfMonth(currentMonth);
  const start = mondayStart(m0);
  const end = addDays(mondayStart(m1), 6);

  const today = new Date(); today.setHours(0,0,0,0);
  const holidays = frHolidaysSet(currentMonth.getFullYear());

  for (let d = new Date(start); d <= end; d = addDays(d, 1)){
    const cell = document.createElement("div");
    cell.className = "day";
    if (d.getMonth() !== currentMonth.getMonth()) cell.classList.add("muted");

    const key = ymd(d);
    const e = getEntry(teamData, key);

    const top = document.createElement("div");
    top.className = "d";
    top.innerHTML = `
      <div>${d.getDate()}</div>
      <div>
        ${holidays.has(key) ? `<span class="badge leave">Férié</span>` : ""}
        ${entryBadge(e)}
      </div>
    `;

    const bottom = document.createElement("div");
    if (e){
      const hours = (e.type === "work") ? fmtHours(clampNumber(e.hours)) : "";
      bottom.innerHTML = `
        <div class="hours">${e.type === "work" ? hours + "h" : ""}</div>
        <div class="note">${e.note ? escapeHtml(e.note) : ""}</div>
      `;
    }else{
      bottom.innerHTML = `<div class="hours"></div><div class="note"></div>`;
    }

    cell.addEventListener("click", async () => {
      if (currentTab.id === MANAGER.id) return;
      if (!unlocked.has(currentTab.id)){
        const ok = await askPin(currentTab);
        if (!ok) return;
      }
      openDayModal(d);
    });

    if (ymd(d) === ymd(today)){
      cell.style.boxShadow = "0 0 0 3px rgba(78,161,255,.18)";
      cell.style.borderColor = "rgba(78,161,255,.35)";
    }

    cell.appendChild(top);
    cell.appendChild(bottom);
    grid.appendChild(cell);
  }
}

function renderWeekly(){
  const box = $("#weekly");
  box.innerHTML = "";
  const fmt = new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"2-digit" });

  const m0 = startOfMonth(currentMonth);
  const m1 = endOfMonth(currentMonth);
  const weeks = weeklyBucketsForRange(teamData, m0, m1);

  for (const w of weeks){
    const label = `Semaine ${fmt.format(w.wkStart)} → ${fmt.format(w.wkEnd)}`;
    const row = document.createElement("div");
    row.className = "week-row";
    row.innerHTML = `
      <div>
        <div class="w">${label}</div>
        <div class="chip"><span>Total</span> <span class="n">${fmtHours(w.work)}h</span></div>
      </div>
      <div class="chip"><span>Base</span> <span class="n">${fmtHours(WEEKLY_BASE_HOURS)}h</span></div>
      <div class="chip"><span>Sup</span> <span class="n">${fmtHours(w.overtime)}h</span></div>
      <div class="chip"><span>Écart</span> <span class="n">${fmtHours(w.work - WEEKLY_BASE_HOURS)}h</span></div>
    `;
    box.appendChild(row);
  }
}

function renderStats(){
  const stats = $("#stats");

  if (currentTab.id === MANAGER.id){
    stats.innerHTML = `
      <div class="stat"><div class="k">Mode</div><div class="v">Manager</div></div>
      <div class="stat"><div class="k">Période</div><div class="v">${formatMonthLabel(currentMonth)}</div></div>
      <div class="stat"><div class="k">Aide</div><div class="v">Voir panneaux ci-dessous</div></div>
      <div class="stat"><div class="k">Base</div><div class="v">${fmtHours(WEEKLY_BASE_HOURS)}h/sem</div></div>
    `;
    return;
  }

  const year = currentMonth.getFullYear();
  const keysM = monthKeys(currentMonth);
  const holidays = frHolidaysSet(year);

  const monthWork = sumWorkHours(teamData, keysM);
  const monthNight = sumNightHours(teamData, keysM);
  const monthHolidayWorked = sumHolidayWorkedHours(teamData, keysM, holidays);

  const monthOver = monthOvertimeByWeekStartInMonth(teamData, currentMonth);
  const ytd = ytdTotals(teamData, year);

  stats.innerHTML = `
    <div class="stat">
      <div class="k">Mois (heures)</div>
      <div class="v">${fmtHours(monthWork)}h</div>
    </div>
    <div class="stat">
      <div class="k">Mois (heures sup)</div>
      <div class="v">${fmtHours(monthOver)}h</div>
    </div>
    <div class="stat">
      <div class="k">Mois (nuit / férié)</div>
      <div class="v">${fmtHours(monthNight)}h / ${fmtHours(monthHolidayWorked)}h</div>
    </div>
    <div class="stat">
      <div class="k">Année (heures / sup)</div>
      <div class="v">${fmtHours(ytd.total)}h / ${fmtHours(ytd.overtime)}h</div>
    </div>
  `;
}

function renderManager(){
  const mgrGrid = $("#mgrGrid");
  mgrGrid.innerHTML = "";

  const imports = loadManagerImports();

  const getDataForChef = (chefId) => {
    if (imports[chefId]?.entries) return { entries: imports[chefId].entries };
    return loadTeamData(chefId);
  };

  const year = currentMonth.getFullYear();
  const keysM = monthKeys(currentMonth);

  for (const chef of TEAM_LEADS){
    const data = getDataForChef(chef.id);

    const monthH = sumWorkHours(data, keysM);
    const monthOver = monthOvertimeByWeekStartInMonth(data, currentMonth);
    const yOver = yearOvertime(data, year);

    const card = document.createElement("div");
    card.className = "mgr-card";
    card.innerHTML = `
      <div class="h">
        <div class="name">${chef.name}</div>
        <div class="chip"><span>Sup (mois)</span> <span class="n">${fmtHours(monthOver)}h</span></div>
      </div>
      <div class="mgr-row">
        <div class="chip"><span>Heures (mois)</span> <span class="n">${fmtHours(monthH)}h</span></div>
        <div class="chip"><span>Sup (année)</span> <span class="n">${fmtHours(yOver)}h</span></div>
      </div>
      <div class="small">Source: ${imports[chef.id] ? "Import JSON" : "Local navigateur"}</div>
    `;
    mgrGrid.appendChild(card);
  }

  let sumMonth = 0, sumOverMonth = 0;
  for (const chef of TEAM_LEADS){
    const data = getDataForChef(chef.id);
    sumMonth += sumWorkHours(data, keysM);
    sumOverMonth += monthOvertimeByWeekStartInMonth(data, currentMonth);
  }
  const total = document.createElement("div");
  total.className = "mgr-card";
  total.innerHTML = `
    <div class="h">
      <div class="name">TOTAL ÉQUIPE (6)</div>
      <div class="chip"><span>Sup (mois)</span> <span class="n">${fmtHours(sumOverMonth)}h</span></div>
    </div>
    <div class="mgr-row">
      <div class="chip"><span>Heures (mois)</span> <span class="n">${fmtHours(sumMonth)}h</span></div>
      <div class="chip"><span>Base</span> <span class="n">${fmtHours(WEEKLY_BASE_HOURS)}h/sem</span></div>
    </div>
  `;
  mgrGrid.prepend(total);
}

function renderAll(){
  renderTabs();
  renderMonthLabel();

  const isMgr = currentTab.id === MANAGER.id;
  $("#chefView").classList.toggle("hidden", isMgr);
  $("#managerView").classList.toggle("hidden", !isMgr);
  $("#weeklyCard").classList.toggle("hidden", isMgr);

  renderStats();

  if (!isMgr){
    renderCalendar();
    renderWeekly();
  }else{
    renderManager();
  }
}

/* ==========
   MODALS / PIN
   ========== */
function setSegmentActive(type){
  modalType = type;
  document.querySelectorAll(".seg").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  $("#hoursField").style.display = (type === "work") ? "grid" : "none";
}

function openDayModal(dateObj){
  modalDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const key = ymd(modalDate);
  const existing = getEntry(teamData, key);

  $("#modalTitle").textContent = `${currentTab.name} · ${key}`;
  $("#hoursInput").value = (existing?.type === "work") ? String(existing.hours ?? "") : "";
  $("#nightInput").value = (existing?.type === "work") ? String(existing.nightHours ?? "") : "";
  $("#noteInput").value = existing?.note ? String(existing.note) : "";

  setSegmentActive(existing?.type || "work");
  $("#btnDelete").style.display = existing ? "inline-flex" : "none";

  $("#dayModal").showModal();
}

function waitDialogClose(dialogEl){
  return new Promise((resolve) => {
    dialogEl.addEventListener("close", () => resolve(dialogEl.returnValue || "cancel"), { once:true });
  });
}

async function askPin(tab){
  $("#pinTitle").textContent = `Accès – ${tab.name}`;
  $("#pinHelp").textContent = tab.pinHint;
  $("#pinInput").value = "";
  $("#pinModal").showModal();

  const res = await waitDialogClose($("#pinModal"));
  if (res !== "ok") return false;

  const pin = $("#pinInput").value.trim();
  const hash = await sha256Hex(pin);

  const stored = localStorage.getItem(LS_PIN_PREFIX + tab.id);
  if (stored && hash === stored){
    unlocked.add(tab.id);
    return true;
  }
  alert("PIN incorrect.");
  return false;
}

/* ==========
   EXPORT / IMPORT
   ========== */
function exportChefJson(teamId){
  const data = loadTeamData(teamId);
  return {
    app: "heures-chefs",
    version: 2,
    exportedAt: new Date().toISOString(),
    team: { id: teamId, name: (TEAM_LEADS.find(x=>x.id===teamId)?.name || teamId) },
    data
  };
}

function downloadJson(payload, filename){
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCurrent(){
  if (currentTab.id === MANAGER.id){
    alert("En mode manager, utilise Exporter (Global).");
    return;
  }
  const payload = exportChefJson(currentTab.id);
  downloadJson(payload, `${currentTab.id}_${ymd(new Date())}.json`);
}

function exportGlobal(){
  const all = {};
  for (const chef of TEAM_LEADS){
    all[chef.id] = loadTeamData(chef.id);
  }
  const payload = {
    app: "heures-chefs",
    version: 2,
    exportedAt: new Date().toISOString(),
    global: true,
    teams: TEAM_LEADS.map(c => ({ id:c.id, name:c.name })),
    dataByTeam: all
  };
  downloadJson(payload, `global_${ymd(new Date())}.json`);
}

async function importJsonText(text){
  let payload;
  try{ payload = JSON.parse(text); }catch{ return { ok:false, error:"JSON invalide." }; }

  if (!payload || payload.app !== "heures-chefs" || payload.version < 1){
    return { ok:false, error:"Fichier non reconnu." };
  }

  if (payload.global && payload.dataByTeam){
    for (const [teamId, data] of Object.entries(payload.dataByTeam)){
      if (typeof data === "object" && data.entries){
        saveTeamData(teamId, { entries: data.entries });
      }
    }
    return { ok:true, mode:"global" };
  }

  if (payload.team?.id && payload.data?.entries){
    const teamId = payload.team.id;
    saveTeamData(teamId, { entries: payload.data.entries });
    return { ok:true, mode:"chef", teamId };
  }

  return { ok:false, error:"Structure JSON inattendue." };
}

async function importForManager(text){
  let payload;
  try{ payload = JSON.parse(text); }catch{ return { ok:false, error:"JSON invalide." }; }

  const imports = loadManagerImports();

  if (payload.global && payload.dataByTeam){
    for (const [teamId, data] of Object.entries(payload.dataByTeam)){
      if (data?.entries) imports[teamId] = { entries: data.entries };
    }
    saveManagerImports(imports);
    return { ok:true, count:Object.keys(payload.dataByTeam).length };
  }

  if (payload.team?.id && payload.data?.entries){
    imports[payload.team.id] = { entries: payload.data.entries };
    saveManagerImports(imports);
    return { ok:true, count:1 };
  }

  return { ok:false, error:"Fichier non reconnu pour import manager." };
}

/* ==========
   ACTIONS
   ========== */
async function switchTab(tab){
  currentTab = tab;
  teamData = loadTeamData(currentTab.id);
  renderAll();
}

function lockCurrent(){
  unlocked.delete(currentTab.id);
  alert(`Onglet verrouillé : ${currentTab.name}`);
}

/* ==========
   EVENTS
   ========== */
function bindEvents(){
  $("#prevMonth").addEventListener("click", () => {
    currentMonth = startOfMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1, 1));
    renderAll();
  });
  $("#nextMonth").addEventListener("click", () => {
    currentMonth = startOfMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 1));
    renderAll();
  });
  $("#todayBtn").addEventListener("click", () => {
    currentMonth = startOfMonth(new Date());
    renderAll();
  });

  $("#btnLock").addEventListener("click", lockCurrent);

  document.querySelectorAll(".seg").forEach(btn => {
    btn.addEventListener("click", () => setSegmentActive(btn.dataset.type));
  });

  $("#btnSave").addEventListener("click", (ev) => {
    ev.preventDefault();
    if (!modalDate) return;

    const key = ymd(modalDate);
    const note = $("#noteInput").value.trim();

    const entry = { type: modalType, hours: 0, nightHours: 0, note: note || "" };

    if (modalType === "work"){
      entry.hours = clampNumber($("#hoursInput").value);
      entry.nightHours = clampNumber($("#nightInput").value);
    }

    setEntry(teamData, key, entry);
    saveTeamData(currentTab.id, teamData);

    $("#dayModal").close("save");
    renderAll();
  });

  $("#btnDelete").addEventListener("click", () => {
    if (!modalDate) return;
    const key = ymd(modalDate);
    deleteEntry(teamData, key);
    saveTeamData(currentTab.id, teamData);
    $("#dayModal").close("delete");
    renderAll();
  });

  $("#btnExport").addEventListener("click", async () => {
    if (currentTab.id !== MANAGER.id && !unlocked.has(currentTab.id)){
      const ok = await askPin(currentTab);
      if (!ok) return;
    }
    exportCurrent();
  });

  $("#btnExportAll").addEventListener("click", async () => {
    exportGlobal();
  });

  $("#fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (currentTab.id !== MANAGER.id && !unlocked.has(currentTab.id)){
      const ok = await askPin(currentTab);
      if (!ok) return;
    }

    const text = await file.text();
    const res = await importJsonText(text);
    if (!res.ok){
      alert(res.error);
      return;
    }
    teamData = loadTeamData(currentTab.id);
    renderAll();
  });

  $("#fileImportMulti").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    if (!unlocked.has(MANAGER.id)){
      const ok = await askPin(MANAGER);
      if (!ok) return;
    }

    let count = 0;
    for (const f of files){
      const text = await f.text();
      const r = await importForManager(text);
      if (r.ok) count += r.count || 1;
    }
    renderAll();
    alert(`Imports manager : ok (${count})`);
  });

  $("#btnMgrClear").addEventListener("click", async () => {
    if (!unlocked.has(MANAGER.id)){
      const ok = await askPin(MANAGER);
      if (!ok) return;
    }
    saveManagerImports({});
    renderAll();
  });
}

/* ==========
   BOOT
   ========== */
(async function boot(){
  if (!("crypto" in window) || !("subtle" in crypto)){
    alert("WebCrypto non supporté. Mets à jour le navigateur.");
  }
  await initPins();
  bindEvents();
  renderAll();
})();
