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

// Starts as null on purpose - initialized inside ensureFirebase.
let firebaseApp = null;
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
  if (!FIREBASE_CONFIG) return false;
  if (firestore) return true;

  const fbApp = await import("firebase/app");
  const fbFs = await import("firebase/firestore");

  firebaseApp = fbApp.initializeApp(FIREBASE_CONFIG);
  firestore = fbFs.getFirestore(firebaseApp);

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
  { key: "WPS", label: "WPS (Win/Place/Show)" },
  { key: "EXACTA", label: "Exacta" },
  { key: "TRIFECTA", label: "Trifecta" },
  { key: "SUPERFECTA", label: "Superfecta" },
];

const PUBLIC_BOARDS = [
  { key: "WIN", label: "Win Board" },
  { key: "PLACE", label: "Place Board" },
  { key: "SHOW", label: "Show Board" },
  { key: "EXACTA", label: "Exacta Board" },
  { key: "TRIFECTA", label: "Trifecta Board" },
  { key: "SUPERFECTA", label: "Superfecta Board" },
];

const DENOMS = [0.1, 0.25, 0.5, 1];

// TV theme presets (background + text + accent)
const TV_THEMES = [
  {
    key: "DEFAULT",
    name: "Default (Light)",
    bg: "#FFFFFF",
    text: "#111827",
    muted: "#6B7280",
    accent: "#111827",
    border: "#E5E7EB",
  },
  {
    key: "TAMU_MAROON",
    name: "Texas A&M (Maroon)",
    bg: "#500000",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.85)",
    accent: "#FFFFFF",
    border: "rgba(255,255,255,0.22)",
  },
  {
    key: "TAMU_LIGHT",
    name: "Texas A&M (Light)",
    bg: "#FFFFFF",
    text: "#500000",
    muted: "#6B7280",
    accent: "#500000",
    border: "#E5E7EB",
  },
  {
    key: "XMAS_CLASSIC",
    name: "Christmas (Classic)",
    bg: "#0B3D2E",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.85)",
    accent: "#D62828",
    border: "rgba(255,255,255,0.22)",
  },
  {
    key: "XMAS_RED",
    name: "Christmas (Red)",
    bg: "#B91C1C",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.85)",
    accent: "#14532D",
    border: "rgba(255,255,255,0.22)",
  },
  {
    key: "MARDI_GRAS",
    name: "Mardi Gras",
    bg: "#2E1065",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.85)",
    accent: "#FBBF24",
    border: "rgba(255,255,255,0.22)",
  },
  {
    key: "HALLOWEEN",
    name: "Halloween",
    bg: "#111827",
    text: "#FBBF24",
    muted: "#D1D5DB",
    accent: "#F97316",
    border: "rgba(251,191,36,0.30)",
  },
  {
    key: "USA",
    name: "4th of July",
    bg: "#0B1F3A",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.85)",
    accent: "#DC2626",
    border: "rgba(255,255,255,0.22)",
  },
  {
    key: "VALENTINE",
    name: "Valentine’s",
    bg: "#FFF1F2",
    text: "#9F1239",
    muted: "#6B7280",
    accent: "#BE123C",
    border: "#FBCFE8",
  },
];

function themeByKey(key) {
  return TV_THEMES.find((t) => t.key === key) ?? TV_THEMES[0];
}

function csvEscape(v) {
  const s = String(v ?? "");
  const needsQuotes = s.includes("\n") || s.includes("\r") || s.includes(",") || s.includes('"');
  if (!needsQuotes) return s;
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
  // Modes:
  // TERMINAL = iPad host/admin
  // BETTOR = phone guests
  // TV = screen share board
  const [mode, setMode] = useState("TERMINAL");

  const [baseUrl, setBaseUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  // iPad input focus stability
  const addNameRef = useRef(null);

  // Sync
  const [cloudReady, setCloudReady] = useState(false);
  const [syncMode, setSyncMode] = useState("LOCAL"); // LOCAL | CLOUD

  // Room
  const [roomCode, setRoomCode] = useState("");
  const [roomInput, setRoomInput] = useState("");

  // Optional terminal/TV graphic
  const [terminalGraphic, setTerminalGraphic] = useState(null); // data URL string

  // TV theme
  const [tvThemeKey, setTvThemeKey] = useState("DEFAULT");

  // Local persistence
  const STORAGE_KEY = "betting-terminal-state-v11";
  const loadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const persisted = typeof window !== "undefined" ? loadState() : null;

  // Core state
  const [participants, setParticipants] = useState(persisted?.participants ?? []);
  const [nameInput, setNameInput] = useState("");

  const [bets, setBets] = useState(persisted?.bets ?? []);

  const [betType, setBetType] = useState(persisted?.betType ?? "WIN");
  const [bettor, setBettor] = useState(persisted?.bettor ?? "");

  // denomination selection
  const [denom, setDenom] = useState(persisted?.denom ?? 0.1);
  const amount = denom;

  // ordered picks (non-boxed)
  const [pick1, setPick1] = useState("");
  const [pick2, setPick2] = useState("");
  const [pick3, setPick3] = useState("");
  const [pick4, setPick4] = useState("");

  // boxed exotics with optional locked positions
  const [boxed, setBoxed] = useState(false);
  const [boxHorses, setBoxHorses] = useState([]);
  const [lock1, setLock1] = useState(false);
  const [lock2, setLock2] = useState(false);
  const [lock3, setLock3] = useState(false);
  const [lock4, setLock4] = useState(false);
  const [lockPick1, setLockPick1] = useState("");
  const [lockPick2, setLockPick2] = useState("");
  const [lockPick3, setLockPick3] = useState("");
  const [lockPick4, setLockPick4] = useState("");

  const [raceLocked, setRaceLocked] = useState(false);

  // max bet (no minimum)
  const [enforceMaxBet, setEnforceMaxBet] = useState(true);
  const [maxBet, setMaxBet] = useState(10);

  // results
  const [results, setResults] = useState({ first: "", second: "", third: "", fourth: "" });

  // TV board rotation
  const [boardKey, setBoardKey] = useState("WIN");
  const [autoRotate, setAutoRotate] = useState(true);

  // ---------
  // URL parse
  // ---------
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

  // restore persisted extras
  useEffect(() => {
    if (persisted?.terminalGraphic) setTerminalGraphic(persisted.terminalGraphic);
    if (persisted?.tvThemeKey) setTvThemeKey(persisted.tvThemeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Firebase readiness
  useEffect(() => {
    (async () => {
      const ok = await ensureFirebase();
      setCloudReady(ok);
      if (ok) {
        try {
          const params = new URLSearchParams(window.location.search);
          const qRoom = params.get("room");
          if (qRoom) setSyncMode("CLOUD");
        } catch {
          // ignore
        }
      } else {
        setSyncMode("LOCAL");
      }
    })();
  }, []);

  // If a room code exists and cloud is ready, auto-switch to CLOUD
  useEffect(() => {
    if (!cloudReady) return;
    if (!roomCode) return;
    setSyncMode("CLOUD");
  }, [cloudReady, roomCode]);

  // QR links
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

  // QR via DataURL (more reliable than canvas on iOS)
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

  // -----------------
  // Local persistence
  // -----------------
  useEffect(() => {
    if (syncMode !== "LOCAL") return;
    try {
      const snapshot = {
        participants,
        bets,
        betType,
        bettor,
        denom,
        raceLocked,
        enforceMaxBet,
        maxBet,
        results,
        boardKey,
        autoRotate,
        terminalGraphic,
        tvThemeKey,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore
    }
  }, [
    syncMode,
    participants,
    bets,
    betType,
    bettor,
    denom,
    raceLocked,
    enforceMaxBet,
    maxBet,
    results,
    boardKey,
    autoRotate,
    terminalGraphic,
    tvThemeKey,
  ]);

  // -----------------
  // Cloud subscription
  // -----------------
  useEffect(() => {
    if (!cloudReady) return;
    if (syncMode !== "CLOUD") return;
    if (!roomCode) return;

    let unsubRoom = null;
    let unsubBets = null;

    (async () => {
      const roomRef = docFn(firestore, "rooms", roomCode);

      unsubRoom = onSnapshotFn(roomRef, (snap) => {
        const data = snap.data();
        if (!data) return;
        setParticipants(Array.isArray(data.participants) ? data.participants : []);
        setRaceLocked(!!data.raceLocked);
        setEnforceMaxBet(data.enforceMaxBet ?? true);
        setMaxBet(Number(data.maxBet ?? 10));
        setResults(data.results ?? { first: "", second: "", third: "", fourth: "" });
        setTerminalGraphic(data.terminalGraphic ?? null);
        setTvThemeKey(data.tvThemeKey ?? "DEFAULT");
      });

      const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");
      const q = queryFn(betsRef, orderByFn("createdAt", "asc"));
      unsubBets = onSnapshotFn(q, (qs) => {
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
            meta: v.meta || null,
          });
        });
        setBets(rows);
      });

      // Ensure doc exists
      await setDocFn(
        roomRef,
        {
          participants,
          raceLocked,
          enforceMaxBet,
          maxBet: Number(maxBet),
          results,
          terminalGraphic: terminalGraphic ?? null,
          tvThemeKey: tvThemeKey ?? "DEFAULT",
          updatedAt: serverTimestampFn(),
        },
        { merge: true }
      );
    })();

    return () => {
      if (unsubRoom) unsubRoom();
      if (unsubBets) unsubBets();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudReady, syncMode, roomCode]);

  const pushRoomUpdate = async (patch) => {
    if (!cloudReady || syncMode !== "CLOUD" || !roomCode) return;
    const roomRef = docFn(firestore, "rooms", roomCode);
    await setDocFn(roomRef, { ...patch, updatedAt: serverTimestampFn() }, { merge: true });
  };

  // -----------------
  // Derived helpers
  // -----------------
  const isExotic = betType === "EXACTA" || betType === "TRIFECTA" || betType === "SUPERFECTA";
  const isWPS = betType === "WPS";

  const picksNeeded = useMemo(() => {
    if (betType === "WIN" || betType === "PLACE" || betType === "SHOW" || betType === "WPS") return 1;
    if (betType === "EXACTA") return 2;
    if (betType === "TRIFECTA") return 3;
    if (betType === "SUPERFECTA") return 4;
    return 1;
  }, [betType]);

  const currentPicks = useMemo(
    () => [pick1, pick2, pick3, pick4].slice(0, picksNeeded),
    [pick1, pick2, pick3, pick4, picksNeeded]
  );

  const lockedPicks = useMemo(() => {
    const arr = [null, null, null, null];
    if (lock1) arr[0] = lockPick1 || null;
    if (lock2) arr[1] = lockPick2 || null;
    if (lock3) arr[2] = lockPick3 || null;
    if (lock4) arr[3] = lockPick4 || null;
    return arr.slice(0, picksNeeded);
  }, [lock1, lock2, lock3, lock4, lockPick1, lockPick2, lockPick3, lockPick4, picksNeeded]);

  const lockedSet = useMemo(() => new Set(lockedPicks.filter(Boolean)), [lockedPicks]);

  const ticketsFromLockedBox = useMemo(() => {
    if (!boxed || !isExotic) return [];
    const n = picksNeeded;

    // validate locks (no duplicates)
    const lockedOnly = lockedPicks.filter(Boolean);
    if (new Set(lockedOnly).size !== lockedOnly.length) return [];

    const openIdx = [];
    for (let i = 0; i < n; i++) if (!lockedPicks[i]) openIdx.push(i);

    // if everything is locked, single ticket
    if (openIdx.length === 0) return [lockedPicks.slice(0, n)];

    const available = boxHorses.filter((h) => h && !lockedSet.has(h));
    if (available.length < openIdx.length) return [];

    const perms = permutations(available, openIdx.length);
    const out = [];
    for (const p of perms) {
      const ticket = lockedPicks.slice(0, n).map((x) => x || null);
      for (let j = 0; j < openIdx.length; j++) ticket[openIdx[j]] = p[j];
      // no duplicates overall
      if (new Set(ticket).size !== ticket.length) continue;
      out.push(ticket);
    }
    return out;
  }, [boxed, isExotic, picksNeeded, lockedPicks, boxHorses, lockedSet]);

  const canAddBet = useMemo(() => {
    if (raceLocked) return false;
    if (!bettor) return false;
    if (!amount || amount <= 0) return false;
    if (enforceMaxBet && amount > maxBet) return false;

    if (isExotic && boxed) {
      if (ticketsFromLockedBox.length === 0) return false;
      if (ticketsFromLockedBox.length > 120) return false;
      return true;
    }

    // Non-boxed
    if (currentPicks.some((p) => !p)) return false;
    if (new Set(currentPicks).size !== currentPicks.length) return false;
    return true;
  }, [
    raceLocked,
    bettor,
    amount,
    enforceMaxBet,
    maxBet,
    isExotic,
    boxed,
    ticketsFromLockedBox.length,
    currentPicks,
  ]);

  const poolsTotals = useMemo(() => {
    const totals = {};
    for (const t of ["WIN", "PLACE", "SHOW", "EXACTA", "TRIFECTA", "SUPERFECTA"]) totals[t] = 0;

    for (const b of bets) {
      if (!b || !b.betType) continue;
      const t = b.betType;
      if (totals[t] !== undefined) totals[t] += Number(b.amount || 0);
    }
    return totals;
  }, [bets]);

  const totalAllBets = useMemo(() => bets.reduce((s, b) => s + Number(b.amount || 0), 0), [bets]);

  const myBets = useMemo(() => {
    if (!bettor) return [];
    return bets.filter((b) => b.bettor === bettor);
  }, [bets, bettor]);

  const totalMyBets = useMemo(() => myBets.reduce((s, b) => s + Number(b.amount || 0), 0), [myBets]);

  // amounts per outcome for odds boards
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

    return {
      WIN: build("WIN"),
      PLACE: build("PLACE"),
      SHOW: build("SHOW"),
    };
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

    return {
      EXACTA: build("EXACTA"),
      TRIFECTA: build("TRIFECTA"),
      SUPERFECTA: build("SUPERFECTA"),
    };
  }, [poolsTotals, amountsOn]);

  // -----------------
  // Actions
  // -----------------
  const saveParticipants = async (next) => {
    setParticipants(next);
    if (syncMode === "CLOUD") await pushRoomUpdate({ participants: next });
  };

  const addParticipant = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) return;

    const next = [...participants, trimmed];
    setNameInput("");

    // keep focus stable on iPad Safari
    setTimeout(() => {
      try {
        addNameRef.current?.focus();
      } catch {
        // ignore
      }
    }, 0);

    if (!bettor) setBettor(trimmed);
    await saveParticipants(next);
  };

  const deleteParticipant = async (name) => {
    const next = participants.filter((p) => p !== name);
    await saveParticipants(next);
    if (bettor === name) setBettor("");
    // Note: existing bets remain; they will still display under that bettor name if selected.
  };

  const addBetCloudOrLocal = async (ticket) => {
    // LOCAL
    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      const now = new Date().toISOString();
      setBets((prev) => [
        ...prev,
        {
          id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
          createdAt: now,
          ...ticket,
        },
      ]);
      return;
    }

    // CLOUD
    const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");
    await addDocFn(betsRef, {
      ...ticket,
      createdAt: serverTimestampFn(),
    });
  };

  const addBet = async () => {
    if (!canAddBet) return;

    // WPS expands into 3 bets
    if (isWPS) {
      const horse = currentPicks[0];
      if (!horse) return;

      const base = {
        bettor,
        amount: Number(amount),
        picks: [horse],
        meta: { parent: "WPS" },
      };

      await addBetCloudOrLocal({ ...base, betType: "WIN" });
      await addBetCloudOrLocal({ ...base, betType: "PLACE" });
      await addBetCloudOrLocal({ ...base, betType: "SHOW" });
      return;
    }

    // Exotics boxed with locks
    if (isExotic && boxed) {
      if (ticketsFromLockedBox.length === 0) return;
      if (ticketsFromLockedBox.length > 120) return;

      for (const picks of ticketsFromLockedBox) {
        await addBetCloudOrLocal({
          bettor,
          amount: Number(amount),
          betType,
          picks,
          meta: {
            boxed: true,
            locks: lockedPicks,
          },
        });
      }
      return;
    }

    // Standard single ticket
    await addBetCloudOrLocal({
      bettor,
      amount: Number(amount),
      betType,
      picks: currentPicks,
      meta: null,
    });
  };

  const cancelBet = async (betId) => {
    if (!betId) return;

    // LOCAL
    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      setBets((prev) => prev.filter((b) => b.id !== betId));
      return;
    }

    // CLOUD
    const betRef = docFn(firestore, "rooms", roomCode, "bets", betId);
    await deleteDocFn(betRef);
  };

  const cancelAllBets = async () => {
    // LOCAL
    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      setBets([]);
      return;
    }
    // CLOUD: delete visible bet docs
    for (const b of bets) {
      if (!b?.id) continue;
      const betRef = docFn(firestore, "rooms", roomCode, "bets", b.id);
      // eslint-disable-next-line no-await-in-loop
      await deleteDocFn(betRef);
    }
  };

  const nextRace = async () => {
    // Clear bets and results, keep participants
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);

    await cancelAllBets();

    if (syncMode === "CLOUD") {
      await pushRoomUpdate({
        raceLocked: false,
        results: { first: "", second: "", third: "", fourth: "" },
      });
    }
  };

  const newRace = async () => {
    // Delete all participants, clear bets and results
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);
    setBettor("");
    setNameInput("");
    setBetType("WIN");
    setDenom(0.1);
    setPick1("");
    setPick2("");
    setPick3("");
    setPick4("");
    setBoxed(false);
    setBoxHorses([]);
    setLock1(false);
    setLock2(false);
    setLock3(false);
    setLock4(false);
    setLockPick1("");
    setLockPick2("");
    setLockPick3("");
    setLockPick4("");

    await cancelAllBets();
    await saveParticipants([]);

    if (syncMode === "CLOUD") {
      await pushRoomUpdate({
        participants: [],
        raceLocked: false,
        results: { first: "", second: "", third: "", fourth: "" },
      });
    }
  };

  const lockRace = async (locked) => {
    setRaceLocked(locked);
    if (syncMode === "CLOUD") await pushRoomUpdate({ raceLocked: locked });
  };

  const updateResults = async (patch) => {
    const next = { ...results, ...patch };
    setResults(next);
    if (syncMode === "CLOUD") await pushRoomUpdate({ results: next });
  };

  const updateMaxBet = async (patch) => {
    const nextEnforce = patch.enforceMaxBet !== undefined ? patch.enforceMaxBet : enforceMaxBet;
    const nextMax = patch.maxBet !== undefined ? patch.maxBet : maxBet;

    setEnforceMaxBet(nextEnforce);
    setMaxBet(nextMax);

    if (syncMode === "CLOUD") await pushRoomUpdate({ enforceMaxBet: nextEnforce, maxBet: nextMax });
  };

  const setTvTheme = async (key) => {
    setTvThemeKey(key);
    if (syncMode === "CLOUD") await pushRoomUpdate({ tvThemeKey: key });
  };

  const exportCsv = () => {
    const lines = [];
    lines.push(["Room", roomCode || "(local)"].map(csvEscape).join(","));
    lines.push(["All Bets Total", totalAllBets.toFixed(2)].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Bets", ""].join(","));
    lines.push(["Time", "Bettor", "Type", "Picks", "Amount"].map(csvEscape).join(","));
    for (const b of bets) {
      lines.push([
        b.createdAt,
        b.bettor,
        b.betType,
        (b.picks || []).join(" > "),
        Number(b.amount).toFixed(2),
      ].map(csvEscape).join(","));
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

  // TV auto rotate boards every 5 seconds (as requested)
  useEffect(() => {
    if (mode !== "TV") return;
    if (!autoRotate) return;
    const keys = PUBLIC_BOARDS.map((b) => b.key);
    const i = keys.indexOf(boardKey);
    const next = keys[(i + 1 + keys.length) % keys.length];
    const handle = setTimeout(() => setBoardKey(next), 5000);
    return () => clearTimeout(handle);
  }, [mode, autoRotate, boardKey]);

  // -----------------
  // UI helpers
  // -----------------
  const smallSelect = "border rounded-2xl p-3 text-base w-full";
  const smallInput = "border rounded-2xl p-3 text-base w-full";
  const buttonPrimary =
    "rounded-2xl px-4 py-3 text-base font-semibold bg-black text-white disabled:opacity-40 disabled:cursor-not-allowed";
  const buttonSecondary =
    "rounded-2xl px-4 py-3 text-base font-semibold border disabled:opacity-40 disabled:cursor-not-allowed";
  const chip =
    "inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm";

  const formatOdds = (odds) => {
    if (!odds || odds <= 0) return "-";
    return `${odds.toFixed(2)}-1`;
  };

  const formatPayoutPerTenCents = (payoutPerDollar) => {
    if (!payoutPerDollar || payoutPerDollar <= 0) return "-";
    return `$${(payoutPerDollar * 0.1).toFixed(2)} per $0.10`;
  };

  const PickSelect = ({ label, value, onChange, disabled }) => (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <select className={smallSelect} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Select</option>
        {participants.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
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
              className={
                "flex items-center gap-2 border rounded-2xl px-3 py-2 text-sm select-none " +
                (active ? "bg-black text-white" : "")
              }
            >
              <input type="checkbox" checked={active} onChange={() => setDenom(d)} disabled={raceLocked} />
              {label}
            </label>
          );
        })}
      </div>
      <div className="text-xs text-gray-600">
        Amount per ticket. WPS places 3 tickets. Boxed exotics can place many tickets.
      </div>
    </div>
  );

  const BettorSummary = () => (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Your bets</div>
        <div className="text-sm text-gray-600">Your total: ${totalMyBets.toFixed(2)}</div>
      </div>

      {myBets.length === 0 ? (
        <div className="text-sm text-gray-600">No bets yet.</div>
      ) : (
        <div className="space-y-2">
          {myBets
            .slice()
            .reverse()
            .map((b) => (
              <div key={b.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">
                    {b.betType}
                    {b.meta?.parent === "WPS" ? " (WPS)" : ""} - {(b.picks || []).join(" > ")}
                  </div>
                  <div className="text-sm text-gray-600">${Number(b.amount).toFixed(2)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <div className="text-xs text-gray-500">
                    {b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}
                  </div>
                  <button className={buttonSecondary} onClick={() => cancelBet(b.id)} disabled={raceLocked}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );

  const TerminalBetList = () => (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">All bets</div>
        <div className="text-sm text-gray-600">Total: ${totalAllBets.toFixed(2)}</div>
      </div>

      {bets.length === 0 ? (
        <div className="text-sm text-gray-600">No bets yet.</div>
      ) : (
        <div className="space-y-2">
          {bets
            .slice()
            .reverse()
            .map((b) => (
              <div key={b.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">
                    {b.bettor} - {b.betType}
                    {b.meta?.parent === "WPS" ? " (WPS)" : ""} - {(b.picks || []).join(" > ")}
                  </div>
                  <div className="text-sm text-gray-600">${Number(b.amount).toFixed(2)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <div className="text-xs text-gray-500">
                    {b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}
                  </div>
                  <button className={buttonSecondary} onClick={() => cancelBet(b.id)}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );

  const Header = () => (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-2xl font-black">Betting Terminal</div>
        <div className="text-sm text-gray-600">
          Win/Place/Show + WPS + Exacta/Trifecta/Superfecta (boxed with optional locks)
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Mode: <span className="font-semibold">{mode}</span> | Sync:{" "}
          <span className="font-semibold">{syncMode}</span>
          {roomCode ? (
            <>
              {" "} | Room: <span className="font-semibold">{roomCode}</span>
            </>
          ) : null}
        </div>
      </div>

      {mode === "TERMINAL" ? (
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          <button onClick={newRace} className={buttonSecondary}>
            New Race (clear participants)
          </button>
          <button onClick={nextRace} className={buttonSecondary} disabled={bets.length === 0 && results.first === "" && results.second === "" && results.third === "" && results.fourth === ""}>
            Next Race (keep participants)
          </button>
          <button onClick={exportCsv} className={buttonSecondary} disabled={bets.length === 0}>
            Export CSV
          </button>
        </div>
      ) : null}
    </div>
  );

  const ModeSwitcher = () => {
    const btn = (m) => (
      <button
        className={"rounded-2xl px-4 py-2 text-sm font-semibold border " + (mode === m ? "bg-black text-white" : "")}
        onClick={() => setMode(m)}
      >
        {m}
      </button>
    );

    return (
      <div className="flex flex-wrap gap-2 items-center">
        {btn("TERMINAL")}
        {btn("BETTOR")}
        {btn("TV")}
      </div>
    );
  };

  const RoomPanel = () => {
    if (mode !== "TERMINAL") return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="font-semibold">Multi-phone setup</div>

        {!cloudReady ? (
          <div className="text-sm text-gray-700">
            Cloud not ready - confirm package.json includes firebase and redeploy.
          </div>
        ) : null}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            className={buttonSecondary}
            onClick={() => {
              const rc = randomRoomCode();
              setRoomCode(rc);
              setRoomInput(rc);
              if (cloudReady) setSyncMode("CLOUD");
            }}
          >
            Generate room
          </button>

          <input
            className={smallInput}
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            placeholder="Enter room code"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
          />

          <button
            className={buttonPrimary}
            onClick={() => {
              const rc = (roomInput || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
              setRoomCode(rc);
              if (cloudReady) setSyncMode("CLOUD");
            }}
            disabled={!roomInput || !cloudReady}
          >
            Use room
          </button>

          <button
            className={buttonSecondary}
            onClick={() => {
              setSyncMode("LOCAL");
              setRoomCode("");
              setRoomInput("");
            }}
          >
            Local only
          </button>
        </div>

        <div className="rounded-2xl border p-3 space-y-2">
          <div className="text-sm font-semibold">TV theme</div>
          <select className={smallSelect} value={tvThemeKey} onChange={(e) => setTvTheme(e.target.value)}>
            {TV_THEMES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl border p-3 space-y-2">
          <div className="font-semibold text-sm">Terminal / TV graphic</div>
          <input type="file" accept="image/*" onChange={(e) => onUploadGraphic(e.target.files?.[0])} className="text-sm" />
          {terminalGraphic ? (
            <div className="space-y-2">
              <img src={terminalGraphic} alt="Terminal graphic" className="max-h-40 rounded-2xl border object-contain w-full" />
              <button onClick={clearGraphic} className={buttonSecondary}>Remove graphic</button>
            </div>
          ) : (
            <div className="text-xs text-gray-600">No graphic uploaded yet.</div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <div className="space-y-2">
            <div className="text-sm font-semibold">Bettor QR</div>
            <div className="text-xs text-gray-600 break-all">{bettorUrl || "(loading...)"}</div>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Bettor QR" className="border rounded-2xl w-[240px] h-[240px]" />
            ) : (
              <div className="text-xs text-red-600">QR not ready - confirm qrcode dependency is installed.</div>
            )}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">TV link</div>
            <div className="text-xs text-gray-600 break-all">{tvUrl || "(loading...)"}</div>
          </div>
        </div>
      </div>
    );
  };

  const ParticipantsPanel = () => {
    if (mode !== "TERMINAL") return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Participants</h2>
          <div className="text-xs text-gray-600">Tap X to remove</div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={addNameRef}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Add name"
            className={smallInput}
            autoCorrect="off"
            autoCapitalize="words"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") addParticipant();
            }}
          />
          <button onClick={addParticipant} className={buttonPrimary}>Add</button>
        </div>

        <div className="flex flex-wrap gap-2">
          {participants.length === 0 ? (
            <div className="text-sm text-gray-600">Add at least 2 participants.</div>
          ) : (
            participants.map((p) => (
              <span key={p} className={chip}>
                {p}
                <button
                  className="border rounded-full w-6 h-6 leading-[1] flex items-center justify-center"
                  onClick={() => deleteParticipant(p)}
                  title="Remove participant"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </div>
    );
  };

  const LockRow = ({ label, enabled, setEnabled, pick, setPick, disabled }) => (
    <div className="rounded-2xl border p-3 space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={disabled} />
        Lock {label}
      </label>
      <select className={smallSelect} value={pick} onChange={(e) => setPick(e.target.value)} disabled={disabled || !enabled}>
        <option value="">Select</option>
        {participants.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </div>
  );

  const BettingPanel = () => {
    if (mode !== "TERMINAL" && mode !== "BETTOR") return null;

    return (
      <div className="rounded-2xl border p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Place a bet</h2>
          <div className="text-xs text-gray-600">{raceLocked ? "Locked" : "Open"}</div>
        </div>

        <div className="rounded-2xl border p-3 text-sm text-gray-700">
          <div className="font-semibold">Totals</div>
          <div className="mt-1">All bets total: ${totalAllBets.toFixed(2)}</div>
          <div className="mt-1">Room: {roomCode || "(local)"} | Sync: {syncMode}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Your name</div>
            <select className={smallSelect} value={bettor} onChange={(e) => setBettor(e.target.value)} disabled={raceLocked}>
              <option value="">Select</option>
              {participants.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
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
                setPick1("");
                setPick2("");
                setPick3("");
                setPick4("");
                setBoxed(false);
                setBoxHorses([]);
                setLock1(false);
                setLock2(false);
                setLock3(false);
                setLock4(false);
                setLockPick1("");
                setLockPick2("");
                setLockPick3("");
                setLockPick4("");
              }}
              disabled={raceLocked}
            >
              {BET_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <DenomPicker />

        {mode === "TERMINAL" ? (
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="font-semibold">Limits</div>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enforceMaxBet} onChange={(e) => updateMaxBet({ enforceMaxBet: e.target.checked })} />
                Enforce max bet
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Max</span>
                <input type="number" className="border rounded-2xl p-2 w-28" value={maxBet} onChange={(e) => updateMaxBet({ maxBet: Number(e.target.value) })} min={0.1} step={0.1} />
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-medium">Pick(s)</div>

          {isExotic ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={boxed}
                onChange={(e) => {
                  setBoxed(e.target.checked);
                  setBoxHorses([]);
                  setLock1(false); setLock2(false); setLock3(false); setLock4(false);
                  setLockPick1(""); setLockPick2(""); setLockPick3(""); setLockPick4("");
                }}
                disabled={raceLocked}
              />
              Box (with optional locked positions)
            </label>
          ) : null}

          {boxed && isExotic ? (
            <div className="space-y-3">
              <div className="text-xs text-gray-600">
                Tickets: {ticketsFromLockedBox.length}. Max 120. Locked horses are removed from the box list automatically.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <LockRow label="1st" enabled={lock1} setEnabled={setLock1} pick={lockPick1} setPick={setLockPick1} disabled={raceLocked} />
                {picksNeeded >= 2 ? <LockRow label="2nd" enabled={lock2} setEnabled={setLock2} pick={lockPick2} setPick={setLockPick2} disabled={raceLocked} /> : null}
                {picksNeeded >= 3 ? <LockRow label="3rd" enabled={lock3} setEnabled={setLock3} pick={lockPick3} setPick={setLockPick3} disabled={raceLocked} /> : null}
                {picksNeeded >= 4 ? <LockRow label="4th" enabled={lock4} setEnabled={setLock4} pick={lockPick4} setPick={setLockPick4} disabled={raceLocked} /> : null}
              </div>

              <div className="rounded-2xl border p-3 space-y-2">
                <div className="text-sm font-medium">Box the remaining positions</div>
                <div className="text-xs text-gray-600">Select horses to permute into any unlocked positions.</div>
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

              {ticketsFromLockedBox.length > 120 ? (
                <div className="text-xs text-red-600">Too many tickets - select fewer horses or lock more positions.</div>
              ) : null}
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

        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={addBet} className={buttonPrimary} disabled={!canAddBet}>Submit bet</button>
          {isWPS ? (
            <div className="text-xs text-gray-600 self-center">
              WPS will place 3 tickets (WIN+PLACE+SHOW) - total ${Number(amount * 3).toFixed(2)}
            </div>
          ) : null}
        </div>

        {mode === "BETTOR" ? <BettorSummary /> : null}
      </div>
    );
  };

  const TerminalControls = () => {
    if (mode !== "TERMINAL") return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Race control</h2>
          <div className="text-xs text-gray-600">Lock betting once the squeeze starts</div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => lockRace(true)} className={buttonSecondary} disabled={raceLocked || bets.length === 0}>Lock Betting</button>
          <button onClick={() => lockRace(false)} className={buttonSecondary} disabled={!raceLocked}>Unlock Betting</button>
        </div>
      </div>
    );
  };

  const ResultsPanel = () => {
    if (mode !== "TERMINAL") return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Official results</h2>
          <div className="text-xs text-gray-600">Used for payouts and odds boards</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PickSelect label="1st" value={results.first} onChange={(v) => updateResults({ first: v })} disabled={false} />
          <PickSelect label="2nd" value={results.second} onChange={(v) => updateResults({ second: v })} disabled={false} />
          <PickSelect label="3rd" value={results.third} onChange={(v) => updateResults({ third: v })} disabled={false} />
          <PickSelect label="4th (Superfecta)" value={results.fourth} onChange={(v) => updateResults({ fourth: v })} disabled={false} />
        </div>
      </div>
    );
  };

  const TvBoard = () => {
    const header = PUBLIC_BOARDS.find((b) => b.key === boardKey)?.label ?? "Board";
    const t = themeByKey(tvThemeKey);

    const rows =
      boardKey === "WIN" || boardKey === "PLACE" || boardKey === "SHOW"
        ? horseBoard[boardKey]
            .slice()
            .sort((a, b) => b.on - a.on)
            .map((r) => ({
              left: r.horse,
              on: `$${r.on.toFixed(2)}`,
              odds: formatOdds(r.odds),
              payout: formatPayoutPerTenCents(r.payoutPerDollar),
            }))
        : (boardKey === "EXACTA" ? exoticLeaders.EXACTA : boardKey === "TRIFECTA" ? exoticLeaders.TRIFECTA : exoticLeaders.SUPERFECTA).map((r) => ({
            left: r.combo,
            on: `$${r.on.toFixed(2)}`,
            odds: formatOdds(r.odds),
            payout: formatPayoutPerTenCents(r.payoutPerDollar),
          }));

    return (
      <div className="min-h-screen" style={{ background: t.bg, color: t.text }}>
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 space-y-2">
              <div className="text-3xl font-black">Betting Terminal</div>
              <div className="text-lg" style={{ color: t.muted }}>{header} - live pools, odds, payouts</div>
              {roomCode ? <div className="text-sm" style={{ color: t.muted }}>Room {roomCode}</div> : null}
              {terminalGraphic ? (
                <img src={terminalGraphic} alt="TV graphic" className="max-h-40 rounded-2xl border object-contain w-full" style={{ borderColor: t.border }} />
              ) : null}
            </div>

            <div className="rounded-2xl p-4" style={{ border: `1px solid ${t.border}` }}>
              <div className="font-semibold text-lg">Bettor QR</div>
              <div className="text-xs" style={{ color: t.muted }}>Scan to bet from your phone</div>
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Bettor QR" className="mt-2 rounded-2xl border w-[240px] h-[240px]" style={{ borderColor: t.border }} />
              ) : (
                <div className="mt-2 text-sm" style={{ color: t.muted }}>QR not ready</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <label className="flex items-center gap-2 text-sm" style={{ color: t.muted }}>
              <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
              Auto-rotate boards (5s)
            </label>
            <div className="flex flex-wrap gap-2">
              {PUBLIC_BOARDS.map((b) => (
                <button
                  key={b.key}
                  className="rounded-2xl px-4 py-2 text-sm font-semibold"
                  onClick={() => setBoardKey(b.key)}
                  style={{
                    border: `1px solid ${t.border}`,
                    background: boardKey === b.key ? t.accent : "transparent",
                    color: boardKey === b.key ? t.bg : t.text,
                  }}
                >
                  {b.label}
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
                    <div className="font-semibold">${(poolsTotals[k] ?? 0).toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-sm" style={{ color: t.muted }}>Total all bets: ${totalAllBets.toFixed(2)}</div>
            </div>

            <div className="rounded-2xl p-4 lg:col-span-2" style={{ border: `1px solid ${t.border}` }}>
              <div className="font-semibold text-lg">{header}</div>
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
  };

  // -----------------
  // Render
  // -----------------
  if (mode === "TV") {
    return <TvBoard />;
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        {terminalGraphic ? (
          <img src={terminalGraphic} alt="Terminal graphic" className="max-h-40 rounded-2xl border object-contain w-full" />
        ) : null}

        <Header />
        <ModeSwitcher />
        <RoomPanel />

        <div className="grid gap-6">
          <ParticipantsPanel />
          <BettingPanel />
          {mode === "TERMINAL" ? <TerminalBetList /> : null}
          <TerminalControls />
          {mode === "TERMINAL" ? <ResultsPanel /> : null}

          <div className="text-xs text-gray-500 pb-10">
            If a phone cannot select participants: make sure you are in a room (CLOUD mode) and you added participants on Terminal.
          </div>
        </div>
      </div>
    </div>
  );
}
