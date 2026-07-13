import { useEffect, useState } from 'react';
import './App.css';

const MODES = ['My Queue', 'Assign', 'Move', 'Triage'] as const;
type Mode = (typeof MODES)[number];

export default function App() {
  const [mode, setMode] = useState<Mode>('My Queue');
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setHealth(d.ok ? 'ok' : 'down'))
      .catch(() => setHealth('down'));
  }, []);

  return (
    <>
      <header className="menubar">
        <div className="logo">
          MET<span>S</span>
        </div>
        <nav>
          <a className="active" href="#">Queue</a>
          <a href="#">Dashboards</a>
          <a href="#">Knowledge Base</a>
          <a href="#">Admin</a>
        </nav>
        <div className="spacer" />
        <input className="search" placeholder="Search tickets… (T-10042, requester, text)" />
      </header>

      <div className="modebar">
        {MODES.map((m) => (
          <button
            key={m}
            className={m === mode ? (m === 'Triage' ? 'active accent' : 'active') : ''}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      <main className="queue-area">
        <div className="queue-panel">
          <h2>Ticket queue</h2>
          <p>
            Mode: <strong>{mode}</strong> — queue board lands here (Day 2–3).
          </p>
          <span className={`status-pill ${health === 'ok' ? 'ok' : 'down'}`}>
            API {health === 'checking' ? 'checking…' : health === 'ok' ? 'connected' : 'unreachable'}
          </span>
        </div>
      </main>
    </>
  );
}
