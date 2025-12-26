import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

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

  return true;
}

// =====================
// Constants
// =====================
const BET_TYPES = [
  { key: "WIN", label: "Win" },
  { key: "PLACE", label: "Place" },
  { key: "SHOW", label: "Show" },
  { key: "EXACTA", label: "Exacta" },
  { key: "TRIFECTA", label: "Trifecta" },
  { key: "SUPERFECTA", label: "Superfecta" },
];

const PUBLIC_BOARDS = ["WIN", "PLACE", "SHOW", "EXACTA", "TRIFECTA", "SUPERFECTA"];

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

// No regex literals to avoid build issues
function csvEscape(v) {
  const s = String(v ?? "");
  const needs = s.includes("\n") || s.includes("\r") || s.includes(",") || s.includes('"');
  if (!needs) return s;
  return `"${s.split('"').join('""')}"`;
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// permutations of length k (ordered), from unique items
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

export default function BettingTerminal() {
  // Modes: TERMINAL | BETTOR | TV
  const [mode, setMode] = useState("TERMINAL");

  const [baseUrl, setBaseUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  const [cloudReady, setCloudReady] = useState(false);
  const [syncMode, setSyncMode] = useState("LOCAL"); // LOCAL | CLOUD

  const [roomCode, setRoomCode] = useState("");
  const [roomInput, setRoomInput] = useState("");

  const STORAGE_KEY = "betting-terminal-state-v13";
  const persisted = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const [participants, setParticipants] = useState(persisted?.participants ?? []);
  const [bets, setBets] = useState(persisted?.bets ?? []);
  const [raceLocked, setRaceLocked] = useState(persisted?.raceLocked ?? false);
  const [results, setResults] = useState(persisted?.results ?? { first: "", second: "", third: "", fourth: "" });

  const [terminalGraphic, setTerminalGraphic] = useState(persisted?.terminalGraphic ?? null);
  const [tvThemeKey, setTvThemeKey] = useState(persisted?.tvThemeKey ?? "DEFAULT");

  const [betType, setBetType] = useState("WIN");
  const [bettor, setBettor] = useState("");
  const [denom, setDenom] = useState(0.1);

  const [nameInput, setNameInput] = useState("");
  const nameInputRef = useRef(null);

  const [boxed, setBoxed] = useState(false);
  const [boxHorses, setBoxHorses] = useState([]);

  const [pick1, setPick1] = useState("");
  const [pick2, setPick2] = useState("");
  const [pick3, setPick3] = useState("");
  const [pick4, setPick4] = useState("");

  const [enforceMaxBet, setEnforceMaxBet] = useState(true);
  const [maxBet, setMaxBet] = useState(10);

  const [boardKey, setBoardKey] = useState("WIN");
  const [autoRotate, setAutoRotate] = useState(true);

  // Parse URL once
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qMode = params.get("mode");
      if (qMode === "TV" || qMode === "BETTOR" || qMode === "TERMINAL") setMode(qMode);

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

  // Firebase ready
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

  // Build bettor/TV URLs
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

  // QR
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

  // Persist locally always (fallback + prevents “lost state” if cloud hiccups)
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
          denom,
          enforceMaxBet,
          maxBet,
        })
      );
    } catch {
      // ignore
    }
  }, [participants, bets, raceLocked, results, terminalGraphic, tvThemeKey, denom, enforceMaxBet, maxBet]);

  // Cloud subscribe
  useEffect(() => {
    if (!cloudReady) return;
    if (syncMode !== "CLOUD") return;
    if (!roomCode) return;

    const roomRef = docFn(firestore, "rooms", roomCode);
    const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");

    const unsubRoom = onSnapshotFn(roomRef, (snap) => {
      const data = snap.data();
      if (!data) return;
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
        });
      });
      setBets(rows);
    });

    // Ensure room doc exists
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

  // ---------- Betting helpers ----------
  const picksNeeded = useMemo(() => {
    if (betType === "WIN" || betType === "PLACE" || betType === "SHOW") return 1;
    if (betType === "EXACTA") return 2;
    if (betType === "TRIFECTA") return 3;
    if (betType === "SUPERFECTA") return 4;
    return 1;
  }, [betType]);

  const isExotic = betType === "EXACTA" || betType === "TRIFECTA" || betType === "SUPERFECTA";

  const currentPicks = useMemo(
    () => [pick1, pick2, pick3, pick4].slice(0, picksNeeded),
    [pick1, pick2, pick3, pick4, picksNeeded]
  );

  const boxCombos = useMemo(() => {
    if (!boxed || !isExotic) return [];
    const horses = boxHorses.filter(Boolean);
    if (horses.length < picksNeeded) return [];
    return permutations(horses, picksNeeded);
  }, [boxed, isExotic, boxHorses, picksNeeded]);

  const canAddBet = useMemo(() => {
    if (raceLocked) return false;
    if (!bettor) return false;
    if (!denom || denom <= 0) return false;
    if (enforceMaxBet && denom > maxBet) return false;

    if (boxed && isExotic) {
      if (boxCombos.length === 0) return false;
      if (boxCombos.length > 120) return false;
      return true;
    }

    if (currentPicks.some((p) => !p)) return false;
    if (new Set(currentPicks).size !== currentPicks.length) return false;
    return true;
  }, [raceLocked, bettor, denom, enforceMaxBet, maxBet, boxed, isExotic, boxCombos.length, currentPicks]);

  // Pools + odds tables
  const poolsTotals = useMemo(() => {
    const totals = { WIN: 0, PLACE: 0, SHOW: 0, EXACTA: 0, TRIFECTA: 0, SUPERFECTA: 0 };
    for (const b of bets) {
      if (!b?.betType) continue;
      if (totals[b.betType] === undefined) totals[b.betType] = 0;
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
        .map(([combo, on]) => ({
          combo,
          on,
          payoutPerDollar: on > 0 ? total / on : 0,
          odds: on > 0 ? total / on - 1 : 0,
        }))
        .sort((a, b) => b.on - a.on)
        .slice(0, limit);
    };
    return { EXACTA: build("EXACTA"), TRIFECTA: build("TRIFECTA"), SUPERFECTA: build("SUPERFECTA") };
  }, [poolsTotals, amountsOn]);

  // ---------- Payout ledger ----------
  const perBetTypePayouts = useMemo(() => {
    const out = {};
    const finish = {
      WIN: [results.first],
      PLACE: [results.first, results.second],
      SHOW: [results.first, results.second, results.third],
      EXACTA: [results.first, results.second],
      TRIFECTA: [results.first, results.second, results.third],
      SUPERFECTA: [results.first, results.second, results.third, results.fourth],
    };

    for (const t of PUBLIC_BOARDS) {
      const pool = bets.filter((b) => b.betType === t);
      const poolTotal = pool.reduce((s, b) => s + Number(b.amount || 0), 0);

      let winners = [];
      const res = finish[t] || [];

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
        out[t] = {
          poolTotal,
          winners: winners.map((w) => ({ bettor: w.bettor, amountWon: split })),
          totalPaid: poolTotal,
        };
      }
    }

    return out;
  }, [bets, results]);

  const payoutLedger = useMemo(() => {
    const people = participants.length ? participants : Array.from(new Set(bets.map((b) => b.bettor))).filter(Boolean);

    const spent = new Map();
    const won = new Map();

    for (const p of people) {
      spent.set(p, 0);
      won.set(p, 0);
    }

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

  // ---------- Actions ----------
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
    if (syncMode === "CLOUD") await pushRoomUpdate({ participants: next });
  };

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

    if (boxed && isExotic) {
      for (const picks of boxCombos) {
        // eslint-disable-next-line no-await-in-loop
        await addBetCloudOrLocal({ bettor, amount: Number(denom), betType, picks });
      }
      return;
    }

    await addBetCloudOrLocal({ bettor, amount: Number(denom), betType, picks: currentPicks });
  };

  const cancelBet = async (betId) => {
    if (!betId) return;

    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      setBets((prev) => prev.filter((b) => b.id !== betId));
      return;
    }
    await deleteDocFn(docFn(firestore, "rooms", roomCode, "bets", betId));
  };

  const lockBets = async () => {
    setRaceLocked(true);
    if (syncMode === "CLOUD") await pushRoomUpdate({ raceLocked: true });
  };

  const unlockBets = async () => {
    setRaceLocked(false);
    if (syncMode === "CLOUD") await pushRoomUpdate({ raceLocked: false });
  };

  const nextRace = async () => {
    // clear bets + results, keep participants
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);
    setBetType("WIN");
    setPick1(""); setPick2(""); setPick3(""); setPick4("");
    setBoxed(false); setBoxHorses([]);

    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      setBets([]);
      return;
    }

    // easiest: new room with same participants (prevents “stale bets”)
    const rc = randomRoomCode();
    setRoomCode(rc);
    setRoomInput(rc);
    setBets([]);

    const roomRef = docFn(firestore, "rooms", rc);
    await setDocFn(roomRef, {
      participants: [...participants],
      raceLocked: false,
      results: { first: "", second: "", third: "", fourth: "" },
      terminalGraphic: terminalGraphic ?? null,
      tvThemeKey,
      enforceMaxBet,
      maxBet: Number(maxBet),
      updatedAt: serverTimestampFn(),
    }, { merge: true });
  };

  const newRace = async () => {
    // clear participants + bets + results
    setParticipants([]);
    setBettor("");
    setNameInput("");
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);
    setBets([]);

    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) return;

    const rc = randomRoomCode();
    setRoomCode(rc);
    setRoomInput(rc);

    const roomRef = docFn(firestore, "rooms", rc);
    await setDocFn(roomRef, {
      participants: [],
      raceLocked: false,
      results: { first: "", second: "", third: "", fourth: "" },
      terminalGraphic: terminalGraphic ?? null,
      tvThemeKey,
      enforceMaxBet,
      maxBet: Number(maxBet),
      updatedAt: serverTimestampFn(),
    }, { merge: true });
  };

  const updateResultsField = async (patch) => {
    const next = { ...results, ...patch };
    setResults(next);
    if (syncMode === "CLOUD") await pushRoomUpdate({ results: next });
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

  const exportCsv = () => {
    const lines = [];
    lines.push(["Room", roomCode || "(local)"].map(csvEscape).join(","));
    lines.push(["All Bets Total", totalAllBets.toFixed(2)].map(csvEscape).join(","));
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

  // TV auto rotate every 5 seconds
  useEffect(() => {
    if (mode !== "TV") return;
    if (!autoRotate) return;
    const i = PUBLIC_BOARDS.indexOf(boardKey);
    const next = PUBLIC_BOARDS[(i + 1 + PUBLIC_BOARDS.length) % PUBLIC_BOARDS.length];
    const handle = setTimeout(() => setBoardKey(next), 5000);
    return () => clearTimeout(handle);
  }, [mode, autoRotate, boardKey]);

  // ---------- Formatting ----------
  const smallSelect = "border rounded-2xl p-3 text-base w-full";
  const smallInput = "border rounded-2xl p-3 text-base w-full";
  const button = "rounded-2xl px-4 py-3 text-base font-semibold border";
  const buttonPrimary = "rounded-2xl px-4 py-3 text-base font-semibold bg-black text-white disabled:opacity-40 disabled:cursor-not-allowed";
  const buttonSecondary = "rounded-2xl px-4 py-3 text-base font-semibold border disabled:opacity-40 disabled:cursor-not-allowed";
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
            <label key={d} className={"flex items-center gap-2 border rounded-2xl px-3 py-2 text-sm select-none " + (active ? "bg-black text-white" : "")}>
              <input type="checkbox" checked={active} onChange={() => setDenom(d)} disabled={raceLocked} />
              {label}
            </label>
          );
        })}
      </div>
    </div>
  );

  // ---------- TV view ----------
  const TvBoard = () => {
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
            .map((r) => ({ left: r.horse, on: `$${r.on.toFixed(2)}`, odds: formatOdds(r.odds), payout: formatPayoutPerTenCents(r.payoutPerDollar) }))
        : (boardKey === "EXACTA" ? exoticLeaders.EXACTA : boardKey === "TRIFECTA" ? exoticLeaders.TRIFECTA : exoticLeaders.SUPERFECTA)
            .map((r) => ({ left: r.combo, on: `$${r.on.toFixed(2)}`, odds: formatOdds(r.odds), payout: formatPayoutPerTenCents(r.payoutPerDollar) }));

    return (
      <div className="min-h-screen" style={{ background: t.bg, color: t.text }}>
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 space-y-2">
              <div className="text-3xl font-black">Betting Terminal</div>
              <div className="text-lg" style={{ color: t.muted }}>
                {headerLabel} - odds + payouts (auto 5s)
              </div>
              {roomCode ? <div className="text-sm" style={{ color: t.muted }}>Room {roomCode}</div> : null}
              {terminalGraphic ? (
                <img src={terminalGraphic} alt="TV photo" className="max-h-40 rounded-2xl border object-contain w-full" style={{ borderColor: t.border }} />
              ) : null}
            </div>

            <div className="rounded-2xl p-4" style={{ border: `1px solid ${t.border}` }}>
              <div className="font-semibold text-lg">Scan to bet</div>
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Bettor QR" className="mt-2 rounded-2xl border w-[240px] h-[240px]" style={{ borderColor: t.border }} />
              ) : (
                <div className="mt-2 text-sm" style={{ color: t.muted }}>QR not ready</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl p-4" style={{ border: `1px solid ${t.border}` }}>
            <div className="flex items-center justify-between">
              <div className="font-semibold text-lg">{headerLabel}</div>
              <div className="text-sm" style={{ color: t.muted }}>Total bets: ${totalAllBets.toFixed(2)}</div>
            </div>

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

            <div className="mt-3 text-sm" style={{ color: t.muted }}>
              Pools: WIN ${poolsTotals.WIN.toFixed(2)} | PLACE ${poolsTotals.PLACE.toFixed(2)} | SHOW ${poolsTotals.SHOW.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------- Main render ----------
  if (mode === "TV") return <TvBoard />;

  const myBets = bettor ? bets.filter((b) => b.bettor === bettor) : [];
  const myTotal = myBets.reduce((s, b) => s + Number(b.amount || 0), 0);

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
              <button className={button} onClick={newRace}>New Race</button>
              <button className={button} onClick={nextRace}>Next Race</button>
              <button className={button} onClick={exportCsv} disabled={bets.length === 0}>Export CSV</button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button className={button + (mode === "TERMINAL" ? " bg-black text-white" : "")} onClick={() => setMode("TERMINAL")}>TERMINAL</button>
          <button className={button + (mode === "BETTOR" ? " bg-black text-white" : "")} onClick={() => setMode("BETTOR")}>BETTOR</button>
          <button className={button + (mode === "TV" ? " bg-black text-white" : "")} onClick={() => setMode("TV")}>TV</button>
        </div>

        {mode === "TERMINAL" ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Room</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button className={button} onClick={() => {
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div className="space-y-2">
                <div className="font-semibold">Bettor QR</div>
                <div className="text-xs text-gray-600 break-all">{bettorUrl || "(loading...)"}</div>
                {qrDataUrl ? <img src={qrDataUrl} alt="QR" className="border rounded-2xl w-[240px] h-[240px]" /> : <div className="text-xs text-red-600">QR not ready</div>}
              </div>

              <div className="space-y-2">
                <div className="font-semibold">TV link</div>
                <div className="text-xs text-gray-600 break-all">{tvUrl || "(loading...)"}</div>

                <div className="font-semibold mt-2">TV theme</div>
                <select className={smallSelect} value={tvThemeKey} onChange={(e) => {
                  setTvThemeKey(e.target.value);
                  pushRoomUpdate({ tvThemeKey: e.target.value });
                }}>
                  {TV_THEMES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border p-3 space-y-2">
              <div className="font-semibold">Upload photo (shows on TV)</div>
              <input type="file" accept="image/*" onChange={(e) => onUploadGraphic(e.target.files?.[0])} className="text-sm" />
              {terminalGraphic ? (
                <button className={buttonSecondary} onClick={clearGraphic}>Remove photo</button>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "TERMINAL" ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Participants</div>
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
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Bet type</div>
              <select className={smallSelect} value={betType} onChange={(e) => {
                const t = e.target.value;
                setBetType(t);
                setPick1(""); setPick2(""); setPick3(""); setPick4("");
                setBoxed(false); setBoxHorses([]);
              }} disabled={raceLocked}>
                {BET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <DenomPicker />

          <div className="space-y-2">
            <div className="text-sm font-medium">Pick(s)</div>

            {isExotic ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={boxed} onChange={(e) => { setBoxed(e.target.checked); setBoxHorses([]); }} disabled={raceLocked} />
                Box (any order)
              </label>
            ) : null}

            {boxed && isExotic ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-600">Select {picksNeeded} or more horses. Tickets: {boxCombos.length}. Max 120.</div>
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
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <PickSelect label={picksNeeded === 1 ? "Pick" : "1st"} value={pick1} onChange={setPick1} disabled={raceLocked} />
                {picksNeeded >= 2 ? <PickSelect label="2nd" value={pick2} onChange={setPick2} disabled={raceLocked} /> : null}
                {picksNeeded >= 3 ? <PickSelect label="3rd" value={pick3} onChange={setPick3} disabled={raceLocked} /> : null}
                {picksNeeded >= 4 ? <PickSelect label="4th" value={pick4} onChange={setPick4} disabled={raceLocked} /> : null}
              </div>
            )}
          </div>

          <button className={buttonPrimary} onClick={addBet} disabled={!canAddBet}>Submit bet</button>

          {mode === "BETTOR" ? (
            <div className="rounded-2xl border p-4 space-y-2">
              <div className="font-semibold">Your bets</div>
              <div className="text-sm text-gray-600">Your total: ${myTotal.toFixed(2)}</div>
              {myBets.length === 0 ? <div className="text-sm text-gray-600">No bets yet.</div> : (
                <div className="space-y-2">
                  {myBets.slice().reverse().map((b) => (
                    <div key={b.id} className="rounded-2xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">{b.betType} - {(b.picks || []).join(" > ")}</div>
                        <div className="text-sm text-gray-600">${Number(b.amount).toFixed(2)}</div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="text-xs text-gray-500">{b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}</div>
                        <button className={buttonSecondary} onClick={() => cancelBet(b.id)} disabled={raceLocked}>Delete</button>
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
              <div className="text-sm text-gray-600">Total: ${totalAllBets.toFixed(2)}</div>
            </div>
            {bets.length === 0 ? <div className="text-sm text-gray-600">No bets yet.</div> : (
              <div className="space-y-2">
                {bets.slice().reverse().map((b) => (
                  <div key={b.id} className="rounded-2xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium">{b.bettor} - {b.betType} - {(b.picks || []).join(" > ")}</div>
                      <div className="text-sm text-gray-600">${Number(b.amount).toFixed(2)}</div>
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
          <div className="rounded-2xl border p-4 space-y-4">
            <div className="font-semibold">Official results + payouts</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PickSelect label="1st" value={results.first} onChange={(v) => updateResultsField({ first: v })} disabled={false} />
              <PickSelect label="2nd" value={results.second} onChange={(v) => updateResultsField({ second: v })} disabled={false} />
              <PickSelect label="3rd" value={results.third} onChange={(v) => updateResultsField({ third: v })} disabled={false} />
              <PickSelect label="4th (Superfecta)" value={results.fourth} onChange={(v) => updateResultsField({ fourth: v })} disabled={false} />
            </div>

            <div className="rounded-2xl border p-3 space-y-2">
              <div className="font-semibold">Payout ledger</div>
              <div className="text-xs text-gray-600">Totals must satisfy: Total won + carryover = total spent.</div>

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
                        <td className="py-2 pr-2">${r.spent.toFixed(2)}</td>
                        <td className="py-2 pr-2">${r.won.toFixed(2)}</td>
                        <td className="py-2">${r.net.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div className="rounded-2xl border p-2">
                  <div className="text-xs text-gray-600">Total spent</div>
                  <div className="font-semibold">${payoutLedger.totalSpent.toFixed(2)}</div>
                </div>
                <div className="rounded-2xl border p-2">
                  <div className="text-xs text-gray-600">Total won</div>
                  <div className="font-semibold">${payoutLedger.totalWon.toFixed(2)}</div>
                </div>
                <div className="rounded-2xl border p-2">
                  <div className="text-xs text-gray-600">Carryover</div>
                  <div className="font-semibold">${payoutLedger.carryover.toFixed(2)}</div>
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Check: ${payoutLedger.totalWon.toFixed(2)} + ${payoutLedger.carryover.toFixed(2)} = ${payoutLedger.totalSpent.toFixed(2)}
              </div>
            </div>
          </div>
        ) : null}

        <div className="text-xs text-gray-500 pb-10">
          If participants still do not appear on Bettor phones: confirm they are opening the QR link for the same room code shown on Terminal.
        </div>
      </div>
    </div>
  );
}
