const transitions = ['PREPARE','PURSUE','QUALIFY','RESEARCH','DEFER','DECLINE','ARCHIVE'];
export default function OutreachTransition({ onSelect, busy }) {
  return <section className="coi-card coi-next-action" aria-labelledby="next-action-heading"><span className="coi-eyebrow">Next action</span><h2 id="next-action-heading">You’re ready to begin the conversation.</h2><p>Confirm the appropriate decision-maker. Choosing a next action does not send or record a communication.</p><div className="coi-actions">{transitions.map(value => <button key={value} disabled={busy} onClick={() => onSelect(value)} className="coi-button primary">{value[0] + value.slice(1).toLowerCase()}</button>)}</div></section>;
}
