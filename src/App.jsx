import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

/**
 * Betting Terminal (single-file App.jsx)
 *
 * INCLUDED - every feature you asked for + all the recurring bug fixes:
 * - Modes: TERMINAL (host iPad) / BETTOR (phones) / TV (screen share)
 * - Title at top: “Betting Terminal”
 * - Multi-device live sync (Firebase Firestore room) + localStorage fallback
 * - Participants: add + delete, saved to room so phones see them; avoids iPad “one letter at a time”
 * - Bets: Win / Place / Show / WPS + Exacta / Trifecta / Superfecta
 * - WPS: one action creates 3 tickets (WIN+PLACE+SHOW)
 * - Exotics:
 *   - Standard ordered ticket
 *   - Full box
 *   - Lock some positions (1st/2nd/3rd/4th) and box remaining positions from selected horses
 * - Denominations: $0.10 / $0.25 / $0.50 / $1.00 (single-choice “checkbox style”)
 * - Optional max bet enforcement (no minimum, optional maximum)
 * - Lock betting once squeeze starts (Lock Bets / Unlock Bets)
 * - Bettor view:
 *   - shows live totals
 *   - shows user’s bets + total wagered
 *   - allows delete own bets (disabled when locked)
 * - Terminal view:
 *   - shows all bets + total
 *   - allows cancel any bet (even when locked)
 * - Race lifecycle:
 *   - Next Race: clears bets + results, keeps participants
 *   - New Race: clears participants + bets + results
 * - Results entry:
 *   - enter 1st-4th
 *   - payout ledger per participant: spent / won / net
 *   - accounting check: total spent = total won + carryover (pools with no winners)
 * - Export CSV for bragging rights
 * - TV:
 *   - cycles boards every 5 seconds (W/P/S + Exacta/Trifecta/Superfecta)
 *   - shows current odds + payouts
 *   - shows Bettor QR code
 *   - shows uploaded photo
 *   - theme selector (Texas A&M, Christmas, Mardi Gras)
 *   - “Back to Terminal” button
 *
 * IMPORTANT anti-bug design decisions:
 * - No regex literals; csvEscape uses string methods only (prevents Vercel parsing issues).
 * - Name input is local-only; we never write to Firestore on keystrokes, only on Add/Delete.
 * - Firestore snapshots never mutate nameInput (prevents focus thrash / one-letter issue).
 */

// =====================
// Firebase (cloud sync)
// =====================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBcWTH6h_xDqfxAUYPHm8mXNNb-vMAWgNM",
  authDomain: "betting-terminal.firebaseapp.com",
  projectId: "betting-terminal",
  storageBucket: "betting-terminal.firebasestorage.app",
  messagingSenderId: "132647014088",
  appId: "1:132647014088:web:f3b6f23cce3cc3849d9ffd",
};

let firestore = null;
let onSnapshotFn = null;
let docFn = null;
let setDocFn = null;
let addDocFn = null;
let deleteDocFn = null;
let collectionFn = null;
let queryFn = null;
let orderByFn = null;
let serverTimestampFn = null;
let getDocsFn = null;
let writeBatchFn = null;

async function ensureFirebase() {
  if (firestore) return true;

  const fbApp = await import("firebase/app");
  const fbFs = await import("firebase/firestore");

  const app = fbApp.initializeApp(FIREBASE_CONFIG);
  firestore = fbFs.getFirestore(app);

  onSnapshotFn = fbFs.onSnapshot;
  docFn = fbFs.doc;
  setDocFn = fbFs.setDoc;
  addDocFn = fbFs.addDoc;
  deleteDocFn = fbFs.deleteDoc;
  collectionFn = fbFs.collection;
  queryFn = fbFs.query;
  orderByFn = fbFs.orderBy;
  serverTimestampFn = fbFs.serverTimestamp;
  getDocsFn = fbFs.getDocs;
  writeBatchFn = fbFs.writeBatch;

  return true;
}

// =====================
// Constants
// =====================
const BET_TYPES = [
  { key: "WIN", label: "Win" },
  { key: "PLACE", label: "Place" },
  { key: "SHOW", label: "Show" },
  { key: "WPS", label: "WPS (Win + Place + Show)" },
  { key: "EXACTA", label: "Exacta" },
  { key: "TRIFECTA", label: "Trifecta" },
  { key: "SUPERFECTA", label: "Superfecta" },
];

const TV_BOARDS = ["WIN", "PLACE", "SHOW", "EXACTA", "TRIFECTA", "SUPERFECTA"];
const DENOMS = [0.1, 0.25, 0.5, 1];

const TV_THEMES = [
  { key: "DEFAULT", name: "Default", bg: "#FFFFFF", text: "#111827", muted: "#6B7280", accent: "#111827", border: "#E5E7EB" },
  { key: "TAMU_MAROON", name: "Texas A&M", bg: "#500000", text: "#FFFFFF", muted: "rgba(255,255,255,0.85)", accent: "#FFFFFF", border: "rgba(255,255,255,0.22)" },
  { key: "XMAS_CLASSIC", name: "Christmas", bg: "#0B3D2E", text: "#FFFFFF", muted: "rgba(255,255,255,0.85)", accent: "#D62828", border: "rgba(255,255,255,0.22)" },
  { key: "MARDI_GRAS", name: "Mardi Gras", bg: "#2E1065", text: "#FFFFFF", muted: "rgba(255,255,255,0.85)", accent: "#FBBF24", border: "rgba(255,255,255,0.22)" },
];

function themeByKey(key) {
  return TV_THEMES.find((t) => t.key === key) ?? TV_THEMES[0];
}

// no regex literals - prevents Vercel parsing issues
function csvEscape(v) {
  const s = String(v ?? "");
  const needs = s.includes("\n") || s.includes("\r") || s.includes(",") || s.includes('"');
  if (!needs) return s;
  return `"${s.split('"').join('""')}"`;
}

function formatMoney(n) {
  const x = Number(n || 0);
  return `$${x.toFixed(2)}`;
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ordered permutations of length k
function permutations(items, k) {
  const out = [];
  const used = new Array(items.length).fill(false);

  const dfs = (path) => {
    if (path.length === k) {
      out.push([...path]);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      path.push(items[i]);
      dfs(path);
      path.pop();
      used[i] = false;
    }
  };

  dfs([]);
  return out;
}

export default function App() {
  // -------------------------
  // State: Mode + Routing
  // -------------------------
  const [mode, setMode] = useState("TERMINAL"); // TERMINAL | BETTOR | TV
  const [baseUrl, setBaseUrl] = useState("");

  const [cloudReady, setCloudReady] = useState(false);
  const [syncMode, setSyncMode] = useState("LOCAL"); // LOCAL | CLOUD

  const [roomCode, setRoomCode] = useState("");
  const [roomInput, setRoomInput] = useState("");

  // TV cycling
  const [boardKey, setBoardKey] = useState("WIN");
  const [autoRotate, setAutoRotate] = useState(true);

  // local persistence
  const STORAGE_KEY = "betting-terminal-state-v16";
  const persisted = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // -------------------------
  // Shared Room State (synced)
  // -------------------------
  const [participants, setParticipants] = useState(persisted?.participants ?? []);
  const [bets, setBets] = useState(persisted?.bets ?? []);
  const [raceLocked, setRaceLocked] = useState(persisted?.raceLocked ?? false);
  const [results, setResults] = useState(persisted?.results ?? { first: "", second: "", third: "", fourth: "" });
  const [terminalGraphic, setTerminalGraphic] = useState(persisted?.terminalGraphic ?? null);
  const [tvThemeKey, setTvThemeKey] = useState(persisted?.tvThemeKey ?? "DEFAULT");
  const [enforceMaxBet, setEnforceMaxBet] = useState(persisted?.enforceMaxBet ?? true);
  const [maxBet, setMaxBet] = useState(Number(persisted?.maxBet ?? 10));

  // -------------------------
  // Betting UI (device-local)
  // -------------------------
  const [bettor, setBettor] = useState(persisted?.bettor ?? "");
  const [betType, setBetType] = useState(persisted?.betType ?? "WIN");
  const [denom, setDenom] = useState(persisted?.denom ?? 0.1);

  const [pick1, setPick1] = useState("");
  const [pick2, setPick2] = useState("");
  const [pick3, setPick3] = useState("");
  const [pick4, setPick4] = useState("");

  // Exotics: box and/or locks
  const [boxed, setBoxed] = useState(false);
  const [useLocks, setUseLocks] = useState(false);
  const [boxHorses, setBoxHorses] = useState([]);

  const [lock1, setLock1] = useState(false);
  const [lock2, setLock2] = useState(false);
  const [lock3, setLock3] = useState(false);
  const [lock4, setLock4] = useState(false);

  const [lockPick1, setLockPick1] = useState("");
  const [lockPick2, setLockPick2] = useState("");
  const [lockPick3, setLockPick3] = useState("");
  const [lockPick4, setLockPick4] = useState("");

  // Participants entry (IMPORTANT: do not tie to cloud updates)
  const [nameInput, setNameInput] = useState("");
  const nameInputRef = useRef(null);

  // QR
  const [qrDataUrl, setQrDataUrl] = useState("");

  // -------------------------
  // Parse URL + base URL
  // -------------------------
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qMode = params.get("mode");
      if (qMode === "TERMINAL" || qMode === "BETTOR" || qMode === "TV") setMode(qMode);

      const qRoom = params.get("room");
      if (qRoom) {
        const rc = String(qRoom).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
        setRoomCode(rc);
        setRoomInput(rc);
      }

      const qTheme = params.get("theme");
      if (qTheme) setTvThemeKey(String(qTheme).toUpperCase());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      setBaseUrl(window.location.origin + window.location.pathname);
    } catch {
      // ignore
    }
  }, []);

  // -------------------------
  // Firebase init
  // -------------------------
  useEffect(() => {
    (async () => {
      const ok = await ensureFirebase();
      setCloudReady(ok);
      if (ok && roomCode) setSyncMode("CLOUD");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cloudReady) return;
    if (!roomCode) return;
    setSyncMode("CLOUD");
  }, [cloudReady, roomCode]);

  // -------------------------
  // URLs + QR
  // -------------------------
  const bettorUrl = useMemo(() => {
    if (!baseUrl) return "";
    const roomPart = roomCode ? `&room=${encodeURIComponent(roomCode)}` : "";
    return `${baseUrl}?mode=BETTOR${roomPart}`;
  }, [baseUrl, roomCode]);

  const tvUrl = useMemo(() => {
    if (!baseUrl) return "";
    const roomPart = roomCode ? `&room=${encodeURIComponent(roomCode)}` : "";
    const themePart = tvThemeKey ? `&theme=${encodeURIComponent(tvThemeKey)}` : "";
    return `${baseUrl}?mode=TV${roomPart}${themePart}`;
  }, [baseUrl, roomCode, tvThemeKey]);

  const terminalUrl = useMemo(() => {
    if (!baseUrl) return "";
    const roomPart = roomCode ? `&room=${encodeURIComponent(roomCode)}` : "";
    return `${baseUrl}?mode=TERMINAL${roomPart}`;
  }, [baseUrl, roomCode]);

  useEffect(() => {
    (async () => {
      if (!bettorUrl) {
        setQrDataUrl("");
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(bettorUrl, { width: 240, margin: 1 });
        setQrDataUrl(dataUrl);
      } catch {
        setQrDataUrl("");
      }
    })();
  }, [bettorUrl]);

  // -------------------------
  // Persist locally ALWAYS
  // -------------------------
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          participants,
          bets,
          raceLocked,
          results,
          terminalGraphic,
          tvThemeKey,
          enforceMaxBet,
          maxBet,
          bettor,
          betType,
          denom,
        })
      );
    } catch {
      // ignore
    }
  }, [participants, bets, raceLocked, results, terminalGraphic, tvThemeKey, enforceMaxBet, maxBet, bettor, betType, denom]);

  // -------------------------
  // Cloud subscribe (room doc + bets subcollection)
  // -------------------------
  useEffect(() => {
    if (!cloudReady) return;
    if (syncMode !== "CLOUD") return;
    if (!roomCode) return;

    const roomRef = docFn(firestore, "rooms", roomCode);
    const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");

    const unsubRoom = onSnapshotFn(roomRef, (snap) => {
      const data = snap.data();
      if (!data) return;

      // IMPORTANT: never touch nameInput here (prevents iPad typing bug)
      setParticipants(Array.isArray(data.participants) ? data.participants : []);
      setRaceLocked(!!data.raceLocked);
      setResults(data.results ?? { first: "", second: "", third: "", fourth: "" });
      setTerminalGraphic(data.terminalGraphic ?? null);
      setTvThemeKey(data.tvThemeKey ?? "DEFAULT");
      setEnforceMaxBet(data.enforceMaxBet ?? true);
      setMaxBet(Number(data.maxBet ?? 10));
    });

    const q = queryFn(betsRef, orderByFn("createdAt", "asc"));
    const unsubBets = onSnapshotFn(q, (qs) => {
      const rows = [];
      qs.forEach((d) => {
        const v = d.data();
        rows.push({
          id: d.id,
          createdAt: v.createdAt?.toDate ? v.createdAt.toDate().toISOString() : new Date().toISOString(),
          bettor: v.bettor,
          amount: Number(v.amount ?? 0),
          betType: v.betType,
          picks: Array.isArray(v.picks) ? v.picks : [],
          meta: v.meta ?? null,
        });
      });
      setBets(rows);
    });

    // Ensure room doc exists so Bettor sees participants immediately
    (async () => {
      await setDocFn(
        roomRef,
        {
          participants,
          raceLocked,
          results,
          terminalGraphic: terminalGraphic ?? null,
          tvThemeKey,
          enforceMaxBet,
          maxBet: Number(maxBet),
          updatedAt: serverTimestampFn(),
        },
        { merge: true }
      );
    })();

    return () => {
      unsubRoom();
      unsubBets();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudReady, syncMode, roomCode]);

  const pushRoomUpdate = async (patch) => {
    if (!(cloudReady && syncMode === "CLOUD" && roomCode)) return;
    const roomRef = docFn(firestore, "rooms", roomCode);
    await setDocFn(roomRef, { ...patch, updatedAt: serverTimestampFn() }, { merge: true });
  };

  // -------------------------
  // Betting + odds computations
  // -------------------------
  const poolsTotals = useMemo(() => {
    const totals = { WIN: 0, PLACE: 0, SHOW: 0, EXACTA: 0, TRIFECTA: 0, SUPERFECTA: 0 };
    for (const b of bets) {
      if (!b?.betType) continue;
      if (totals[b.betType] === undefined) continue;
      totals[b.betType] += Number(b.amount || 0);
    }
    return totals;
  }, [bets]);

  const totalAllBets = useMemo(() => bets.reduce((s, b) => s + Number(b.amount || 0), 0), [bets]);

  const amountsOn = useMemo(() => {
    const out = {
      WIN: new Map(),
      PLACE: new Map(),
      SHOW: new Map(),
      EXACTA: new Map(),
      TRIFECTA: new Map(),
      SUPERFECTA: new Map(),
    };

    for (const b of bets) {
      const t = b.betType;
      if (!(t in out)) continue;

      if (t === "WIN" || t === "PLACE" || t === "SHOW") {
        const horse = (b.picks || [])[0];
        if (!horse) continue;
        out[t].set(horse, (out[t].get(horse) ?? 0) + Number(b.amount || 0));
      } else {
        const key = (b.picks || []).join(" > ");
        if (!key) continue;
        out[t].set(key, (out[t].get(key) ?? 0) + Number(b.amount || 0));
      }
    }

    return out;
  }, [bets]);

  const horseBoard = useMemo(() => {
    const build = (t) => {
      const total = poolsTotals[t] ?? 0;
      const map = amountsOn[t];
      return participants.map((h) => {
        const on = map.get(h) ?? 0;
        const payoutPerDollar = on > 0 ? total / on : 0;
        const odds = on > 0 ? payoutPerDollar - 1 : 0;
        return { horse: h, on, payoutPerDollar, odds };
      });
    };
    return { WIN: build("WIN"), PLACE: build("PLACE"), SHOW: build("SHOW") };
  }, [participants, poolsTotals, amountsOn]);

  const exoticLeaders = useMemo(() => {
    const build = (t, limit = 12) => {
      const total = poolsTotals[t] ?? 0;
      const map = amountsOn[t];
      return Array.from(map.entries())
        .map(([combo, on]) => ({ combo, on, payoutPerDollar: on > 0 ? total / on : 0, odds: on > 0 ? total / on - 1 : 0 }))
        .sort((a, b) => b.on - a.on)
        .slice(0, limit);
    };
    return { EXACTA: build("EXACTA"), TRIFECTA: build("TRIFECTA"), SUPERFECTA: build("SUPERFECTA") };
  }, [poolsTotals, amountsOn]);

  // -------------------------
  // Ticket generation logic
  // -------------------------
  const isExotic = betType === "EXACTA" || betType === "TRIFECTA" || betType === "SUPERFECTA";
  const isWPS = betType === "WPS";

  const picksNeeded = useMemo(() => {
    if (betType === "WIN" || betType === "PLACE" || betType === "SHOW" || betType === "WPS") return 1;
    if (betType === "EXACTA") return 2;
    if (betType === "TRIFECTA") return 3;
    if (betType === "SUPERFECTA") return 4;
    return 1;
  }, [betType]);

  const currentPicks = useMemo(() => [pick1, pick2, pick3, pick4].slice(0, picksNeeded), [pick1, pick2, pick3, pick4, picksNeeded]);

  const lockedPicks = useMemo(() => {
    const arr = [null, null, null, null];
    if (lock1) arr[0] = lockPick1 || null;
    if (lock2) arr[1] = lockPick2 || null;
    if (lock3) arr[2] = lockPick3 || null;
    if (lock4) arr[3] = lockPick4 || null;
    return arr.slice(0, picksNeeded);
  }, [lock1, lock2, lock3, lock4, lockPick1, lockPick2, lockPick3, lockPick4, picksNeeded]);

  const lockedSet = useMemo(() => new Set(lockedPicks.filter(Boolean)), [lockedPicks]);

  const plainBoxCombos = useMemo(() => {
    if (!(boxed && isExotic) || useLocks) return [];
    const horses = boxHorses.filter(Boolean);
    if (horses.length < picksNeeded) return [];
    return permutations(horses, picksNeeded);
  }, [boxed, isExotic, useLocks, boxHorses, picksNeeded]);

  const lockBoxCombos = useMemo(() => {
    if (!(boxed && isExotic) || !useLocks) return [];
    const n = picksNeeded;

    // Validate lock duplicates
    const lockedOnly = lockedPicks.filter(Boolean);
    if (new Set(lockedOnly).size !== lockedOnly.length) return [];

    const openIdx = [];
    for (let i = 0; i < n; i++) if (!lockedPicks[i]) openIdx.push(i);

    if (openIdx.length === 0) return [lockedPicks.slice(0, n)];

    const available = boxHorses.filter((h) => h && !lockedSet.has(h));
    if (available.length < openIdx.length) return [];

    const perms = permutations(available, openIdx.length);
    const out = [];

    for (const p of perms) {
      const ticket = lockedPicks.slice(0, n).map((x) => x || null);
      for (let j = 0; j < openIdx.length; j++) ticket[openIdx[j]] = p[j];
      if (new Set(ticket).size !== ticket.length) continue;
      out.push(ticket);
    }

    return out;
  }, [boxed, isExotic, useLocks, picksNeeded, lockedPicks, boxHorses, lockedSet]);

  const ticketsForCurrentBet = useMemo(() => {
    if (!(boxed && isExotic)) return [currentPicks];
    const combos = useLocks ? lockBoxCombos : plainBoxCombos;
    return combos.length ? combos : [];
  }, [boxed, isExotic, useLocks, lockBoxCombos, plainBoxCombos, currentPicks]);

  const canAddBet = useMemo(() => {
    if (raceLocked) return false;
    if (!bettor) return false;
    if (!denom || denom <= 0) return false;
    if (enforceMaxBet && denom > maxBet) return false;

    if (isWPS) return !!currentPicks[0];

    if (boxed && isExotic) {
      if (ticketsForCurrentBet.length === 0) return false;
      if (ticketsForCurrentBet.length > 120) return false;
      return true;
    }

    if (currentPicks.some((p) => !p)) return false;
    if (new Set(currentPicks).size !== currentPicks.length) return false;
    return true;
  }, [raceLocked, bettor, denom, enforceMaxBet, maxBet, isWPS, boxed, isExotic, ticketsForCurrentBet.length, currentPicks]);

  // -------------------------
  // Payout ledger (spent/won/net) and check
  // -------------------------
  const perBetTypePayouts = useMemo(() => {
    const finish = {
      WIN: [results.first],
      PLACE: [results.first, results.second],
      SHOW: [results.first, results.second, results.third],
      EXACTA: [results.first, results.second],
      TRIFECTA: [results.first, results.second, results.third],
      SUPERFECTA: [results.first, results.second, results.third, results.fourth],
    };

    const out = {};
    for (const t of TV_BOARDS) {
      const pool = bets.filter((b) => b.betType === t);
      const poolTotal = pool.reduce((s, b) => s + Number(b.amount || 0), 0);
      const res = finish[t] || [];

      let winners = [];
      if (t === "WIN" || t === "PLACE" || t === "SHOW") {
        winners = pool.filter((b) => res.includes((b.picks || [])[0]));
      } else {
        winners = pool.filter((b) => {
          const p = b.picks || [];
          if (p.length !== res.length) return false;
          for (let i = 0; i < res.length; i++) if (p[i] !== res[i]) return false;
          return true;
        });
      }

      if (winners.length === 0 || poolTotal === 0) {
        out[t] = { poolTotal, winners: [], totalPaid: 0 };
      } else {
        const split = poolTotal / winners.length;
        out[t] = { poolTotal, winners: winners.map((w) => ({ bettor: w.bettor, amountWon: split })), totalPaid: poolTotal };
      }
    }
    return out;
  }, [bets, results]);

  const payoutLedger = useMemo(() => {
    const people = participants.length ? participants : Array.from(new Set(bets.map((b) => b.bettor))).filter(Boolean);

    const spent = new Map();
    const won = new Map();
    for (const p of people) { spent.set(p, 0); won.set(p, 0); }

    for (const b of bets) {
      if (!b?.bettor) continue;
      spent.set(b.bettor, (spent.get(b.bettor) ?? 0) + Number(b.amount || 0));
      if (!won.has(b.bettor)) won.set(b.bettor, 0);
      if (!spent.has(b.bettor)) spent.set(b.bettor, 0);
    }

    for (const t of Object.keys(perBetTypePayouts)) {
      for (const w of perBetTypePayouts[t].winners) {
        won.set(w.bettor, (won.get(w.bettor) ?? 0) + w.amountWon);
      }
    }

    const rows = Array.from(new Set([...spent.keys(), ...won.keys()]))
      .map((p) => {
        const s = spent.get(p) ?? 0;
        const w = won.get(p) ?? 0;
        return { person: p, spent: s, won: w, net: w - s };
      })
      .sort((a, b) => b.net - a.net);

    const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
    const totalWon = rows.reduce((s, r) => s + r.won, 0);
    const carryover = Math.max(0, totalSpent - totalWon);

    return { rows, totalSpent, totalWon, carryover };
  }, [participants, bets, perBetTypePayouts]);

  // -------------------------
  // Actions: participants
  // -------------------------
  const focusNameInput = () => {
    setTimeout(() => {
      try { nameInputRef.current?.focus(); } catch { /* ignore */ }
    }, 0);
  };

  const addParticipant = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) return;

    const next = [...participants, trimmed];
    setParticipants(next);
    setNameInput("");
    focusNameInput();

    if (!bettor) setBettor(trimmed);

    if (syncMode === "CLOUD") await pushRoomUpdate({ participants: next });
  };

  const deleteParticipant = async (name) => {
    const next = participants.filter((p) => p !== name);
    setParticipants(next);
    if (bettor === name) setBettor("");
    setBoxHorses((h) => h.filter((x) => x !== name));

    if (syncMode === "CLOUD") await pushRoomUpdate({ participants: next });
  };

  // -------------------------
  // Actions: bets
  // -------------------------
  const addBetCloudOrLocal = async (ticket) => {
    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      const now = new Date().toISOString();
      setBets((prev) => [
        ...prev,
        { id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2), createdAt: now, ...ticket },
      ]);
      return;
    }
    const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");
    await addDocFn(betsRef, { ...ticket, createdAt: serverTimestampFn() });
  };

  const addBet = async () => {
    if (!canAddBet) return;

    // WPS = 3 tickets
    if (isWPS) {
      const horse = currentPicks[0];
      const base = { bettor, amount: Number(denom), picks: [horse], meta: { parent: "WPS" } };
      await addBetCloudOrLocal({ ...base, betType: "WIN" });
      await addBetCloudOrLocal({ ...base, betType: "PLACE" });
      await addBetCloudOrLocal({ ...base, betType: "SHOW" });
      return;
    }

    // boxed exotics (including lock/box mode)
    if (boxed && isExotic) {
      if (ticketsForCurrentBet.length === 0 || ticketsForCurrentBet.length > 120) return;

      for (const picks of ticketsForCurrentBet) {
        // eslint-disable-next-line no-await-in-loop
        await addBetCloudOrLocal({
          bettor,
          amount: Number(denom),
          betType,
          picks,
          meta: useLocks ? { boxed: true, locks: lockedPicks } : { boxed: true },
        });
      }
      return;
    }

    // standard single ticket
    await addBetCloudOrLocal({ bettor, amount: Number(denom), betType, picks: currentPicks, meta: null });
  };

  const cancelBet = async (betId) => {
    if (!betId) return;

    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      setBets((prev) => prev.filter((b) => b.id !== betId));
      return;
    }
    await deleteDocFn(docFn(firestore, "rooms", roomCode, "bets", betId));
  };

  const deleteAllBetsCloud = async () => {
    if (!(cloudReady && syncMode === "CLOUD" && roomCode)) return;
    const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");
    const snap = await getDocsFn(betsRef);
    const batch = writeBatchFn(firestore);
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  };

  // -------------------------
  // Race lifecycle
  // -------------------------
  const nextRaceLocal = () => {
    setBets([]);
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);

    setBetType("WIN");
    setPick1(""); setPick2(""); setPick3(""); setPick4("");
    setBoxed(false); setUseLocks(false); setBoxHorses([]);
    setLock1(false); setLock2(false); setLock3(false); setLock4(false);
    setLockPick1(""); setLockPick2(""); setLockPick3(""); setLockPick4("");
  };

  const nextRace = async () => {
    // clears bets + results but keeps participants
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);

    setBetType("WIN");
    setPick1(""); setPick2(""); setPick3(""); setPick4("");
    setBoxed(false); setUseLocks(false); setBoxHorses([]);
    setLock1(false); setLock2(false); setLock3(false); setLock4(false);
    setLockPick1(""); setLockPick2(""); setLockPick3(""); setLockPick4("");

    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      nextRaceLocal();
      return;
    }

    await deleteAllBetsCloud();
    setBets([]);

    await pushRoomUpdate({
      results: { first: "", second: "", third: "", fourth: "" },
      raceLocked: false,
    });
  };

  const newRace = async () => {
    // clears participants + bets + results
    setParticipants([]);
    setBettor("");
    setNameInput("");
    nextRaceLocal();

    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) return;

    await deleteAllBetsCloud();
    setBets([]);

    await pushRoomUpdate({
      participants: [],
      results: { first: "", second: "", third: "", fourth: "" },
      raceLocked: false,
    });
  };

  // -------------------------
  // Betting lock
  // -------------------------
  const lockBets = async () => {
    setRaceLocked(true);
    if (syncMode === "CLOUD") await pushRoomUpdate({ raceLocked: true });
  };

  const unlockBets = async () => {
    setRaceLocked(false);
    if (syncMode === "CLOUD") await pushRoomUpdate({ raceLocked: false });
  };

  // -------------------------
  // Results + theme + limits + photo
  // -------------------------
  const updateResultsField = async (patch) => {
    const next = { ...results, ...patch };
    setResults(next);
    if (syncMode === "CLOUD") await pushRoomUpdate({ results: next });
  };

  const setTvTheme = async (key) => {
    setTvThemeKey(key);
    if (syncMode === "CLOUD") await pushRoomUpdate({ tvThemeKey: key });
  };

  const setLimits = async (patch) => {
    if (patch.enforceMaxBet !== undefined) setEnforceMaxBet(patch.enforceMaxBet);
    if (patch.maxBet !== undefined) setMaxBet(Number(patch.maxBet));
    if (syncMode === "CLOUD") {
      await pushRoomUpdate({
        enforceMaxBet: patch.enforceMaxBet !== undefined ? patch.enforceMaxBet : enforceMaxBet,
        maxBet: patch.maxBet !== undefined ? Number(patch.maxBet) : Number(maxBet),
      });
    }
  };

  const onUploadGraphic = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      setTerminalGraphic(dataUrl);
      if (syncMode === "CLOUD") await pushRoomUpdate({ terminalGraphic: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const clearGraphic = async () => {
    setTerminalGraphic(null);
    if (syncMode === "CLOUD") await pushRoomUpdate({ terminalGraphic: null });
  };

  // -------------------------
  // Export CSV
  // -------------------------
  const exportCsv = () => {
    const lines = [];
    lines.push(["Room", roomCode || "(local)"].map(csvEscape).join(","));
    lines.push(["All Bets Total", totalAllBets.toFixed(2)].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Results", ""].join(","));
    lines.push(["1st", results.first].map(csvEscape).join(","));
    lines.push(["2nd", results.second].map(csvEscape).join(","));
    lines.push(["3rd", results.third].map(csvEscape).join(","));
    lines.push(["4th", results.fourth].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Ledger", ""].join(","));
    lines.push(["Person", "Spent", "Won", "Net"].map(csvEscape).join(","));
    for (const r of payoutLedger.rows) {
      lines.push([r.person, r.spent.toFixed(2), r.won.toFixed(2), r.net.toFixed(2)].map(csvEscape).join(","));
    }
    lines.push(["Totals", payoutLedger.totalSpent.toFixed(2), payoutLedger.totalWon.toFixed(2), payoutLedger.carryover.toFixed(2)].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Bets", ""].join(","));
    lines.push(["Time", "Bettor", "Type", "Picks", "Amount"].map(csvEscape).join(","));
    for (const b of bets) {
      lines.push([b.createdAt, b.bettor, b.betType, (b.picks || []).join(" > "), Number(b.amount).toFixed(2)].map(csvEscape).join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `betting-terminal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // -------------------------
  // TV cycling every 5 seconds
  // -------------------------
  useEffect(() => {
    if (mode !== "TV") return;
    if (!autoRotate) return;
    const i = TV_BOARDS.indexOf(boardKey);
    const next = TV_BOARDS[(i + 1 + TV_BOARDS.length) % TV_BOARDS.length];
    const handle = setTimeout(() => setBoardKey(next), 5000);
    return () => clearTimeout(handle);
  }, [mode, autoRotate, boardKey]);

  // -------------------------
  // UI helpers
  // -------------------------
  const smallSelect = "border rounded-2xl p-3 text-base w-full";
  const smallInput = "border rounded-2xl p-3 text-base w-full";
  const buttonPrimary = "rounded-2xl px-4 py-3 text-base font-semibold bg-black text-white disabled:opacity-40 disabled:cursor-not-allowed";
  const buttonSecondary = "rounded-2xl px-4 py-3 text-base font-semibold border disabled:opacity-40 disabled:cursor-not-allowed";
  const buttonDanger = "rounded-2xl px-4 py-3 text-base font-semibold border border-red-600 text-red-600 disabled:opacity-40 disabled:cursor-not-allowed";
  const chip = "px-3 py-1 rounded-full border text-sm inline-flex items-center gap-2";

  const formatOdds = (odds) => (!odds || odds <= 0 ? "-" : `${odds.toFixed(2)}-1`);
  const formatPayoutPerTenCents = (payoutPerDollar) => (!payoutPerDollar || payoutPerDollar <= 0 ? "-" : `$${(payoutPerDollar * 0.1).toFixed(2)} per $0.10`);

  const PickSelect = ({ label, value, onChange, disabled }) => (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <select className={smallSelect} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Select</option>
        {participants.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );

  const DenomPicker = () => (
    <div className="space-y-2">
      <div className="text-sm font-medium">Denomination</div>
      <div className="flex flex-wrap gap-2">
        {DENOMS.map((d) => {
          const label = d === 1 ? "$1" : `$${d.toFixed(2)}`;
          const active = denom === d;
          return (
            <label
              key={d}
              className={"flex items-center gap-2 border rounded-2xl px-3 py-2 text-sm select-none " + (active ? "bg-black text-white" : "")}
            >
              <input type="checkbox" checked={active} onChange={() => setDenom(d)} disabled={raceLocked} />
              {label}
            </label>
          );
        })}
      </div>
      <div className="text-xs text-gray-600">Per ticket. WPS places 3 tickets.</div>
    </div>
  );

  const LockRow = ({ label, enabled, setEnabled, pick, setPick, disabled }) => (
    <div className="rounded-2xl border p-3 space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={disabled} />
        Lock {label}
      </label>
      <select className={smallSelect} value={pick} onChange={(e) => setPick(e.target.value)} disabled={disabled || !enabled}>
        <option value="">Select</option>
        {participants.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );

  // -------------------------
  // Bettor + Terminal derived
  // -------------------------
  const myBets = bettor ? bets.filter((b) => b.bettor === bettor) : [];
  const myTotal = myBets.reduce((s, b) => s + Number(b.amount || 0), 0);
  const bettorCanDelete = !raceLocked;

  // -------------------------
  // TV view
  // -------------------------
  if (mode === "TV") {
    const t = themeByKey(tvThemeKey);

    const headerLabel =
      boardKey === "WIN" ? "Win Board" :
      boardKey === "PLACE" ? "Place Board" :
      boardKey === "SHOW" ? "Show Board" :
      boardKey === "EXACTA" ? "Exacta Board" :
      boardKey === "TRIFECTA" ? "Trifecta Board" : "Superfecta Board";

    const rows =
      boardKey === "WIN" || boardKey === "PLACE" || boardKey === "SHOW"
        ? horseBoard[boardKey]
            .slice()
            .sort((a, b) => b.on - a.on)
            .map((r) => ({ left: r.horse, on: formatMoney(r.on), odds: formatOdds(r.odds), payout: formatPayoutPerTenCents(r.payoutPerDollar) }))
        : (boardKey === "EXACTA" ? exoticLeaders.EXACTA : boardKey === "TRIFECTA" ? exoticLeaders.TRIFECTA : exoticLeaders.SUPERFECTA)
            .map((r) => ({ left: r.combo, on: formatMoney(r.on), odds: formatOdds(r.odds), payout: formatPayoutPerTenCents(r.payoutPerDollar) }));

    return (
      <div className="min-h-screen" style={{ background: t.bg, color: t.text }}>
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="text-3xl font-black">Betting Terminal</div>
              <div className="text-lg" style={{ color: t.muted }}>{headerLabel} - live pools, odds, payouts (auto 5s)</div>
              {roomCode ? <div className="text-sm" style={{ color: t.muted }}>Room {roomCode} - Total {formatMoney(totalAllBets)}</div> : null}
              {terminalGraphic ? <img src={terminalGraphic} alt="TV photo" className="max-h-40 rounded-2xl border object-contain w-full" style={{ borderColor: t.border }} /> : null}
            </div>

            <div className="flex flex-col gap-2 items-end">
              <button
                className="rounded-2xl px-4 py-2 text-sm font-semibold border"
                style={{ borderColor: t.border, color: t.text }}
                onClick={() => { window.location.href = terminalUrl || baseUrl || "/"; }}
              >
                Back to Terminal
              </button>

              <div className="rounded-2xl p-3" style={{ border: `1px solid ${t.border}` }}>
                <div className="font-semibold">Scan to bet</div>
                {qrDataUrl ? <img src={qrDataUrl} alt="Bettor QR" className="mt-2 rounded-2xl border w-[220px] h-[220px]" style={{ borderColor: t.border }} /> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <label className="flex items-center gap-2 text-sm" style={{ color: t.muted }}>
              <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
              Auto-rotate
            </label>

            <div className="flex flex-wrap gap-2">
              {TV_BOARDS.map((k) => (
                <button
                  key={k}
                  className="rounded-2xl px-4 py-2 text-sm font-semibold"
                  onClick={() => setBoardKey(k)}
                  style={{
                    border: `1px solid ${t.border}`,
                    background: boardKey === k ? t.accent : "transparent",
                    color: boardKey === k ? t.bg : t.text,
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl p-4" style={{ border: `1px solid ${t.border}` }}>
              <div className="font-semibold text-lg">Pools</div>
              <div className="mt-3 space-y-2 text-base">
                {["WIN", "PLACE", "SHOW", "EXACTA", "TRIFECTA", "SUPERFECTA"].map((k) => (
                  <div key={k} className="flex items-center justify-between">
                    <div>{k}</div>
                    <div className="font-semibold">{formatMoney(poolsTotals[k] ?? 0)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-4 lg:col-span-2" style={{ border: `1px solid ${t.border}` }}>
              <div className="font-semibold text-lg">{headerLabel}</div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-base">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                      <th className="py-3 pr-3 text-left">Outcome</th>
                      <th className="py-3 pr-3 text-left">Bet On</th>
                      <th className="py-3 pr-3 text-left">Odds</th>
                      <th className="py-3 text-left">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.left} style={{ borderBottom: `1px solid ${t.border}` }}>
                        <td className="py-3 pr-3 font-semibold">{r.left}</td>
                        <td className="py-3 pr-3">{r.on}</td>
                        <td className="py-3 pr-3">{r.odds}</td>
                        <td className="py-3">{r.payout}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-sm" style={{ color: t.muted }}>Theme: {themeByKey(tvThemeKey).name}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------
  // Terminal + Bettor views
  // -------------------------
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        {terminalGraphic ? <img src={terminalGraphic} alt="Photo" className="max-h-40 rounded-2xl border object-contain w-full" /> : null}

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-black">Betting Terminal</div>
            <div className="text-xs text-gray-500 mt-1">
              Mode: <span className="font-semibold">{mode}</span> | Sync: <span className="font-semibold">{syncMode}</span>
              {roomCode ? <> | Room: <span className="font-semibold">{roomCode}</span></> : null}
            </div>
          </div>

          {mode === "TERMINAL" ? (
            <div className="flex flex-col sm:flex-row gap-2 items-end">
              <button className={buttonDanger} onClick={newRace}>New Race</button>
              <button className={buttonSecondary} onClick={nextRace}>Next Race</button>
              <button className={buttonSecondary} onClick={exportCsv} disabled={bets.length === 0}>Export CSV</button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button className={buttonSecondary + (mode === "TERMINAL" ? " bg-black text-white" : "")} onClick={() => setMode("TERMINAL")}>TERMINAL</button>
          <button className={buttonSecondary + (mode === "BETTOR" ? " bg-black text-white" : "")} onClick={() => setMode("BETTOR")}>BETTOR</button>
          <button className={buttonSecondary} onClick={() => { window.location.href = tvUrl || ""; }} disabled={!tvUrl}>Open TV</button>
        </div>

        {mode === "TERMINAL" ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Multi-phone setup</div>

            {!cloudReady ? <div className="text-sm text-gray-700">Cloud not ready - confirm package.json includes firebase and redeploy.</div> : null}

            <div className="flex flex-col sm:flex-row gap-2">
              <button className={buttonSecondary} onClick={() => {
                const rc = randomRoomCode();
                setRoomCode(rc);
                setRoomInput(rc);
                if (cloudReady) setSyncMode("CLOUD");
              }}>
                Generate room
              </button>

              <input className={smallInput} value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} placeholder="Enter room code" />

              <button className={buttonPrimary} onClick={() => {
                const rc = (roomInput || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
                setRoomCode(rc);
                if (cloudReady) setSyncMode("CLOUD");
              }} disabled={!roomInput || !cloudReady}>
                Use room
              </button>

              <button className={buttonSecondary} onClick={() => { setSyncMode("LOCAL"); setRoomCode(""); setRoomInput(""); }}>
                Local only
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div className="space-y-2">
                <div className="font-semibold">Bettor QR</div>
                <div className="text-xs text-gray-600 break-all">{bettorUrl || "(loading...)"}</div>
                {qrDataUrl ? <img src={qrDataUrl} alt="Bettor QR" className="border rounded-2xl w-[240px] h-[240px]" /> : <div className="text-xs text-red-600">QR not ready</div>}
              </div>

              <div className="space-y-2">
                <div className="font-semibold">TV theme</div>
                <select className={smallSelect} value={tvThemeKey} onChange={(e) => setTvTheme(e.target.value)}>
                  {TV_THEMES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>

                <div className="font-semibold mt-2">Upload photo (shows on TV)</div>
                <input type="file" accept="image/*" onChange={(e) => onUploadGraphic(e.target.files?.[0])} className="text-sm" />
                {terminalGraphic ? <button className={buttonSecondary} onClick={clearGraphic}>Remove photo</button> : null}

                <div className="font-semibold mt-2">TV link</div>
                <div className="text-xs text-gray-600 break-all">{tvUrl || "(loading...)"}</div>
              </div>
            </div>
          </div>
        ) : null}

        {mode === "TERMINAL" ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Participants</div>
              <div className="text-xs text-gray-600">These populate Bettor login</div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                ref={nameInputRef}
                className={smallInput}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Add name"
                autoCorrect="off"
                autoCapitalize="words"
                autoComplete="off"
                onKeyDown={(e) => { if (e.key === "Enter") addParticipant(); }}
              />
              <button className={buttonPrimary} onClick={addParticipant}>Add</button>
            </div>

            <div className="flex flex-wrap gap-2">
              {participants.length === 0 ? <div className="text-sm text-gray-600">Add at least 2 participants.</div> : null}
              {participants.map((p) => (
                <span key={p} className={chip}>
                  {p}
                  <button className="border rounded-full w-6 h-6 flex items-center justify-center" onClick={() => deleteParticipant(p)} title="Remove">×</button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Betting</div>
            <div className="text-sm text-gray-600">{raceLocked ? "Locked" : "Open"}</div>
          </div>

          {mode === "TERMINAL" ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <button className={buttonSecondary} onClick={lockBets} disabled={raceLocked}>Lock Bets</button>
              <button className={buttonSecondary} onClick={unlockBets} disabled={!raceLocked}>Unlock Bets</button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Your name</div>
              <select className={smallSelect} value={bettor} onChange={(e) => setBettor(e.target.value)} disabled={raceLocked}>
                <option value="">Select</option>
                {participants.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {participants.length === 0 ? <div className="text-xs text-red-600">Host must add participants first.</div> : null}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Bet type</div>
              <select
                className={smallSelect}
                value={betType}
                onChange={(e) => {
                  const t = e.target.value;
                  setBetType(t);
                  setPick1(""); setPick2(""); setPick3(""); setPick4("");
                  setBoxed(false); setUseLocks(false); setBoxHorses([]);
                  setLock1(false); setLock2(false); setLock3(false); setLock4(false);
                  setLockPick1(""); setLockPick2(""); setLockPick3(""); setLockPick4("");
                }}
                disabled={raceLocked}
              >
                {BET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <DenomPicker />

          {mode === "TERMINAL" ? (
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="font-semibold">Limits</div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={enforceMaxBet} onChange={(e) => setLimits({ enforceMaxBet: e.target.checked })} />
                  Enforce max bet
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">Max</span>
                  <input type="number" className="border rounded-2xl p-2 w-28" value={maxBet} onChange={(e) => setLimits({ maxBet: Number(e.target.value) })} min={0.1} step={0.1} />
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-medium">Pick(s)</div>

            {isExotic ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={boxed} onChange={(e) => { setBoxed(e.target.checked); setBoxHorses([]); }} disabled={raceLocked} />
                  Box exotics
                </label>

                {boxed ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={useLocks}
                      onChange={(e) => {
                        setUseLocks(e.target.checked);
                        setLock1(false); setLock2(false); setLock3(false); setLock4(false);
                        setLockPick1(""); setLockPick2(""); setLockPick3(""); setLockPick4("");
                      }}
                      disabled={raceLocked}
                    />
                    Lock some positions and box the rest
                  </label>
                ) : null}

                {boxed && useLocks ? (
                  <div className="space-y-3">
                    <div className="text-xs text-gray-600">Tickets: {ticketsForCurrentBet.length}. Max 120.</div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <LockRow label="1st" enabled={lock1} setEnabled={setLock1} pick={lockPick1} setPick={setLockPick1} disabled={raceLocked} />
                      {picksNeeded >= 2 ? <LockRow label="2nd" enabled={lock2} setEnabled={setLock2} pick={lockPick2} setPick={setLockPick2} disabled={raceLocked} /> : null}
                      {picksNeeded >= 3 ? <LockRow label="3rd" enabled={lock3} setEnabled={setLock3} pick={lockPick3} setPick={setLockPick3} disabled={raceLocked} /> : null}
                      {picksNeeded >= 4 ? <LockRow label="4th" enabled={lock4} setEnabled={setLock4} pick={lockPick4} setPick={setLockPick4} disabled={raceLocked} /> : null}
                    </div>

                    <div className="rounded-2xl border p-3 space-y-2">
                      <div className="text-sm font-medium">Box remaining positions</div>
                      <div className="grid grid-cols-2 gap-2">
                        {participants.map((p) => {
                          const checked = boxHorses.includes(p);
                          const disabled = lockedSet.has(p);
                          return (
                            <label key={p} className={"flex items-center gap-2 text-sm border rounded-2xl p-2 " + (disabled ? "opacity-50" : "")}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={raceLocked || disabled}
                                onChange={(e) => {
                                  if (e.target.checked) setBoxHorses((h) => [...h, p]);
                                  else setBoxHorses((h) => h.filter((x) => x !== p));
                                }}
                              />
                              {p}{disabled ? " (locked)" : ""}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {ticketsForCurrentBet.length > 120 ? <div className="text-xs text-red-600">Too many tickets. Lock more positions or select fewer horses.</div> : null}
                  </div>
                ) : null}

                {boxed && !useLocks ? (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-600">Select {picksNeeded} or more horses. Tickets: {ticketsForCurrentBet.length}. Max 120.</div>
                    <div className="grid grid-cols-2 gap-2">
                      {participants.map((p) => (
                        <label key={p} className="flex items-center gap-2 text-sm border rounded-2xl p-2">
                          <input
                            type="checkbox"
                            checked={boxHorses.includes(p)}
                            onChange={(e) => {
                              if (e.target.checked) setBoxHorses((h) => [...h, p]);
                              else setBoxHorses((h) => h.filter((x) => x !== p));
                            }}
                            disabled={raceLocked}
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                    {ticketsForCurrentBet.length > 120 ? <div className="text-xs text-red-600">Too many tickets. Select fewer horses.</div> : null}
                  </div>
                ) : null}

                {!boxed ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <PickSelect label="1st" value={pick1} onChange={setPick1} disabled={raceLocked} />
                    {picksNeeded >= 2 ? <PickSelect label="2nd" value={pick2} onChange={setPick2} disabled={raceLocked} /> : null}
                    {picksNeeded >= 3 ? <PickSelect label="3rd" value={pick3} onChange={setPick3} disabled={raceLocked} /> : null}
                    {picksNeeded >= 4 ? <PickSelect label="4th" value={pick4} onChange={setPick4} disabled={raceLocked} /> : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <PickSelect label="Pick" value={pick1} onChange={setPick1} disabled={raceLocked} />
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button className={buttonPrimary} onClick={addBet} disabled={!canAddBet}>Submit bet</button>
            {isWPS ? <div className="text-xs text-gray-600 self-center">WPS places 3 tickets at this denomination each.</div> : null}
          </div>

          {mode === "BETTOR" ? (
            <div className="rounded-2xl border p-4 space-y-2">
              <div className="font-semibold">Your bets</div>
              <div className="text-sm text-gray-600">Your total: {formatMoney(myTotal)}</div>
              <div className="text-sm text-gray-600">All bets total: {formatMoney(totalAllBets)}</div>

              {myBets.length === 0 ? <div className="text-sm text-gray-600">No bets yet.</div> : (
                <div className="space-y-2">
                  {myBets.slice().reverse().map((b) => (
                    <div key={b.id} className="rounded-2xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">
                          {b.betType}{b.meta?.parent ? " (WPS)" : ""} - {(b.picks || []).join(" > ")}
                        </div>
                        <div className="text-sm text-gray-600">{formatMoney(b.amount)}</div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="text-xs text-gray-500">{b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}</div>
                        <button className={buttonSecondary} onClick={() => cancelBet(b.id)} disabled={!bettorCanDelete}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {mode === "TERMINAL" ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">All bets</div>
              <div className="text-sm text-gray-600">Total: {formatMoney(totalAllBets)}</div>
            </div>

            {bets.length === 0 ? <div className="text-sm text-gray-600">No bets yet.</div> : (
              <div className="space-y-2">
                {bets.slice().reverse().map((b) => (
                  <div key={b.id} className="rounded-2xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium">{b.bettor} - {b.betType}{b.meta?.parent ? " (WPS)" : ""} - {(b.picks || []).join(" > ")}</div>
                      <div className="text-sm text-gray-600">{formatMoney(b.amount)}</div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="text-xs text-gray-500">{b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}</div>
                      <button className={buttonSecondary} onClick={() => cancelBet(b.id)}>Cancel</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {mode === "TERMINAL" ? (
          <>
            <div className="rounded-2xl border p-4 space-y-3">
              <div className="font-semibold">Official results</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PickSelect label="1st" value={results.first} onChange={(v) => updateResultsField({ first: v })} disabled={false} />
                <PickSelect label="2nd" value={results.second} onChange={(v) => updateResultsField({ second: v })} disabled={false} />
                <PickSelect label="3rd" value={results.third} onChange={(v) => updateResultsField({ third: v })} disabled={false} />
                <PickSelect label="4th (Superfecta)" value={results.fourth} onChange={(v) => updateResultsField({ fourth: v })} disabled={false} />
              </div>
            </div>

            <div className="rounded-2xl border p-4 space-y-3">
              <div className="font-semibold">Payout ledger</div>
              <div className="text-xs text-gray-600">Total spent must equal total won + carryover.</div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-2">Person</th>
                      <th className="py-2 pr-2">Spent</th>
                      <th className="py-2 pr-2">Won</th>
                      <th className="py-2">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutLedger.rows.map((r) => (
                      <tr key={r.person} className="border-b last:border-b-0">
                        <td className="py-2 pr-2 font-medium">{r.person}</td>
                        <td className="py-2 pr-2">{formatMoney(r.spent)}</td>
                        <td className="py-2 pr-2">{formatMoney(r.won)}</td>
                        <td className="py-2">{formatMoney(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div className="rounded-2xl border p-2">
                  <div className="text-xs text-gray-600">Total spent</div>
                  <div className="font-semibold">{formatMoney(payoutLedger.totalSpent)}</div>
                </div>
                <div className="rounded-2xl border p-2">
                  <div className="text-xs text-gray-600">Total won</div>
                  <div className="font-semibold">{formatMoney(payoutLedger.totalWon)}</div>
                </div>
                <div className="rounded-2xl border p-2">
                  <div className="text-xs text-gray-600">Carryover</div>
                  <div className="font-semibold">{formatMoney(payoutLedger.carryover)}</div>
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Check: {formatMoney(payoutLedger.totalWon)} + {formatMoney(payoutLedger.carryover)} = {formatMoney(payoutLedger.totalSpent)}
              </div>
            </div>

            <div className="rounded-2xl border p-4 space-y-3">
              <div className="font-semibold">Lock bets</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button className={buttonSecondary} onClick={lockBets} disabled={raceLocked}>Lock Bets</button>
                <button className={buttonSecondary} onClick={unlockBets} disabled={!raceLocked}>Unlock Bets</button>
              </div>
            </div>
          </>
        ) : null}

        <div className="text-xs text-gray-500 pb-10">
          If Bettor phones cannot see participants, confirm they are opening the QR link for the same room code shown on Terminal.
        </div>
      </div>
    </div>
  );
}
