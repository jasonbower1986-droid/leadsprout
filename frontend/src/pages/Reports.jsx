import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ReportState, ReportUnavailable } from '../components/reports/ReportState';

export default function Reports() {
  const { getHeaders } = useAuth();
  const [view, setView] = useState({ loading: true, reports: [], error: '' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/reports', { headers: getHeaders(), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json()).error || 'Reports unavailable');
        return response.json();
      })
      .then(data => setView({ loading: false, reports: data.reports || [], error: '' }))
      .catch(error => error.name !== 'AbortError' &&
        setView({ loading: false, reports: [], error: error.message }));
    return () => controller.abort();
  }, []);
  return <div className="rpt-page">
    <header className="rpt-page-header"><div><p className="rpt-kicker">Commercial intelligence</p>
      <h1>Reports</h1><p>System-produced decision briefings with immutable versions and inspectable evidence boundaries.</p>
    </div></header>
    {view.loading ? <div className="rpt-loading" aria-live="polite" aria-busy="true">
      <span className="rpt-skeleton"/><span>Loading authorised reports…</span></div>
      : view.error ? <ReportUnavailable state="FAILED" title="Reports could not be loaded" detail={view.error}/>
      : !view.reports.length ? <ReportUnavailable/>
      : <div className="rpt-index">{view.reports.map(report =>
        <article className="rpt-index-card" key={report.report_id}>
          <div className="rpt-icon"><FileText aria-hidden="true"/></div>
          <div><div className="rpt-card-meta"><ReportState state={report.report_state} current={report.current}/>
            <span>Version {report.report_version_sequence}</span></div>
            <h2>{report.subject_display_name || 'Business identity unavailable'}</h2>
            <p>{report.judgement_title || 'Judgement unavailable'}</p>
            {!report.currently_verified && <p className="rpt-muted">
              Historical report · not currently verified. Download and progression are withheld.
            </p>}
            <p className="rpt-muted">{report.confidence_classification} confidence · {report.generated_at ? new Date(report.generated_at).toLocaleString() : 'Completion time unavailable'}</p>
          </div>
          <Link to={`/reports/${encodeURIComponent(report.report_id)}`}>Open report<span className="sr-only"> for {report.subject_display_name || report.report_id}</span></Link>
        </article>)}</div>}
  </div>;
}
