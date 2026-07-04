/**
 * v5.3 Independent Investigation Engine
 *
 * Platform-reusable diagnostic module that scores 4 core digital dimensions:
 * 1. Accessibility/Speed
 * 2. Trust/Credibility
 * 3. Conversion Optimization
 * 4. Local SEO/Search
 *
 * Each dimension gets a dynamic commercial severity score (0–10) that varies
 * relative to the business's niche transaction model.
 */

// Severity weights per transaction model for each diagnostic signal
const SEVERITY_TABLE = {
  // Accessibility/Speed dimension
  slow_speed: { Urgent: 9, Deliberate: 7, Hybrid: 8 },
  not_responsive: { Urgent: 10, Deliberate: 8, Hybrid: 9 },
  // Trust/Credibility dimension
  missing_ssl: { Urgent: 5, Deliberate: 9, Hybrid: 7 },
  no_address: { Urgent: 4, Deliberate: 8, Hybrid: 6 },
  // Conversion Optimization dimension
  no_phone: { Urgent: 10, Deliberate: 3, Hybrid: 7 },
  no_cta: { Urgent: 8, Deliberate: 6, Hybrid: 7 },
  no_lead_capture: { Urgent: 7, Deliberate: 9, Hybrid: 8 },
  // Local SEO/Search dimension
  no_schema: { Urgent: 5, Deliberate: 8, Hybrid: 6 },
  missing_title: { Urgent: 6, Deliberate: 9, Hybrid: 7 },
  missing_meta: { Urgent: 4, Deliberate: 7, Hybrid: 5 },
  no_social: { Urgent: 3, Deliberate: 6, Hybrid: 4 },
};

/**
 * Resolve severity weight for a given signal and transaction model.
 * Falls back to Deliberate weights if model unknown.
 */
function getSeverity(signalId, transactionModel) {
  const row = SEVERITY_TABLE[signalId];
  if (!row) return 5; // default medium severity
  return row[transactionModel] || row.Deliberate;
}

/**
 * Score the Accessibility/Speed dimension.
 * Returns { score: 0-10, findings: [], severity: 'low'|'medium'|'high'|'critical' }
 */
function assessAccessibility(lead, transactionModel) {
  const findings = [];
  const speed = lead.speed_score || 50;
  const isResponsive = lead.responsive_status === 'responsive';

  if (speed < 30) {
    findings.push({ signal: 'slow_speed', detail: `Speed score ${speed}/100 — critical`, severity: getSeverity('slow_speed', transactionModel) });
  } else if (speed < 50) {
    findings.push({ signal: 'slow_speed', detail: `Speed score ${speed}/100 — poor`, severity: getSeverity('slow_speed', transactionModel) });
  } else if (speed < 70) {
    findings.push({ signal: 'slow_speed', detail: `Speed score ${speed}/100 — moderate`, severity: Math.round(getSeverity('slow_speed', transactionModel) * 0.6) });
  }

  if (!isResponsive) {
    findings.push({ signal: 'not_responsive', detail: 'Site is not mobile-responsive', severity: getSeverity('not_responsive', transactionModel) });
  }

  const maxSeverity = findings.length > 0 ? Math.max(...findings.map(f => f.severity)) : 0;
  // Composite score: weighted average of findings + baseline deduction
  let rawScore = findings.reduce((sum, f) => sum + f.severity, 0);
  const findingCount = findings.length || 1;
  const composite = Math.round(rawScore / findingCount);

  return {
    score: Math.min(10, composite),
    findings,
    maxSeverity,
    label: severityLabel(maxSeverity)
  };
}

/**
 * Score the Trust/Credibility dimension.
 */
function assessTrust(lead, transactionModel, seoGaps) {
  const findings = [];
  const gapSet = new Set(seoGaps.map(g => typeof g === 'string' ? g : g.name || ''));

  const hasSSLIssue = gapSet.has('SSL certificate is missing or invalid (Site loaded over HTTP)');
  const hasAddress = Boolean(lead.address_detected);

  if (hasSSLIssue) {
    findings.push({ signal: 'missing_ssl', detail: 'SSL certificate missing or invalid', severity: getSeverity('missing_ssl', transactionModel) });
  }
  if (!hasAddress) {
    findings.push({ signal: 'no_address', detail: 'No physical address detected', severity: getSeverity('no_address', transactionModel) });
  }

  const maxSeverity = findings.length > 0 ? Math.max(...findings.map(f => f.severity)) : 0;
  const composite = findings.length > 0
    ? Math.round(findings.reduce((sum, f) => sum + f.severity, 0) / findings.length)
    : 0;

  return {
    score: Math.min(10, composite),
    findings,
    maxSeverity,
    label: severityLabel(maxSeverity)
  };
}

/**
 * Score the Conversion Optimization dimension.
 */
function assessConversion(lead, transactionModel, convGaps) {
  const findings = [];
  const gapSet = new Set(convGaps.map(g => typeof g === 'string' ? g : g.name || ''));

  const hasPhoneGap = gapSet.has('No phone number detected for direct contact');
  const hasCTAGap = gapSet.has('No clear Call-To-Action (CTA) buttons found');
  const hasLeadCaptureGap = gapSet.has('No lead capture form found');

  if (hasPhoneGap) {
    findings.push({ signal: 'no_phone', detail: 'No phone number detected', severity: getSeverity('no_phone', transactionModel) });
  }
  if (hasCTAGap) {
    findings.push({ signal: 'no_cta', detail: 'No clear Call-To-Action found', severity: getSeverity('no_cta', transactionModel) });
  }
  if (hasLeadCaptureGap) {
    findings.push({ signal: 'no_lead_capture', detail: 'No lead capture form found', severity: getSeverity('no_lead_capture', transactionModel) });
  }

  const maxSeverity = findings.length > 0 ? Math.max(...findings.map(f => f.severity)) : 0;
  const composite = findings.length > 0
    ? Math.round(findings.reduce((sum, f) => sum + f.severity, 0) / findings.length)
    : 0;

  return {
    score: Math.min(10, composite),
    findings,
    maxSeverity,
    label: severityLabel(maxSeverity)
  };
}

/**
 * Score the Local SEO/Search dimension.
 */
function assessLocalSEO(lead, transactionModel, seoGaps, convGaps) {
  const findings = [];
  const seoSet = new Set(seoGaps.map(g => typeof g === 'string' ? g : g.name || ''));
  const convSet = new Set(convGaps.map(g => typeof g === 'string' ? g : g.name || ''));

  const hasSchemaGap = convSet.has('No Schema.org structured data detected (Local SEO risk)');
  const hasTitleGap = seoSet.has('Missing Title Tag');
  const hasMetaGap = seoSet.has('Missing Meta Description');
  const hasSocialGap = convSet.has('Missing social media links (Trust gap)');

  if (hasSchemaGap) {
    findings.push({ signal: 'no_schema', detail: 'No Schema.org structured data found', severity: getSeverity('no_schema', transactionModel) });
  }
  if (hasTitleGap) {
    findings.push({ signal: 'missing_title', detail: 'Missing Title Tag', severity: getSeverity('missing_title', transactionModel) });
  }
  if (hasMetaGap) {
    findings.push({ signal: 'missing_meta', detail: 'Missing Meta Description', severity: getSeverity('missing_meta', transactionModel) });
  }
  if (hasSocialGap) {
    findings.push({ signal: 'no_social', detail: 'No social media links found', severity: getSeverity('no_social', transactionModel) });
  }

  const maxSeverity = findings.length > 0 ? Math.max(...findings.map(f => f.severity)) : 0;
  const composite = findings.length > 0
    ? Math.round(findings.reduce((sum, f) => sum + f.severity, 0) / findings.length)
    : 0;

  return {
    score: Math.min(10, composite),
    findings,
    maxSeverity,
    label: severityLabel(maxSeverity)
  };
}

function severityLabel(severity) {
  if (severity >= 8) return 'critical';
  if (severity >= 6) return 'high';
  if (severity >= 3) return 'medium';
  if (severity > 0) return 'low';
  return 'none';
}

/**
 * Run the full investigation on a lead.
 * Returns a structured diagnostic report with all 4 dimensions scored.
 *
 * @param {Object} lead - Lead object with speed_score, responsive_status, etc.
 * @param {Object} context - Classified context (must include transactionModel)
 * @returns {Object} investigation report
 */
function investigate(lead, context) {
  const transactionModel = context.transactionModel || 'Deliberate';
  
  // Parse gap arrays safely
  const seoGaps = Array.isArray(lead.seo_gaps) ? lead.seo_gaps : [];
  const convGaps = Array.isArray(lead.conversion_gaps) ? lead.conversion_gaps : [];

  const accessibility = assessAccessibility(lead, transactionModel);
  const trust = assessTrust(lead, transactionModel, seoGaps);
  const conversion = assessConversion(lead, transactionModel, convGaps);
  const localSEO = assessLocalSEO(lead, transactionModel, seoGaps, convGaps);

  // Overall commercial health score (0-100) inversed from dimension averages
  const dimensionScores = [accessibility.score, trust.score, conversion.score, localSEO.score];
  const avgSeverity = dimensionScores.reduce((a, b) => a + b, 0) / dimensionScores.length;
  const healthScore = Math.max(0, Math.round(100 - (avgSeverity / 10) * 100));

  return {
    dimensions: {
      accessibility,
      trust,
      conversion,
      localSEO
    },
    overall: {
      healthScore,
      severity: severityLabel(Math.round(avgSeverity)),
      criticalFindings: [
        ...accessibility.findings.filter(f => f.severity >= 8),
        ...trust.findings.filter(f => f.severity >= 8),
        ...conversion.findings.filter(f => f.severity >= 8),
        ...localSEO.findings.filter(f => f.severity >= 8)
      ],
      totalFindings: accessibility.findings.length + trust.findings.length + conversion.findings.length + localSEO.findings.length
    },
    scoredForModel: transactionModel
  };
}

module.exports = {
  investigate,
  assessAccessibility,
  assessTrust,
  assessConversion,
  assessLocalSEO,
  SEVERITY_TABLE
};