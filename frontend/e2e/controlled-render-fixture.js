const estimate = (type, low, high, period) => ({
  type,
  state: 'ESTIMATE',
  value_low: low,
  value_high: high,
  currency: 'GBP',
  period,
  inputs: ['Current estimated conversion rate', 'Estimated monthly traffic', 'Local demand', 'Industry benchmarks'],
  assumptions: ['Current traffic remains stable', 'Conversion improves conditionally'],
  unavailable_information: ['Internal conversion analytics', 'Actual appointment data'],
  method: 'Evidence-bounded scenario range using public observations and controlled benchmarks.',
  confidence: 'MEDIUM',
  evidence_references: ['EVI-CONTROLLED'],
  conditional: true,
  non_guaranteed: true,
});

export const preReviewOpportunity = {
  workspace_id: 'workspace-pre',
  workspace_version: 1,
  candidate_snapshot_id: 'candidate-controlled',
  rank: 1,
  business: {
    subject_id: 'lead-controlled',
    business_name: 'ABC Dental Care',
    domain: 'abcdentalcare.co.uk',
  },
  prioritisation_reason: 'High-potential opportunity to improve patient enquiries and appointment bookings.',
  confidence: 'HIGH',
  confidence_breakdown: {
    evidence_strength: 40,
    market_demand: 30,
    competitive_position: 20,
    data_completeness: 10,
  },
  recommendation: {
    offer_id: 'offer-controlled',
    title: 'Conversion-focused appointment booking optimisation',
    problem_fit: 'Improve the mobile appointment journey and enquiry conversion flow.',
    outcome: 'Plausible improvement in booked appointments and new patient intake.',
    why_first: 'Strong fit with current evidence.',
    assumptions: ['Traffic remains stable'],
    limitations: ['Decision-maker not confirmed'],
    decision: 'ACCEPTED',
    adaptation_text: null,
  },
  estimates: {
    consultant_fee: estimate('CONSULTANT_FEE', 4000, 7000, 'One-off project'),
    client_upside: estimate('CLIENT_UPSIDE', 120000, 180000, 'Annual revenue opportunity'),
  },
  evidence_references: [{ reference_id: 'EVI-CONTROLLED', source_type: 'EVIDENCE_IDENTITY' }],
  decision_basis: {
    assumptions: ['Current traffic remains stable'],
    unavailable_information: ['Internal conversion analytics', 'Actual appointment data'],
    contradictions: [],
    material_limitations: ['Exact internal pricing not confirmed', 'Decision-maker not yet confirmed', 'Revenue estimate based on public evidence'],
    confidence_basis: 'HIGH',
  },
  contact: {
    name: 'Sarah Mitchell',
    role: 'Practice Manager',
    email: 'sarah.mitchell@abcdentalcare.co.uk',
    phone: '+44 161 123 4567',
    domain: 'abcdentalcare.co.uk',
    field_states: {
      business_identity: 'VERIFIED',
      contact_identity: 'VERIFIED',
      contact_role: 'VERIFIED',
      email: 'VERIFIED',
      phone: 'VERIFIED',
      domain: 'VERIFIED',
      decision_authority: 'UNCONFIRMED',
    },
    provenance: {},
  },
  review: {
    review_id: 'review-controlled',
    status: 'INCOMPLETE',
    valid: false,
    completion_id: null,
    completed_at: null,
    limitation_set_digest: 'controlled-digest',
  },
  outreach_eligible: false,
  next_action: null,
};

export const postReviewOpportunity = {
  ...preReviewOpportunity,
  workspace_id: 'workspace-post',
  review: {
    ...preReviewOpportunity.review,
    status: 'COMPLETE',
    valid: true,
    completion_id: 'completion-controlled',
    completed_at: '2026-07-24T10:37:00.000Z',
  },
  outreach_eligible: true,
};

export const opportunityList = [
  preReviewOpportunity,
  {
    ...preReviewOpportunity,
    workspace_id: 'workspace-b',
    rank: 2,
    business: { business_name: 'Elite Fitness Manchester', domain: 'elitefitness.example' },
    recommendation: { ...preReviewOpportunity.recommendation, title: 'Lead generation and enquiry optimisation' },
    review: { status: 'NOT_STARTED', valid: false },
  },
  {
    ...postReviewOpportunity,
    rank: 3,
    business: { business_name: 'Peak Performance Co.', domain: 'peak.example' },
    confidence: 'MEDIUM',
  },
  {
    ...preReviewOpportunity,
    workspace_id: 'workspace-d',
    rank: 4,
    business: { business_name: 'Bright Dental Clinic', domain: 'bright.example' },
    confidence: 'MEDIUM',
    review: { status: 'INVALIDATED', valid: false },
  },
];

export const dashboardFixture = {
  strongest_opportunity: preReviewOpportunity,
  portfolio: { total: 20, priority: 4, reviewed: 7, invalidated: 2 },
  metrics: {
    estimated_consultant_fee_pipeline: { value: '£42,500', source_name: 'Controlled commercial estimates' },
    converted_opportunities: { value: 7, source_name: 'Opportunity review completions' },
    average_consultant_fee: { value: '£6,070', source_name: 'Controlled commercial estimates' },
    attributed_revenue: { value: '£18,400', source_name: 'Authorised CRM attribution' },
  },
  insights: [{ workspace_id: 'workspace-pre', text: 'ABC Dental Care remains the strongest current opportunity.' }],
  activity: [
    { workspace_id: 'workspace-b', text: 'New opportunity discovered — Elite Fitness Manchester' },
    { workspace_id: 'workspace-post', text: 'Review completed — Peak Performance Co.' },
  ],
  follow_ups: [{ action_id: 'a1', type: 'QUALIFY', due_at: 'Tomorrow', state: 'PLANNED' }],
  momentum: {
    state: 'AVAILABLE',
    source_name: 'Controlled commercial attribution',
    points: [18, 26, 35, 42, 55, 64, 72, 88],
  },
};

export const controlledResponses = {
  '/api/config/features': { opportunity_workspace: true },
  '/api/config/personas': {},
  '/api/auth/me': {
    user: {
      id: 'controlled-user',
      email: 'jason.bower@saiphlab.test',
      plan: 'agency',
      unlocks_count: 500,
    },
  },
  '/api/opportunity-workspaces/dashboard': dashboardFixture,
  '/api/opportunity-workspaces': {
    opportunities: opportunityList,
    filters: {},
    ordering: 'SERVER_DERIVED',
  },
  '/api/opportunity-workspaces/workspace-pre/opportunity': preReviewOpportunity,
  '/api/opportunity-workspaces/workspace-post/opportunity': postReviewOpportunity,
};
