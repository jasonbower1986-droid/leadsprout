import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Filter, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ActivityItem from '../components/activity/ActivityItem';
import { ActivityState } from '../components/activity/ActivityState';

export default function ActivityFeed() {
  const { activityEventId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }), [token]);
  const [view, setView] = useState({ state: 'loading', events: [], cursor: null, boundary: null });
  const load = useCallback(async (cursor = null, append = false) => {
    setView(current => ({ ...current, state: append ? current.state : 'loading' }));
    try {
      const query = cursor ? `?page_size=25&cursor=${encodeURIComponent(cursor)}` : '?page_size=25';
      const response = await fetch(`/api/activity${query}`, { headers: headers() });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      setView(current => ({
        state: data.events.length || append ? 'ready' : 'empty',
        events: append ? [...current.events, ...data.events] : data.events,
        cursor: data.next_cursor,
        boundary: data.history_boundary
      }));
    } catch { setView(current => ({ ...current, state: 'error' })); }
  }, [headers]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useEffect(() => {
    if (!activityEventId) return;
    fetch(`/api/activity/${encodeURIComponent(activityEventId)}/affected-object`, { headers: headers() })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => navigate(data.href, { replace: true }))
      .catch(() => navigate('/activity', { replace: true }));
  }, [activityEventId, headers, navigate]);
  return <article className="act-page">
    <header className="act-header"><div><p className="act-kicker">LeadSprout Intelligence · Material change</p>
      <h1>Change intelligence</h1><p>Understand what changed, why it matters, and what it now permits.</p></div>
      <button type="button" disabled title="No additional authoritative filter is available"><Filter size={17}/>Material events</button></header>
    <section className="act-authority"><div><ShieldCheck/><span>Governed history</span><strong>Material events only</strong></div>
      <p>Activity is projected from authoritative domain events. Internal processing and inferred communication are excluded.</p></section>
    {['loading', 'empty', 'error'].includes(view.state) ? <ActivityState state={view.state} retry={() => load()}/> :
      <><ol className="act-list">{view.events.map(event => <ActivityItem key={event.activity_event_id} event={event}/>)}</ol>
        <footer className="act-footer">{view.cursor
          ? <button type="button" onClick={() => load(view.cursor, true)}>Load earlier activity</button>
          : <p>{view.boundary?.complete ? 'End of currently retained, accessible history.' : 'Additional history may exist outside the visible retention or access boundary.'}</p>}</footer></>}
  </article>;
}
