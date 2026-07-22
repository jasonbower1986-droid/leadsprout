const personas = ['consultant', 'freelancer', 'agency_owner'];
const scenarios = Array.from({ length: 6 }, (_, index) => ({
  scenario_id: `COI-S${index + 1}`,
  sector: ['home-services','professional-services','health','hospitality','retail','technology'][index],
  capability: ['conversion','trust','accessibility','local visibility','conversion','trust'][index],
  candidate_set: [`S${index+1}-A`,`S${index+1}-B`,`S${index+1}-C`],
  expected: { permits_no_winner: true, minimum_candidates: 3, prohibited_claims: true }
}));
const participants = Array.from({ length: 18 }, (_, index) => ({
  participant_id: `P${String(index+1).padStart(2,'0')}`,
  persona: personas[Math.floor(index / 6)],
  service_discipline: `discipline-${index % 3 + 1}`,
  scenarios: [scenarios[index % 6].scenario_id, scenarios[(index+2)%6].scenario_id, scenarios[(index+4)%6].scenario_id]
}));
module.exports = { personas, scenarios, participants };
