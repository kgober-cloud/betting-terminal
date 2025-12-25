import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

// =====================
// Firebase (cloud sync)
// =====================
// Paste your Firebase web config into FIREBASE_CONFIG to enable multi-phone sync.
// If FIREBASE_CONFIG stays null, the app works in LOCAL mode only (each device is separate).
const FIREBASE_CONFIG = null;
// Example:
// const FIREBASE_CONFIG = {
//   apiKey: "...",
//   authDomain: "...",
//   projectId: "...",
//   storageBucket: "...",
//   messagingSenderId: "...",
//   appId: "...",
// };

let firebaseApp = null;
let firestore = null;
let onSnapshotFn = null;
let docFn = null;
let setDocFn = null;
let addDocFn = null;
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

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[

,"]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
  const qrCanvasRef = useRef(null);

  // Kiosk mode hides mode switching on-screen
  const [kioskMode, setKioskMode] = useState(false);

  // Sync
  const [cloudReady, setCloudReady] = useState(false);
  const [syncMode, setSyncMode] = useState("LOCAL"); // LOCAL | CLOUD

  // Room
  const [roomCode, setRoomCode] = useState("");
  const [roomInput, setRoomInput] = useState("");

  // Local persistence
  const STORAGE_KEY = "betting-terminal-state-v4";
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

  // default $0.10
  const [amount, setAmount] = useState(persisted?.amount ?? 0.1);

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

  // Firebase readiness
  useEffect(() => {
    (async () => {
      const ok = await ensureFirebase();
      setCloudReady(ok);
      // If someone loads with ?room=... and firebase is available, auto-enable CLOUD.
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

  // QR links
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
        amount,
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
    raceLocked,
    enforceMaxBet,
    maxBet,
    results,
    boardKey,
    autoRotate,
    kioskMode,
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
        const horse = b.picks[0];
        out[t].set(horse, (out[t].get(horse) ?? 0) + b.amount);
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
  const addParticipant = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) return;

    const next = [...participants, trimmed];
    setParticipants(next);
    setNameInput("");

    // keep focus in input
    requestAnimationFrame(() => {
      try {
        document.getElementById("addNameInput")?.focus();
      } catch {
        // ignore
      }
    });

    if (!bettor) setBettor(trimmed);

    if (syncMode === "CLOUD") await pushRoomUpdate({ participants: next });
  };

  const addBet = async () => {
    if (!canAddBet) return;

    const perTicket = Number(amount);
    const tickets = boxed && isExotic ? boxCombos : [currentPicks];

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

  const newRace = async () => {
    // LOCAL: wipe
    if (syncMode !== "CLOUD") {
      setBets([]);
      setResults({ first: "", second: "", third: "", fourth: "" });
      setRaceLocked(false);
      setBetType("WIN");
      setBettor("");
      setAmount(0.1);
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
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);
    await pushRoomUpdate({
      participants,
      raceLocked: false,
      results: { first: "", second: "", third: "", fourth: "" },
    });
  };

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
    for (const t of BET_TYPES.map((x) => x.key)) {
      lines.push([t, (poolsTotals[t] ?? 0).toFixed(2)].map(csvEscape).join(","));
    }
    lines.push(["", ""].join(","));

    lines.push(["Bets", ""].join(","));
    lines.push(["Time", "Bettor", "Type", "Picks", "Amount"].map(csvEscape).join(","));
    for (const b of bets) {
      lines.push([b.createdAt, b.bettor, b.betType, (b.picks || []).join(" > "), Number(b.amount).toFixed(2)].map(csvEscape).join(","));
    }

    const blob = new Blob([lines.join("
")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `betting-terminal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // TV auto rotate
  useEffect(() => {
    if (mode !== "TV") return;
    if (!autoRotate) return;
    const keys = PUBLIC_BOARDS.map((b) => b.key);
    const i = keys.indexOf(boardKey);
    const next = keys[(i + 1 + keys.length) % keys.length];
    const handle = setTimeout(() => setBoardKey(next), 6000);
    return () => clearTimeout(handle);
  }, [mode, autoRotate, boardKey]);

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

  const formatOdds = (odds) => {
    if (!odds || odds <= 0) return "-";
    return `${odds.toFixed(2)}-1`;
  };

  const formatPayoutPerTenCents = (payoutPerDollar) => {
    if (!payoutPerDollar || payoutPerDollar <= 0) return "-";
    return `$${(payoutPerDollar * 0.1).toFixed(2)} per $0.10`;
  };

  const Header = () => (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-2xl font-black">Betting Terminal</div>
        <div className="text-sm text-gray-600">Win / Place / Show + Exacta / Trifecta / Superfecta</div>
        <div className="text-xs text-gray-500 mt-1">
          Mode: <span className="font-semibold">{mode}</span> | Sync: <span className="font-semibold">{syncMode}</span>
          {roomCode ? (
            <>
              {" "} | Room: <span className="font-semibold">{roomCode}</span>
            </>
          ) : null}
        </div>
      </div>

      {mode === "TERMINAL" && !kioskMode ? (
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
        <div className="font-semibold">Multi-phone betting</div>

        {!cloudReady ? (
          <div className="text-sm text-gray-700">
            Cloud sync is OFF. To sync phones, paste Firebase config into FIREBASE_CONFIG and add firebase dependency.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <div className="space-y-2">
            <div className="text-sm font-semibold">Bettor QR</div>
            <div className="text-xs text-gray-600 break-all">{bettorUrl || "(loading...)"}</div>
            <canvas ref={qrCanvasRef} className="border rounded-2xl" />
            <div className="text-xs text-gray-600">Guests scan this to bet (must include the same room).</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">TV link</div>
            <div className="text-xs text-gray-600 break-all">{tvUrl || "(loading...)"}</div>
            <div className="text-xs text-gray-600">Open this and screen share to your TV.</div>
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
          <div className="text-xs text-gray-600">Participants are the horses</div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="addNameInput"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Add name"
            className={smallInput}
            autoCorrect="off"
            autoCapitalize="words"
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

        {mode === "BETTOR" ? (
          <div className="rounded-2xl border p-3 text-sm text-gray-700">
            <div className="font-semibold">Live race info</div>
            <div className="mt-1">Participants: {participants.length ? participants.join(", ") : "(none yet)"}</div>
            <div className="mt-1">Win pool: ${(poolsTotals.WIN ?? 0).toFixed(2)} | Place: ${(poolsTotals.PLACE ?? 0).toFixed(2)} | Show: ${(poolsTotals.SHOW ?? 0).toFixed(2)}</div>
            <div className="mt-1">Room: {roomCode || "(local)"}</div>
          </div>
        ) : null}

        {mode === "TERMINAL" && !kioskMode ? (
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="font-semibold">Limits</div>
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
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Your name</div>
            <select className={smallSelect} value={bettor} onChange={(e) => setBettor(e.target.value)} disabled={raceLocked}>
              <option value="">Select</option>
              {participants.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {participants.length === 0 ? (
              <div className="text-xs text-red-600">Host must add participants first.</div>
            ) : null}
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

          <div className="space-y-2">
            <div className="text-sm font-medium">Pick(s)</div>

            {isExotic ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={boxed} onChange={(e) => {
                  setBoxed(e.target.checked);
                  setBoxHorses([]);
                }} disabled={raceLocked} />
                Box (any order)
              </label>
            ) : null}

            {boxed && isExotic ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-600">
                  Select {picksNeeded} or more horses. Tickets: {boxCombos.length}. Max 120.
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
                {boxCombos.length > 120 ? (
                  <div className="text-xs text-red-600">Too many tickets. Select fewer horses.</div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                <PickSelect label={picksNeeded === 1 ? "Pick" : "1st"} value={pick1} onChange={setPick1} disabled={raceLocked} />
                {picksNeeded >= 2 ? <PickSelect label="2nd" value={pick2} onChange={setPick2} disabled={raceLocked} /> : null}
                {picksNeeded >= 3 ? <PickSelect label="3rd" value={pick3} onChange={setPick3} disabled={raceLocked} /> : null}
                {picksNeeded >= 4 ? <PickSelect label="4th" value={pick4} onChange={setPick4} disabled={raceLocked} /> : null}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={addBet} className={buttonPrimary} disabled={!canAddBet}>
            Submit bet
          </button>
          {boxed && isExotic && boxCombos.length > 0 ? (
            <div className="text-xs text-gray-600 self-center">Submitting {boxCombos.length} tickets.</div>
          ) : null}
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
      </div>
    );
  };

  const ResultsPanel = () => {
    if (mode !== "TERMINAL" || kioskMode) return null;

    return (
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Official results</h2>
          <div className="text-xs text-gray-600">Used for payouts and exotics</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PickSelect label="1st" value={results.first} onChange={(v) => updateResults({ first: v })} />
          <PickSelect label="2nd" value={results.second} onChange={(v) => updateResults({ second: v })} />
          <PickSelect label="3rd" value={results.third} onChange={(v) => updateResults({ third: v })} />
          <PickSelect label="4th (Superfecta)" value={results.fourth} onChange={(v) => updateResults({ fourth: v })} />
        </div>
      </div>
    );
  };

  const TvBoard = () => {
    const header = PUBLIC_BOARDS.find((b) => b.key === boardKey)?.label ?? "Board";

    const rows = (boardKey === "WIN" || boardKey === "PLACE" || boardKey === "SHOW")
      ? horseBoard[boardKey].slice().sort((a, b) => b.on - a.on).map((r) => ({
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
      <div className="min-h-screen bg-white">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-3xl font-black">Betting Terminal</div>
              <div className="text-lg text-gray-700">{header} - live pools, odds, payouts</div>
              {roomCode ? <div className="text-sm text-gray-600">Room {roomCode}</div> : null}
            </div>
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
            </div>

            <div className="rounded-2xl border p-4 lg:col-span-2">
              <div className="font-semibold text-lg">{header}</div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-base">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-3 pr-3">Outcome</th>
                      <th className="py-3 pr-3">Bet On</th>
                      <th className="py-3 pr-3">Odds</th>
                      <th className="py-3">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.left} className="border-b last:border-b-0">
                        <td className="py-3 pr-3 font-semibold">{r.left}</td>
                        <td className="py-3 pr-3">{r.on}</td>
                        <td className="py-3 pr-3">{r.odds}</td>
                        <td className="py-3">{r.payout}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border p-4">
            <div className="font-semibold text-lg">Official Results</div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-base">
              {["first", "second", "third", "fourth"].map((k, idx) => (
                <div key={k} className="rounded-2xl border p-3">
                  <div className="text-sm text-gray-600">{idx + 1}{idx === 0 ? "st" : idx === 1 ? "nd" : idx === 2 ? "rd" : "th"}</div>
                  <div className="font-bold text-xl">{results[k] || "-"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // -----------------
  // Render
  // -----------------
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

          <div className="text-xs text-gray-500 pb-10">
            If the phone shows no names - cloud sync is OFF or the phone is not using the same room code.
          </div>
        </div>
      </div>
    </div>
  );
}
