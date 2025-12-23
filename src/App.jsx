import { useMemo, useState } from "react";

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
  if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/\"/g, '""')}"`;
  return s;
}

export default function HorseStyleBettingApp() {
  const [participants, setParticipants] = useState([]);
  const [nameInput, setNameInput] = useState("");

  const [bets, setBets] = useState([]);
  const [betType, setBetType] = useState("WIN");
  const [bettor, setBettor] = useState("");
  const [amount, setAmount] = useState(10);

  // picks for multi-leg bets
  const [pick1, setPick1] = useState("");
  const [pick2, setPick2] = useState("");
  const [pick3, setPick3] = useState("");
  const [pick4, setPick4] = useState("");

  const [raceLocked, setRaceLocked] = useState(false);

  // Optional max bet enforcement (no minimum, only a maximum)
  const [enforceMaxBet, setEnforceMaxBet] = useState(true);
  const [maxBet, setMaxBet] = useState(10);

  // Results
  const [results, setResults] = useState({ first: "", second: "", third: "", fourth: "" });

  const addParticipant = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) return;
    setParticipants([...participants, trimmed]);
    setNameInput("");

    // Sensible defaults so the first bet can be entered quickly
    if (!bettor) setBettor(trimmed);
  };

  const picksNeeded = useMemo(() => {
    if (betType === "WIN" || betType === "PLACE" || betType === "SHOW") return 1;
    if (betType === "EXACTA") return 2;
    if (betType === "TRIFECTA") return 3;
    if (betType === "SUPERFECTA") return 4;
    return 1;
  }, [betType]);

  const currentPicks = useMemo(() => {
    const arr = [pick1, pick2, pick3, pick4].slice(0, picksNeeded);
    return arr;
  }, [pick1, pick2, pick3, pick4, picksNeeded]);

  const canAddBet = useMemo(() => {
    if (raceLocked) return false;
    if (!bettor) return false;
    if (!amount || amount <= 0) return false;
    if (enforceMaxBet && amount > maxBet) return false;
    // all picks required
    if (currentPicks.some((p) => !p)) return false;

    // for multi-leg bets, require all unique picks to avoid impossible ordered duplicates
    const uniq = new Set(currentPicks);
    if (uniq.size !== currentPicks.length) return false;

    return true;
  }, [raceLocked, bettor, amount, enforceMaxBet, maxBet, currentPicks]);

  const addBet = () => {
    if (!canAddBet) return;

    setBets([
      ...bets,
      {
        id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        createdAt: new Date().toISOString(),
        bettor,
        amount: Number(amount),
        betType,
        picks: currentPicks,
      },
    ]);
  };

  const poolFor = (type) => bets.filter((b) => b.betType === type);

  const isWinningTicket = (bet, r) => {
    const [a, b, c, d] = bet.picks;

    if (bet.betType === "WIN") return a === r.first;
    if (bet.betType === "PLACE") return a === r.second;
    if (bet.betType === "SHOW") return a === r.third;

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
      if (winners.length === 0 || total === 0) {
        out[t] = { total, winners: [], split: 0 };
      } else {
        const split = total / winners.length;
        out[t] = { total, winners: winners.map((w) => ({ id: w.id, bettor: w.bettor, split })), split };
      }
    }
    return out;
  }, [bets, results]);

  const ledger = useMemo(() => {
    const people = participants.length ? participants : Array.from(new Set(bets.map((b) => b.bettor)));
    const spent = new Map();
    const won = new Map();

    for (const p of people) {
      spent.set(p, 0);
      won.set(p, 0);
    }

    for (const b of bets) {
      spent.set(b.bettor, (spent.get(b.bettor) ?? 0) + b.amount);
    }

    for (const t of Object.keys(payoutsByType)) {
      for (const w of payoutsByType[t].winners) {
        won.set(w.bettor, (won.get(w.bettor) ?? 0) + w.split);
      }
    }

    const rows = people
      .map((p) => {
        const s = spent.get(p) ?? 0;
        const w = won.get(p) ?? 0;
        return { person: p, spent: s, won: w, net: w - s };
      })
      .sort((a, b) => b.net - a.net);

    return rows;
  }, [participants, bets, payoutsByType]);

  const exportCsv = () => {
    const lines = [];
    lines.push(["Race Results", ""].map(csvEscape).join(","));
    lines.push(["1st", results.first].map(csvEscape).join(","));
    lines.push(["2nd", results.second].map(csvEscape).join(","));
    lines.push(["3rd", results.third].map(csvEscape).join(","));
    lines.push(["4th", results.fourth].map(csvEscape).join(","));
    lines.push(["", ""].join(","));

    lines.push(["Ledger", ""].join(","));
    lines.push(["Person", "Spent", "Won", "Net"].map(csvEscape).join(","));
    for (const r of ledger) {
      lines.push([r.person, r.spent.toFixed(2), r.won.toFixed(2), r.net.toFixed(2)].map(csvEscape).join(","));
    }
    lines.push(["", ""].join(","));

    lines.push(["Bets", ""].join(","));
    lines.push(["Time", "Bettor", "Type", "Picks", "Amount"].map(csvEscape).join(","));
    for (const b of bets) {
      lines.push([
        b.createdAt,
        b.bettor,
        b.betType,
        b.picks.join(" > "),
        Number(b.amount).toFixed(2),
      ].map(csvEscape).join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `horse-style-bets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const newRace = () => {
    setBets([]);
    setResults({ first: "", second: "", third: "", fourth: "" });
    setRaceLocked(false);
    setBetType("WIN");
    setPick1("");
    setPick2("");
    setPick3("");
    setPick4("");
    setAmount(10);
  };

  const removeBet = (id) => setBets(bets.filter((b) => b.id !== id));

  const smallSelect = "border rounded-xl p-3 text-base w-full";
  const smallInput = "border rounded-xl p-3 text-base w-full";
  const buttonPrimary = "rounded-xl px-4 py-3 text-base font-semibold bg-black text-white disabled:opacity-40 disabled:cursor-not-allowed";
  const buttonSecondary = "rounded-xl px-4 py-3 text-base font-semibold border";

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

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Horse-Style Betting Tally</h1>
            <div className="text-sm text-gray-600">Win / Place / Show + Exacta / Trifecta / Superfecta</div>
          </div>
          <button onClick={newRace} className={buttonSecondary}>
            New Race
          </button>
        </div>

        <div className="grid gap-6">
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
              <button onClick={addParticipant} className={buttonPrimary}>
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {participants.length === 0 ? (
                <div className="text-sm text-gray-600">Add at least 2 participants to start betting.</div>
              ) : (
                participants.map((p) => (
                  <span key={p} className="px-3 py-1 rounded-full border text-sm">
                    {p}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="font-semibold">Betting</h2>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enforceMaxBet}
                    onChange={(e) => setEnforceMaxBet(e.target.checked)}
                  />
                  Enforce max bet
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">Max</span>
                  <input
                    type="number"
                    className="border rounded-xl p-2 w-24"
                    value={maxBet}
                    onChange={(e) => setMaxBet(Number(e.target.value))}
                    min={1}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Bettor</div>
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
                <select className={smallSelect} value={betType} onChange={(e) => {
                  const t = e.target.value;
                  setBetType(t);
                  setPick1("");
                  setPick2("");
                  setPick3("");
                  setPick4("");
                }} disabled={raceLocked}>
                  {BET_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
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
                {enforceMaxBet && amount > maxBet ? (
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
                {currentPicks.filter(Boolean).length === picksNeeded && new Set(currentPicks).size !== currentPicks.length ? (
                  <div className="text-xs text-red-600">Picks must be unique (no duplicates).</div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={addBet} className={buttonPrimary} disabled={!canAddBet}>
                Add Bet
              </button>
              <button
                onClick={() => setRaceLocked(true)}
                className={buttonSecondary + " disabled:opacity-40 disabled:cursor-not-allowed"}
                disabled={raceLocked || bets.length === 0}
              >
                Lock Betting (Start Squeeze)
              </button>
              <button
                onClick={() => setRaceLocked(false)}
                className={buttonSecondary + " disabled:opacity-40 disabled:cursor-not-allowed"}
                disabled={!raceLocked}
              >
                Unlock Betting
              </button>
            </div>
          </div>

          <div className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Results</h2>
              <div className="text-xs text-gray-600">Enter finish order for multi-leg bets</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PickSelect label="1st" value={results.first} onChange={(v) => setResults((r) => ({ ...r, first: v }))} />
              <PickSelect label="2nd" value={results.second} onChange={(v) => setResults((r) => ({ ...r, second: v }))} />
              <PickSelect label="3rd" value={results.third} onChange={(v) => setResults((r) => ({ ...r, third: v }))} />
              <PickSelect label="4th (only needed for Superfecta)" value={results.fourth} onChange={(v) => setResults((r) => ({ ...r, fourth: v }))} />
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={exportCsv} className={buttonSecondary} disabled={bets.length === 0}>
                Export CSV
              </button>
            </div>
          </div>

          <div className="rounded-2xl border p-4 space-y-4">
            <h2 className="font-semibold">Payouts</h2>

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
              <div className="text-xs text-gray-600">Tap to remove a mistaken bet</div>
            </div>
            {bets.length === 0 ? (
              <div className="text-sm text-gray-600">No bets yet.</div>
            ) : (
              <div className="space-y-2">
                {bets
                  .slice()
                  .reverse()
                  .map((b) => (
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
                      {raceLocked ? (
                        <div className="text-xs text-gray-500 mt-1">Locked</div>
                      ) : (
                        <div className="text-xs text-gray-500 mt-1">Tap to remove</div>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500 pb-10">
            Notes: Pools are split evenly across winning tickets in each bet type. No house take. Place/Show are treated as separate pools for 2nd and 3rd.
          </div>
        </div>
      </div>
    </div>
  );
}

