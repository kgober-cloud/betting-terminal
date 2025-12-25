import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

// =====================
// Firebase (cloud sync)
// =====================
// Your Firebase web config. Cloud sync works when you use a room code.
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

// FIX: No regex at all, so Vercel can never complain about “unterminated regular expression”.
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

  // Kiosk mode hides mode switching on-screen
  const [kioskMode, setKioskMode] = useState(false);

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
  const STORAGE_KEY = "betting-terminal-state-v10";
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

  // amount is always denom
  const amount = denom;

  // ordered picks (non-boxed)
  const [pick1, setPick1] = useState("");
  const [pick2, setPick2] = useState("");
  const [pick3, setPick3] = useState("");
  const [pick4, setPick4] = useState("");

  // boxing
  const [boxed, setBoxed] = useState(false);
  const [boxHorses, setBoxHorses] = useState([]);

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
        const dataUrl = await QRCode.toDataURL(bettorUrl, { width: 220, margin: 1 });
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
        kioskMode,
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
    kioskMode,
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

  const picksNeeded = useMemo(() => {
    if (betType === "WIN" || betType === "PLACE" || betType === "SHOW") return 1;
    if (betType === "EXACTA") return 2;
    if (betType === "TRIFECTA") return 3;
    if (betType === "SUPERFECTA") return 4;
    return 1;
  }, [betType]);

  const currentPicks = useMemo(() => [pick1, pick2, pick3, pick4].slice(0, picksNeeded), [pick1, pick2, pick3, pick4, picksNeeded]);

  const boxCombos = useMemo(() => {
    if (!boxed || !isExotic) return [];
    const horses = boxHorses.filter(Boolean);
    if (horses.length < picksNeeded) return [];
    return permutations(horses, picksNeeded);
  }, [boxed, isExotic, boxHorses, picksNeeded]);

  const canAddBet = useMemo(() => {
    if (raceLocked) return false;
    if (!bettor) return false;
    if (!amount || amount <= 0) return false;
    if (enforceMaxBet && amount > maxBet) return false;

    if (boxed && isExotic) {
      if (boxCombos.length === 0) return false;
      if (boxCombos.length > 120) return false;
      return true;
    }

    if (currentPicks.some((p) => !p)) return false;
    if (new Set(currentPicks).size !== currentPicks.length) return false;
    return true;
  }, [raceLocked, bettor, amount, enforceMaxBet, maxBet, boxed, isExotic, boxCombos.length, currentPicks]);

  const poolFor = (type) => bets.filter((b) => b.betType === type);

  const poolsTotals = useMemo(() => {
    const totals = {};
    for (const t of BET_TYPES.map((x) => x.key)) {
      totals[t] = poolFor(t).reduce((s, b) => s + b.amount, 0);
    }
    return totals;
  }, [bets]);

  const totalAllBets = useMemo(() => bets.reduce((s, b) => s + Number(b.amount || 0), 0), [bets]);

  const myBets = useMemo(() => {
    if (!bettor) return [];
    return bets.filter((b) => b.bettor === bettor);
  }, [bets, bettor]);

  const totalMyBets = useMemo(() => myBets.reduce((s, b) => s + Number(b.amount || 0), 0), [myBets]);

  // -----------------
  // Actions
  // -----------------
  const addParticipant = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) return;

    const next = [...participants, trimmed];
    setParticipants(next);
    setNameInput("");

    setTimeout(() => {
      try {
        addNameRef.current?.focus();
      } catch {
        // ignore
      }
    }, 0);

    if (!bettor) setBettor(trimmed);

    if (syncMode === "CLOUD") await pushRoomUpdate({ participants: next });
  };

  const addBet = async () => {
    if (!canAddBet) return;

    const perTicket = Number(amount);
    const tickets = boxed && isExotic ? boxCombos : [currentPicks];

    // LOCAL
    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      const now = new Date().toISOString();
      const rows = tickets.map((picks) => ({
        id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        createdAt: now,
        bettor,
        amount: perTicket,
        betType,
        picks,
      }));
      setBets((prev) => [...prev, ...rows]);
      return;
    }

    // CLOUD
    const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");
    await Promise.all(
      tickets.map((picks) =>
        addDocFn(betsRef, {
          bettor,
          amount: perTicket,
          betType,
          picks,
          createdAt: serverTimestampFn(),
        })
      )
    );
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

  const lockRace = async (locked) => {
    setRaceLocked(locked);
    if (syncMode === "CLOUD") await pushRoomUpdate({ raceLocked: locked });
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

  const newRace = async () => {
    // LOCAL
    if (syncMode !== "CLOUD") {
      setBets([]);
      setRaceLocked(false);
      setBetType("WIN");
      setBettor("");
      setDenom(0.1);
      setPick1("");
      setPick2("");
      setPick3("");
      setPick4("");
      setBoxed(false);
      setBoxHorses([]);
      return;
    }

    // CLOUD: easiest is new room
    const rc = randomRoomCode();
    setRoomCode(rc);
    setRoomInput(rc);
    setBets([]);
    setRaceLocked(false);
    await pushRoomUpdate({
      participants,
      raceLocked: false,
      terminalGraphic: terminalGraphic ?? null,
      tvThemeKey: tvThemeKey ?? "DEFAULT",
    });
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

  // -----------------
  // UI helpers
  // -----------------
  const smallSelect = "border rounded-2xl p-3 text-base w-full";
  const smallInput = "border rounded-2xl p-3 text-base w-full";
  const buttonPrimary = "rounded-2xl px-4 py-3 text-base font-semibold bg-black text-white disabled:opacity-40 disabled:cursor-not-allowed";
  const buttonSecondary = "rounded-2xl px-4 py-3 text-base font-semibold border disabled:opacity-40 disabled:cursor-not-allowed";

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

  const ModeSwitcher = () => {
    if (kioskMode) return null;
    const btn = (m) => (
      <button className={"rounded-2xl px-4 py-2 text-sm font-semibold border " + (mode === m ? "bg-black text-white" : "")} onClick={() => setMode(m)}>
        {m}
      </button>
    );
    return (
      <div className="flex flex-wrap gap-2 items-center">
        {btn("TERMINAL")}
        {btn("BETTOR")}
        {btn("TV")}
        <label className="flex items-center gap-2 text-sm ml-2">
          <input type="checkbox" checked={kioskMode} onChange={(e) => setKioskMode(e.target.checked)} />
          Kiosk mode
        </label>
      </div>
    );
  };

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
      <div className="text-xs text-gray-600">Amount per ticket. Boxed bets create multiple tickets.</div>
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
                    {b.betType} - {(b.picks || []).join(" > ")}
                  </div>
                  <div className="text-sm text-gray-600">${Number(b.amount).toFixed(2)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <div className="text-xs text-gray-500">{b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}</div>
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
                    {b.bettor} - {b.betType} - {(b.picks || []).join(" > ")}
                  </div>
                  <div className="text-sm text-gray-600">${Number(b.amount).toFixed(2)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <div className="text-xs text-gray-500">{b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}</div>
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

  const BettingPanel = () => {
    const isExoticLocal = betType === "EXACTA" || betType === "TRIFECTA" || betType === "SUPERFECTA";

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
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
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
              }}
              disabled={raceLocked}
            >
              {BET_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DenomPicker />

        {mode === "TERMINAL" && !kioskMode ? (
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

          {isExoticLocal ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={boxed}
                onChange={(e) => {
                  setBoxed(e.target.checked);
                  setBoxHorses([]);
                }}
                disabled={raceLocked}
              />
              Box (any order)
            </label>
          ) : null}

          {boxed && isExoticLocal ? (
            <div className="space-y-2">
              <div className="text-xs text-gray-600">Select {picksNeeded} or more horses. Tickets: {boxCombos.length}. Max 120.</div>
              <div className="grid grid-cols-2 gap-2">
                {participants.map((p) => {
                  const checked = boxHorses.includes(p);
                  return (
                    <label key={p} className="flex items-center gap-2 text-sm border rounded-2xl p-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setBoxHorses((h) => [...h, p]);
                          else setBoxHorses((h) => h.filter((x) => x !== p));
                        }}
                        disabled={raceLocked}
                      />
                      {p}
                    </label>
                  );
                })}
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

        <button onClick={addBet} className={buttonPrimary} disabled={!canAddBet}>
          Submit bet
        </button>

        {mode === "BETTOR" ? <BettorSummary /> : null}
      </div>
    );
  };

  // -----------------
  // Render
  // -----------------
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="text-2xl font-black">Betting Terminal</div>

        <div className="flex flex-wrap gap-2 items-center">
          <button className={"rounded-2xl px-4 py-2 text-sm font-semibold border " + (mode === "TERMINAL" ? "bg-black text-white" : "")} onClick={() => setMode("TERMINAL")}>
            TERMINAL
          </button>
          <button className={"rounded-2xl px-4 py-2 text-sm font-semibold border " + (mode === "BETTOR" ? "bg-black text-white" : "")} onClick={() => setMode("BETTOR")}>
            BETTOR
          </button>
          <button className={"rounded-2xl px-4 py-2 text-sm font-semibold border " + (mode === "TV" ? "bg-black text-white" : "")} onClick={() => setMode("TV")}>
            TV
          </button>
        </div>

        <div className="rounded-2xl border p-4 space-y-2">
          <div className="font-semibold">Room</div>
          <div className="text-sm text-gray-700">Room code: {roomCode || "(none)"}</div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              className="rounded-2xl px-4 py-2 text-sm font-semibold border"
              onClick={() => {
                const rc = randomRoomCode();
                setRoomCode(rc);
                setRoomInput(rc);
                if (cloudReady) setSyncMode("CLOUD");
              }}
            >
              Generate room
            </button>
            <input className="border rounded-2xl p-3 text-base w-full" value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} placeholder="Enter room code" />
            <button
              className="rounded-2xl px-4 py-2 text-sm font-semibold border"
              onClick={() => {
                const rc = (roomInput || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
                setRoomCode(rc);
                if (cloudReady) setSyncMode("CLOUD");
              }}
            >
              Use room
            </button>
          </div>

          <div className="text-xs text-gray-600">Bettor URL: {bettorUrl}</div>
          <div className="text-xs text-gray-600">TV URL: {tvUrl}</div>
          {qrDataUrl ? <img src={qrDataUrl} alt="QR" className="border rounded-2xl w-[220px] h-[220px]" /> : null}
        </div>

        {mode === "TERMINAL" ? (
          <div className="rounded-2xl border p-4 space-y-2">
            <div className="font-semibold">Add participants</div>
            <div className="flex gap-2">
              <input ref={addNameRef} className="border rounded-2xl p-3 text-base w-full" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Add name" />
              <button className="rounded-2xl px-4 py-3 text-base font-semibold bg-black text-white" onClick={addParticipant}>
                Add
              </button>
            </div>
            <div className="text-sm text-gray-700">Participants: {participants.join(", ") || "(none)"}</div>
          </div>
        ) : null}

        {mode !== "TV" ? <BettingPanel /> : null}

        {mode === "BETTOR" ? (
          <div className="rounded-2xl border p-4 space-y-1">
            <div className="font-semibold">All bets total</div>
            <div>${totalAllBets.toFixed(2)}</div>
          </div>
        ) : null}

        {mode === "TERMINAL" ? <TerminalBetList /> : null}
      </div>
    </div>
  );
}