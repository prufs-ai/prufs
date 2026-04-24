import { useState, useEffect, useCallback } from "react";

const STORAGE_KEYS = {
  VALUES: "pari-values-profile", TOPICS: "pari-topic-filters", BILLS: "pari-bill-history",
  POSITIONS: "pari-positions", PATTERNS: "pari-patterns", PREDICTIONS: "pari-predictions",
  COMMS: "pari-communications", TONE: "pari-tone-prefs",
};

const POSITION_LABELS = ["strongly_oppose", "oppose", "neutral", "support", "strongly_support"];
const MIN_POS = 8;

const LEGISLATORS = [
  { id: "us_sen_1", name: "Alex Padilla", title: "U.S. Senator", party: "D", level: "federal", contact: "senate.gov web form / (202) 224-3553" },
  { id: "us_sen_2", name: "Adam Schiff", title: "U.S. Senator", party: "D", level: "federal", contact: "senate.gov web form / (202) 224-3841" },
  { id: "us_rep", name: "Scott Peters", title: "U.S. Representative (CA-50)", party: "D", level: "federal", contact: "house.gov web form / (202) 225-0508" },
  { id: "ca_sen", name: "State Senator (SD 39)", title: "CA State Senator", party: "", level: "state", contact: "senate.ca.gov - verify district rep" },
  { id: "ca_asm", name: "Assembly Member (AD 77)", title: "CA Assembly Member", party: "", level: "state", contact: "assembly.ca.gov - verify district rep" },
  { id: "sd_council", name: "City Council (District 1)", title: "SD City Council Member", party: "", level: "local", contact: "sandiego.gov council page" },
  { id: "sd_county", name: "County Supervisor (Dist 3)", title: "SD County Supervisor", party: "", level: "local", contact: "sandiegocounty.gov" },
];

const TONES = [
  { id: "professional", label: "Professional Constituent", desc: "Measured, factual, respectful" },
  { id: "expert", label: "Subject Matter Expert", desc: "Emphasizes technical expertise" },
  { id: "urgent", label: "Concerned Constituent", desc: "More assertive, conveys urgency" },
  { id: "collaborative", label: "Collaborative Partner", desc: "Offers to help with implementation" },
];

const FORMATS = [
  { id: "email", label: "Email / Web Form" }, { id: "letter", label: "Formal Letter" },
  { id: "phone_script", label: "Phone Script" }, { id: "public_comment", label: "Public Comment" },
];

const VALUES_QUESTIONS = [
  { id: "individual_liberty", text: "Individual liberty should take precedence over collective regulation, even when regulation might produce better aggregate outcomes.", domain: "philosophy" },
  { id: "gov_tech_regulation", text: "Government should actively regulate emerging technologies (AI, biotech, crypto) rather than allowing industry self-regulation.", domain: "technology" },
  { id: "fiscal_conservatism", text: "Government spending should be minimized and budgets balanced, even if it means reducing public services.", domain: "fiscal" },
  { id: "privacy_rights", text: "Personal data privacy is a fundamental right that should override law enforcement and national security convenience.", domain: "privacy" },
  { id: "market_freedom", text: "Free markets, with minimal intervention, produce the best outcomes for innovation and prosperity.", domain: "economics" },
  { id: "environmental_priority", text: "Environmental protection should take priority over short-term economic growth when the two conflict.", domain: "environment" },
  { id: "federalism", text: "State and local governments should have more authority relative to the federal government in most policy areas.", domain: "governance" },
  { id: "worker_protections", text: "Workers need strong legal protections (minimum wage, benefits mandates, union rights) even when these increase business costs.", domain: "labor" },
  { id: "education_public", text: "Public education should be the primary vehicle for K-12 learning, with limited public funding for private alternatives.", domain: "education" },
  { id: "immigration_openness", text: "Immigration policy should prioritize openness and pathways to legal status over enforcement and restriction.", domain: "immigration" },
  { id: "housing_intervention", text: "Government should actively intervene in housing markets (rent control, zoning reform, public housing) to ensure affordability.", domain: "housing" },
  { id: "healthcare_role", text: "Government should guarantee healthcare access for all residents, even if it requires significant public funding.", domain: "healthcare" },
  { id: "criminal_justice_reform", text: "The criminal justice system should prioritize rehabilitation and restorative justice over punishment and deterrence.", domain: "justice" },
  { id: "ai_transparency", text: "AI systems used in consequential decisions (hiring, lending, law enforcement) should be required to be explainable and auditable.", domain: "technology" },
  { id: "independent_contractor", text: "Independent contractors and gig workers should have the freedom to operate without being reclassified as employees, even if it means fewer protections.", domain: "labor" },
];

const TOPIC_FILTERS = [
  { id: "ai_tech", label: "AI / Technology / Data Privacy", icon: "\u{1F916}", keywords: ["artificial intelligence", "technology", "data privacy", "cybersecurity", "algorithm", "automation"] },
  { id: "small_biz", label: "Small Business / Consulting", icon: "\u{1F4BC}", keywords: ["small business", "independent contractor", "consulting", "self-employment", "gig economy"] },
  { id: "tax", label: "Tax Policy", icon: "\u{1F4B0}", keywords: ["tax", "revenue", "property tax", "income tax", "business tax"] },
  { id: "education", label: "Education", icon: "\u{1F4DA}", keywords: ["education", "school", "university", "curriculum", "student"] },
  { id: "automotive", label: "Automotive / Vehicle", icon: "\u{1F697}", keywords: ["vehicle", "automotive", "emissions", "registration", "transportation"] },
  { id: "housing", label: "Housing / Zoning", icon: "\u{1F3E0}", keywords: ["housing", "zoning", "rent", "tenant", "development"] },
  { id: "licensing", label: "Professional Licensing", icon: "\u{1F4CB}", keywords: ["license", "certification", "professional", "credential"] },
  { id: "banking", label: "Financial Services", icon: "\u{1F3E6}", keywords: ["bank", "financial", "lending", "fintech", "credit"] },
];

const SCALE_LABELS = [{ value: -1.0, label: "Strongly Disagree" }, { value: -0.5, label: "Disagree" }, { value: 0, label: "Neutral" }, { value: 0.5, label: "Agree" }, { value: 1.0, label: "Strongly Agree" }];

// --- Shared Components ---
function Badge({ status }) {
  const c = { introduced: "#3b82f6", committee: "#ca8a04", floor: "#a855f7", passed: "#16a34a", signed: "#15803d", vetoed: "#dc2626", failed: "#6b7280", approved: "#22c55e", unknown: "#9ca3af" }[status] || "#9ca3af";
  return <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: `${c}22`, color: c, border: `1px solid ${c}44`, textTransform: "uppercase", letterSpacing: "0.5px" }}>{status}</span>;
}
function Tag({ label }) { return <span style={{ padding: "1px 7px", borderRadius: 7, fontSize: 9, fontWeight: 500, background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>{label}</span>; }
function Meter({ v, size = "sm" }) {
  const p = Math.round(v * 100), c = v >= 0.75 ? "#22c55e" : v >= 0.5 ? "#f59e0b" : "#ef4444", h = size === "lg" ? 7 : 4;
  return <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: size === "lg" ? 70 : 45, height: h, borderRadius: h, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}><div style={{ width: `${p}%`, height: "100%", borderRadius: h, background: c }} /></div><span style={{ fontSize: size === "lg" ? 11 : 9, color: c, fontWeight: 600 }}>{p}%</span></div>;
}

// --- API Calls ---
async function apiCall(prompt, useSearch = false) {
  try {
    const body = { model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] };
    if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    const t = d.content?.filter(i => i.type === "text").map(i => i.text).join("");
    if (t) return JSON.parse(t.replace(/```json|```/g, "").trim());
  } catch (e) { console.error("API error:", e); }
  return null;
}

function valuesText(values) { return VALUES_QUESTIONS.filter(q => values[q.id] !== undefined).map(q => `- "${q.text}" => ${values[q.id]}`).join("\n"); }
function positionHistory(positions, bills) { return bills.filter(b => positions[b.id]).map(b => ({ bill_number: b.bill_number, title: b.title, summary: b.summary, topics: b.topics, level: b.level, position: positions[b.id].position })); }

async function predictPosition(bill, values, positions, bills) {
  const hist = positionHistory(positions, bills);
  return apiCall(`Predict political position. VALUES:\n${valuesText(values)}\n\nPAST (${hist.length}):\n${JSON.stringify(hist)}\n\nBILL: ${bill.bill_number} - ${bill.title}\n${bill.summary}\nTopics: ${(bill.topics||[]).join(", ")}\nLevel: ${bill.level}\n\nReturn ONLY JSON: {"predicted_position":"strongly_oppose|oppose|neutral|support|strongly_support","confidence":0.0-1.0,"reasoning":"2-3 sentences","relevant_values":[],"similar_bills":[],"tension_flag":false,"tension_explanation":""}`);
}

async function analyzePatterns(values, positions, bills) {
  const hist = positionHistory(positions, bills);
  return apiCall(`Analyze ${hist.length} political positions.\n\nVALUES:\n${valuesText(values)}\n\nHISTORY:\n${JSON.stringify(hist)}\n\nReturn ONLY JSON: {"patterns":[{"id":"p1","label":"5 words","description":"1-2 sentences","strength":0.0-1.0,"supporting_bills":[],"relevant_values":[]}],"consistency_score":0.0-1.0,"consistency_note":"","lean_summary":"","blind_spots":[],"prediction_readiness":{"overall":0.0-1.0,"by_topic":{}}}`);
}

async function draftComm(bill, position, legislator, tone, format, values, approvedComms) {
  const toneDesc = TONES.find(t => t.id === tone)?.desc || "Professional";
  const styleRef = approvedComms.length > 0 ? `\n\nSTYLE REFERENCE (match this voice):\n${approvedComms.slice(-3).map(c => `---\n${c.final_text}\n---`).join("\n")}` : "";
  return apiCall(`Draft a ${FORMATS.find(f=>f.id===format)?.label||"Email"} from a San Diego resident (92131) to their elected official.

CONSTITUENT: Technology consultant, AI architect, 30+ years experience, small business owner, PhD candidate in AI reliability.
VALUES:\n${valuesText(values)}

BILL: ${bill.bill_number} - ${bill.title}
Summary: ${bill.summary}
Topics: ${(bill.topics||[]).join(", ")}
Status: ${bill.status}

POSITION: ${position.replace(/_/g, " ")}
RECIPIENT: ${legislator.name} - ${legislator.title}
TONE: ${toneDesc}
${styleRef}

Return ONLY JSON: {"subject":"subject line","body":"full text with paragraphs separated by newlines","key_points":["3-5 points"],"call_to_action":"specific ask","style_analysis":{"formality":0.0-1.0,"intensity":0.0-1.0,"approach":0.0-1.0,"technicality":0.0-1.0}}`);
}

// --- Main App ---
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [level, setLevel] = useState("all");
  const [bills, setBills] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanProg, setScanProg] = useState("");
  const [values, setValues] = useState({});
  const [valDone, setValDone] = useState(false);
  const [topics, setTopics] = useState(TOPIC_FILTERS.reduce((a, t) => ({ ...a, [t.id]: true }), {}));
  const [positions, setPositions] = useState({});
  const [predictions, setPredictions] = useState({});
  const [patterns, setPatterns] = useState(null);
  const [comms, setComms] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [predicting, setPredicting] = useState({});
  const [analyzing, setAnalyzing] = useState(false);
  const [draftFor, setDraftFor] = useState(null);
  const [draftCfg, setDraftCfg] = useState({ leg: null, tone: "professional", fmt: "email" });
  const [draft, setDraft] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTxt, setEditTxt] = useState("");

  const posCount = Object.keys(positions).length;
  const canPredict = posCount >= MIN_POS && valDone;
  const approved = comms.filter(c => c.status === "approved");

  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get(STORAGE_KEYS.VALUES); if (r) { const p = JSON.parse(r.value); setValues(p.values || {}); setValDone(p.complete || false); } } catch {}
      try { const r = await window.storage.get(STORAGE_KEYS.TOPICS); if (r) setTopics(JSON.parse(r.value)); } catch {}
      try { const r = await window.storage.get(STORAGE_KEYS.BILLS); if (r) setBills(JSON.parse(r.value)); } catch {}
      try { const r = await window.storage.get(STORAGE_KEYS.POSITIONS); if (r) setPositions(JSON.parse(r.value)); } catch {}
      try { const r = await window.storage.get(STORAGE_KEYS.PREDICTIONS); if (r) setPredictions(JSON.parse(r.value)); } catch {}
      try { const r = await window.storage.get(STORAGE_KEYS.PATTERNS); if (r) setPatterns(JSON.parse(r.value)); } catch {}
      try { const r = await window.storage.get(STORAGE_KEYS.COMMS); if (r) setComms(JSON.parse(r.value)); } catch {}
      setLoaded(true);
    })();
  }, []);

  const sv = useCallback(async (k, d) => { try { await window.storage.set(k, JSON.stringify(d)); } catch {} }, []);

  const setVal = (qId, v) => { const nv = { ...values, [qId]: v }; setValues(nv); const c = VALUES_QUESTIONS.every(q => nv[q.id] !== undefined); setValDone(c); sv(STORAGE_KEYS.VALUES, { values: nv, complete: c }); };
  const togTopic = id => { const nt = { ...topics, [id]: !topics[id] }; setTopics(nt); sv(STORAGE_KEYS.TOPICS, nt); };
  const setPos = (bid, pos) => { const pred = predictions[bid]; const np = { ...positions, [bid]: { position: pos, timestamp: Date.now(), overrode_prediction: pred ? pred.predicted_position !== pos : false, predicted_was: pred?.predicted_position || null } }; setPositions(np); sv(STORAGE_KEYS.POSITIONS, np); };

  const doPredict = async (bill) => { if (!canPredict) return; setPredicting(p => ({ ...p, [bill.id]: true })); const r = await predictPosition(bill, values, positions, bills); if (r) { const np = { ...predictions, [bill.id]: { ...r, predicted_at: Date.now() } }; setPredictions(np); sv(STORAGE_KEYS.PREDICTIONS, np); } setPredicting(p => ({ ...p, [bill.id]: false })); };
  const doPatterns = async () => { setAnalyzing(true); const r = await analyzePatterns(values, positions, bills); if (r) { const w = { ...r, analyzed_at: Date.now() }; setPatterns(w); sv(STORAGE_KEYS.PATTERNS, w); } setAnalyzing(false); };

  const startDraft = (bill) => { const p = positions[bill.id]; if (!p) return; setDraftFor({ bill, position: p.position }); setDraftCfg({ leg: LEGISLATORS.find(l => l.level === bill.level)?.id || null, tone: "professional", fmt: "email" }); setDraft(null); setEditing(false); setTab("compose"); };
  const genDraft = async () => { if (!draftFor || !draftCfg.leg) return; setDrafting(true); const l = LEGISLATORS.find(x => x.id === draftCfg.leg); const r = await draftComm(draftFor.bill, draftFor.position, l, draftCfg.tone, draftCfg.fmt, values, approved); if (r) { setDraft(r); setEditTxt(r.body); } setDrafting(false); };
  const approveDraft = () => {
    if (!draft || !draftFor) return;
    const l = LEGISLATORS.find(x => x.id === draftCfg.leg);
    const c = { id: `c-${Date.now()}`, bill_id: draftFor.bill.id, bill_number: draftFor.bill.bill_number, bill_title: draftFor.bill.title, position: draftFor.position,
      legislator_id: draftCfg.leg, legislator_name: l?.name, legislator_title: l?.title, tone: draftCfg.tone, format: draftCfg.fmt,
      subject: draft.subject, original_text: draft.body, final_text: editTxt, was_edited: editTxt !== draft.body,
      style_analysis: draft.style_analysis, key_points: draft.key_points, call_to_action: draft.call_to_action,
      status: "approved", approved_at: Date.now() };
    const nc = [...comms, c]; setComms(nc); sv(STORAGE_KEYS.COMMS, nc); setDraftFor(null); setDraft(null); setTab("communications");
  };

  const scan = async () => {
    setScanning(true); setErr(null);
    const lvls = [{ key: "federal", label: "Federal", query: "recent bills U.S. Congress 2026" }, { key: "state", label: "California", query: "recent bills California legislature 2026" }, { key: "local", label: "San Diego", query: "recent San Diego city council ordinances 2026" }];
    const kw = TOPIC_FILTERS.filter(t => topics[t.id]).flatMap(t => t.keywords);
    const tc = kw.length > 0 ? `Interested in: ${kw.join(", ")}. Prioritize these.` : "";
    let all = [];
    for (const l of lvls) {
      setScanProg(`Scanning ${l.label}...`);
      const r = await apiCall(`Search for ${l.query}. ${tc}\n\nReturn ONLY JSON array of up to 8 bills: [{"bill_number":"SB 1234","title":"title","sponsor":"Name (P-D)","summary":"2-3 sentences","status":"introduced|committee|floor|passed|signed|vetoed|failed","topics":["t1"],"level":"${l.key}","relevance_note":"relevance to tech consultant in San Diego"}]\nOnly real bills. If none, return [].`, true);
      if (Array.isArray(r)) all = [...all, ...r.map((b, i) => ({ ...b, id: `${l.key}-${Date.now()}-${i}`, scanned_at: new Date().toISOString(), level: l.key }))];
    }
    setBills(all); sv(STORAGE_KEYS.BILLS, all); setScanning(false); setScanProg("");
  };

  const filtered = bills.filter(b => level === "all" || b.level === level);

  // Stats
  const stats = (() => {
    const s = { total: posCount, byPos: {}, byLvl: {}, overrides: 0, correctPred: 0, totalPred: 0 };
    POSITION_LABELS.forEach(p => s.byPos[p] = 0);
    Object.entries(positions).forEach(([bid, pos]) => {
      s.byPos[pos.position] = (s.byPos[pos.position] || 0) + 1;
      const b = bills.find(x => x.id === bid); if (b) s.byLvl[b.level] = (s.byLvl[b.level] || 0) + 1;
      if (pos.overrode_prediction) s.overrides++;
      if (pos.predicted_was) { s.totalPred++; if (pos.predicted_was === pos.position) s.correctPred++; }
    });
    s.predAcc = s.totalPred > 0 ? s.correctPred / s.totalPred : null;
    return s;
  })();

  if (!loaded) return <div style={S.loading}><div style={S.spinner} /><p style={{ marginTop: 16, fontSize: 14, color: "#94a3b8" }}>Loading...</p></div>;

  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={S.hInner}>
          <div><h1 style={S.hTitle}>Legislative Tracking Agent</h1><p style={S.hSub}>San Diego, CA 92131</p></div>
          <div style={S.hStats}>
            <div style={S.stat}><span style={S.statN}>{bills.length}</span><span style={S.statL}>Bills</span></div>
            <div style={S.stat}><span style={S.statN}>{posCount}</span><span style={S.statL}>Positions</span></div>
            <div style={S.stat}><span style={S.statN}>{approved.length}</span><span style={S.statL}>Letters</span></div>
            {stats.predAcc !== null && <div style={S.stat}><span style={{ ...S.statN, color: stats.predAcc >= 0.75 ? "#22c55e" : "#f59e0b" }}>{Math.round(stats.predAcc * 100)}%</span><span style={S.statL}>Accuracy</span></div>}
            <div style={S.stat}><span style={{ ...S.statN, color: valDone ? "#22c55e" : "#f59e0b" }}>{valDone ? "\u2713" : `${Object.keys(values).length}/15`}</span><span style={S.statL}>Values</span></div>
          </div>
        </div>
      </header>
      <nav style={S.nav}>
        {[{ id: "dashboard", l: "Dashboard" }, { id: "communications", l: `Comms (${approved.length})` }, { id: "compose", l: draftFor ? "Compose" : "Compose" }, { id: "patterns", l: "Patterns" }, { id: "values", l: "Values" }, { id: "topics", l: "Topics" }].map(t =>
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...S.navBtn, ...(tab === t.id ? S.navAct : {}) }}>{t.l}</button>)}
      </nav>
      <main style={S.main}>
        {tab === "dashboard" && <Dashboard bills={filtered} level={level} setLevel={setLevel} positions={positions} predictions={predictions} setPos={setPos} doPredict={doPredict} predicting={predicting} canPredict={canPredict} scanning={scanning} scanProg={scanProg} scan={scan} err={err} expanded={expanded} setExpanded={setExpanded} valDone={valDone} posCount={posCount} startDraft={startDraft} />}
        {tab === "compose" && <Compose draftFor={draftFor} cfg={draftCfg} setCfg={setDraftCfg} draft={draft} gen={genDraft} approve={approveDraft} reject={() => { setDraft(null); setEditing(false); }} drafting={drafting} editing={editing} setEditing={setEditing} editTxt={editTxt} setEditTxt={setEditTxt} bills={bills} positions={positions} />}
        {tab === "communications" && <Comms comms={comms} />}
        {tab === "patterns" && <Patterns patterns={patterns} stats={stats} analyze={doPatterns} analyzing={analyzing} canAnalyze={posCount >= MIN_POS} posCount={posCount} />}
        {tab === "values" && <Values values={values} setVal={setVal} done={valDone} />}
        {tab === "topics" && <Topics topics={topics} toggle={togTopic} />}
      </main>
    </div>
  );
}

// --- Dashboard ---
function Dashboard({ bills, level, setLevel, positions, predictions, setPos, doPredict, predicting, canPredict, scanning, scanProg, scan, err, expanded, setExpanded, valDone, posCount, startDraft }) {
  return (
    <div>
      {!valDone && <div style={S.alert}><strong>Complete Values Profile</strong> - needed for predictions and communications.</div>}
      {valDone && posCount < MIN_POS && <div style={{ ...S.alert, background: "rgba(99,102,241,0.1)", borderColor: "rgba(99,102,241,0.25)", color: "#a5b4fc" }}><strong>Building corpus</strong> - {MIN_POS - posCount} more positions needed.</div>}
      {canPredict && <div style={{ ...S.alert, background: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.2)", color: "#4ade80" }}><strong>Predictions active</strong> - expand bills to see predictions and draft communications.</div>}
      <div style={S.row}><button onClick={scan} disabled={scanning} style={{ ...S.btn, opacity: scanning ? 0.5 : 1 }}>{scanning ? "Scanning..." : "Scan Legislative Activity"}</button>{scanProg && <span style={S.prog}>{scanProg}</span>}</div>
      {err && <div style={S.errBox}>{err}</div>}
      <div style={S.filters}>{[{ id: "all", l: "All" }, { id: "federal", l: "Federal" }, { id: "state", l: "California" }, { id: "local", l: "San Diego" }].map(lv =>
        <button key={lv.id} onClick={() => setLevel(lv.id)} style={{ ...S.fBtn, ...(level === lv.id ? S.fAct : {}) }}>{lv.l}{lv.id !== "all" && <span style={S.fCount}>{bills.filter(b => lv.id === "all" || b.level === lv.id).length}</span>}</button>)}</div>
      {bills.length === 0 ? <div style={S.empty}><p style={{ fontSize: 15, fontWeight: 600, color: "#64748b" }}>No bills scanned yet</p></div> :
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{bills.map(b => <Bill key={b.id} bill={b} pos={positions[b.id]} pred={predictions[b.id]} setPos={setPos} doPredict={doPredict} predicting={predicting[b.id]} canPredict={canPredict} open={expanded === b.id} toggle={() => setExpanded(expanded === b.id ? null : b.id)} startDraft={startDraft} />)}</div>}
    </div>
  );
}

function Bill({ bill, pos, pred, setPos, doPredict, predicting, canPredict, open, toggle, startDraft }) {
  const lc = { federal: { c: "#3b82f6", t: "FED" }, state: { c: "#ca8a04", t: "CA" }, local: { c: "#16a34a", t: "SD" } }[bill.level] || { c: "#3b82f6", t: "?" };
  return (
    <div style={{ padding: "11px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", borderLeft: `3px solid ${lc.c}`, background: open ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)", cursor: "pointer" }} onClick={toggle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, color: lc.c, background: `${lc.c}15`, border: `1px solid ${lc.c}33`, letterSpacing: "0.8px" }}>{lc.t}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>{bill.bill_number}</span>
          <Badge status={bill.status} />
          {pos?.overrode_prediction && <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 600 }}>OVERRIDE</span>}
        </div>
        <span style={{ fontSize: 12, color: "#475569" }}>{open ? "\u25BE" : "\u25B8"}</span>
      </div>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", margin: "5px 0 2px", lineHeight: 1.4 }}>{bill.title}</h3>
      <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>Sponsor: {bill.sponsor}</p>
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: "#94a3b8", margin: "0 0 10px" }}>{bill.summary}</p>
          {bill.relevance_note && <div style={{ padding: "7px 11px", borderRadius: 6, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", color: "#a5b4fc", marginBottom: 10, fontSize: 12 }}><strong style={{ fontSize: 10, textTransform: "uppercase" }}>Relevance</strong><p style={{ margin: "3px 0 0", lineHeight: 1.5 }}>{bill.relevance_note}</p></div>}
          {bill.topics?.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>{bill.topics.map((t, i) => <Tag key={i} label={t} />)}</div>}
          {canPredict && !pos && <div style={{ marginBottom: 10, padding: "9px 11px", borderRadius: 6, background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.1)" }}>
            {pred ? <div><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", textTransform: "uppercase" }}>Predicted</span><span style={{ padding: "2px 7px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: "rgba(129,140,248,0.2)", color: "#a5b4fc", textTransform: "capitalize" }}>{pred.predicted_position.replace(/_/g, " ")}</span><Meter v={pred.confidence} size="lg" /></div>
              <p style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>{pred.reasoning}</p>
              {pred.tension_flag && <div style={{ padding: "7px 10px", borderRadius: 6, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)", color: "#fbbf24", marginTop: 6 }}><strong style={{ fontSize: 10 }}>Values Tension</strong><p style={{ margin: "3px 0 0", fontSize: 11 }}>{pred.tension_explanation}</p></div>}</div>
            : <button onClick={e => { e.stopPropagation(); doPredict(bill); }} disabled={predicting} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.1)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: predicting ? 0.5 : 1 }}>{predicting ? "Analyzing..." : "Predict Position"}</button>}
          </div>}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginRight: 2 }}>Position:</span>
            {POSITION_LABELS.map(p => <button key={p} onClick={e => { e.stopPropagation(); setPos(bill.id, p); }} style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.1)", background: pos?.position === p ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.03)", color: pos?.position === p ? "#a5b4fc" : "#94a3b8", fontSize: 10, cursor: "pointer", textTransform: "capitalize", fontWeight: pos?.position === p ? 600 : 400 }}>{p.replace(/_/g, " ")}</button>)}
          </div>
          {pos && <div style={{ marginTop: 8 }}><button onClick={e => { e.stopPropagation(); startDraft(bill); }} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.1)", color: "#4ade80", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Draft Communication</button></div>}
        </div>
      )}
    </div>
  );
}

// --- Compose ---
function Compose({ draftFor, cfg, setCfg, draft, gen, approve, reject, drafting, editing, setEditing, editTxt, setEditTxt, bills, positions }) {
  if (!draftFor) {
    const withPos = bills.filter(b => positions[b.id]);
    return <div><div style={S.secH}><h2 style={S.secT}>Compose Communication</h2><p style={S.secD}>Take a position on a bill first, then click "Draft Communication" on the dashboard.</p></div>
      {withPos.length === 0 ? <div style={S.empty}><p style={{ fontSize: 14, color: "#64748b" }}>No positions recorded yet.</p></div> :
        <p style={{ fontSize: 12, color: "#64748b" }}>{withPos.length} bill{withPos.length !== 1 ? "s" : ""} with positions. Use the Dashboard to draft communications.</p>}</div>;
  }
  const sameLvl = LEGISLATORS.filter(l => l.level === draftFor.bill.level);
  const otherLvl = LEGISLATORS.filter(l => l.level !== draftFor.bill.level);
  return (
    <div>
      <div style={S.secH}><h2 style={S.secT}>Draft Communication</h2><p style={S.secD}>Re: <strong>{draftFor.bill.bill_number}</strong> - {draftFor.bill.title}<br />Position: <strong style={{ textTransform: "capitalize" }}>{draftFor.position.replace(/_/g, " ")}</strong></p></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={S.card}><h4 style={S.cardH}>Recipient</h4>
          {sameLvl.length > 0 && <p style={{ fontSize: 9, color: "#475569", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Recommended</p>}
          {sameLvl.map(l => <div key={l.id} onClick={() => setCfg(c => ({ ...c, leg: l.id }))} style={{ ...S.opt, ...(cfg.leg === l.id ? S.optAct : {}), cursor: "pointer", marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{l.name}</span><span style={{ fontSize: 10, color: "#64748b" }}>{l.title}</span></div>)}
          {otherLvl.length > 0 && <><p style={{ fontSize: 9, color: "#475569", margin: "8px 0 4px", textTransform: "uppercase" }}>Other officials</p>
            {otherLvl.map(l => <div key={l.id} onClick={() => setCfg(c => ({ ...c, leg: l.id }))} style={{ ...S.opt, ...(cfg.leg === l.id ? S.optAct : {}), cursor: "pointer", opacity: 0.7, marginBottom: 4 }}><span style={{ fontSize: 11, color: "#cbd5e1" }}>{l.name}</span><span style={{ fontSize: 9, color: "#64748b" }}>{l.title}</span></div>)}</>}
        </div>
        <div><div style={{ ...S.card, marginBottom: 10 }}><h4 style={S.cardH}>Tone</h4>
          {TONES.map(t => <div key={t.id} onClick={() => setCfg(c => ({ ...c, tone: t.id }))} style={{ ...S.opt, ...(cfg.tone === t.id ? S.optAct : {}), cursor: "pointer", marginBottom: 4 }}><span style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>{t.label}</span><span style={{ fontSize: 9, color: "#64748b" }}>{t.desc}</span></div>)}</div>
          <div style={S.card}><h4 style={S.cardH}>Format</h4><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {FORMATS.map(f => <button key={f.id} onClick={() => setCfg(c => ({ ...c, fmt: f.id }))} style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${cfg.fmt === f.id ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.1)"}`, background: cfg.fmt === f.id ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.03)", color: cfg.fmt === f.id ? "#a5b4fc" : "#94a3b8", fontSize: 10, cursor: "pointer" }}>{f.label}</button>)}</div></div></div>
      </div>
      <button onClick={gen} disabled={drafting || !cfg.leg} style={{ ...S.btn, opacity: (drafting || !cfg.leg) ? 0.5 : 1 }}>{drafting ? "Generating..." : "Generate Draft"}</button>

      {draft && <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#c7d2fe", margin: 0 }}>Draft Preview</h3>
          {draft.style_analysis && <div style={{ display: "flex", gap: 6, fontSize: 9, color: "#64748b" }}>
            <span>F:{Math.round(draft.style_analysis.formality * 100)}</span><span>I:{Math.round(draft.style_analysis.intensity * 100)}</span>
            <span>A:{Math.round(draft.style_analysis.approach * 100)}</span><span>T:{Math.round(draft.style_analysis.technicality * 100)}</span></div>}
        </div>
        {draft.subject && <div style={{ padding: "6px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 6, marginBottom: 8, border: "1px solid rgba(255,255,255,0.06)" }}><span style={{ fontSize: 10, color: "#64748b" }}>Subject: </span><span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{draft.subject}</span></div>}
        {editing ? <textarea value={editTxt} onChange={e => setEditTxt(e.target.value)} style={{ width: "100%", padding: "14px 16px", borderRadius: 7, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(99,102,241,0.3)", color: "#e2e8f0", fontSize: 12, lineHeight: 1.7, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }} rows={14} />
          : <div style={{ padding: "14px 16px", borderRadius: 7, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", maxHeight: 360, overflowY: "auto" }}>
            {(editTxt || draft.body).split("\n").map((line, i) => <p key={i} style={{ margin: "0 0 6px", fontSize: 12, lineHeight: 1.7, color: "#cbd5e1" }}>{line || "\u00A0"}</p>)}</div>}
        {draft.key_points && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.1)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#818cf8", textTransform: "uppercase" }}>Key Arguments</span>{draft.key_points.map((k, i) => <p key={i} style={{ fontSize: 11, color: "#94a3b8", margin: "3px 0 0", lineHeight: 1.5 }}>{k}</p>)}</div>}
        {draft.call_to_action && <div style={{ marginTop: 6, padding: "6px 12px", borderRadius: 6, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#4ade80", textTransform: "uppercase" }}>Call to Action</span><p style={{ fontSize: 11, color: "#86efac", margin: "3px 0 0" }}>{draft.call_to_action}</p></div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => setEditing(!editing)} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>{editing ? "Preview" : "Edit"}</button>
          <button onClick={approve} style={{ ...S.btn, background: "linear-gradient(135deg, #059669, #10b981)" }}>Approve & Save</button>
          <button onClick={reject} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: 11, cursor: "pointer" }}>Discard</button>
          <button onClick={gen} disabled={drafting} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>Regen</button>
        </div>
      </div>}
    </div>
  );
}

// --- Communications Archive ---
function Comms({ comms }) {
  const approved = comms.filter(c => c.status === "approved");
  const [open, setOpen] = useState(null);
  return (
    <div>
      <div style={S.secH}><h2 style={S.secT}>Communications Archive</h2><p style={S.secD}>{approved.length} approved. This archive is the TRI reference corpus - the agent learns your voice here.</p></div>
      {approved.length === 0 ? <div style={S.empty}><p style={{ fontSize: 14, color: "#64748b" }}>No communications yet. Draft one from the Dashboard.</p></div> :
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{[...approved].reverse().map(c => (
          <div key={c.id} onClick={() => setOpen(open === c.id ? null : c.id)} style={{ padding: "11px 14px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.06)", borderLeft: "3px solid #6366f1", background: open === c.id ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>{c.bill_number}</span><Badge status="approved" />{c.was_edited && <span style={{ fontSize: 9, color: "#f59e0b" }}>EDITED</span>}</div>
              <span style={{ fontSize: 9, color: "#475569" }}>{new Date(c.approved_at).toLocaleDateString()}</span>
            </div>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", margin: "4px 0 2px" }}>To: {c.legislator_name}</h3>
            <p style={{ fontSize: 10, color: "#64748b", margin: 0 }}>{c.subject} &middot; <span style={{ textTransform: "capitalize" }}>{c.position.replace(/_/g, " ")}</span> &middot; {TONES.find(t => t.id === c.tone)?.label}</p>
            {open === c.id && <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ padding: "12px 14px", borderRadius: 6, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", maxHeight: 300, overflowY: "auto" }}>
                {c.final_text.split("\n").map((l, i) => <p key={i} style={{ margin: "0 0 6px", fontSize: 12, lineHeight: 1.7, color: "#cbd5e1" }}>{l || "\u00A0"}</p>)}</div>
              {c.style_analysis && <div style={{ marginTop: 8, display: "flex", gap: 10, fontSize: 10, color: "#64748b" }}>
                <span>Formality: {Math.round(c.style_analysis.formality * 100)}%</span><span>Intensity: {Math.round(c.style_analysis.intensity * 100)}%</span>
                <span>Approach: {Math.round(c.style_analysis.approach * 100)}%</span><span>Technicality: {Math.round(c.style_analysis.technicality * 100)}%</span></div>}
            </div>}
          </div>
        ))}</div>}
    </div>
  );
}

// --- Patterns ---
function Patterns({ patterns, stats, analyze, analyzing, canAnalyze, posCount }) {
  if (!canAnalyze) return <div><div style={S.secH}><h2 style={S.secT}>Patterns</h2><p style={S.secD}>{MIN_POS - posCount} more positions needed.</p></div>
    <div style={{ padding: "14px", borderRadius: 7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}><div style={{ width: `${(posCount / MIN_POS) * 100}%`, height: "100%", borderRadius: 4, background: "linear-gradient(90deg, #4f46e5, #818cf8)" }} /></div></div></div>;
  return (
    <div>
      <div style={S.secH}><h2 style={S.secT}>Pattern Analysis</h2></div>
      <button onClick={analyze} disabled={analyzing} style={{ ...S.btn, opacity: analyzing ? 0.5 : 1, marginBottom: 16 }}>{analyzing ? "Analyzing..." : "Run Analysis"}</button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={S.card}><h4 style={S.cardH}>Distribution</h4>{POSITION_LABELS.map(p => { const c = stats.byPos[p] || 0, pct = stats.total > 0 ? (c / stats.total) * 100 : 0; const cl = { strongly_oppose: "#ef4444", oppose: "#f97316", neutral: "#6b7280", support: "#22c55e", strongly_support: "#10b981" }[p];
          return <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}><span style={{ fontSize: 10, color: "#94a3b8", width: 100, textTransform: "capitalize" }}>{p.replace(/_/g, " ")}</span><div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: cl }} /></div><span style={{ fontSize: 10, color: "#64748b", width: 20, textAlign: "right" }}>{c}</span></div>; })}</div>
        <div style={S.card}><h4 style={S.cardH}>Coverage</h4>{[["federal", "Federal", "#3b82f6"], ["state", "CA", "#ca8a04"], ["local", "SD", "#16a34a"]].map(([k, l, c]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}><span style={{ fontSize: 11, color: c }}>{l}</span><span style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1" }}>{stats.byLvl[k] || 0}</span></div>)}
          {stats.predAcc !== null && <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, color: "#94a3b8" }}>Accuracy</span><span style={{ fontSize: 13, fontWeight: 700, color: stats.predAcc >= 0.75 ? "#22c55e" : "#f59e0b" }}>{Math.round(stats.predAcc * 100)}%</span></div></div>}</div>
      </div>
      {patterns && <div style={{ marginTop: 16 }}>
        {patterns.lean_summary && <div style={{ padding: "10px 12px", borderRadius: 7, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", color: "#a5b4fc", marginBottom: 12 }}><strong style={{ fontSize: 10, textTransform: "uppercase" }}>Summary</strong><p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.6 }}>{patterns.lean_summary}</p>
          {patterns.consistency_score !== undefined && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}><span style={{ fontSize: 10, color: "#64748b" }}>Consistency:</span><Meter v={patterns.consistency_score} size="lg" /></div>}</div>}
        {patterns.patterns?.map((p, i) => <div key={i} style={{ padding: "9px 12px", borderRadius: 6, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 6 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{p.label}</span><Meter v={p.strength} /></div><p style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, margin: 0 }}>{p.description}</p></div>)}
        {patterns.blind_spots?.length > 0 && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)", color: "#fbbf24", marginTop: 8 }}><strong style={{ fontSize: 10 }}>Blind Spots</strong><p style={{ margin: "4px 0 0", fontSize: 11 }}>{patterns.blind_spots.join(" \u00B7 ")}</p></div>}
      </div>}
    </div>
  );
}

// --- Values & Topics ---
function Values({ values, setVal, done }) {
  return <div><div style={S.secH}><h2 style={S.secT}>Values & Principles</h2><p style={S.secD}>Rate each statement. These form the agent's compass.</p>
    {done && <div style={{ ...S.alert, background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>Complete.</div>}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{VALUES_QUESTIONS.map((q, i) => <div key={q.id} style={{ padding: "12px 14px", borderRadius: 7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", position: "relative" }}>
      <div style={{ position: "absolute", top: 12, left: 14, fontSize: 10, fontWeight: 700, color: "#4f46e5", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(79,70,229,0.12)", borderRadius: 4 }}>{i + 1}</div>
      <p style={{ fontSize: 12, lineHeight: 1.6, color: "#cbd5e1", margin: "0 0 8px", paddingLeft: 28 }}>{q.text}</p>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingLeft: 28 }}>{SCALE_LABELS.map(s => <button key={s.value} onClick={() => setVal(q.id, s.value)} style={{ padding: "3px 9px", borderRadius: 4, border: `1px solid ${values[q.id] === s.value ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`, background: values[q.id] === s.value ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.02)", color: values[q.id] === s.value ? "#a5b4fc" : "#64748b", fontSize: 10, cursor: "pointer", fontWeight: values[q.id] === s.value ? 600 : 400 }}>{s.label}</button>)}</div>
    </div>)}</div></div>;
}

function Topics({ topics, toggle }) {
  return <div><div style={S.secH}><h2 style={S.secT}>Topic Filters</h2></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 7 }}>{TOPIC_FILTERS.map(t => <div key={t.id} onClick={() => toggle(t.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 7, border: `1px solid ${topics[t.id] ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.06)"}`, background: topics[t.id] ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)", cursor: "pointer" }}>
      <span style={{ fontSize: 18 }}>{t.icon}</span><span style={{ flex: 1, fontSize: 11, fontWeight: 500, color: "#cbd5e1" }}>{t.label}</span><span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 700, color: "#fff", background: topics[t.id] ? "#6366f1" : "rgba(255,255,255,0.1)" }}>{topics[t.id] ? "ON" : "OFF"}</span>
    </div>)}</div></div>;
}

// --- Styles ---
const S = {
  root: { fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", background: "linear-gradient(145deg, #0a0e1a, #111827, #0f172a)", color: "#e2e8f0", minHeight: "100vh" },
  loading: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0e1a" },
  spinner: { width: 28, height: 28, border: "3px solid rgba(99,102,241,0.2)", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  header: { background: "rgba(15,23,42,0.8)", borderBottom: "1px solid rgba(99,102,241,0.15)", padding: "14px 20px" },
  hInner: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 },
  hTitle: { fontSize: 18, fontWeight: 700, margin: 0, background: "linear-gradient(135deg, #c7d2fe, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  hSub: { fontSize: 11, color: "#64748b", margin: "2px 0 0" },
  hStats: { display: "flex", gap: 8, flexWrap: "wrap" },
  stat: { display: "flex", flexDirection: "column", alignItems: "center", padding: "5px 10px", background: "rgba(99,102,241,0.08)", borderRadius: 7, border: "1px solid rgba(99,102,241,0.12)" },
  statN: { fontSize: 15, fontWeight: 700, color: "#a5b4fc" },
  statL: { fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" },
  nav: { display: "flex", gap: 1, padding: "0 20px", background: "rgba(15,23,42,0.5)", borderBottom: "1px solid rgba(255,255,255,0.05)", overflowX: "auto" },
  navBtn: { padding: "9px 12px", background: "none", border: "none", color: "#64748b", fontSize: 11, fontWeight: 500, cursor: "pointer", borderBottom: "2px solid transparent", whiteSpace: "nowrap" },
  navAct: { color: "#a5b4fc", borderBottomColor: "#6366f1" },
  main: { padding: "16px 20px", maxWidth: 880, margin: "0 auto" },
  alert: { padding: "9px 12px", borderRadius: 7, fontSize: 11, lineHeight: 1.5, background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.25)", color: "#fbbf24", marginBottom: 10 },
  errBox: { padding: "9px 12px", borderRadius: 7, fontSize: 11, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", marginBottom: 10 },
  row: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 },
  btn: { padding: "8px 18px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #4f46e5, #6366f1)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 10px rgba(99,102,241,0.3)" },
  prog: { fontSize: 11, color: "#818cf8", fontStyle: "italic" },
  filters: { display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" },
  fBtn: { padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#94a3b8", fontSize: 10, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 },
  fAct: { background: "rgba(99,102,241,0.15)", borderColor: "rgba(99,102,241,0.3)", color: "#a5b4fc" },
  fCount: { padding: "0px 4px", borderRadius: 4, fontSize: 9, fontWeight: 600, background: "rgba(255,255,255,0.08)" },
  empty: { textAlign: "center", padding: "40px 16px" },
  secH: { marginBottom: 16 },
  secT: { fontSize: 16, fontWeight: 700, color: "#c7d2fe", margin: "0 0 4px" },
  secD: { fontSize: 11, color: "#64748b", lineHeight: 1.7, margin: 0 },
  card: { padding: "12px 14px", borderRadius: 7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" },
  cardH: { fontSize: 10, fontWeight: 700, color: "#94a3b8", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" },
  opt: { display: "flex", flexDirection: "column", gap: 1, padding: "6px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" },
  optAct: { background: "rgba(99,102,241,0.12)", borderColor: "rgba(99,102,241,0.3)" },
};

if (typeof document !== "undefined") { const s = document.createElement("style"); s.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`; document.head.appendChild(s); }
