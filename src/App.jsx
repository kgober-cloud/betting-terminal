import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

const BET_TYPES = [
  { key: "WIN", label: "Win", legs: 1 },
  { key: "PLACE", label: "Place", legs: 1 },
  { key: "SHOW", label: "Show", legs: 1 },
  { key: "EXACTA", label: "Exacta", legs: 2 },
  { key: "TRIFECTA", label: "Trifecta", legs: 3 },
  { key: "SUPERFECTA", label: "Superfecta", legs: 4 },
];

const TV_BOARDS = [
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

function safeUUID() {
  return crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function getModeFromUrl() {
  try {
    const p = new URLSearchParams(window.location.search);
    const m = (p.get("mode") || "").toUpperCase();
    if (m === "TV" || m === "BETTOR" || m === "TERMINAL") return m;
  } catch {
    // ignore
  }
  return "TERMINAL";
}

export default function App() {
  // Basic iPad / mobile behavior: reduce scroll bounce a bit
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      html, body { height: 100%; }
      body { margin: 0; overscroll-behavior: none; }
      * { -webkit-tap-highlight-color: transparent; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // --- Persistence ---
  const STORAGE_KEY = "betting-terminal-state-v2";

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

  // Mode: TERMINAL (admin) vs BETTOR (phones) vs TV (screen share)
  const [mode, setMode] = useState(persisted?.mode ?? getModeFromUrl());

  // Shared game state
  const [participants, setParticipants] = useState(persisted?.participants ?? []);
  const [bets, setBets] = useState(persisted?.bets ?? []);
  const [results, setResults] = useState(persisted?.results ?? { first: "", second: "", third: "", fourth: "" });

  // Admin settings
  const [raceLocked, setRaceLocked] = useState(persisted?.raceLocked ?? false);
  const [kioskMode, setKioskMode] = useState(persisted?.kioskMode ?? false);
  const [enforceMaxBet, setEnforceMaxBet] = useState(persisted?.enforceMaxBet ?? true);
  const [maxBet, setMaxBet] = useState(persisted?.maxBet ?? 10);

  // TV settings
  const [boardKey, setBoardKey] = useState(persisted?.boardKey ?? "WIN");
  const [autoRotate, setAutoRotate] = useState(persisted?.autoRotate ?? true);

  // Terminal inputs
  const [nameInput, setNameInput] = useState("");
  const [bettor, setBettor] = useState(persisted?.bettor ?? "");
  const [betType, setBetType] = useState(persisted?.betType ?? "WIN");
  const [amount, setAmount] = useState(persisted?.amount ?? 10);
  const [pick1, setPick1] = useState(persisted?.pick1 ?? "");
  const [pick2, setPick2] = useState(persisted?.pick2 ?? "");
  const [pick3, setPick3] = useState(persisted?.pick3 ?? "");
  const [pick4, setPick4] = useState(persisted?.pick4 ?? "");

  // URLs for QR code and sharing
  const [baseUrl, setBaseUrl] = useState("");
  useEffect(() => {
    try {
      setBaseUrl(window.location.origin + window.location.pathname);
    } catch {
      // ignore
    }
  }, []);

  const bettorUrl = useMemo(() => (baseUrl ? `${baseUrl}?mode=BETTOR` : ""), [baseUrl]);
  const tvUrl = useMemo(() => (baseUrl ? `${baseUrl}?mode=TV` : ""), [baseUrl]);

  const qrCanvasRef = useRef(null);
  useEffect(() => {
    const c = qrCanvasRef.current;
    if (!c) return;
    if (!bettorUrl) return;
    QRCode.toCanvas(c, bettorUrl, { width: 220, margin: 1 }).catch(() => {});
  }, [bettorUrl]);

  // Save state (debounced)
  const saveTimer = useRef(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const snapshot = {
          mode,
          participants,
          bets,
          results,
          raceLocked,
          kioskMode,
          enforceMaxBet,
          maxBet,
          boardKey,
          autoRotate,
          bettor,
          betType,
          amount,
          pick1,
          pick2,
          pick3,
          pick4,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // ignore
      }
    }, 250);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    mode,
    participants,
    bets,
    results,
    raceLocked,
    kioskMode,
    enforceMaxBet,
    maxBet,
    boardKey,
    autoRotate,
    bettor,
    betType,
    amount,
    pick1,
    pick2,
    pick3,
    pick4,
  ]);

  // If user hits a URL with mode=..., respect it
  useEffect(() => {
    const urlMode = getModeFromUrl();
    setMode(urlMode);
  }, []);

  // Auto-rotate TV boards
  useEffect(() => {
    if (mode !== "TV") return;
    if (!autoRotate) return;
    const keys = TV_BOARDS.map((b) => b.key);
    const idx = keys.indexOf(boardKey);
    const next = keys[(idx + 1) % keys.length];
    const handle = setTimeout(() => setBoardKey(next), 6500);
    return () => clearTimeout(handle);
  }, [mode, autoRotate, boardKey]);

  const betConfig = useMemo(() => BET_TYPES.find((b) => b.key === betType) ?? BET_TYPES[0], [betType]);
  const picksNeeded = betConfig.legs;

  const currentPicks = useMemo(() => [pick1, pick2, pick3, pick4].slice(0, picksNeeded), [pick1, pick2, pick3, pick4, picksNeeded]);

  const canAddBet = useMemo(() => {
    if (raceLocked) return false;
    if (!bettor) return false;
    if (!amount || amount <= 0) return false;
    if (enforceMaxBet && Number(amount) > Number(maxBet)) return false;
    if (participants.length < 2) return false;
    if (currentPicks.some((p) => !p)) return false;

    // ordered exotics cannot repeat horses
    if (picksNeeded > 1) {
      const uniq = new Set(currentPicks);
      if (uniq.size !== currentPicks.length) return false;
    }
    return true;
  }, [raceLocked, bettor, amount, enforceMaxBet, maxBet, participants.length, currentPicks, picksNeeded]);

  const addParticipant = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) return;
    setParticipants([...participants, trimmed]);
    setNameInput("");
    if (!bettor) setBettor(trimmed);
  };

  const addBet = () => {
    if (!canAddBet) return;
    setBets([
      ...bets,
      {
        id: safeUUID(),
        createdAt: new Date().toISOString(),
        bettor,
        betType,
        amount: Number(amount),
        picks: currentPicks,
      },
    ]);
  };

  const removeBet = (id) => setBets(bets.filter((b) => b.id !== id));

  const poolTotal = useMemo(() => {
    const totals = {};
    for (const t of BET_TYPES) totals[t.key] = 0;
    for (const b of bets) totals[b.betType] = (totals[b.betType] ?? 0) + Number(b.amount || 0);
    return totals;
  }, [bets]);

  const amountOnOutcome = useMemo(() => {
    // For WIN/PLACE/SHOW: per-horse amount
    // For exotics: per combo string amount
    const maps = {
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
        maps[t].set(horse, (maps[t].get(horse) ?? 0) + Number(b.amount || 0));
      } else {
        const key = b.picks.join(" > ");
        maps[t].set(key, (maps[t].get(key) ?? 0) + Number(b.amount || 0));
      }
    }

    return maps;
  }, [bets]);

  // True win/place/show eligibility
  const isWinnerForType = (bet, r) => {
    const a = bet.picks[0];
    if (bet.betType === "WIN") return a === r.first;
    if (bet.betType === "PLACE") return a === r.first || a === r.second;
    if (bet.betType === "SHOW") return a === r.first || a === r.second || a === r.third;

    const [x, y, z, w] = bet.picks;
    if (bet.betType === "EXACTA") return x === r.first && y === r.second;
    if (bet.betType === "TRIFECTA") return x === r.first && y === r.second && z === r.third;
    if (bet.betType === "SUPERFECTA") return x === r.first && y === r.second && z === r.third && w === r.fourth;
    return false;
  };

  // Parimutuel-style proportional payouts: each winning ticket gets (ticketAmount / sumWinningAmounts) * pool
  const payouts = useMemo(() => {
    const byType = {};
    for (const t of BET_TYPES) {
      const pool = poolTotal[t.key] ?? 0;
      const winners = bets.filter((b) => b.betType === t.key && isWinnerForType(b, results));
      const sumWinning = winners.reduce((s, b) => s + Number(b.amount || 0), 0);
      if (!pool || !winners.length || !sumWinning) {
        byType[t.key] = { pool, winners: [] };
        continue;
      }
      byType[t.key] = {
        pool,
        winners: winners.map((b) => ({
          id: b.id,
          bettor: b.bettor,
          ticket: Number(b.amount || 0),
          payout: (Number(b.amount || 0) / sumWinning) * pool,
          picks: b.picks,
        })),
      };
    }
    return byType;
  }, [bets, results, poolTotal]);

  const ledger = useMemo(() => {
    const people = participants.length ? participants : Array.from(new Set(bets.map((b) => b.bettor)));
    const spent = new Map();
    const won = new Map();
    for (const p of people) {
      spent.set(p, 0);
      won.set(p, 0);
    }
    for (const b of bets) {
      spent.set(b.bettor, (spent.get(b.bettor) ?? 0) + Number(b.amount || 0));
    }
    for (const t of BET_TYPES) {
      for (const w of payouts[t.key]?.winners ?? []) {
        won.set(w.bettor, (won.get(w.bettor) ?? 0) + Number(w.payout || 0));
      }
    }
    return people
      .map((p) => {
        const s = spent.get(p) ?? 0;
        const w = won.get(p) ?? 0;
        return { person: p, spent: s, won: w, net: w - s };
      })
      .sort((a, b) => b.net - a.net);
  }, [participants, bets, payouts]);

  // Projected odds and payout per $1 for boards (no takeout)
  const horseBoard = useMemo(() => {
    const build = (type) => {
      const total = poolTotal[type] ?? 0;
      const map = amountOnOutcome[type];
      return participants
        .map((h) => {
          const on = map.get(h) ?? 0;
          const payoutPerDollar = on > 0 ? total / on : 0;
          const odds = on > 0 ? payoutPerDollar - 1 : 0;
          return { horse: h, on, payoutPerDollar, odds };
        })
        .sort((a, b) => b.on - a.on);
    };
    return {
      WIN: build("WIN"),
      PLACE: build("PLACE"),
      SHOW: build("SHOW"),
    };
  }, [participants, poolTotal, amountOnOutcome]);

  const exoticBoard = useMemo(() => {
    const build = (type) => {
      const total = poolTotal[type] ?? 0;
      const map = amountOnOutcome[type];
      return Array.from(map.entries())
        .map(([combo, on]) => {
          const payoutPerDollar = on > 0 ? total / on : 0;
          const odds = on > 0 ? payoutPerDollar - 1 : 0;
          return { combo, on, payoutPerDollar, odds };
        })
        .sort((a, b) => b.on - a.on)
        .slice(0, 14);
    };
    return {
      EXACTA: build("EXACTA"),
      TRIFECTA: build("TRIFECTA"),
      SUPERFECTA: build("SUPERFECTA"),
    };
  }, [poolTotal, amountOnOutcome]);

  const exportCsv = () => {
    const lines = [];

    lines.push(["Betting Terminal Export", ""].map(csvEscape).join(","));
    lines.push(["Exported At", new Date().toISOString()].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Race Results", ""].map(csvEscape).join(","));
    lines.push(["1st", results.first].map(csvEscape).join(","));
    lines.push(["2nd", results.second].map(csvEscape).join(","));
    lines.push(["3rd", results.third].map(csvEscape).join(","));
    lines.push(["4th", results.fourth].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Pools", ""].join(","));
    lines.push(["Type", "Total"].map(csvEscape).join(","));
    for (const t of BET_TYPES) lines.push([t.key, (poolTotal[t.key] ?? 0).toFixed(2)].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Ledger", ""].join(","));
    lines.push(["Person", "Spent", "Won", "Net"].map(csvEscape).join(","));
    for (const r of ledger) lines.push([r.person, r.spent.toFixed(2), r.won.toFixed(2), r.net.toFixed(2)].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Bets", ""].join(","));
    lines.push(["Time", "Bettor", "Type", "Picks", "Amount"].map(csvEscape).join(","));
    for (const b of bets) {
      lines.push([b.createdAt, b.bettor, b.betType, b.picks.join(" > "), Number(b.amount || 0).toFixed(2)].map(csvEscape).join(","));
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

  const newRace = () => {
    if (!confirm("Start a new race? This clears bets and results.")) return;
    setBets([]);
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);
    setBetType("WIN");
    setPick1("");
    setPick2("");
    setPick3("");
    setPick4("");
    setAmount(enforceMaxBet ? Math.min(10, Number(maxBet)) : 10);
  };

  const smallSelect = "border rounded-xl p-3 text-base w-full";
  const smallInput = "border rounded-xl p-3 text-base w-full";
  const buttonPrimary = "rounded-xl px-4 py-3 text-base font-semibold bg-black text-white disabled:opacity-40 disabled:cursor-not-allowed";
  const buttonSecondary = "rounded-xl px-4 py-3 text-base font-semibold border disabled:opacity-40 disabled:cursor-not-allowed";

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

  const ModeButtons = ({ compact = false }) => (
    <div className={"flex flex-wrap gap-2 " + (compact ? "" : "justify-end")}>
      <button className={buttonSecondary} onClick={() => setMode("TERMINAL")}>Terminal</button>
      <button className={buttonSecondary} onClick={() => setMode("BETTOR")}>Bettor</button>
      <button className={buttonSecondary} onClick={() => setMode("TV")}>TV</button>
    </div>
  );

  const formatOdds = (odds) => {
    if (!odds || odds <= 0) return "-";
    return `${odds.toFixed(2)}-1`;
  };

  const formatPayoutPerDollar = (p) => {
    if (!p || p <= 0) return "-";
    return `$${p.toFixed(2)} per $1`;
  };

  // --- TV MODE ---
  if (mode === "TV") {
    const header = TV_BOARDS.find((b) => b.key === boardKey)?.label ?? "Board";

    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-3xl font-black">Betting Terminal</div>
              <div className="text-lg text-gray-700">{header} - live odds and projected payouts</div>
              <div className="text-sm text-gray-500 mt-1">Auto-rotate cycles every ~6 seconds. Use the buttons to pin a board.</div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button className={buttonSecondary} onClick={() => setMode("TERMINAL")}>Back to Terminal</button>
              <button className={buttonSecondary} onClick={exportCsv} disabled={bets.length === 0}>Export CSV</button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
              Auto-rotate boards
            </label>

            <div className="flex flex-wrap gap-2">
              {TV_BOARDS.map((b) => (
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
                    <div className="font-semibold">${(poolTotal[t.key] ?? 0).toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm text-gray-600">
                Projected payout per $1 = pool / amount bet on that outcome. No house take.
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
                          <th className="py-3">Proj Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {horseBoard[boardKey].map((r) => (
                          <tr key={r.horse} className="border-b last:border-b-0">
                            <td className="py-3 pr-3 font-semibold">{r.horse}</td>
                            <td className="py-3 pr-3">${r.on.toFixed(2)}</td>
                            <td className="py-3 pr-3">{formatOdds(r.odds)}</td>
                            <td className="py-3">{formatPayoutPerDollar(r.payoutPerDollar)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-lg">{header}</div>
                  <div className="mt-2 text-sm text-gray-600">
                    Exotics are ordered. Showing the most-bet combos.
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-base">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-3 pr-3">Combo</th>
                          <th className="py-3 pr-3">Bet On</th>
                          <th className="py-3 pr-3">Odds</th>
                          <th className="py-3">Proj Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(boardKey === "EXACTA" ? exoticBoard.EXACTA : boardKey === "TRIFECTA" ? exoticBoard.TRIFECTA : exoticBoard.SUPERFECTA).map((r) => (
                          <tr key={r.combo} className="border-b last:border-b-0">
                            <td className="py-3 pr-3 font-semibold">{r.combo}</td>
                            <td className="py-3 pr-3">${r.on.toFixed(2)}</td>
                            <td className="py-3 pr-3">{formatOdds(r.odds)}</td>
                            <td className="py-3">{formatPayoutPerDollar(r.payoutPerDollar)}</td>
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
              <div className="rounded-2xl border p-3">
                <div className="text-sm text-gray-600">1st</div>
                <div className="font-bold text-xl">{results.first || "-"}</div>
              </div>
              <div className="rounded-2xl border p-3">
                <div className="text-sm text-gray-600">2nd</div>
                <div className="font-bold text-xl">{results.second || "-"}</div>
              </div>
              <div className="rounded-2xl border p-3">
                <div className="text-sm text-gray-600">3rd</div>
                <div className="font-bold text-xl">{results.third || "-"}</div>
              </div>
              <div className="rounded-2xl border p-3">
                <div className="text-sm text-gray-600">4th</div>
                <div className="font-bold text-xl">{results.fourth || "-"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- BETTOR MODE (phones) ---
  const BettorPanel = ({ hideAdminBits = false }) => (
    <div className="rounded-2xl border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">{hideAdminBits ? "Place Your Bets" : "Betting"}</h2>
          <div className="text-sm text-gray-600">
            {raceLocked ? "Betting is locked." : "Pick your bet and tap Add Bet."}
          </div>
        </div>
        {!hideAdminBits ? (
          <div className="text-sm text-gray-600">
            Max bet {enforceMaxBet ? `$${Number(maxBet).toFixed(0)}` : "off"}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Bettor</div>
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
            }}
            disabled={raceLocked}
          >
            {BET_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">Amount</div>
          <input
            type="number"
            className={smallInput}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            min={1}
            step={1}
            disabled={raceLocked}
          />
          {enforceMaxBet && Number(amount) > Number(maxBet) ? (
            <div className="text-xs text-red-600">Amount exceeds max bet of ${Number(maxBet).toFixed(0)}.</div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Pick(s)</div>
          <div className="grid grid-cols-1 gap-2">
            <PickSelect label={picksNeeded === 1 ? "Pick" : "1st"} value={pick1} onChange={setPick1} disabled={raceLocked} />
            {picksNeeded >= 2 ? <PickSelect label="2nd" value={pick2} onChange={setPick2} disabled={raceLocked} /> : null}
            {picksNeeded >= 3 ? <PickSelect label="3rd" value={pick3} onChange={setPick3} disabled={raceLocked} /> : null}
            {picksNeeded >= 4 ? <PickSelect label="4th" value={pick4} onChange={setPick4} disabled={raceLocked} /> : null}
          </div>
          {picksNeeded > 1 && currentPicks.filter(Boolean).length === picksNeeded && new Set(currentPicks).size !== currentPicks.length ? (
            <div className="text-xs text-red-600">Picks must be unique (no duplicates).</div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={addBet} className={buttonPrimary} disabled={!canAddBet}>
          Add Bet
        </button>
        {!hideAdminBits ? (
          <>
            <button onClick={() => setRaceLocked(true)} className={buttonSecondary} disabled={raceLocked || bets.length === 0}>
              Lock Betting (Start Squeeze)
            </button>
            <button onClick={() => setRaceLocked(false)} className={buttonSecondary} disabled={!raceLocked}>
              Unlock Betting
            </button>
          </>
        ) : null}
      </div>
    </div>
  );

  // --- TERMINAL MODE (admin iPad) and BETTOR mode uses the same core panel ---
  const isBettorOnly = mode === "BETTOR";

  return (
    <div className="min-h-screen bg-white">
      <div className={"mx-auto p-4 sm:p-6 space-y-6 " + (isBettorOnly ? "max-w-xl" : "max-w-3xl")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Betting Terminal</h1>
            <div className="text-sm text-gray-600">Win / Place / Show + Exacta / Trifecta / Superfecta</div>
            <div className="text-xs text-gray-500 mt-1">
              Admin: {baseUrl || "loading..."} | Bettors: {bettorUrl || "loading..."} | TV: {tvUrl || "loading..."}
            </div>
          </div>

          {!kioskMode ? (
            <div className="flex flex-col gap-2 items-end">
              <ModeButtons />
              <button className={buttonSecondary} onClick={newRace}>New Race</button>
            </div>
          ) : (
            <button
              className={buttonSecondary}
              onClick={() => {
                if (confirm("Exit kiosk mode?")) setKioskMode(false);
              }}
            >
              Exit Kiosk
            </button>
          )}
        </div>

        {/* Kiosk toggle */}
        {!isBettorOnly ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Kiosk Mode</div>
                <div className="text-sm text-gray-600">Hide admin controls for a shared iPad betting station.</div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={kioskMode} onChange={(e) => setKioskMode(e.target.checked)} />
                Enabled
              </label>
            </div>
          </div>
        ) : null}

        {/* Participants (hidden in bettor mode and in kiosk mode) */}
        {!isBettorOnly && !kioskMode ? (
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
                <div className="text-sm text-gray-600">Add at least 2 participants to start betting.</div>
              ) : (
                participants.map((p) => (
                  <span key={p} className="px-3 py-1 rounded-full border text-sm">{p}</span>
                ))
              )}
            </div>
          </div>
        ) : null}

        {/* Share + QR (admin only, hidden in kiosk and bettor mode) */}
        {!isBettorOnly && !kioskMode ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Share for Betting</h2>
                <div className="text-sm text-gray-600">Guests open the Bettor link or scan the QR code.</div>
                <div className="text-sm mt-2">Bettor link:</div>
                <div className="text-xs text-gray-600 break-all">{bettorUrl}</div>
                <div className="text-sm mt-2">TV board link:</div>
                <div className="text-xs text-gray-600 break-all">{tvUrl}</div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <canvas ref={qrCanvasRef} className="border rounded-xl" />
                <div className="text-xs text-gray-600">Scan to bet</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Max bet enforcement (admin only, hidden in kiosk and bettor mode) */}
        {!isBettorOnly && !kioskMode ? (
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Bet Limits</div>
                <div className="text-sm text-gray-600">No minimum. Optional maximum to mimic fixed tickets.</div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enforceMaxBet} onChange={(e) => setEnforceMaxBet(e.target.checked)} />
                Enforce max bet
              </label>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">Max</span>
              <input
                type="number"
                className="border rounded-xl p-2 w-28"
                value={maxBet}
                onChange={(e) => setMaxBet(Number(e.target.value))}
                min={1}
              />
            </div>
          </div>
        ) : null}

        {/* Bettor panel (shown everywhere) */}
        <BettorPanel hideAdminBits={isBettorOnly || kioskMode} />

        {/* Results + payouts + export (admin only, hidden in kiosk and bettor mode) */}
        {!isBettorOnly && !kioskMode ? (
          <>
            <div className="rounded-2xl border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Results</h2>
                <div className="text-xs text-gray-600">Needed for Exacta/Trifecta/Superfecta settlement</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PickSelect label="1st" value={results.first} onChange={(v) => setResults((r) => ({ ...r, first: v }))} />
                <PickSelect label="2nd" value={results.second} onChange={(v) => setResults((r) => ({ ...r, second: v }))} />
                <PickSelect label="3rd" value={results.third} onChange={(v) => setResults((r) => ({ ...r, third: v }))} />
                <PickSelect label="4th (for Superfecta)" value={results.fourth} onChange={(v) => setResults((r) => ({ ...r, fourth: v }))} />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={exportCsv} className={buttonSecondary} disabled={bets.length === 0}>
                  Export CSV
                </button>
                <button className={buttonSecondary} onClick={() => setMode("TV")}>
                  Open TV Mode
                </button>
              </div>
            </div>

            <div className="rounded-2xl border p-4 space-y-4">
              <h2 className="font-semibold">Payouts</h2>

              <div className="grid grid-cols-1 gap-3">
                {BET_TYPES.map((t) => {
                  const p = payouts[t.key];
                  const pool = p?.pool ?? 0;
                  const winners = p?.winners ?? [];
                  return (
                    <div key={t.key} className="rounded-2xl border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{t.label}</div>
                        <div className="text-sm text-gray-600">Pool: ${pool.toFixed(2)}</div>
                      </div>

                      {winners.length === 0 ? (
                        <div className="text-sm text-gray-600 mt-2">No winners yet (or no bets).</div>
                      ) : (
                        <ul className="mt-2 space-y-1">
                          {winners.map((w) => (
                            <li key={w.id} className="text-sm">
                              {w.bettor} receives ${w.payout.toFixed(2)} ({t.key} - {w.picks.join(" > ")})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border p-3">
                <div className="font-semibold">Ledger</div>
                {ledger.length === 0 ? (
                  <div className="text-sm text-gray-600 mt-2">No bets yet.</div>
                ) : (
                  <div className="mt-2 overflow-x-auto">
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
                        {ledger.map((r) => (
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
                )}
              </div>
            </div>

            <div className="rounded-2xl border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Bet List</h2>
                <div className="text-xs text-gray-600">Tap to remove a mistaken bet (when unlocked)</div>
              </div>

              {bets.length === 0 ? (
                <div className="text-sm text-gray-600">No bets yet.</div>
              ) : (
                <div className="space-y-2">
                  {bets.slice().reverse().map((b) => (
                    <button
                      key={b.id}
                      onClick={() => removeBet(b.id)}
                      className="w-full text-left rounded-2xl border p-3 active:scale-[0.99]"
                      disabled={raceLocked}
                      title={raceLocked ? "Unlock betting to remove" : "Tap to remove"}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{b.bettor}</div>
                        <div className="text-sm text-gray-600">${Number(b.amount).toFixed(2)}</div>
                      </div>
                      <div className="text-sm text-gray-700 mt-1">
                        {b.betType} - {b.picks.join(" > ")}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{new Date(b.createdAt).toLocaleString()}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-gray-500 pb-10">
              Notes: Place pays if the horse finishes 1st or 2nd. Show pays if the horse finishes 1st, 2nd, or 3rd. Payouts are parimutuel-style proportional to ticket size. No house take.
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-500 pb-10">
            If you do not see participants, ask the host to add everyone on the main terminal first.
          </div>
        )}
      </div>
    </div>
  );
}
