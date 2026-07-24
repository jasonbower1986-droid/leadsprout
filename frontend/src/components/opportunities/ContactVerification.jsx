const labels = { business_identity: 'Business identity', contact_identity: 'Contact identity', contact_role: 'Role', email: 'Email address', phone: 'Phone number', domain: 'Domain', decision_authority: 'Decision authority' };
export default function ContactVerification({ contact = {} }) {
  const states = contact.field_states || {};
  return <section className="coi-card" aria-labelledby="contact-heading">
    <span className="coi-eyebrow">Recommended initial contact</span><h2 id="contact-heading">{contact.name || 'Contact unavailable'}</h2><p>{contact.role || 'Role not confirmed'}</p>
    <div className="coi-contact-lines"><p>{contact.email || 'Email unavailable'}</p><p>{contact.phone || 'Phone unavailable'}</p><p>{contact.domain || 'Domain unavailable'}</p></div>
    <h3>Verification breakdown</h3>{Object.entries(labels).map(([field, label]) => { const state = states[field] || 'UNCONFIRMED'; return <div className="coi-verification-row" key={field}><span>{label}</span><span className={`coi-status ${state === 'VERIFIED' ? 'success' : 'warning'}`}>{state.replaceAll('_',' ')}</span></div>; })}
    {(states.decision_authority || 'UNCONFIRMED') !== 'VERIFIED' && <div className="coi-warning"><b>Decision authority has not been independently confirmed.</b><p>Confirm the appropriate decision-maker before progressing.</p></div>}
  </section>;
}
