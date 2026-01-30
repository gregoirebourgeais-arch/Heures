/* ==========
   CONFIG
   ========== */

const TEAM_LEADS = [
  { id: "chef1", name: "Chef 1", pinHint: "PIN par défaut : 1111", pinHash: null, defaultPin: "1111" },
  { id: "chef2", name: "Chef 2", pinHint: "PIN par défaut : 2222", pinHash: null, defaultPin: "2222" },
  { id: "chef3", name: "Chef 3", pinHint: "PIN par défaut : 3333", pinHash: null, defaultPin: "3333" },
  { id: "chef4", name: "Chef 4", pinHint: "PIN par défaut : 4444", pinHash: null, defaultPin: "4444" },
  { id: "chef5", name: "Chef 5", pinHint: "PIN par défaut : 5555", pinHash: null, defaultPin: "5555" },
  { id: "chef6", name: "Chef 6", pinHint: "PIN par défaut : 6666", pinHash: null, defaultPin: "6666" },
];

// Règle heures sup : base 39h par semaine (lun->dim)
const WEEKLY_BASE_HOURS = 39;

// Stockage local par chef
const LS_PREFIX = "heures_app_v1";

// Types d’entrées
const ENTRY_TYPES = {
  work: { label: "Travail", badge: "work" },
  leave: { label: "Congé", badge: "leave" },
  rest: { label: "Repos", badge: "rest" },
};

/* ==========
   UTILS
   ========== */

const $ = (sel) => document.querySelector(sel);

function pad2(n){ return String(n).padStart(2, "0"); }
function ymd(date){
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}
function parseYmd(s){
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}
function isSameDay(a,b){ return ymd(a) === ymd(b); }

function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }

function mondayStart(date){
  // retourne le lundi de la semaine du date (lun=1..dim=0 en JS)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 dim ... 6 sam
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}
function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function clampNumber(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function formatMonthLabel(d){
  const fmt = new Intl.DateTimeFormat("fr-FR", { month:"long", year:"numeric" });
  const s = fmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtHours(n){
  // Affiche 1 décimale si besoin, sinon entier
  const rounded = Math.round(n * 100) / 100;
  return (Math.abs(rounded - Math.round(rounded)) < 1e-9)
    ? String(Math.round(rounded))
    : String(rounded);
}

async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2,"0")).join("");
}

/* ==========
   DATA
   ========== */

function storageKey(teamId){ return `${LS_PREFIX}:${teamId}`; }

function loadTeamData(teamId){
  const raw = localStorage.getItem(storageKey(teamId));
  if (!raw) return { entries: {} };
  try{
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { entries: {} };
    if (!parsed.entries || typeof parsed.entries !== "object") parsed.entries = {};
    return parsed;
  }catch{
    return { entries: {} };
  }
}

function saveTeamData(teamId, data){
  localStorage.setItem(storageKey(teamId), JSON.stringify(data));
}

// Entrée : { type:"work"|"leave"|"rest", hours:number, note?:string }
function getEntry(data, ymdKey){
  return data.entries[ymdKey] || null;
}
function setEntry(data, ymdKey, entry){
  data.entries[ymdKey] = entry;
}
function deleteEntry(data, ymdKey){
  delete data.entries[ymdKey];
}

/* ==========
   STATE
   ========== */

let currentTeam = TEAM_LEADS[0];
let currentMonth = startOfMonth(new Date());
let unlockedTeams = new Set(); // teams déverrouillés en mémoire (session)
let teamData = loadTeamData(currentTeam.id);

// Modal state
let modalDate = null;
let modalType = "work";

/* ==========
   UI INIT
   ========== */

async function initPins(){
  // Stocke hash PIN en localStorage une fois (si absent)
  // Permet de changer PIN plus tard (variante), ici juste initialisation.
  for (const t of TEAM_LEADS){
    const key = `${LS_PREFIX}:pin:${t.id}`;
    let h = localStorage.getItem(key);
    if (!h){
      h = await sha256Hex(String(t.defaultPin));
      localStorage.setItem(key, h);
    }
    t.pinHash = h;
  }
}

function renderTabs(){
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  for (const t of TEAM_LEADS){
    const b = document.createElement("button");
    b.className = "tab" + (t.id === currentTeam.id ? " active" : "");
    b.textContent = t.name;
    b.addEventListener("click", async () => {
      if (t.id === currentTeam.id) return;
      await switchTeam(t);
    });
    tabs.appendChild(b);
  }
}

function renderMonthLabel(){
  $("#monthLabel").textContent = formatMonthLabel(currentMonth);
}

function entryBadge(entry){
  if (!entry) return "";
  const meta = ENTRY_TYPES[entry.type] || ENTRY_TYPES.work;
  return `<span class="badge ${meta.badge}">${meta.label}</span>`;
}

function renderCalendar(){
  const grid = $("#calGrid");
  grid.innerHTML = "";

  const m0 = startOfMonth(currentMonth);
  const m1 = endOfMonth(currentMonth);

  // calendrier lun->dim : on prend le lundi de la semaine du 1er
  const start = mondayStart(m0);

  // fin = dimanche de la dernière semaine du mois
  const lastMonday = mondayStart(m1);
  const end = addDays(lastMonday, 6);

  const today = new Date();
  today.setHours(0,0,0,0);

  for (let d = new Date(start); d <= end; d = addDays(d, 1)){
    const cell = document.createElement("div");
    cell.className = "day";
    if (d.getMonth() !== currentMonth.getMonth()) cell.classList.add("muted");

    const key = ymd(d);
    const e = getEntry(teamData, key);

    const top = document.createElement("div");
    top.className = "d";
    const left = document.createElement("div");
    left.textContent = d.getDate();

    const right = document.createElement("div");
    right.innerHTML = entryBadge(e);

    top.appendChild(left);
    top.appendChild(right);

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

    // click
    cell.addEventListener("click", async () => {
      // sécurité : si pas déverrouillé, demander PIN
      if (!unlockedTeams.has(currentTeam.id)){
        await askPin(currentTeam);
        if (!unlockedTeams.has(currentTeam.id)) return;
      }
      openDayModal(d);
    });

    // surligner aujourd’hui (léger)
    if (isSameDay(d, today)){
      cell.style.boxShadow = "0 0 0 3px rgba(78,161,255,.18)";
      cell.style.borderColor = "rgba(78,161,255,.35)";
    }

    cell.appendChild(top);
    cell.appendChild(bottom);
    grid.appendChild(cell);
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ==========
   CALCULS
   ========== */

function getMonthKeys(){
  const m0 = startOfMonth(currentMonth);
  const m1 = endOfMonth(currentMonth);
  const keys = [];
  for (let d = new Date(m0); d <= m1; d = addDays(d, 1)){
    keys.push(ymd(d));
  }
  return keys;
}

function sumWorkHoursForKeys(keys){
  let total = 0;
  for (const k of keys){
    const e = getEntry(teamData, k);
    if (e && e.type === "work") total += clampNumber(e.hours);
  }
  return total;
}

function computeWeeklyBucketsInView(){
  // Calcule les semaines qui touchent le mois affiché
  const m0 = startOfMonth(currentMonth);
  const m1 = endOfMonth(currentMonth);

  const start = mondayStart(m0);
  const end = addDays(mondayStart(m1), 6);

  const weeks = [];
  for (let w = new Date(start); w <= end; w = addDays(w, 7)){
    const wkStart = new Date(w);
    const wkEnd = addDays(wkStart, 6);

    const keys = [];
    for (let d = new Date(wkStart); d <= wkEnd; d = addDays(d, 1)){
      keys.push(ymd(d));
    }

    const weekHours = sumWorkHoursForKeys(keys);
    const overtime = Math.max(0, weekHours - WEEKLY_BASE_HOURS);

    weeks.push({
      start: wkStart,
      end: wkEnd,
      weekHours,
      overtime,
      keys
    });
  }
  return weeks;
}

function computeYtdTotals(){
  const year = currentMonth.getFullYear();
  let total = 0;
  let overtime = 0;

  // On balaie toutes les entrées stockées pour l'année
  const entries = teamData.entries || {};
  const keys = Object.keys(entries).filter(k => k.startsWith(year + "-"));

  // Total annuel
  for (const k of keys){
    const e = entries[k];
    if (e && e.type === "work") total += clampNumber(e.hours);
  }

  // Heures sup annuelles : calcul par semaine ISO (lun->dim) sur l'année
  // Stratégie : regrouper par lundi de semaine.
  const byWeek = new Map(); // mondayYmd -> hours
  for (const k of keys){
    const e = entries[k];
    if (!e || e.type !== "work") continue;
    const d = parseYmd(k);
    const mon = mondayStart(d);
    const wkKey = ymd(mon);
    byWeek.set(wkKey, (byWeek.get(wkKey) || 0) + clampNumber(e.hours));
  }
  for (const [_, hrs] of byWeek){
    overtime += Math.max(0, hrs - WEEKLY_BASE_HOURS);
  }

  return { total, overtime, daysWithEntry: keys.length };
}

function renderStats(){
  const monthKeys = getMonthKeys();
  const monthHours = sumWorkHoursForKeys(monthKeys);

  const weeks = computeWeeklyBucketsInView();
  const monthOvertime = weeks.reduce((acc,w) => acc + w.overtime, 0);

  const ytd = computeYtdTotals();

  const stats = $("#stats");
  stats.innerHTML = `
    <div class="stat">
      <div class="k">Mois (heures travail)</div>
      <div class="v">${fmtHours(monthHours)}h</div>
    </div>
    <div class="stat">
      <div class="k">Mois (heures sup)</div>
      <div class="v">${fmtHours(monthOvertime)}h</div>
    </div>
    <div class="stat">
      <div class="k">Année (heures travail)</div>
      <div class="v">${fmtHours(ytd.total)}h</div>
    </div>
    <div class="stat">
      <div class="k">Année (heures sup)</div>
      <div class="v">${fmtHours(ytd.overtime)}h</div>
    </div>
  `;
}

function renderWeekly(){
  const weeks = computeWeeklyBucketsInView();
  const box = $("#weekly");
  box.innerHTML = "";

  const fmt = new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"2-digit" });

  for (const w of weeks){
    const row = document.createElement("div");
    row.className = "week-row";

    const label = `Semaine ${fmt.format(w.start)} → ${fmt.format(w.end)}`;
    row.innerHTML = `
      <div>
        <div class="w">${label}</div>
        <div class="chip"><span>Total</span> <span class="n">${fmtHours(w.weekHours)}h</span></div>
      </div>
      <div class="chip"><span>Base</span> <span class="n">${fmtHours(WEEKLY_BASE_HOURS)}h</span></div>
      <div class="chip"><span>Sup</span> <span class="n">${fmtHours(w.overtime)}h</span></div>
      <div class="chip"><span>Écart</span> <span class="n">${fmtHours(w.weekHours - WEEKLY_BASE_HOURS)}h</span></div>
    `;
    box.appendChild(row);
  }
}

/* ==========
   MODALS
   ========== */

function setSegmentActive(type){
  modalType = type;
  document.querySelectorAll(".seg").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  // Affiche le champ heures uniquement en "work"
  $("#hoursField").style.display = (type === "work") ? "grid" : "none";
}

function openDayModal(dateObj){
  modalDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const key = ymd(modalDate);
  const existing = getEntry(teamData, key);

  $("#modalTitle").textContent = `${currentTeam.name} · ${key}`;
  $("#hoursInput").value = existing && existing.type === "work" ? String(existing.hours ?? "") : "";
  $("#noteInput").value = existing?.note ? String(existing.note) : "";

  const t = existing?.type || "work";
  setSegmentActive(t);

  $("#btnDelete").style.display = existing ? "inline-flex" : "none";

  const modal = $("#dayModal");
  modal.showModal();
}

async function askPin(team){
  const modal = $("#pinModal");
  $("#pinTitle").textContent = `Accès – ${team.name}`;
  $("#pinHelp").textContent = team.pinHint;
  $("#pinInput").value = "";
  modal.showModal();

  const res = await waitDialogClose(modal, $("#pinForm"));
  if (res !== "ok") return false;

  const pin = $("#pinInput").value.trim();
  const hash = await sha256Hex(pin);

  const key = `${LS_PREFIX}:pin:${team.id}`;
  const stored = localStorage.getItem(key);

  if (stored && hash === stored){
    unlockedTeams.add(team.id);
    return true;
  }

  alert("PIN incorrect.");
  return false;
}

function waitDialogClose(dialogEl, formEl){
  return new Promise((resolve) => {
    const handler = () => {
      dialogEl.removeEventListener("close", handler);
      resolve(dialogEl.returnValue || "cancel");
    };
    dialogEl.addEventListener("close", handler, { once:true });
    // (form method=dialog) déclenche close automatiquement
  });
}

/* ==========
   ACTIONS
   ========== */

async function switchTeam(team){
  // verrouille par défaut (demande PIN à la première action)
  currentTeam = team;
  teamData = loadTeamData(currentTeam.id);
  renderAll();
}

function renderAll(){
  renderTabs();
  renderMonthLabel();
  renderStats();
  renderCalendar();
  renderWeekly();
}

function lockCurrent(){
  unlockedTeams.delete(currentTeam.id);
  alert(`Onglet verrouillé : ${currentTeam.name}`);
}

/* ==========
   EXPORT / IMPORT
   ========== */

function exportJson(){
  // export uniquement du chef courant (simple).
  // Variante possible : export global des 6.
  const payload = {
    app: "heures-chefs",
    version: 1,
    exportedAt: new Date().toISOString(),
    team: { id: currentTeam.id, name: currentTeam.name },
    data: teamData
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${currentTeam.id}_${ymd(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJsonFile(file){
  const text = await file.text();
  let payload;
  try{ payload = JSON.parse(text); }catch{ alert("JSON invalide."); return; }

  if (!payload || payload.app !== "heures-chefs" || !payload.data){
    alert("Fichier non reconnu.");
    return;
  }

  if (payload.team?.id !== currentTeam.id){
    const ok = confirm(`Ce fichier semble être pour "${payload.team?.name || payload.team?.id}". Importer quand même dans "${currentTeam.name}" ?`);
    if (!ok) return;
  }

  // merge simple : les clés du fichier écrasent
  const incoming = payload.data.entries || {};
  teamData.entries = teamData.entries || {};
  for (const k of Object.keys(incoming)){
    teamData.entries[k] = incoming[k];
  }
  saveTeamData(currentTeam.id, teamData);
  renderAll();
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

  $("#btnLogout").addEventListener("click", lockCurrent);

  // Modal : type selection
  document.querySelectorAll(".seg").forEach(btn => {
    btn.addEventListener("click", () => setSegmentActive(btn.dataset.type));
  });

  // Modal : save/delete
  $("#btnSave").addEventListener("click", (ev) => {
    ev.preventDefault(); // on gère nous-mêmes
    if (!modalDate) return;

    const key = ymd(modalDate);
    const note = $("#noteInput").value.trim();

    const entry = { type: modalType, hours: 0, note: note || "" };

    if (modalType === "work"){
      const hours = clampNumber($("#hoursInput").value);
      entry.hours = hours;
    }

    setEntry(teamData, key, entry);
    saveTeamData(currentTeam.id, teamData);

    $("#dayModal").close("save");
    renderAll();
  });

  $("#btnDelete").addEventListener("click", () => {
    if (!modalDate) return;
    const key = ymd(modalDate);
    deleteEntry(teamData, key);
    saveTeamData(currentTeam.id, teamData);
    $("#dayModal").close("delete");
    renderAll();
  });

  // Export / Import
  $("#btnExport").addEventListener("click", () => {
    if (!unlockedTeams.has(currentTeam.id)){
      askPin(currentTeam).then(ok => { if (ok) exportJson(); });
      return;
    }
    exportJson();
  });

  $("#fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset
    if (!file) return;

    if (!unlockedTeams.has(currentTeam.id)){
      const ok = await askPin(currentTeam);
      if (!ok) return;
    }

    await importJsonFile(file);
  });

  // PIN modal : validation => on laisse le close method=dialog gérer returnValue
  $("#btnPinOk").addEventListener("click", (ev) => {
    // laisse le close se faire
  });
}

/* ==========
   BOOT
   ========== */

(async function boot(){
  if (!("crypto" in window) || !("subtle" in crypto)){
    alert("Votre navigateur ne supporte pas WebCrypto (SHA-256). Mettez à jour le navigateur.");
  }

  await initPins();
  bindEvents();
  renderAll();
})();
