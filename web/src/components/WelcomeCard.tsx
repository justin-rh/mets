import { useState } from 'react';

/**
 * First-visit orientation for people landing on the board cold (judges,
 * new agents). Dismissal sticks per browser via localStorage.
 */
export function WelcomeCard() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('mets-welcome-dismissed') === '1',
  );
  if (dismissed) return null;

  return (
    <div className="welcome-card">
      <div className="welcome-head">
        <h3>👋 Welcome to METS — Master Electronics' ticketing system</h3>
        <button
          className="welcome-close"
          title="Dismiss"
          onClick={() => {
            localStorage.setItem('mets-welcome-dismissed', '1');
            setDismissed(true);
          }}
        >
          ✕
        </button>
      </div>
      <p>
        Every ticket below was routed, prioritized, and summarized by <strong>SOTO</strong>,
        the built-in AI triage engine — no category pickers, no assignment rules to maintain.
        A few things worth trying:
      </p>
      <ul>
        <li><strong>File a ticket</strong> (+ New Ticket, top right) and watch SOTO route it in seconds — a pasted screenshot or a ticket in Spanish both work.</li>
        <li><strong>Open Dashboards</strong> for the AI accuracy scoreboard and what every AI call costs.</li>
        <li><strong>Drag a ticket</strong> to a different queue — corrections train the router.</li>
        <li><strong>Press ⚠️ Incident Demo</strong> (top bar) to simulate an outage — three similar reports hit the queue and SOTO declares a suspected incident within a few minutes.</li>
      </ul>
    </div>
  );
}
