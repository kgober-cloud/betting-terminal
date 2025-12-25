import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

// Cloud sync (for multi-phone live betting) via Firebase Firestore.
// If FIREBASE_CONFIG stays null, the app runs LOCAL ONLY (iPad-only).
const firebaseConfig = {
  apiKey: "AIzaSyBcWTH6h_xDqfxAUYPHm8mXNNb-vMAWgNM",
  authDomain: "betting-terminal.firebaseapp.com",
  projectId: "betting-terminal",
  storageBucket: "betting-terminal.firebasestorage.app",
  messagingSenderId: "132647014088",
  appId: "1:132647014088:web:f3b6f23cce3cc3849d9ffd"
};
let firestore = null;
let onSnapshotFn = null;
let docFn = null;
let setDocFn = null;
let addDocFn = null;
let collectionFn = null;
let queryFn = null;
let orderByFn = null;
let serverTimestampFn = null;

const FIREBASE_CONFIG = null;
// Paste your Firebase web config here to enable multi-phone sync.
// Example:
// const FIREBASE_CONFIG = {
//   apiKey: "...",
//   authDomain: "...",
//   projectId: "...",
//   storageBucket: "...",
//   messagingSenderId: "...",
//   appId: "...",
// };

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
  collectionFn = fbFs.collection;
  queryFn = fbFs.query;
  orderByFn = fbFs.orderBy;
  serverTimestampFn = fbFs.serverTimestamp;

  return true;
}

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

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[\n\r,"]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// permutations of length k (ordered) from a list of unique items
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
  // Modes:
  // TERMINAL = admin iPad
  // BETTOR = guests on phones
  // TV = screen share board
  const [mode, setMode] = useState("TERMINAL");

  const [baseUrl, setBaseUrl] = useState("");
  const qrCanvasRef = useRef(null);

  const [kioskMode, setKioskMode] = useState(false);

  // Room and sync
  const [roomCode, setRoomCode] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [cloudReady, setCloudReady] = useState(false);
  const [syncMode, setSyncMode] = useState("LOCAL"); // LOCAL | CLOUD

  // Local persistence
  const STORAGE_KEY = "betting-terminal-state-v3";
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
  const [amount, setAmount] = useState(persisted?.amount ?? 0.1); // $0.10 default

  // ordered picks (non-boxed)
  const [pick1, setPick1] = useState(persisted?.pick1 ?? "");
  const [pick2, setPick2] = useState(persisted?.pick2 ?? "");
  const [pick3, setPick3] = useState(persisted?.pick3 ?? "");
  const [pick4, setPick4] = useState(persisted?.pick4 ?? "");

  // Boxing for exotics
  const [boxed, setBoxed] = useState(persisted?.boxed ?? false);
  const [boxHorses, setBoxHorses] = useState(persisted?.boxHorses ?? []);

  const [raceLocked, setRaceLocked] = useState(persisted?.raceLocked ?? false);

  // No minimum bet, only a max bet
  const [enforceMaxBet, setEnforceMaxBet] = useState(persisted?.enforceMaxBet ?? true);
  const [maxBet, setMaxBet] = useState(persisted?.maxBet ?? 10);

  // Official results
  const [results, setResults] = useState(persisted?.results ?? { first: "", second: "", third: "", fourth: "" });

  // TV board controls
  const [boardKey, setBoardKey] = useState(persisted?.boardKey ?? "WIN");
  const [autoRotate, setAutoRotate] = useState(persisted?.autoRotate ?? true);

  // Read mode + room from URL
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

  const bettorUrl = useMemo(() => {
    if (!baseUrl) return "";
    const roomPart = roomCode ? `&room=${encodeURIComponent(roomCode)}` : "";
    return `${baseUrl}?mode=BETTOR${roomPart}`;
  }, [baseUrl, roomCode]);

  const tvUrl = useMemo(() => {
    if (!baseUrl) return "";
    const roomPart = roomCode ? `&room=${encodeURIComponent(roomCode)}` : "";
    return `${baseUrl}?mode=TV${roomPart}`;
  }, [baseUrl, roomCode]);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !bettorUrl) return;
    QRCode.toCanvas(canvas, bettorUrl, { width: 220, margin: 1 }).catch(() => {});
  }, [bettorUrl]);

  // LOCAL persistence only
  useEffect(() => {
    if (syncMode !== "LOCAL") return;
    try {
      const snapshot = {
        participants,
        bets,
        betType,
        bettor,
        amount,
        pick1,
        pick2,
        pick3,
        pick4,
        boxed,
        boxHorses,
        raceLocked,
        enforceMaxBet,
        maxBet,
        results,
        boardKey,
        autoRotate,
        kioskMode,
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
    amount,
    pick1,
    pick2,
    pick3,
    pick4,
    boxed,
    boxHorses,
    raceLocked,
    enforceMaxBet,
    maxBet,
    results,
    boardKey,
    autoRotate,
    kioskMode,
  ]);

  // Firebase readiness
  useEffect(() => {
    (async () => {
      const ok = await ensureFirebase();
      setCloudReady(ok);
      if (!ok) setSyncMode("LOCAL");
    })();
  }, []);

  // Subscribe to room + bets in CLOUD mode
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
      });

      const betsRef = collectionFn(firestore, "rooms", roomCode, "bets");
      const q = queryFn(betsRef, orderByFn("createdAt", "asc"));
      unsubBets = onSnapshotFn(q, (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({
            id: d.id,
            createdAt: v.createdAt?.toDate ? v.createdAt.toDate().toISOString() : v.createdAt ?? new Date().toISOString(),
            bettor: v.bettor,
            amount: Number(v.amount ?? 0),
            betType: v.betType,
            picks: Array.isArray(v.picks) ? v.picks : [],
          });
        });
        setBets(rows);
      });

      // Ensure room exists
      await setDocFn(
        roomRef,
        {
          participants,
          raceLocked,
          enforceMaxBet,
          maxBet: Number(maxBet),
          results,
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

  // TV auto-rotate
  useEffect(() => {
    if (mode !== "TV") return;
    if (!autoRotate) return;
    const keys = PUBLIC_BOARDS.map((b) => b.key);
    const i = keys.indexOf(boardKey);
    const next = keys[(i + 1 + keys.length) % keys.length];
    const handle = setTimeout(() => setBoardKey(next), 6000);
    return () => clearTimeout(handle);
  }, [mode, autoRotate, boardKey]);

  const pushRoomUpdate = async (patch) => {
    if (!cloudReady || syncMode !== "CLOUD" || !roomCode) return;
    const roomRef = docFn(firestore, "rooms", roomCode);
    await setDocFn(roomRef, { ...patch, updatedAt: serverTimestampFn() }, { merge: true });
  };

  const addParticipant = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) return;

    const next = [...participants, trimmed];
    setParticipants(next);
    setNameInput("");
    if (!bettor) setBettor(trimmed);

    if (syncMode === "CLOUD") await pushRoomUpdate({ participants: next });
  };

  const poolFor = (type) => bets.filter((b) => b.betType === type);

  const picksNeeded = useMemo(() => {
    if (betType === "WIN" || betType === "PLACE" || betType === "SHOW") return 1;
    if (betType === "EXACTA") return 2;
    if (betType === "TRIFECTA") return 3;
    if (betType === "SUPERFECTA") return 4;
    return 1;
  }, [betType]);

  const isExotic = betType === "EXACTA" || betType === "TRIFECTA" || betType === "SUPERFECTA";
  const currentPicks = useMemo(() => [pick1, pick2, pick3, pick4].slice(0, picksNeeded), [pick1, pick2, pick3, pick4, picksNeeded]);

  const boxSize = picksNeeded;

  const boxCombos = useMemo(() => {
    if (!boxed || !isExotic) return [];
    const horses = boxHorses.filter(Boolean);
    if (horses.length < boxSize) return [];
    return permutations(horses, boxSize);
  }, [boxed, isExotic, boxHorses, boxSize]);

  const canAddBet = useMemo(() => {
    if (raceLocked) return false;
    if (!bettor) return false;
    if (!amount || amount <= 0) return false;
    if (enforceMaxBet && amount > maxBet) return false;

    if (boxed && isExotic) {
      if (boxHorses.filter(Boolean).length < boxSize) return false;
      if (boxCombos.length === 0) return false;
      if (boxCombos.length > 120) return false; // guardrail
      return true;
    }

    if (currentPicks.some((p) => !p)) return false;
    const uniq = new Set(currentPicks);
    if (uniq.size !== currentPicks.length) return false;
    return true;
  }, [raceLocked, bettor, amount, enforceMaxBet, maxBet, boxed, isExotic, boxHorses, boxSize, boxCombos.length, currentPicks]);

  const addBet = async () => {
    if (!canAddBet) return;

    const perTicket = Number(amount);
    const tickets = boxed && isExotic ? boxCombos : [currentPicks];

    // LOCAL
    if (!(syncMode === "CLOUD" && cloudReady && roomCode)) {
      const now = new Date().toISOString();
      const newRows = tickets.map((picks) => ({
        id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        createdAt: now,
        bettor,
        amount: perTicket,
        betType,
        picks,
      }));
      setBets([...bets, ...newRows]);
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

  const isWinningTicket = (bet, r) => {
    const [a, b, c, d] = bet.picks;

    // Real horse racing semantics
    if (bet.betType === "WIN") return a === r.first;
    if (bet.betType === "PLACE") return a === r.first || a === r.second;
    if (bet.betType === "SHOW") return a === r.first || a === r.second || a === r.third;

    if (bet.betType === "EXACTA") return a === r.first && b === r.second;
    if (bet.betType === "TRIFECTA") return a === r.first && b === r.second && c === r.third;
    if (bet.betType === "SUPERFECTA") return a === r.first && b === r.second && c === r.third && d === r.fourth;

    return false;
  };

  const payoutsByType = useMemo(() => {
    const out = {};
    for (const t of BET_TYPES.map((x) => x.key)) {
      const pool = poolFor(t);
      const total = pool.reduce((s, b) => s + b.amount, 0);
      const winners = pool.filter((b) => isWinningTicket(b, results));
      if (winners.length === 0 || total === 0) out[t] = { total, winners: [], split: 0 };
      else {
        const split = total / winners.length;
        out[t] = { total, winners: winners.map((w) => ({ id: w.id, bettor: w.bettor, split })), split };
      }
    }
    return out;
  }, [bets, results]);

  // Live pools and odds boards
  const poolsTotals = useMemo(() => {
    const totals = {};
    for (const t of BET_TYPES.map((x) => x.key)) totals[t] = poolFor(t).reduce((s, b) => s + b.amount, 0);
    return totals;
  }, [bets]);

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
      if (t === "WIN" || t === "PLACE" || t === "SHOW") {
        const horseName = b.picks[0];
        out[t].set(horseName, (out[t].get(horseName) ?? 0) + b.amount);
      } else {
        const key = b.picks.join(" > ");
        out[t].set(key, (out[t].get(key) ?? 0) + b.amount);
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
        return { horse: h, on, pool: total, payoutPerDollar, odds };
      });
    };
    return { WIN: build("WIN"), PLACE: build("PLACE"), SHOW: build("SHOW") };
  }, [participants, poolsTotals, amountsOn]);

  const exoticLeaders = useMemo(() => {
    const build = (t, limit = 12) => {
      const total = poolsTotals[t] ?? 0;
      const map = amountsOn[t];
      const rows = Array.from(map.entries())
        .map(([combo, on]) => ({ combo, on, payoutPerDollar: on > 0 ? total / on : 0, odds: on > 0 ? total / on - 1 : 0 }))
        .sort((a, b) => b.on - a.on)
        .slice(0, limit);
      return { total, rows };
    };
    return { EXACTA: build("EXACTA"), TRIFECTA: build("TRIFECTA"), SUPERFECTA: build("SUPERFECTA") };
  }, [poolsTotals, amountsOn]);

  const ledger = useMemo(() => {
    const people = participants.length ? participants : Array.from(new Set(bets.map((b) => b.bettor)));
    const spent = new Map();
    const won = new Map();
    for (const p of people) {
      spent.set(p, 0);
      won.set(p, 0);
    }
    for (const b of bets) spent.set(b.bettor, (spent.get(b.bettor) ?? 0) + b.amount);
    for (const t of Object.keys(payoutsByType)) {
      for (const w of payoutsByType[t].winners) won.set(w.bettor, (won.get(w.bettor) ?? 0) + w.split);
    }
    return people
      .map((p) => {
        const s = spent.get(p) ?? 0;
        const w = won.get(p) ?? 0;
        return { person: p, spent: s, won: w, net: w - s };
      })
      .sort((a, b) => b.net - a.net);
  }, [participants, bets, payoutsByType]);

  const exportCsv = () => {
    const lines = [];
    lines.push(["Room", roomCode || "(local)"].map(csvEscape).join(","));
    lines.push(["Race Results", ""].map(csvEscape).join(","));
    lines.push(["1st", results.first].map(csvEscape).join(","));
    lines.push(["2nd", results.second].map(csvEscape).join(","));
    lines.push(["3rd", results.third].map(csvEscape).join(","));
    lines.push(["4th", results.fourth].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Pools", ""].join(","));
    lines.push(["Type", "Total Pool"].map(csvEscape).join(","));
    for (const t of BET_TYPES.map((x) => x.key)) lines.push([t, (poolsTotals[t] ?? 0).toFixed(2)].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Ledger", ""].join(","));
    lines.push(["Person", "Spent", "Won", "Net"].map(csvEscape).join(","));
    for (const r of ledger) lines.push([r.person, r.spent.toFixed(2), r.won.toFixed(2), r.net.toFixed(2)].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Bets", ""].join(","));
    lines.push(["Time", "Bettor", "Type", "Picks", "Amount"].map(csvEscape).join(","));
    for (const b of bets) lines.push([b.createdAt, b.bettor, b.betType, b.picks.join(" > "), Number(b.amount).toFixed(2)].map(csvEscape).join(","));

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

  const newRace = async () => {
    // LOCAL new race: clear bets and results
    if (syncMode === "LOCAL") {
      setBets([]);
      setResults({ first: "", second: "", third: "", fourth: "" });
      setRaceLocked(false);
      setBetType("WIN");
      setPick1("");
      setPick2("");
      setPick3("");
      setPick4("");
      setBoxed(false);
      setBoxHorses([]);
      setAmount(0.1);
      return;
    }

    // CLOUD: generate a new room code (clean slate)
    const next = randomRoomCode();
    setRoomCode(next);
    setRoomInput(next);
    setBets([]);
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);
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
    if (patch.enforceMaxBet !== undefined) setEnforceMaxBet(patch.enforceMaxBet);
    if (patch.maxBet !== undefined) setMaxBet(patch.maxBet);
    if (syncMode === "CLOUD") {
      await pushRoomUpdate({
        enforceMaxBet: patch.enforceMaxBet ?? enforceMaxBet,
        maxBet: patch.maxBet ?? maxBet,
      });
    }
  };

  const formatOdds = (odds) => {
    if (!odds || odds <= 0) return "-";
    return `${odds.toFixed(2)}-1`;
  };

  const formatPayoutPerDollar = (p) => {
    if (!p || p <= 0) return "-";
    return `$${p.toFixed(2)} per $1`;
  };

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

  const LiveOddsMini = () => (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Live pools and odds</div>
        <div className="text-xs text-gray-600">{roomCode ? `Room ${roomCode}` : "Local"}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-2xl border p-2">
          <div className="text-xs text-gray-600">Win pool</div>
          <div className="font-semibold">${(poolsTotals.WIN ?? 0).toFixed(2)}</div>
        </div>
        <div className="rounded-2xl border p-2">
          <div className="text-xs text-gray-600">Place pool</div>
          <div className="font-semibold">${(poolsTotals.PLACE ?? 0).toFixed(2)}</div>
        </div>
        <div className="rounded-2xl border p-2">
          <div className="text-xs text-gray-600">Show pool</div>
          <div className="font-semibold">${(poolsTotals.SHOW ?? 0).toFixed(2)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-2">Horse</th>
              <th className="py-2 pr-2">Win odds</th>
              <th className="py-2">Win payout</th>
            </tr>
          </thead>
          <tbody>
            {horseBoard.WIN
              .slice()
              .sort((a, b) => b.on - a.on)
              .map((r) => (
                <tr key={r.horse} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-medium">{r.horse}</td>
                  <td className="py-2 pr-2">{formatOdds(r.odds)}</td>
                  <td className="py-2">{formatPayoutPerDollar(r.payoutPerDollar)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-600">
        Betting status: <span className="font-semibold">{raceLocked ? "Locked" : "Open"}</span>
      </div>
    </div>
  );

  const Header = () => (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-2xl font-black">Betting Terminal</div>
        <div className="text-sm text-gray-600">Win / Place / Show + Exacta / Trifecta / Superfecta (boxed allowed)</div>
        <div className="text-xs text-gray-500 mt-1">
          Mode: <span className="font-semibold">{mode}</span> | Sync: <span className="font-semibold">{syncMode}</span>
          {roomCode ? (
            <>
              {" "} | Room: <span className="font-semibold">{roomCode}</span>
            </>
          ) : null}
        </div>
      </div>

      {!kioskMode && mode === "TERMINAL" ? (
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          <button onClick={newRace} className={buttonSecondary}>New Race</button>
          <button onClick={exportCsv} className={buttonSecondary} disabled={bets.length === 0}>Export CSV</button>
        </div>
      ) : null}
    </div>
  );

  const ModeSwitcher = () => {
    if (kioskMode) return null;

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
        <label className="flex items-center gap-2 text-sm ml-2">
          <input type="checkbox" checked={kioskMode} onChange={(e) => setKioskMode(e.target.checked)} />
          Kiosk mode
        </label>
      </div>
    );
  };

  const RoomPanel = () => {
    if (mode !== "TERMINAL" || kioskMode) return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="font-semibold">Multi-phone live betting</div>

        {!cloudReady ? (
          <div className="text-sm text-gray-700">
            Cloud sync is not enabled yet. To sync all phones, paste your Firebase config into FIREBASE_CONFIG and make sure firebase is in package.json.
          </div>
        ) : null}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            className={buttonSecondary}
            onClick={() => {
              const rc = randomRoomCode();
              setRoomCode(rc);
              setRoomInput(rc);
            }}
          >
            Generate room code
          </button>

          <input
            className={smallInput}
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            placeholder="Enter room code"
          />

          <button
            className={buttonPrimary}
            onClick={() => {
              const rc = (roomInput || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
              setRoomCode(rc);
              if (cloudReady) setSyncMode("CLOUD");
            }}
            disabled={!roomInput || !cloudReady}
            title={!cloudReady ? "Enable Firebase first" : ""}
          >
            Use room (Cloud)
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <div className="space-y-2">
            <div className="text-sm font-semibold">Bettor link</div>
            <div className="text-xs text-gray-600 break-all">{bettorUrl || "(loading...)"}</div>
            <canvas ref={qrCanvasRef} className="border rounded-2xl" />
            <div className="text-xs text-gray-600">Guests scan this QR to bet from any phone.</div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">TV link</div>
            <div className="text-xs text-gray-600 break-all">{tvUrl || "(loading...)"}</div>
            <div className="text-xs text-gray-600">Open this on the iPad and screen share to the TV.</div>
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
          <div className="text-xs text-gray-600">Participants are also the horses</div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Add name"
            className={smallInput}
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
              <span key={p} className="px-3 py-1 rounded-full border text-sm">{p}</span>
            ))
          )}
        </div>
      </div>
    );
  };

  const BettingPanel = () => {
    if (mode !== "TERMINAL" && mode !== "BETTOR") return null;

    return (
      <div className="rounded-2xl border p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Place a bet</h2>
          <div className="text-xs text-gray-600">{raceLocked ? "Locked" : "Open"}</div>
        </div>

        {mode === "BETTOR" ? <LiveOddsMini /> : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Your name</div>
            <select className={smallSelect} value={bettor} onChange={(e) => setBettor(e.target.value)} disabled={raceLocked}>
              <option value="">Select</option>
              {participants.map((p) => (
                <option key={p} value={p}>{p}</option>
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
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>

            {isExotic ? (
              <label className="flex items-center gap-2 text-sm mt-2">
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

            {boxed && isExotic ? (
              <div className="mt-2 space-y-2">
                <div className="text-xs text-gray-600">
                  Select {boxSize} or more horses. Tickets created: {boxCombos.length}. Max 120.
                </div>
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
                {boxCombos.length > 120 ? <div className="text-xs text-red-600">Too many tickets. Select fewer horses.</div> : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Amount (per ticket)</div>
            <input
              type="number"
              className={smallInput}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              min={0.1}
              step={0.1}
              disabled={raceLocked}
            />
            <div className="text-xs text-gray-600">Use $0.10 increments.</div>
            {enforceMaxBet && amount > maxBet ? (
              <div className="text-xs text-red-600">Amount exceeds max bet of ${Number(maxBet).toFixed(2)}.</div>
            ) : null}
          </div>

          {!boxed || !isExotic ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Pick(s)</div>
              <div className="grid grid-cols-1 gap-2">
                <PickSelect label={picksNeeded === 1 ? "Pick" : "1st"} value={pick1} onChange={setPick1} disabled={raceLocked} />
                {picksNeeded >= 2 ? <PickSelect label="2nd" value={pick2} onChange={setPick2} disabled={raceLocked} /> : null}
                {picksNeeded >= 3 ? <PickSelect label="3rd" value={pick3} onChange={setPick3} disabled={raceLocked} /> : null}
                {picksNeeded >= 4 ? <PickSelect label="4th" value={pick4} onChange={setPick4} disabled={raceLocked} /> : null}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium">Pick(s)</div>
              <div className="text-sm text-gray-700">Boxed bet uses your horse selections above.</div>
            </div>
          )}
        </div>

        <button onClick={addBet} className={buttonPrimary} disabled={!canAddBet}>
          Submit bet
        </button>

        <div className="text-xs text-gray-600">
          {boxed && isExotic && boxCombos.length > 0 ? `Submitting ${boxCombos.length} tickets at $${Number(amount).toFixed(2)} each.` : null}
        </div>
      </div>
    );
  };

  const TerminalControls = () => {
    if (mode !== "TERMINAL" || kioskMode) return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Race control</h2>
          <div className="text-xs text-gray-600">Lock betting once the squeeze starts</div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => lockRace(true)} className={buttonSecondary} disabled={raceLocked || bets.length === 0}>
            Lock Betting
          </button>
          <button onClick={() => lockRace(false)} className={buttonSecondary} disabled={!raceLocked}>
            Unlock Betting
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enforceMaxBet}
              onChange={(e) => updateMaxBet({ enforceMaxBet: e.target.checked })}
            />
            Enforce max bet
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700">Max</span>
            <input
              type="number"
              className="border rounded-2xl p-2 w-28"
              value={maxBet}
              onChange={(e) => updateMaxBet({ maxBet: Number(e.target.value) })}
              min={0.1}
              step={0.1}
            />
          </div>
        </div>
      </div>
    );
  };

  const ResultsPanel = () => {
    if (mode !== "TERMINAL" || kioskMode) return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Official results</h2>
          <div className="text-xs text-gray-600">Used for payouts</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PickSelect label="1st" value={results.first} onChange={(v) => updateResults({ first: v })} />
          <PickSelect label="2nd" value={results.second} onChange={(v) => updateResults({ second: v })} />
          <PickSelect label="3rd" value={results.third} onChange={(v) => updateResults({ third: v })} />
          <PickSelect label="4th (Superfecta only)" value={results.fourth} onChange={(v) => updateResults({ fourth: v })} />
        </div>
      </div>
    );
  };

  const PayoutsPanel = () => {
    if (mode !== "TERMINAL") return null;

    return (
      <div className="rounded-2xl border p-4 space-y-4">
        <h2 className="font-semibold">Payouts (after results)</h2>

        <div className="grid grid-cols-1 gap-3">
          {BET_TYPES.map((t) => {
            const p = payoutsByType[t.key];
            const poolTotal = p?.total ?? 0;
            const winners = p?.winners ?? [];
            return (
              <div key={t.key} className="rounded-2xl border p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.label}</div>
                  <div className="text-sm text-gray-600">Pool: ${poolTotal.toFixed(2)}</div>
                </div>
                {winners.length === 0 ? (
                  <div className="text-sm text-gray-600 mt-2">No winning tickets (or no bets placed).</div>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {winners.map((w) => (
                      <li key={w.id} className="text-sm">
                        {w.bettor} receives ${w.split.toFixed(2)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const TvBoard = () => {
    const header = PUBLIC_BOARDS.find((b) => b.key === boardKey)?.label ?? "Board";

    const formatPayoutPerTenCents = (payoutPerDollar) => {
      if (!payoutPerDollar || payoutPerDollar <= 0) return "-";
      return `$${(payoutPerDollar * 0.1).toFixed(2)} per $0.10`;
    };

    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-3xl font-black">Betting Terminal</div>
              <div className="text-lg text-gray-700">{header} - live pools, odds, projected payouts</div>
              {roomCode ? <div className="text-sm text-gray-600">Room {roomCode}</div> : <div className="text-sm text-gray-600">Local</div>}
            </div>
            {!kioskMode ? (
              <div className="flex flex-wrap gap-2 justify-end">
                <button className={buttonSecondary} onClick={() => setMode("TERMINAL")}>Terminal</button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
              Auto-rotate boards
            </label>
            <div className="flex flex-wrap gap-2">
              {PUBLIC_BOARDS.map((b) => (
                <button
                  key={b.key}
                  className={"rounded-2xl px-4 py-2 text-sm font-semibold border " + (boardKey === b.key ? "bg-black text-white" : "")}
                  onClick={() => setBoardKey(b.key)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border p-4">
              <div className="font-semibold text-lg">Pools</div>
              <div className="mt-3 space-y-2 text-base">
                {BET_TYPES.map((t) => (
                  <div key={t.key} className="flex items-center justify-between">
                    <div>{t.label}</div>
                    <div className="font-semibold">${(poolsTotals[t.key] ?? 0).toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm text-gray-600">
                Projected payout per $0.10 shown (derived from per $1).
              </div>
            </div>

            <div className="rounded-2xl border p-4 lg:col-span-2">
              {(boardKey === "WIN" || boardKey === "PLACE" || boardKey === "SHOW") ? (
                <>
                  <div className="font-semibold text-lg">{header}</div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-base">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-3 pr-3">Horse</th>
                          <th className="py-3 pr-3">Bet On</th>
                          <th className="py-3 pr-3">Odds</th>
                          <th className="py-3">Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {horseBoard[boardKey]
                          .slice()
                          .sort((a, b) => b.on - a.on)
                          .map((r) => (
                            <tr key={r.horse} className="border-b last:border-b-0">
                              <td className="py-3 pr-3 font-semibold">{r.horse}</td>
                              <td className="py-3 pr-3">${r.on.toFixed(2)}</td>
                              <td className="py-3 pr-3">{formatOdds(r.odds)}</td>
                              <td className="py-3">{formatPayoutPerTenCents(r.payoutPerDollar)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-lg">{header}</div>
                  <div className="mt-2 text-sm text-gray-600">Exotics are ordered. Showing most-bet combos.</div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-base">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-3 pr-3">Combo</th>
                          <th className="py-3 pr-3">Bet On</th>
                          <th className="py-3 pr-3">Odds</th>
                          <th className="py-3">Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(boardKey === "EXACTA" ? exoticLeaders.EXACTA : boardKey === "TRIFECTA" ? exoticLeaders.TRIFECTA : exoticLeaders.SUPERFECTA).rows.map((r) => (
                          <tr key={r.combo} className="border-b last:border-b-0">
                            <td className="py-3 pr-3 font-semibold">{r.combo}</td>
                            <td className="py-3 pr-3">${r.on.toFixed(2)}</td>
                            <td className="py-3 pr-3">{formatOdds(r.odds)}</td>
                            <td className="py-3">{formatPayoutPerTenCents(r.payoutPerDollar)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl border p-4">
            <div className="font-semibold text-lg">Official Results</div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-base">
              {["first", "second", "third", "fourth"].map((k, idx) => (
                <div key={k} className="rounded-2xl border p-3">
                  <div className="text-sm text-gray-600">
                    {idx + 1}
                    {idx === 0 ? "st" : idx === 1 ? "nd" : idx === 2 ? "rd" : "th"}
                  </div>
                  <div className="font-bold text-xl">{results[k] || "-"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // TV mode
  if (mode === "TV") return <TvBoard />;

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <Header />
        <ModeSwitcher />
        <RoomPanel />

        <div className="grid gap-6">
          <ParticipantsPanel />
          <BettingPanel />
          <TerminalControls />
          <ResultsPanel />
          {mode === "TERMINAL" ? <PayoutsPanel /> : null}

          <div className="text-xs text-gray-500 pb-10">
            If phones are not syncing: Firebase config is missing or guests are not using the same room code in the URL.
          </div>
        </div>
      </div>
    </div>
  );
}
