// ── UI data (trip data lives in /shared/data.js, loaded as globals) ──
const typeOptions = [{value:"beach",label:"Beach"},{value:"cultural",label:"Cultural"},{value:"nature",label:"Nature & Eco"},{value:"food",label:"Food"},{value:"adventure",label:"Adventure"},{value:"wellness",label:"Wellness"},{value:"shopping",label:"Shopping"},{value:"nightlife",label:"Nightlife"},{value:"family",label:"Family"},{value:"cold",label:"Winter"}];
const budgetOptions = [{value:"budget",label:"Budget"},{value:"midrange",label:"Mid-range"},{value:"luxury",label:"Luxury"}];
const paceOptions = [{value:"relaxed",label:"Relaxed"},{value:"balanced",label:"Balanced"},{value:"adventurous",label:"Adventurous"}];
const slotLabels = { morning:"Morning", afternoon:"Afternoon", evening:"Evening" };
const esc = s => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };

function showToast(msg, type) {
  const t = document.createElement("div");
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = msg;
  document.getElementById("toastContainer").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(-6px)"; setTimeout(() => t.remove(), 300); }, 3500);
}
const showError = msg => showToast(msg, "error");
const showSuccess = msg => showToast(msg, "success");

function getDefaultStartDate() { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().split("T")[0]; }
function fmtDate(dateStr) { return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
function timeAgo(dateStr) { if (!dateStr) return ""; const diff = Date.now() - new Date(dateStr).getTime(); const m = Math.floor(diff / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); return h < 24 ? h + "h ago" : Math.floor(h / 24) + "d ago"; }

// ── Visual helpers ──
// Flag files are named like "United-Kingdom.svg".

function flagUrl(country) {
  if (!country) return "";
  return `/img/flags/${country.replace(/\s+/g, "-").toLowerCase()}.svg`;
}

// Destination cover: a soft colour mesh seeded from the country name, so every country gets a stable look.
function destStyle(country) {
  let h = 0;
  for (const ch of country || "") h = (h * 31 + ch.charCodeAt(0)) % 360;
  const h2 = (h + 45) % 360, h3 = (h + 190) % 360;
  return { backgroundImage: `radial-gradient(60% 80% at 15% 20%, hsl(${h} 80% 60% / .95), transparent 60%), radial-gradient(55% 75% at 85% 25%, hsl(${h2} 75% 55% / .85), transparent 65%), radial-gradient(70% 70% at 50% 115%, hsl(${h3} 65% 45% / .9), transparent 65%)` };
}
function weatherSvgUrl(code) {
  const m = { 0:"sun",1:"sun-cloud",2:"cloud",3:"cloud",45:"fog",48:"fog",51:"drizzle",53:"drizzle",55:"drizzle",56:"rain",57:"rain",61:"rain",63:"rain",65:"rain",66:"rain",67:"rain",71:"snow",73:"snow",75:"snow",77:"snow",80:"drizzle",81:"rain",82:"rain",85:"snow",86:"snow",95:"thunder",96:"thunder",99:"thunder" };
  return m[code] || "sun";
}
function badgeHtml(icon, text) {
  if (!text) return "";
  return iconSvg(icon, {size:13,stroke:"currentColor"}) + " " + esc(text);
}

// ── Map state (kept outside Vue so Leaflet objects aren't wrapped in reactive proxies) ──
const SLOT_NAMES = ["morning", "afternoon", "evening"];
let map = null, mapLayer = null, mapMarkers = [], mapRoutes = [];
let landmarkLayer = null, landmarksFor = "";
let liveSource = null, liveWatch = null, livePoll = null;
let genSeq = 0;
const BUDGET_SPLIT = [
  { key: "stay", label: "Stay", share: 0.35, color: "#ff9a6b" },
  { key: "food", label: "Food", share: 0.25, color: "#ff7a8a" },
  { key: "activities", label: "Activities", share: 0.2, color: "#c17bff" },
  { key: "transport", label: "Transport", share: 0.15, color: "#7cf0d0" },
  { key: "misc", label: "Misc", share: 0.05, color: "#9b9aa5" }
];
const MAP_DAY_COLORS = ["#ff9a6b","#c17bff","#7cf0d0","#ffd166","#ff7a8a","#6bb8ff","#b8f26b","#ff9ad5","#9a9bff","#6bffb8"];

const TRAVEL_MODES = [
  { value: "walk", label: "Walk", icon: "walk" },
  { value: "transit", label: "Bus / train", icon: "train" },
  { value: "drive", label: "Taxi / car", icon: "car" },
  { value: "bicycle", label: "Bike", icon: "bike" }
];
const MODE_STYLE = {
  walk: { weight: 4, dashArray: "1 8", opacity: .9 },
  transit: { weight: 5, opacity: .9 },
  drive: { weight: 4, opacity: .8 },
  bicycle: { weight: 4, dashArray: "10 7", opacity: .85 }
};
// Stable key for an activity: its uid, or (for trips saved before uids existed) its name and position.
function actKey(a) { return a.uid || `${a.title}|${(+a.lat || 0).toFixed(4)}|${(+a.lon || 0).toFixed(4)}`; }
// Who pays whom so everyone ends up even, per currency (greedy: largest debtor pays largest creditor).
function settleUp(expenses, memberIds) {
  const byCur = {};
  for (const e of expenses) {
    const split = e.split_among.length ? e.split_among : memberIds;
    const bal = byCur[e.currency] = byCur[e.currency] || {};
    const cents = Math.round(e.amount * 100);
    const share = Math.floor(cents / split.length);
    let rem = cents - share * split.length;
    bal[e.paid_by] = (bal[e.paid_by] || 0) + cents;
    for (const u of split) { bal[u] = (bal[u] || 0) - share - (rem > 0 ? 1 : 0); rem--; }
  }
  const out = {};
  for (const [cur, bal] of Object.entries(byCur)) {
    const debt = Object.entries(bal).filter(([, v]) => v < 0).map(([u, v]) => [+u, -v]).sort((a, b) => b[1] - a[1]);
    const cred = Object.entries(bal).filter(([, v]) => v > 0).map(([u, v]) => [+u, v]).sort((a, b) => b[1] - a[1]);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i][1], cred[j][1]);
      if (amt > 0) transfers.push({ from: debt[i][0], to: cred[j][0], amount: amt / 100 });
      debt[i][1] -= amt; cred[j][1] -= amt;
      if (!debt[i][1]) i++;
      if (!cred[j][1]) j++;
    }
    out[cur] = { balances: Object.fromEntries(Object.entries(bal).map(([u, v]) => [u, v / 100])), transfers };
  }
  return out;
}
function money(amount, cur) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(amount); }
  catch { return cur + " " + amount.toFixed(2); }
}

function safeNext(n) { return n && n.startsWith("/") && !n.startsWith("//") ? n : ""; }

// ── Vue App (Options API) ──
Vue.createApp({
  data() {
    return {
      booted: false, view: "", next: "",
      sessionUser: null, userMenuOpen: false,
      authLogin: "", authUsername: "", authEmail: "", authName: "", authPassword: "", authError: "", authLoading: false,
      usernameAvailable: null, checkUsernameTimeout: null,
      state: { country: "", days: 5, budget: "midrange", pace: "balanced", types: ["cultural"], startDate: getDefaultStartDate(), region: "" },
      generating: false, generateError: "",
      plans: [], budget: null,
      pinDraft: {}, pinMode: null, showLandmarks: true,
      legInfo: {}, travelModes: TRAVEL_MODES,
      comments: [], commentDraft: {}, openThread: null,
      panelTab: "plan", expenses: [], expenseForm: null,
      covers: {},
      SURPRISE: "__surprise__", surpriseCountry: "",
      currentTripId: null, currentRole: null, tripVersion: 1, tripTitle: "",
      tripLastEditedBy: "", tripLastEditedAt: "", tripStartDate: "", activity: [],
      members: [], userTrips: [], tripsLoaded: false,
      hasCoords: false, activeAct: null, focusedDay: null, mobileTab: "list",
      joinCode: "", invite: null, inviteError: "", joining: false,
      shareOpen: false, shareTab: "link", shareRole: "editor", invites: [], freshCode: "",
      regions: REGIONS, typeOptions, budgetOptions, paceOptions, slotLabels, slotNames: SLOT_NAMES,
      previewDays: ["Temples & old town", "Street food crawl", "Island hopping"]
    };
  },
  computed: {
    isSurprise() { return this.state.country === this.SURPRISE; },
    canEdit() { return this.currentRole === "owner" || this.currentRole === "editor"; },
    allCountries() {
      const r = REGIONS[this.state.region];
      return r ? r.countries : Object.keys(COUNTRY_FLAGS).sort();
    },
    marqueeCountries() { const c = Object.keys(COUNTRY_FLAGS); return [...c, ...c]; },
    budgetLabel() { return budgetOptions.find(b => b.value === this.state.budget)?.label || this.state.budget; },
    paceLabel() { return paceOptions.find(p => p.value === this.state.pace)?.label || this.state.pace; },
    firstName() { const n = this.sessionUser?.name || this.sessionUser?.username || ""; return n.split(" ")[0]; },
    nextQuery() { return this.next ? "?next=" + encodeURIComponent(this.next) : ""; },
    normalizedJoinCode() { return this.joinCode.replace(/[\s-]/g, "").toUpperCase(); },
    totalStops() { return this.plans.reduce((n, d) => n + this.dayStops(d), 0); },
    commentsByAct() {
      const m = {};
      for (const c of this.comments) (m[c.act_key] = m[c.act_key] || []).push(c);
      return m;
    },
    tripCurrencies() { return [...new Set([COUNTRY_CURRENCIES[this.state.country] || "SGD", "SGD"])]; },
    settlement() { return settleUp(this.expenses, this.members.map(m => m.id)); },
    anyTransfers() { return Object.values(this.settlement).some(st => st.transfers.length); },
    expenseTotals() {
      const t = {};
      for (const e of this.expenses) t[e.currency] = (t[e.currency] || 0) + e.amount;
      return t;
    },
    linkInvites() { return this.invites.filter(i => i.kind === "link"); },
    codeInvites() { return this.invites.filter(i => i.kind === "code"); }
  },
  watch: {
    view(v) { document.getElementById("scenery")?.classList.toggle("dim", v === "trip"); },
    showLandmarks(on) { if (map && landmarkLayer) on ? landmarkLayer.addTo(map) : landmarkLayer.remove(); }
  },
  methods: {
    // ── Template helpers ──
    icon(name, size) { return iconSvg(name, { size: size || 16, stroke: "currentColor" }); },
    badge(i, t) { return badgeHtml(i, t); },
    flagUrl, destStyle, fmtDate, timeAgo,
    weatherIcon(code) { return weatherSvgUrl(code); },
    actKey,
    money,
    commentLabel(a) { const n = (this.commentsByAct[actKey(a)] || []).length; return n ? `${n} comment${n > 1 ? "s" : ""}` : "Comment"; },
    balanceText(v, cur) { return v > 0.004 ? "gets back " + money(v, cur) : v < -0.004 ? "owes " + money(-v, cur) : "even"; },
    memberName(id) { const m = this.members.find(m => m.id === +id); return m ? "@" + (m.username || m.name) : "former member"; },
    isMe(id) { return this.sessionUser && +id === this.sessionUser.id; },
    modeMeta(v) { return TRAVEL_MODES.find(m => m.value === v) || TRAVEL_MODES[0]; },
    // The stop before this one on the same day (across morning/afternoon/evening), if any.
    prevStop(day, slot, ai) {
      const flat = SLOT_NAMES.flatMap(s => day.slots[s] || []);
      const i = flat.indexOf(day.slots[slot][ai]);
      return i > 0 ? flat[i - 1] : null;
    },
    // Country photo (Wikipedia landmark image via the server), fetched once per country.
    cover(country) {
      if (!country) return "";
      if (!(country in this.covers)) {
        this.covers[country] = null;
        fetch("/api/covers/" + encodeURIComponent(country)).then(r => r.ok ? r.json() : null)
          .then(d => { this.covers[country] = d || ""; }).catch(() => { this.covers[country] = ""; });
      }
      return this.covers[country]?.url || "";
    },
    coverCredit(country) { const c = this.covers[country]; return c?.landmark ? { name: c.landmark, url: c.pageUrl } : null; },
    initial(u) { return ((u && (u.username || u.name)) || "?").charAt(0).toUpperCase(); },
    dayColor(d) { return MAP_DAY_COLORS[(d - 1) % MAP_DAY_COLORS.length]; },
    dayStops(day) { return SLOT_NAMES.reduce((n, s) => n + (day.slots?.[s]?.length || 0), 0); },
    shortDesc(a) {
      if (a.custom) return a.loc || "Pinned on the map";
      const d = a.desc && a.desc.length > 5 ? a.desc : "Visit " + a.title; return d.length > 300 ? d.slice(0, 300) + "…" : d; },
    dayActNum(dn, slot, ai) {
      let n = 0;
      for (const d of this.plans) { if (d.day >= dn) break; n += this.dayStops(d); }
      const day = this.plans.find(p => p.day === dn);
      for (const s of SLOT_NAMES) { if (s === slot) return n + ai + 1; n += day?.slots[s]?.length || 0; }
      return n + 1;
    },

    // ── Routing ──
    go(path, replace) {
      history[replace ? "replaceState" : "pushState"]({}, "", path);
      this.route();
      window.scrollTo(0, 0);
    },
    route() {
      const p = location.pathname;
      this.userMenuOpen = false;
      this.next = safeNext(new URLSearchParams(location.search).get("next"));
      const tripMatch = p.match(/^\/trip\/([a-f0-9]+)$/);
      if (this.view === "trip" && !(tripMatch && tripMatch[1] === this.currentTripId)) this.leaveTrip();

      if (p === "/login" || p === "/signup") {
        if (this.sessionUser && !this.sessionUser.needsUsername) return this.go(this.next || "/plan", true);
        this.authError = ""; this.view = p.slice(1); return;
      }
      // Everything else requires an account; signed-out visitors only see the landing page.
      if (!this.sessionUser) {
        if (p === "/") { this.view = "landing"; this.$nextTick(() => this.observeReveals()); return; }
        return this.go("/login?next=" + encodeURIComponent(p), true);
      }
      if (this.sessionUser.needsUsername) { this.view = "need-username"; return; }
      if (tripMatch) { if (tripMatch[1] !== this.currentTripId || this.view !== "trip") this.loadTrip(tripMatch[1]); return; }
      const joinMatch = p.match(/^\/join\/([A-Za-z0-9-]+)$/);
      if (joinMatch) { this.view = "join"; this.loadInvite(joinMatch[1]); return; }
      if (p === "/my-trips") { this.view = "trips"; this.loadMyTrips(); return; }
      if (p !== "/" && p !== "/plan") history.replaceState({}, "", "/plan");
      this.view = "planner";
      this.loadMyTrips();
    },
    observeReveals() {
      const els = document.querySelectorAll("[data-reveal]:not(.in)");
      if (!("IntersectionObserver" in window)) { els.forEach(e => e.classList.add("in")); return; }
      const io = new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }, { threshold: 0.15 });
      els.forEach(e => io.observe(e));
    },

    // ── Auth ──
    async checkSession() {
      try { const r = await fetch("/api/auth/me"); if (r.ok) this.sessionUser = (await r.json()).user; } catch {}
    },
    async loginAction() {
      if (!this.authLogin || !this.authPassword) { this.authError = "Enter your username/email and password."; return; }
      this.authLoading = true; this.authError = "";
      try {
        const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: this.authLogin, password: this.authPassword }) });
        const d = await r.json();
        if (!r.ok) { this.authError = d.error || "Invalid login."; return; }
        this.sessionUser = d.user; this.authPassword = "";
        if (d.user.needsUsername) { this.view = "need-username"; return; }
        this.go(this.next || "/plan", true);
      } catch { this.authError = "Network error."; }
      finally { this.authLoading = false; }
    },
    async registerAction() {
      if (!this.authUsername || !this.authEmail || !this.authName || !this.authPassword) { this.authError = "All fields are required."; return; }
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(this.authUsername)) { this.authError = "Username: 3-20 letters, numbers, underscores."; return; }
      if (this.authPassword.length < 6) { this.authError = "Password must be at least 6 characters."; return; }
      this.authLoading = true; this.authError = "";
      try {
        const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: this.authUsername, email: this.authEmail, name: this.authName, password: this.authPassword }) });
        const d = await r.json();
        if (!r.ok) { this.authError = d.error || "Sign up failed."; return; }
        this.sessionUser = d.user; this.authPassword = "";
        this.go(this.next || "/plan", true);
      } catch { this.authError = "Network error."; }
      finally { this.authLoading = false; }
    },
    async setUsernameAction() {
      if (!this.authUsername || this.usernameAvailable !== true) return;
      try {
        const r = await fetch("/api/auth/set-username", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: this.authUsername }) });
        const d = await r.json();
        if (!r.ok) { this.authError = d.error || "Failed."; return; }
        this.sessionUser.username = this.authUsername; this.sessionUser.needsUsername = 0;
        this.go(this.next || "/plan", true);
      } catch { this.authError = "Network error."; }
    },
    checkUsernameDebounced() {
      this.usernameAvailable = null; clearTimeout(this.checkUsernameTimeout);
      if (!this.authUsername || this.authUsername.length < 2 || !/^[a-zA-Z0-9_]+$/.test(this.authUsername)) return;
      this.checkUsernameTimeout = setTimeout(async () => {
        try { const r = await fetch("/api/auth/check-username?username=" + encodeURIComponent(this.authUsername)); this.usernameAvailable = (await r.json()).available; } catch {}
      }, 300);
    },
    async logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/"; },

    // ── Planner ──
    toggleType(val) { const t = this.state.types; const i = t.indexOf(val); if (i >= 0) t.splice(i, 1); else t.push(val); if (!t.length) t.push("cultural"); },
    joinWithCode() { if (this.normalizedJoinCode.length === 6) this.go("/join/" + this.normalizedJoinCode); },
    async loadMyTrips() {
      try { const r = await fetch("/api/trips"); if (r.ok) this.userTrips = (await r.json()).trips || []; } catch {}
      this.tripsLoaded = true;
    },
    resetTrip() {
      this.plans = []; this.budget = null; this.generateError = ""; this.activity = []; this.tripStartDate = "";
      this.currentTripId = null; this.currentRole = null; this.tripVersion = 1; this.tripTitle = "";
      this.tripLastEditedBy = ""; this.tripLastEditedAt = ""; this.members = [];
      this.activeAct = null; this.focusedDay = null; this.mobileTab = "list"; this.hasCoords = false;
      this.legInfo = {}; this.comments = []; this.commentDraft = {}; this.openThread = null;
      this.panelTab = "plan"; this.expenses = []; this.expenseForm = null;
    },
    leaveTrip() {
      genSeq++;
      this.generating = false; this.shareOpen = false;
      this.closeLive();
      if (map) { try { map.remove(); } catch {} map = null; mapLayer = null; mapMarkers = []; mapRoutes = []; landmarkLayer = null; landmarksFor = ""; }
      this.pinMode = null; this.pinDraft = {};
      this.resetTrip();
    },
    preparePlans(plans) {
      plans.forEach(d => {
        d.open = d.day === 1;
        for (const s of SLOT_NAMES) for (const a of d.slots?.[s] || []) a._globalIdx = a.uid; // stops are keyed by their server uuid
      });
      return plans;
    },
    // Create the trip on the server (it generates the itinerary), then show it.
    async generate() {
      if (!this.state.country) { showError("Choose a country, or pick Surprise me."); return; }
      // Surprise me: pick a random country from the chosen region (or anywhere), preferring ones
      // the user hasn't planned before. It's revealed on the trip page.
      if (this.isSurprise) {
        const pick = pickSurprise(this.allCountries, this.userTrips.map(t => t.country));
        if (!pick) { showError("No countries to pick from."); return; }
        this.state.country = pick;
        this.surpriseCountry = pick;
      } else this.surpriseCountry = "";
      this.leaveTrip();
      const seq = genSeq;
      this.view = "trip"; this.generating = true;
      this.tripTitle = `${this.state.days} days in ${this.state.country}`;
      await this.$nextTick();
      this.ensureMap();
      try {
        const d = await this.api("POST", "/api/trips", { country: this.state.country, days: this.state.days, budget: this.state.budget, pace: this.state.pace, types: this.state.types, startDate: this.state.startDate || undefined });
        if (seq !== genSeq) return;
        this.currentTripId = d.id;
        history.replaceState({}, "", "/trip/" + d.id);
        this.applyTrip(d.trip, d.role);
        this.renderMap();
        await this.renderBudget();
        if (this.surpriseCountry === d.trip.country) showSuccess(`🎲 Surprise! You're off to ${d.trip.country}`);
        this.openLive();
        this.refreshMembers();
        this.refreshSocial();
      } catch (e) {
        if (seq === genSeq) this.generateError = e.message || "Unexpected error during generation.";
      } finally {
        if (seq === genSeq) this.generating = false;
      }
    },
    async regenerate() {
      const seq = genSeq;
      this.generating = true;
      try {
        const d = await this.api("POST", `/api/trips/${this.currentTripId}/regenerate`);
        if (seq !== genSeq) return;
        this.applyTrip(d.trip, this.currentRole);
        this.renderMap();
        await this.renderBudget();
      } catch (e) { showError(e.message); }
      finally { if (seq === genSeq) this.generating = false; }
    },

    // ── Trip load / save / live updates ──
    applyTrip(t, role) {
      const openDays = new Set(this.plans.filter(p => p.open).map(p => p.day));
      this.currentRole = role;
      this.tripVersion = t.version;
      this.tripTitle = t.title;
      this.tripLastEditedBy = t.last_edited_by_name || "";
      this.tripLastEditedAt = t.updated_at || "";
      this.tripStartDate = t.start_date || t.result?.dates?.[0] || "";
      Object.assign(this.state, { country: t.country, days: t.days, budget: t.budget, pace: t.pace, types: t.types || ["cultural"], region: "" });
      if (t.result?.plans) {
        this.plans = this.preparePlans(t.result.plans);
        if (openDays.size) this.plans.forEach(d => { d.open = openDays.has(d.day); });
      } else this.plans = [];
    },
    async loadTrip(id) {
      this.leaveTrip();
      const seq = genSeq;
      this.view = "trip"; this.currentTripId = id;
      try {
        const r = await fetch("/api/trips/" + id);
        if (seq !== genSeq) return;
        if (r.status === 401) return this.go("/login?next=" + encodeURIComponent("/trip/" + id), true);
        if (!r.ok) { showError(r.status === 404 ? "Trip not found." : "You don't have access to this trip."); return this.go("/my-trips", true); }
        const d = await r.json();
        this.applyTrip(d.trip, d.role);
        await this.$nextTick();
        this.ensureMap();
        this.openLive();
        this.refreshMembers();
        this.refreshSocial();
        this.refreshActivity();
        if (this.plans.length) { this.renderMap(); await this.renderBudget(); }
        else if (this.canEdit) await this.regenerate();
      } catch { showError("Network error."); }
    },
    // Every itinerary edit is one operation on the server; its reply (the saved trip) replaces local state.
    async runOp(op, args, okMsg) {
      try {
        const d = await this.api("POST", `/api/trips/${this.currentTripId}/ops`, { op, args });
        this.applyTrip(d.trip, this.currentRole);
        this.renderMap(false);
        if (op === "set_dates") this.renderBudget();
        if (okMsg) showSuccess(okMsg);
        this.refreshActivity();
        return d;
      } catch (e) {
        showError(e.message);
        this.onRemoteUpdate(true);
        return null;
      }
    },
    closeLive() {
      if (liveSource) { liveSource.close(); liveSource = null; }
      clearInterval(liveWatch); clearInterval(livePoll); liveWatch = livePoll = null;
    },
    // Live updates over SSE. Some proxies (e.g. Cloudflare quick tunnels) buffer SSE, so if no message
    // (the server sends one at once, then a ping every 20s) arrives in time, fall back to polling every 10s.
    openLive() {
      this.closeLive();
      if (!this.currentTripId) return;
      const startPolling = () => {
        if (livePoll) return;
        if (liveSource) { liveSource.close(); liveSource = null; }
        clearInterval(liveWatch); liveWatch = null;
        livePoll = setInterval(() => { this.onRemoteUpdate(); this.refreshSocial(); this.refreshMembers(); this.refreshActivity(); }, 10_000);
      };
      if (!window.EventSource) return startPolling();
      let lastMsg = 0;
      const opened = Date.now();
      liveSource = new EventSource("/api/trips/" + this.currentTripId + "/sse");
      liveSource.onmessage = e => {
        lastMsg = Date.now();
        let msg = {}; try { msg = JSON.parse(e.data); } catch {}
        if (msg.type === "deleted") { showError("This trip was deleted."); return this.go("/my-trips", true); }
        if (msg.type === "trip" && msg.version !== this.tripVersion) this.onRemoteUpdate();
        if (msg.type === "social") { this.refreshSocial(); this.refreshMembers(); }
        if (msg.type && msg.type !== "ping") this.refreshActivity();
      };
      liveWatch = setInterval(() => {
        if ((!lastMsg && Date.now() - opened > 6000) || (lastMsg && Date.now() - lastMsg > 50_000)) startPolling();
      }, 3000);
    },
    async onRemoteUpdate(force) {
      if (!this.currentTripId) return;
      const id = this.currentTripId;
      try {
        const r = await fetch("/api/trips/" + id);
        if (id !== this.currentTripId) return;
        if (r.status === 403) { showError("You no longer have access to this trip."); return this.go("/my-trips", true); }
        if (!r.ok) return;
        const d = await r.json();
        this.refreshMembers();
        if (d.trip.version !== this.tripVersion || force) {
          const by = d.trip.last_edited_by !== this.sessionUser?.id ? d.trip.last_edited_by_name : "";
          this.applyTrip(d.trip, d.role);
          this.renderMap(false);
          await this.renderBudget();
          if (!force && by) showToast("Updated by @" + by);
        } else this.currentRole = d.role;
      } catch {}
    },
    async refreshActivity() {
      if (!this.currentTripId) return;
      try { const r = await fetch(`/api/trips/${this.currentTripId}/activity`); if (r.ok) this.activity = (await r.json()).activity; } catch {}
    },
    async refreshSocial() {
      const id = this.currentTripId;
      if (!id) return;
      try {
        const [c, e] = await Promise.all([fetch(`/api/trips/${id}/comments`), fetch(`/api/trips/${id}/expenses`)]);
        if (id !== this.currentTripId) return;
        if (c.ok) this.comments = (await c.json()).comments;
        if (e.ok) this.expenses = (await e.json()).expenses;
      } catch {}
    },
    async api(method, url, body) {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong");
      return d;
    },

    // ── Comments: each member adds their own ──
    toggleThread(a) { const k = actKey(a); this.openThread = this.openThread === k ? null : k; },
    async postComment(a) {
      const k = actKey(a);
      const text = (this.commentDraft[k] || "").trim();
      if (!text) return;
      try {
        await this.api("POST", `/api/trips/${this.currentTripId}/comments`, { stopId: k, text });
        this.commentDraft[k] = "";
        this.refreshSocial();
      } catch (e) { showError(e.message); }
    },
    async deleteComment(c) {
      try { await this.api("DELETE", `/api/trips/${this.currentTripId}/comments/${c.id}`); this.refreshSocial(); }
      catch (e) { showError(e.message); }
    },

    // ── Expenses / split costs ──
    newExpense() {
      this.expenseForm = { description: "", amount: "", currency: this.tripCurrencies[0], paidBy: this.sessionUser.id, splitAmong: this.members.map(m => m.id) };
    },
    toggleSplit(id) {
      const s = this.expenseForm.splitAmong, i = s.indexOf(id);
      if (i >= 0) { if (s.length > 1) s.splice(i, 1); } else s.push(id);
    },
    async saveExpense() {
      const f = this.expenseForm;
      try {
        await this.api("POST", `/api/trips/${this.currentTripId}/expenses`, { ...f, amount: parseFloat(f.amount) });
        this.expenseForm = null;
        this.refreshSocial();
        showSuccess("Expense added");
      } catch (e) { showError(e.message); }
    },
    async deleteExpense(e) {
      try { await this.api("DELETE", `/api/trips/${this.currentTripId}/expenses/${e.id}`); this.refreshSocial(); }
      catch (err) { showError(err.message); }
    },
    canDeleteExpense(e) { return this.currentRole === "owner" || this.isMe(e.paid_by) || this.isMe(e.created_by); },

    // ── Travel between stops ──
    setLegMode(a, mode) { this.runOp("set_stop_details", { stopId: a.uid, details: { travelMode: mode } }); },
    async refreshMembers() {
      if (!this.currentTripId) return;
      try { const r = await fetch("/api/trips/" + this.currentTripId + "/members"); if (r.ok) this.members = (await r.json()).members; } catch {}
    },

    // ── Itinerary editing ──
    toggleDay(day) { day.open = !day.open; if (day.open) this.focusDay(day.day); },
    findAct(d, s, ai) { const day = this.plans.find(p => p.day === d); return day ? { day, act: day.slots[s]?.[ai] } : null; },
    moveAct(d, s, ai, dir) {
      const f = this.findAct(d, s, ai);
      if (f?.act) this.runOp("move_stop", { stopId: f.act.uid, toDay: d, toSlot: s, toIndex: ai + dir });
    },
    moveToDay(fd, fs, ai, td) {
      const f = this.findAct(fd, fs, ai);
      if (td && f?.act) this.runOp("move_stop", { stopId: f.act.uid, toDay: td }, `Moved to day ${td}`);
    },
    removeAct(d, s, ai) { const f = this.findAct(d, s, ai); if (f?.act) this.runOp("remove_stop", { stopId: f.act.uid }); },
    editNote(a) {
      const n = prompt(`Shared note for ${a.title} (everyone on the trip sees this):`, a.note || "");
      if (n !== null) this.runOp("set_note", { stopId: a.uid, note: n.trim() });
    },
    editTitle() { const t = prompt("Rename trip:", this.tripTitle); if (t?.trim()) this.runOp("rename_trip", { title: t.trim() }); },
    setStartDate(v) { if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== this.tripStartDate) this.runOp("set_dates", { startDate: v }, "Dates updated"); },
    // ── Pin a custom place on the map (works for anywhere, not just places the search knows about) ──
    async startPin(dayNum) {
      const name = (this.pinDraft[dayNum] || "").trim();
      if (!name) return;
      this.pinMode = { day: dayNum, name };
      if (window.matchMedia("(max-width: 900px)").matches) await this.setMobileTab("map");
      // Jump near the place if we can find it, so it's easy to drop the pin; the user still picks the exact spot.
      const c = map?.getCenter();
      geocodePlace(name, this.state.country, c ? { lat: c.lat, lon: c.lng } : null).then(hit => {
        if (hit && this.pinMode?.name === name && this.mapVisible()) map.flyTo([hit.lat, hit.lon], 16, { duration: 0.8 });
      });
    },
    cancelPin() { this.pinMode = null; },
    async onMapClick(e) {
      if (!this.pinMode) return;
      const { day: dayNum, name } = this.pinMode;
      this.pinMode = null;
      const { lat, lng } = e.latlng;
      const loc = await reverseGeocode(lat, lng);
      const d = await this.runOp("add_stop", { day: dayNum, slot: "evening", stop: { title: name, lat, lon: lng, loc: loc || undefined, dur: "1h", custom: true } }, `Pinned ${name} to Day ${dayNum}`);
      if (!d) return;
      this.pinDraft[dayNum] = "";
      const day = this.plans.find(p => p.day === dayNum);
      if (day) day.open = true;
      this.activeAct = d.stopId;
      this.$nextTick(() => this.highlightPin(d.stopId));
    },
    addActivity(dayNum, p) {
      this.runOp("add_stop", { day: dayNum, slot: "evening", stop: p }, `Added ${p.title} to Day ${dayNum}`)
        .then(d => { const day = d && this.plans.find(x => x.day === dayNum); if (day) day.open = true; });
    },
    async renderBudget() {
      const bg = getDailyBudget(this.state.country, this.state.budget);
      if (!bg || bg.local <= 0) { this.budget = null; return; }
      let sgd = bg.local, note = "";
      if (bg.currency !== "SGD") {
        try { const rate = await getExchangeRate(bg.currency, "SGD"); if (typeof rate === "number" && rate > 0) { sgd = bg.local * rate; note = " · converted from " + bg.currency; } else note = " · est."; } catch { note = " · est."; }
      }
      if (!(sgd > 0)) { sgd = { budget: 35, midrange: 80, luxury: 200 }[this.state.budget] || 80; note = " · approx."; }
      const perDay = Math.round(sgd);
      this.budget = {
        perDay, total: perDay * this.state.days, note,
        breakdown: BUDGET_SPLIT.map(b => ({ label: b.label, color: b.color, pct: b.share, value: Math.round(perDay * b.share) }))
      };
    },

    // ── Map ──
    ensureMap() {
      const el = document.getElementById("tripMap");
      if (map || !el) return;
      const c = COUNTRY_COORDS[this.state.country] || [20, 0];
      map = L.map(el, { zoomControl: true, attributionControl: true, minZoom: 3, worldCopyJump: true }).setView(c, 5);
      // OpenFreeMap vector tiles (free, no key). Labels are switched to English, falling back to the Latin spelling.
      const gl = L.maplibreGL({ style: "https://tiles.openfreemap.org/styles/liberty", attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · Routes &amp; places: <a href="https://www.geoapify.com/" target="_blank">Powered by Geoapify</a>' }).addTo(map);
      const glMap = gl.getMaplibreMap();
      const EN_LABEL = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
      const EN_JSON = JSON.stringify(EN_LABEL);
      glMap.on("styledata", () => {
        for (const layer of glMap.getStyle()?.layers || []) {
          const tf = JSON.stringify(layer.layout?.["text-field"] || "");
          // Skip layers already switched; setLayoutProperty fires styledata again.
          if (tf.includes("name") && tf !== EN_JSON) glMap.setLayoutProperty(layer.id, "text-field", EN_LABEL);
        }
      });
      mapLayer = L.layerGroup().addTo(map);
      map.on("click", e => this.onMapClick(e));
      // Landmark name labels only appear once zoomed in, so the overview stays readable.
      const syncLabels = () => el.classList.toggle("lm-far", map.getZoom() < 12);
      map.on("zoomend", syncLabels); syncLabels();
    },
    renderMap(fit = true) {
      this.ensureMap();
      if (!map) return;
      mapLayer.clearLayers(); mapMarkers = []; mapRoutes = []; this.legInfo = {};
      const layer = mapLayer;
      const byDay = {};
      let n = 1;
      for (const day of this.plans) for (const s of SLOT_NAMES) for (const a of day.slots[s] || []) {
        if (!a.lat || !a.lon) { n++; continue; }
        const color = this.dayColor(day.day);
        const icon = L.divIcon({ html: `<div class="pin${a.custom ? " custom" : ""}" style="background:${color}">${n}</div>`, iconSize: [28, 28], iconAnchor: [14, 14], className: "" });
        const draggable = !!a.custom && this.canEdit;
        const marker = L.marker([a.lat, a.lon], { icon, draggable }).bindPopup(`<b>${esc(a.title)}</b><br><span style="color:#5d6a6f">Day ${day.day} · ${slotLabels[s]}${draggable ? " · drag to move" : ""}</span>`);
        marker.on("click", () => this.selectFromMap(a._globalIdx, day.day));
        if (draggable) marker.on("dragend", async ev => {
          const ll = ev.target.getLatLng();
          const loc = await reverseGeocode(ll.lat, ll.lng);
          this.runOp("set_stop_details", { stopId: a.uid, details: { lat: ll.lat, lon: ll.lng, ...(loc ? { loc } : {}) } });
        });
        marker.addTo(layer);
        mapMarkers.push({ marker, idx: a._globalIdx, day: day.day });
        (byDay[day.day] = byDay[day.day] || []).push(a);
        n++;
      }
      this.hasCoords = mapMarkers.length > 0;
      if (!this.hasCoords) return;
      // One route per leg (stop → next stop) in the mode the group chose, so every pair of stops is joined.
      for (const [dn, acts] of Object.entries(byDay)) {
        const color = this.dayColor(+dn);
        for (let i = 1; i < acts.length; i++) {
          const from = acts[i - 1], to = acts[i];
          const km = haversineDist(from.lat, from.lon, to.lat, to.lon);
          const mode = to.travelMode || (km < 1.2 ? "walk" : "transit");
          const key = actKey(to);
          // Straight dashed placeholder until the real route arrives (and as the fallback if routing fails).
          const straight = L.polyline([[from.lat, from.lon], [to.lat, to.lon]], { color, weight: 3, opacity: .55, dashArray: "4 8" }).addTo(layer);
          const entry = { day: +dn, line: straight };
          mapRoutes.push(entry);
          const speed = { walk: 4.8, bicycle: 15, drive: 30, transit: 20 }[mode];
          this.legInfo[key] = { mode, km: Math.round(km * 10) / 10, min: Math.max(1, Math.round(km / speed * 60 + (mode === "transit" ? 5 : 0))), approx: true, loading: true };
          getLegRoute({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }, mode).then(r => {
            if (layer !== mapLayer) return;
            if (!r) { this.legInfo[key] = { ...this.legInfo[key], loading: false }; return; }
            layer.removeLayer(straight);
            // Join the route onto both pins so the path is visibly continuous.
            const pts = [[from.lat, from.lon], ...r.coords, [to.lat, to.lon]];
            entry.line = L.polyline(pts, { color, lineCap: "round", lineJoin: "round", ...MODE_STYLE[r.mode] }).addTo(layer);
            this.legInfo[key] = { mode: r.mode, requested: mode, km: r.km, min: r.min, line: r.line, fallback: r.fallback, approx: false };
            this.applyDayFocus();
          });
        }
      }
      this.applyDayFocus();
      if (fit) this.fitTo(this.focusedDay);
      this.loadLandmarks();
    },
    // English-named sights near the trip, as small labelled dots. Any of them can be added to a day from its popup.
    async loadLandmarks() {
      const stops = mapMarkers.map(m => m.marker.getLatLng());
      if (!map || !stops.length) return;
      const lat = stops.reduce((t, p) => t + p.lat, 0) / stops.length;
      const lon = stops.reduce((t, p) => t + p.lng, 0) / stops.length;
      const key = lat.toFixed(2) + "," + lon.toFixed(2);
      if (landmarksFor === key) return;
      landmarksFor = key;
      const places = await getPlaces(lat, lon, ["tourism.attraction", "tourism.sights", "heritage", "leisure.park", "natural"], 60);
      if (!map || landmarksFor !== key) return;
      if (landmarkLayer) landmarkLayer.remove();
      landmarkLayer = L.layerGroup();
      const stopNames = new Set(this.plans.flatMap(d => SLOT_NAMES.flatMap(s => (d.slots[s] || []).map(a => (a.title || "").toLowerCase()))));
      const seen = new Set();
      for (const p of places) {
        if (!p.localName || !isLatinScript(p.name)) continue; // unnamed or no English name
        const k = p.name.toLowerCase();
        if (seen.has(k) || stopNames.has(k)) continue;
        seen.add(k);
        const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ html: '<div class="lm-dot"></div>', iconSize: [10, 10], iconAnchor: [5, 5], className: "" }) });
        m.bindTooltip(esc(p.name), { permanent: true, direction: "right", offset: [6, 0], className: "lm-label" });
        m.bindPopup(() => this.landmarkPopup(p));
        m.addTo(landmarkLayer);
      }
      if (this.showLandmarks) landmarkLayer.addTo(map);
    },
    landmarkPopup(p) {
      const el = document.createElement("div");
      const cat = (p.categories[0] || "").split(".").pop().replace(/_/g, " ");
      el.innerHTML = `<b>${esc(p.name)}</b>${cat ? `<br><span style="color:#5d6a6f;text-transform:capitalize">${esc(cat)}</span>` : ""}`;
      if (!this.canEdit) return el;
      const row = document.createElement("div");
      row.className = "popup-add";
      const sel = document.createElement("select");
      for (const d of this.plans) sel.add(new Option("Day " + d.day, d.day, false, d.day === (this.focusedDay || 1)));
      const btn = document.createElement("button");
      btn.textContent = "Add to trip";
      btn.onclick = () => {
        this.addActivity(+sel.value, { title: p.name.slice(0, 120), localName: p.localName && p.localName !== p.name ? p.localName.slice(0, 120) : null, desc: "Visit " + p.name + ".", loc: (p.address || p.city || this.state.country).slice(0, 200), dur: CATEGORY_DURATIONS[p.categories[0]] || "1h", cost: getActivitySgdCost(p.categories).display, lat: p.lat, lon: p.lon, categories: p.categories.slice(0, 10), placeId: p.placeId || undefined });
        map.closePopup();
      };
      row.append(sel, btn);
      el.append(row);
      return el;
    },
    mapVisible() { return !!map && map.getSize().x > 0 && map.getSize().y > 0; },
    fitTo(day) {
      const ms = mapMarkers.filter(m => day === null || m.day === day).map(m => m.marker);
      // A hidden map (mobile list tab) has zero size and Leaflet would compute NaN coordinates.
      if (!this.mapVisible() || !ms.length) return;
      try { map.flyToBounds(L.featureGroup(ms).getBounds().pad(0.2), { duration: 0.8, maxZoom: 15 }); } catch {}
    },
    applyDayFocus() {
      const d = this.focusedDay;
      for (const m of mapMarkers) m.marker.setOpacity(d === null || m.day === d ? 1 : 0.3);
      for (const r of mapRoutes) r.line.setStyle({ opacity: d === null || r.day === d ? .85 : .15 });
    },
    focusDay(d) {
      this.focusedDay = d;
      this.applyDayFocus();
      this.fitTo(d);
    },
    highlightPin(idx) {
      for (const m of mapMarkers) m.marker.getElement()?.querySelector(".pin")?.classList.toggle("active", m.idx === idx);
    },
    focusActivity(idx) {
      this.activeAct = idx;
      this.highlightPin(idx);
      const m = mapMarkers.find(m => m.idx === idx);
      if (m && this.mapVisible()) { map.flyTo(m.marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.7 }); m.marker.openPopup(); }
    },
    async selectFromMap(idx, dayNum) {
      this.activeAct = idx;
      this.highlightPin(idx);
      const day = this.plans.find(p => p.day === dayNum);
      if (day) day.open = true;
      await this.$nextTick();
      document.querySelector(`[data-act-idx="${idx}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    async setMobileTab(tab) {
      this.mobileTab = tab;
      if (tab === "map") { await this.$nextTick(); map?.invalidateSize(); this.fitTo(this.focusedDay); }
    },

    // ── Join via invite ──
    async loadInvite(code) {
      this.invite = null; this.inviteError = "";
      try {
        const r = await fetch("/api/invites/" + encodeURIComponent(code));
        const d = await r.json();
        if (!r.ok) { this.inviteError = d.error || "This invite is invalid or has expired."; return; }
        this.invite = { ...d, code };
      } catch { this.inviteError = "Network error."; }
    },
    async acceptInvite() {
      if (!this.invite) return;
      if (this.invite.alreadyMember) return this.go("/trip/" + this.invite.trip.id, true);
      this.joining = true;
      try {
        const r = await fetch("/api/invites/" + encodeURIComponent(this.invite.code) + "/join", { method: "POST" });
        const d = await r.json();
        if (!r.ok) { this.inviteError = d.error || "Couldn't join."; this.invite = null; return; }
        showSuccess("You're in! Welcome to the trip.");
        this.go("/trip/" + d.tripId, true);
      } catch { showError("Network error."); }
      finally { this.joining = false; }
    },

    // ── Share / invite modal ──
    openShare() {
      this.shareOpen = true; this.freshCode = "";
      this.refreshMembers();
      if (this.currentRole === "owner") this.loadInvites();
    },
    async loadInvites() {
      try { const r = await fetch(`/api/trips/${this.currentTripId}/invites`); if (r.ok) this.invites = (await r.json()).invites; } catch {}
    },
    inviteUrl(code) { return location.origin + "/join/" + code; },
    async createInvite(kind) {
      try {
        const r = await fetch(`/api/trips/${this.currentTripId}/invites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, role: this.shareRole }) });
        const d = await r.json();
        if (!r.ok) { showError(d.error || "Couldn't create invite."); return; }
        if (kind === "code") this.freshCode = d.code;
        else this.copy(this.inviteUrl(d.code), "Invite link created and copied");
        this.loadInvites();
      } catch { showError("Network error."); }
    },
    async revokeInvite(code) {
      try { await fetch(`/api/trips/${this.currentTripId}/invites/${code}`, { method: "DELETE" }); this.loadInvites(); } catch {}
    },
    copy(text, msg) {
      navigator.clipboard?.writeText(text).then(() => showSuccess(msg || "Copied"), () => showError("Couldn't copy — select it manually."));
    },
    async removeMember(uid) { try { await fetch(`/api/trips/${this.currentTripId}/members/${uid}`, { method: "DELETE" }); this.refreshMembers(); } catch {} },
    async changeMemberRole(uid, role) { try { await fetch(`/api/trips/${this.currentTripId}/members/${uid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) }); this.refreshMembers(); } catch {} }
  },
  async mounted() {
    document.addEventListener("click", () => { this.userMenuOpen = false; });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { this.shareOpen = false; this.pinMode = null; } });
    // Cursor spotlight for .glow cards
    document.addEventListener("pointermove", e => {
      const el = e.target.closest?.(".glow"); if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - r.left + "px");
      el.style.setProperty("--my", e.clientY - r.top + "px");
    });
    window.addEventListener("popstate", () => this.route());
    await this.checkSession();
    this.booted = true;
    this.route();
  }
}).mount("#app");
