const { generateNarrative } = require('./backend/services/narrativeService');

const sampleLeads = [
  {
    business_name: 'Miami HVAC Pros',
    niche: 'HVAC',
    speed_score: 45,
    responsive_status: 'non-responsive',
    seo_gaps: JSON.stringify(['missing_meta_tags', 'no_h1']),
    location: 'Miami, FL'
  },
  {
    business_name: 'Smith & Associates',
    niche: 'Legal Services',
    speed_score: 55,
    responsive_status: 'responsive',
    seo_gaps: JSON.stringify(['no_schema']),
    location: 'Chicago, IL'
  },
  {
    business_name: 'Healthy Smiles Dental',
    niche: 'Dentist',
    speed_score: 85,
    responsive_status: 'responsive',
    seo_gaps: JSON.stringify(['missing_meta_tags']),
    location: 'Austin, TX'
  }
];

const personas = ['web_agency', 'freelancer', 'seo_consultant', 'cold_email_agency'];

sampleLeads.forEach(lead => {
  console.log(`\n--- LEAD: ${lead.business_name} (${lead.niche}) ---`);
  personas.forEach(persona => {
    const narrative = generateNarrative(lead, persona, { company_name: 'GrowthGurus' });
    console.log(`\n[PERSONA: ${persona}]`);
    console.log(`Urgency Label: ${narrative.pitch_urgency_label}`);
    console.log(`Summary: ${narrative.executive_summary}`);
    console.log(`Primary Hook: ${narrative.hook}`);
    console.log(`CTA: ${narrative.cta}`);
  });
});
