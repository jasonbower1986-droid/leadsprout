import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const defaults = {
  evidence_density: { value: 'BALANCED', revision: 0, persisted: false },
  reduced_motion: { value: false, revision: 0, persisted: false },
  material_change_notifications: { value: 'ENABLED', revision: 0, persisted: false }
};

export default function Settings() {
  const { getHeaders } = useAuth();
  const [confirmed, setConfirmed] = useState(defaults);
  const [draft, setDraft] = useState(defaults);
  const [readOnly, setReadOnly] = useState({});
  const [status, setStatus] = useState({ kind: 'loading', message: 'Loading settings…' });
  const systemReducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, []
  );

  useEffect(() => {
    fetch('/api/settings/preferences', { headers: getHeaders() })
      .then(async response => {
        if (!response.ok) throw new Error('Settings could not be loaded.');
        return response.json();
      })
      .then(data => {
        setConfirmed(data.preferences);
        setDraft(data.preferences);
        setReadOnly(data.read_only);
        setStatus({ kind: 'saved', message: 'Settings loaded and confirmed.' });
      })
      .catch(() => {
        setStatus({
          kind: 'unsaved',
          message: 'Settings are unavailable. Safe defaults are shown and have not been saved.'
        });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (field, value) => {
    setDraft(current => ({ ...current, [field]: { ...current[field], value } }));
    setStatus({ kind: 'unsaved', message: 'You have unsaved presentation settings.' });
  };

  const save = async field => {
    setStatus({ kind: 'saving', message: `Saving ${field.replaceAll('_', ' ')}…` });
    try {
      const response = await fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          field_name: field,
          field_value: String(draft[field].value),
          expected_revision: confirmed[field].revision
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code || 'SAVE_FAILED');
      const next = {
        value: field === 'reduced_motion'
          ? data.preference.field_value === 'true' : data.preference.field_value,
        revision: data.preference.revision,
        persisted: true
      };
      setConfirmed(current => ({ ...current, [field]: next }));
      setDraft(current => ({ ...current, [field]: next }));
      setStatus({ kind: 'saved', message: 'Preference saved.' });
    } catch {
      setStatus({
        kind: 'error',
        message: 'Save failed. Your selection is retained locally; the last confirmed value is unchanged.'
      });
    }
  };

  return <div className="settings-page">
    <header className="coi-page-header"><div><p className="coi-eyebrow">Governed preferences</p><h1>Settings</h1><p>Change presentation and in-product notification delivery. Evidence and lifecycle meaning cannot be changed here.</p></div></header>
    <p className={`settings-status ${status.kind}`} role="status" aria-live="polite">{status.message}</p>
    <section className="settings-section" aria-labelledby="workspace-settings">
      <h2 id="workspace-settings">Workspace</h2>
      <label>Evidence density<select value={draft.evidence_density.value} onChange={event => change('evidence_density', event.target.value)}><option>COMPACT</option><option>BALANCED</option><option>EXPANDED</option></select></label>
      <button onClick={() => save('evidence_density')}>Save evidence density</button>
    </section>
    <section className="settings-section" aria-labelledby="notification-settings">
      <h2 id="notification-settings">Notifications</h2>
      <label>Material-change in-product notifications<select value={draft.material_change_notifications.value} onChange={event => change('material_change_notifications', event.target.value)}><option>ENABLED</option><option>DISABLED</option></select></label>
      <p>No external message or communication is sent by this preference.</p>
      <button onClick={() => save('material_change_notifications')}>Save notification preference</button>
    </section>
    <section className="settings-section" aria-labelledby="accessibility-settings">
      <h2 id="accessibility-settings">Accessibility</h2>
      <label className="settings-check"><input type="checkbox" checked={draft.reduced_motion.value} onChange={event => change('reduced_motion', event.target.checked)}/> Reduce non-essential motion</label>
      {systemReducedMotion && <p>Operating-system reduced motion is active and takes precedence.</p>}
      <button onClick={() => save('reduced_motion')}>Save motion preference</button>
      <p>{readOnly.accessibility_target || 'LeadSprout targets WCAG 2.2 AA. This is a target, not a certification.'}</p>
    </section>
    <section className="settings-section readonly" aria-labelledby="governed-information">
      <h2 id="governed-information">Data &amp; provenance</h2>
      <p>{readOnly.data_provenance_summary || 'Provenance information is temporarily unavailable.'}</p>
      <h2>Roles</h2>
      <p>{readOnly.role_assignment_summary || 'Role information is temporarily unavailable and cannot be changed here.'}</p>
      <h2>Feature state</h2>
      <p>{readOnly.feature_state === 'ENABLED' ? 'Enabled' : 'Disabled or unavailable'}</p>
    </section>
  </div>;
}
