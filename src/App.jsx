import { useState } from "react";

export default function HorseStyleBettingApp() {
  const [participants, setParticipants] = useState([]);
  const [nameInput, setNameInput] = useState("");
  const [bets, setBets] = useState([]);
  const [betType, setBetType] = useState("WIN");
  const [bettor, setBettor] = useState("");
  const [horse, setHorse] = useState("");
  const [amount, setAmount] = useState(10);
  const [results, setResults] = useState({ win: "", place: "", show: "" });

  const addParticipant = () => {
    if (!nameInput || participants.includes(nameInput)) return;
    setParticipants([...participants, nameInput]);
    setNameInput("");
  };

  const addBet = () => {
    if (!bettor || !horse || !amount) return;
    setBets([...bets, { bettor, horse, amount, betType }]);
  };

  const poolFor = (type) => bets.filter((b) => b.betType === type);

  const payout = (type, winner) => {
    const pool = poolFor(type);
    const total = pool.reduce((s, b) => s + b.amount, 0);
    const winners = pool.filter((b) => b.horse === winner);
    if (winners.length === 0) return [];
    const split = total / winners.length;
    return winners.map((w) => ({ name: w.bettor, amount: split }));
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Horse-Style Betting Tally</h1>

      <div className="space-y-2">
        <h2 className="font-semibold">Participants</h2>
        <div className="flex gap-2">
          <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Name" className="border p-2 rounded" />
          <button onClick={addParticipant} className="px-3 py-2 bg-black text-white rounded">Add</button>
        </div>
        <div>{participants.join(", ")}</div>
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold">Place Bet</h2>
        <div className="grid grid-cols-2 gap-2">
          <select onChange={(e) => setBettor(e.target.value)} className="border p-2 rounded">
            <option value="">Bettor</option>
            {participants.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select onChange={(e) => setHorse(e.target.value)} className="border p-2 rounded">
            <option value="">Horse</option>
            {participants.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select onChange={(e) => setBetType(e.target.value)} className="border p-2 rounded">
            <option>WIN</option>
            <option>PLACE</option>
            <option>SHOW</option>
          </select>
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="border p-2 rounded" />
        </div>
        <button onClick={addBet} className="px-3 py-2 bg-black text-white rounded">Add Bet</button>
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold">Enter Results</h2>
        <div className="grid grid-cols-3 gap-2">
          <select onChange={(e) => setResults({ ...results, win: e.target.value })} className="border p-2 rounded"><option>Win</option>{participants.map((p) => <option key={p}>{p}</option>)}</select>
          <select onChange={(e) => setResults({ ...results, place: e.target.value })} className="border p-2 rounded"><option>Place</option>{participants.map((p) => <option key={p}>{p}</option>)}</select>
          <select onChange={(e) => setResults({ ...results, show: e.target.value })} className="border p-2 rounded"><option>Show</option>{participants.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold">Payouts</h2>
        {["WIN", "PLACE", "SHOW"].map((t) => (
          <div key={t}>
            <strong>{t}</strong>
            <ul>
              {payout(t, results[t.toLowerCase()]).map((p, i) => (
                <li key={i}>{p.name} receives ${p.amount.toFixed(2)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
