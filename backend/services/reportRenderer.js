const { stableJson } = require('./domain-outbox');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function renderReport(model) {
  const payload = stableJson(model);
  const evidence = (model.evidence || []).map(item =>
    `<li><strong>${escapeHtml(item.classification)}</strong> ${escapeHtml(item.provenanceReference)}</li>`
  ).join('');
  const limitations = (model.limitations || []).map(item =>
    `<li>${escapeHtml(item.statement || item)}</li>`
  ).join('');
  return Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(model.judgementTitle)}</title></head>
<body><main data-rendering-contract="${escapeHtml(model.renderingContractVersion)}">
<header><p>System-produced commercial decision briefing</p><h1>${escapeHtml(model.judgementTitle)}</h1>
<p>${escapeHtml(model.judgementSummary)}</p></header>
<section><h2>Confidence</h2><p>${escapeHtml(model.confidenceClassification)}</p>
<p>${escapeHtml(model.confidenceBasis)}</p></section>
<section><h2>Evidence composition</h2><ul>${evidence}</ul></section>
<section><h2>Limitations</h2><ul>${limitations}</ul></section>
<section><h2>Provenance</h2><pre>${escapeHtml(stableJson(model.provenance))}</pre></section>
<footer><p>Checksum verifies these exact artifact bytes only; it does not verify evidence truth.</p>
<script type="application/json" id="report-contract">${escapeHtml(payload)}</script></footer>
</main></body></html>`, 'utf8');
}

module.exports = { renderReport };
