/**
 * Phase 1.2: Technical Gap Metadata
 * Maps technical signals to business impact and implementation difficulty.
 */
module.exports = {
  SEO_GAPS: {
    'Missing Meta Description': { impact: 'High', difficulty: 'Low', category: 'SEO Foundations' },
    'Multiple H1 Headers (2)': { impact: 'Medium', difficulty: 'Low', category: 'SEO Foundations' },
    '3 images missing descriptive alt tags': { impact: 'Medium', difficulty: 'Low', category: 'SEO Foundations' },
    'Missing mobile-responsive viewport meta tags': { impact: 'High', difficulty: 'Low', category: 'Mobile UX' },
    'Slow server response time (TTFB > 1.2s)': { impact: 'High', difficulty: 'High', category: 'Performance' },
    'Missing Title Tag': { impact: 'High', difficulty: 'Low', category: 'SEO Foundations' },
    'No H1 Header Found': { impact: 'High', difficulty: 'Low', category: 'SEO Foundations' }
  },
  CONVERSION_GAPS: {
    'No clear Call-To-Action (CTA) buttons found': { impact: 'High', difficulty: 'Low', category: 'Conversion' },
    'No phone number detected for direct contact': { impact: 'High', difficulty: 'Low', category: 'Conversion' },
    'Missing social media links (Trust gap)': { impact: 'Low', difficulty: 'Low', category: 'Trust' },
    'No Schema.org structured data detected (Local SEO risk)': { impact: 'Medium', difficulty: 'Medium', category: 'Local SEO' }
  }
};
