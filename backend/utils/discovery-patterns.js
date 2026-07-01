/**
 * Discovery Pattern Matching Engine (v4.0)
 * Translates technical findings into high-conviction commercial opportunities.
 */

const PATTERN_METADATA = require('../constants/discovery-patterns');

const PATTERNS = [
  {
    ...PATTERN_METADATA.NEGLECTED_DIGITAL_STOREFRONT,
    match: (lead, context) => {
      return context.healthScore < 50 && 
             lead.speed_score < 40 && 
             lead.responsive_status === 'not_responsive';
    }
  },
  {
    ...PATTERN_METADATA.PREMIUM_BUSINESS_BUDGET_SITE,
    match: (lead, context) => {
      const premiumKeywords = ['Premium', 'Luxury', 'Elite', 'High-End', 'Bespoke', 'Exclusive'];
      const isPremiumName = lead.business_name && premiumKeywords.some(k => lead.business_name.includes(k));
      return isPremiumName && context.healthScore < 60;
    }
  },
  {
    ...PATTERN_METADATA.HIGH_TRAFFIC_LOW_CONVERSION,
    match: (lead, context) => {
      const hasAnalytics = lead.trackers_found && lead.trackers_found.includes('Google Analytics');
      const hasConversionGaps = lead.conversion_gaps && (
        lead.conversion_gaps.includes('No clear Call-To-Action (CTA) buttons found') ||
        lead.conversion_gaps.includes('No lead capture form found')
      );
      return hasAnalytics && hasConversionGaps;
    }
  },
  {
    ...PATTERN_METADATA.MOBILE_CONFIDENCE_BREAKDOWN,
    match: (lead, context) => {
      const hasViewportErrors = lead.details && lead.details.mobile_viewport_errors > 0;
      return (lead.responsive_status === 'not_responsive' || hasViewportErrors) &&
             lead.speed_score < 45;
    }
  },
  {
    ...PATTERN_METADATA.COMPETITIVE_NEGLECT,
    match: (lead, context) => {
      if (!context.nicheAvgHealth) return false;
      return context.healthScore < (context.nicheAvgHealth - 15);
    }
  },
  {
    ...PATTERN_METADATA.LOCAL_VISIBILITY_GAP,
    match: (lead, context) => {
      const noSchema = lead.conversion_gaps && lead.conversion_gaps.includes('No Schema.org structured data detected (Local SEO risk)');
      const missingTitle = lead.seo_gaps && lead.seo_gaps.includes('Missing Title Tag');
      return noSchema && missingTitle && lead.address_detected;
    }
  },
  {
    ...PATTERN_METADATA.TRUST_DEFICIT,
    match: (lead, context) => {
      const insecure = lead.seo_gaps && lead.seo_gaps.includes('SSL certificate is missing or invalid (Site loaded over HTTP)');
      const noAddress = !lead.address_detected;
      const trustSensitiveNiches = ['Finance', 'Legal', 'Medical', 'Insurance', 'Real Estate'];
      return insecure || (noAddress && trustSensitiveNiches.includes(lead.niche));
    }
  },
  {
    ...PATTERN_METADATA.BOOKING_FRICTION,
    match: (lead, context) => {
      const urgentNiches = ['HVAC', 'Plumbing', 'Roofing', 'Auto Repair', 'Locksmith', 'Emergency'];
      const noPhone = lead.conversion_gaps && lead.conversion_gaps.includes('No phone number detected for direct contact');
      const noCTA = lead.conversion_gaps && lead.conversion_gaps.includes('No clear Call-To-Action (CTA) buttons found');
      return urgentNiches.includes(lead.niche) && noPhone && noCTA;
    }
  },
  {
    ...PATTERN_METADATA.REPUTATION_LEAKAGE,
    match: (lead, context) => {
      const sociallyDrivenNiches = ['Restaurant', 'Agency', 'Fitness', 'Beauty', 'Retail'];
      const noSocial = lead.conversion_gaps && lead.conversion_gaps.includes('Missing social media links (Trust gap)');
      const missingMeta = lead.seo_gaps && lead.seo_gaps.includes('Missing Meta Description');
      return (sociallyDrivenNiches.includes(lead.niche) || lead.niche === 'General') && noSocial && missingMeta;
    }
  },
  {
    ...PATTERN_METADATA.OUTDATED_CUSTOMER_EXPERIENCE,
    match: (lead, context) => {
      return lead.speed_score < 30 && 
             lead.responsive_status === 'not_responsive' && 
             context.healthScore < 40;
    }
  },
  {
    ...PATTERN_METADATA.AUTHORITY_WITHOUT_CREDIBILITY,
    match: (lead, context) => {
      const highAuthorityNiches = ['Consulting', 'Legal', 'B2B', 'Agency', 'Software'];
      const technicalNeglect = lead.seo_gaps && (
        lead.seo_gaps.includes('Missing Title Tag') || 
        lead.seo_gaps.includes('Slow server response time (TTFB > 1.2s)')
      );
      const noAddress = !lead.address_detected;
      return highAuthorityNiches.includes(lead.niche) && technicalNeglect && noAddress;
    }
  },
  {
    ...PATTERN_METADATA.REVENUE_BOTTLENECK,
    match: (lead, context) => {
      const hasAds = lead.trackers_found && (
        lead.trackers_found.includes('Google Ads') || 
        lead.trackers_found.includes('Facebook Pixel')
      );
      return hasAds && lead.speed_score < 40;
    }
  },
  {
    ...PATTERN_METADATA.DIGITAL_FIRST_IMPRESSION_FAILURE,
    match: (lead, context) => {
      return context.healthScore < 35 && 
             lead.seo_gaps && lead.seo_gaps.includes('Missing Title Tag') && 
             lead.speed_score < 35;
    }
  }
];

/**
 * Identifies all applicable discovery patterns for a lead.
 */
function identifyPatterns(lead, healthScore, nicheAvgHealth = null) {
  const context = { healthScore, nicheAvgHealth };
  
  // Parse fields if they are strings
  const leadObj = { ...lead };
  if (typeof leadObj.seo_gaps === 'string') {
    try {
      leadObj.seo_gaps = JSON.parse(leadObj.seo_gaps);
    } catch (e) {
      leadObj.seo_gaps = [];
    }
  }
  if (typeof leadObj.conversion_gaps === 'string') {
    try {
      leadObj.conversion_gaps = JSON.parse(leadObj.conversion_gaps);
    } catch (e) {
      leadObj.conversion_gaps = [];
    }
  }
  if (typeof leadObj.trackers_found === 'string') {
    try {
      leadObj.trackers_found = JSON.parse(leadObj.trackers_found);
    } catch (e) {
      leadObj.trackers_found = [];
    }
  }

  const matchedPatterns = PATTERNS.filter(p => p.match(leadObj, context));
  
  return matchedPatterns;
}

module.exports = {
  identifyPatterns,
  PATTERNS
};
