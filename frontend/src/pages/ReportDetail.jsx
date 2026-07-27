import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import EvidenceComposition from '../components/reports/EvidenceComposition';
import { ReportState, ReportUnavailable } from '../components/reports/ReportState';

export default function ReportDetail() {
  const { reportId, reportVersionId } = useParams();
  const { getHeaders } = useAuth();
  const [view, setView] = useState({ loading: true, report: null, error: '' });
  const [downloadState, setDownloadState] = useState('');
  const endpoint = reportVersionId
    ? `/api/reports/${encodeURIComponent(reportId)}/versions/${encodeURIComponent(reportVersionId)}`
    : `/api/reports/${encodeURIComponent(reportId)}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { headers: getHeaders(), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Report unavailable or restricted' : (await response.json()).error);
        return response.json();
      }).then(data => setView({ loading: false, report: data.report, error: '' }))
      .catch(error => error.name !== 'AbortError' && setView({ loading: false, report: null, error: error.message }));
    return () => controller.abort();
  }, [endpoint]);
  if (view.loading) return <div className="rpt-loading" aria-live="polite" aria-busy="true"><span className="rpt-skeleton"/>Loading report…</div>;
  if (!view.report) return <ReportUnavailable state={view.error.includes('restricted') ? 'RESTRICTED' : 'FAILED'} title="Report unavailable" detail={view.error}/>;
  const report = view.report;
  const downloadable = report.download_allowed === true;
  const downloadArtifact = async () => {
    setDownloadState('Downloading verified bytes…');
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(report.report_id)}/versions/${encodeURIComponent(report.report_version_id)}/artifact`, { headers: getHeaders() });
      if (!response.ok) throw new Error((await response.json()).error || 'Download unavailable');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `report-v${report.report_version_sequence}.html`;
      anchor.click(); URL.revokeObjectURL(url); setDownloadState('Download complete');
    } catch (error) { setDownloadState(error.message); }
  };
  return <article className="rpt-page rpt-detail">
    <nav aria-label="Breadcrumb"><Link to="/reports">Reports</Link><span>/</span><span>Version {report.report_version_sequence}</span></nav>
    <header className="rpt-detail-hero"><div><p className="rpt-kicker">System-produced commercial decision briefing</p>
      <div className="rpt-card-meta"><ReportState state={report.report_state} current={report.current}/><span>Version {report.report_version_sequence}</span></div>
      <h1>{report.judgement?.subject_display_name || 'Business identity unavailable'}</h1>
      <p className="rpt-thesis">{report.judgement?.title || 'Judgement unavailable'}</p>
      <p>{report.judgement?.summary || 'A bounded summary is unavailable for this version.'}</p>
    </div><aside><p>Confidence</p><strong>{report.confidence.classification}</strong><span>{report.confidence.basis}</span></aside></header>
    {!report.currently_verified &&
      <section className="rpt-notice limitation" role="status"><strong>Evidence Integrity blocked</strong>
        <p>Historical report data remains readable but is not currently verified. Download and progression are withheld.</p>
      </section>}
    {report.historical &&
      <section className="rpt-notice" role="status"><strong>Historical version</strong><p>This version remains readable but is not the current authority.</p></section>}
    {report.report_state === 'PARTIAL_EVIDENCE' &&
      <section className="rpt-notice limitation" role="status"><strong>Partial evidence</strong><p>Specified evidence or outcome information is unavailable. Unsupported conclusions are withheld.</p></section>}
    <div className="rpt-detail-grid"><EvidenceComposition composition={report.evidence_composition}/>
      <section className="rpt-card"><p className="rpt-kicker">Authority path</p><h2>Provenance</h2>
        <dl className="rpt-provenance"><div><dt>Workspace</dt><dd>{report.workspace_id} · version {report.workspace_version}</dd></div>
          <div><dt>Policy</dt><dd>{report.policy_version}</dd></div><div><dt>Generated</dt><dd>{report.generated_at ? new Date(report.generated_at).toLocaleString() : 'Unavailable'}</dd></div></dl>
        <pre>{report.provenance ? JSON.stringify(report.provenance, null, 2) : 'Provenance unavailable'}</pre>
      </section></div>
    <section className="rpt-card"><p className="rpt-kicker">Boundaries</p><h2>Limitations and contradictions</h2>
      {!report.limitations.length && !report.contradictions.length ? <p>None recorded for the evaluated complete set.</p> :
        <div className="rpt-boundaries"><ul>{report.limitations.map((item, index) => <li key={item.id || index}>{item.statement || String(item)}</li>)}</ul>
          <ul>{report.contradictions.map((item, index) => <li key={item.id || index}>{item.statement || String(item)}</li>)}</ul></div>}
    </section>
    <section className="rpt-card rpt-artifact"><div><ShieldCheck aria-hidden="true"/><div><p className="rpt-kicker">Artifact byte identity</p><h2>{report.artifact.state}</h2>
      <p>{report.artifact.checksum_meaning}</p>{report.artifact.checksum && <code>{report.artifact.checksum}</code>}</div></div>
      {downloadable ? <button type="button" className="rpt-download" onClick={downloadArtifact}><Download size={18}/>Download immutable artifact</button>
        : <span className="rpt-disabled">Download unavailable</span>}</section>
    {downloadState && <p className="rpt-download-status" role="status">{downloadState}</p>}
    <section className="rpt-card"><p className="rpt-kicker">Version history</p><h2>Report lineage</h2>
      <ol className="rpt-history">{report.history.map(version => <li key={version.report_version_id}>
        <Link to={`/reports/${encodeURIComponent(report.report_id)}/versions/${encodeURIComponent(version.report_version_id)}`}>Version {version.report_version_sequence}</Link>
        <ReportState state={version.report_state} current={Boolean(version.current)}/><time>{version.generated_at ? new Date(version.generated_at).toLocaleString() : 'Unavailable'}</time>
      </li>)}</ol></section>
  </article>;
}
