/**
 * advisor_narratives.js
 * 
 * Motivational sales narratives and discovery patterns for the Business Growth Advisor.
 * Aligned with the LeadSprout Audience & Intelligence Constitution (Commercial-First).
 * Hierarchy: Business -> Behaviour -> Problem -> Opportunity -> Evidence.
 */

const ADVISOR_QUOTES = [
  {
    id: 'hvac_mobile_emergency',
    priority: 0,
    condition: (lead) => (lead.niche === 'HVAC' || lead.niche === 'Plumbing') && lead.responsive_status !== 'responsive',
    quote: "**Emergency Intent Capture.** As a local emergency service provider, your growth depends on capturing high-intent 'distress' calls immediately. However, your current mobile accessibility issues create an invisible wall, causing stressed customers to bounce to competitors. By fixing this 'Mobile Blind Spot', you can immediately reclaim lost high-margin emergency revenue. Our scan identified a critical responsiveness failure that proves this barrier is currently active."
  },
  {
    id: 'legal_authority_gap',
    priority: 0,
    condition: (lead) => (lead.niche === 'Legal' || lead.niche === 'Legal Services') && (lead.speed_score < 60 || lead.responsive_status !== 'responsive'),
    quote: "**High-Stakes Authority Play.** Law firms grow through trust and the projection of absolute professionalism. Right now, your digital presence doesn't match your legal expertise, creating a 'Credibility Gap' that likely kills $10k+ cases before they even contact you. Upgrading your technical authority ensures your first impression matches your courtroom reputation. Evidence: your current loading friction and mobile accessibility are signaling 'unreliability' to potential high-value clients."
  },
  {
    id: 'dental_patient_leak',
    priority: 0,
    condition: (lead) => (lead.niche === 'Dental' || lead.niche === 'Dentist') && lead.speed_score < 70,
    quote: "**Patient Comparison Shield.** Dentistry is a fierce local comparison game where patients choose the practice that feels most modern and accessible. Your growth is likely being capped by a 'Leaky First Impression' that hands new patients to the modern clinic across the street. Optimizing your patient capture path will solidify your position as the #1 local choice. Proof: your site's high loading friction is a silent signal to patients that your practice might be outdated."
  },
  {
    id: 'security_failure',
    priority: 1,
    condition: (lead) => lead.ssl_status === 'missing',
    quote: "**Trust Deficit Recovery.** For a professional service business, digital safety is the foundation of lead generation. A 'Not Secure' warning acts as a major psychological barrier, likely scaring off 40% of inbound leads instantly. By removing this friction, you can immediately salvage the high-value leads you've already worked to attract. Technical finding: your missing SSL certificate is the specific barrier to this trust recovery."
  },
  {
    id: 'mobile_blindness',
    priority: 2,
    condition: (lead) => lead.responsive_status !== 'responsive',
    quote: "**Market Accessibility Play.** Most local business growth is now mobile-first. When a site doesn't scale, the business is effectively 'blind' to 60% of its potential market. Dominating your local niche requires being accessible where your customers are searching. Transitioning to a mobile-responsive architecture will unlock a massive segment of your market that is currently being ignored. Evidence: our scan confirms your site is non-responsive on modern mobile devices."
  },
  {
    id: 'high_friction',
    priority: 3,
    condition: (lead) => lead.speed_score < 50,
    quote: "**Revenue Leak Intervention.** High-growth businesses thrive on efficiency. Right now, you are likely paying for traffic that never even sees your brand because they bounce during the 5+ second wait. Plugging this 'Leaky Bucket' is the fastest and cheapest way to increase your monthly revenue without spending a cent more on marketing. Supporting proof: your speed score is in the bottom tier of your industry, indicating severe revenue-killing friction."
  },
  {
    id: 'missing_contact',
    priority: 4,
    condition: (lead) => lead.no_phone || lead.no_email,
    quote: "**Conversion Path Cleanup.** Digital marketing only works if there is a clear 'Path to Purchase.' You have established a presence, but you've left the front door locked by making your contact info difficult to find. Fixing this 'Invisible Door' is the ultimate quick-win for your growth. Simply making your contact hooks impossible to miss will turn your existing visitors into active buyers. Evidence: our scan could not locate a primary phone number or email hook."
  },
  {
    id: 'conversion_leak',
    priority: 5,
    condition: (lead) => lead.no_cta_found,
    quote: "**Sales Direction Overhaul.** Traffic without direction is a missed commercial opportunity. Your business is successfully attracting visitors, but it lacks a clear 'Call to Action' to move them toward a sale. Implementing a high-conviction conversion architecture will transform your passive website into an active sales machine. Proof: our scan identified a total lack of primary conversion hooks (CTAs) on your homepage."
  },
  {
    id: 'moderate_friction',
    priority: 6,
    condition: (lead) => lead.speed_score >= 50 && lead.speed_score < 70,
    quote: "**Efficiency Edge Play.** In competitive markets, growth is won on the margins. You aren't in the 'danger zone' yet, but you're still losing 1 in 5 potential customers to subtle site sluggishness. A performance sprint will give you a silent competitive advantage over the technical-debt-heavy rivals in your local niche. Supporting evidence: your current loading friction is just above average, leaving significant room for optimization."
  },
  {
    id: 'visibility_gap',
    priority: 7,
    condition: (lead) => lead.meta_tags_missing,
    quote: "**Search Real Estate Recovery.** Local authority is built on being seen for your specific services. Right now, you are hitting a 'Visibility Ceiling' because search engines can't identify your primary value propositions. Reclaiming your rightful search ranking will ensure you capture the organic traffic you've already earned through your reputation. Technical finding: missing meta-tags (Search Hooks) are the primary barrier to your search visibility."
  },
  {
    id: 'authority_gap',
    priority: 8,
    condition: (lead) => lead.schema_missing || lead.no_social_links,
    quote: "**Authority Stacking Strategy.** Dominant businesses signal their leadership through consistent social and technical proof. You have a solid foundation, but you lack the final 10% of 'Authority Markers' that tell both Google and customers that you are #1. Stacking these signals will help you pull away from competitors who are still competing on price alone. Proof: our scan shows a lack of Schema markup and social proof integration."
  },
  {
    id: 'healthy_site',
    priority: 9,
    condition: (lead) => lead.overall_score > 90,
    quote: "**Market Share Aggression.** Your business is technically superior to almost all local rivals. Instead of maintenance, your next growth phase is 'Market Conquest.' You can leverage your technical edge to aggressively steal market share through content and outreach while your competitors are still struggling with technical debt. Evidence: your site is currently outperforming 90% of the market in core health metrics."
  }
];

const JARGON_TRANSLATIONS = {
  seo_score: "Visibility Health",
  speed_score: "Loading Friction",
  responsive_status: "Mobile Accessibility",
  meta_tags: "Search Hooks",
  ssl_status: "Trust & Security",
  headers: "Value Proposition Clarity"
};

module.exports = {
  ADVISOR_QUOTES,
  JARGON_TRANSLATIONS
};
