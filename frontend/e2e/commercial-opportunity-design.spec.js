/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import fs from 'node:fs';

const evidenceDir = process.env.COI_EVIDENCE_DIR || path.resolve('../outputs/commercial-opportunity-design');
fs.mkdirSync(evidenceDir, {recursive:true});
const estimate = (type, low, high, period) => ({ type, state:'ESTIMATE', value_low:low, value_high:high, currency:'GBP', period, inputs:['Current estimated conversion rate','Estimated monthly traffic','Local demand','Industry benchmarks'], assumptions:['Current traffic remains stable','Conversion improves conditionally'], unavailable_information:['Internal conversion analytics','Actual appointment data'], method:'Evidence-bounded scenario range using public observations and controlled benchmarks.', confidence:'MEDIUM', evidence_references:['EVI-CONTROLLED'], conditional:true, non_guaranteed:true });
const baseOpportunity = {
  workspace_id:'workspace-pre', workspace_version:1, candidate_snapshot_id:'candidate-controlled', rank:1,
  business:{subject_id:'lead-controlled',business_name:'ABC Dental Care',domain:'abcdentalcare.co.uk'},
  prioritisation_reason:'High-potential opportunity to improve patient enquiries and appointment bookings.',
  confidence:'HIGH', confidence_breakdown:{evidence_strength:40,market_demand:30,competitive_position:20,data_completeness:10},
  recommendation:{offer_id:'offer-controlled',title:'Conversion-focused appointment booking optimisation',problem_fit:'Improve the mobile appointment journey and enquiry conversion flow.',outcome:'Plausible improvement in booked appointments and new patient intake.',why_first:'Strong fit with current evidence.',assumptions:['Traffic remains stable'],limitations:['Decision-maker not confirmed'],decision:'ACCEPTED',adaptation_text:null},
  estimates:{consultant_fee:estimate('CONSULTANT_FEE',4000,7000,'One-off project'),client_upside:estimate('CLIENT_UPSIDE',120000,180000,'Annual revenue opportunity')},
  evidence_references:[{reference_id:'EVI-CONTROLLED',source_type:'EVIDENCE_IDENTITY'}],
  decision_basis:{assumptions:['Current traffic remains stable'],unavailable_information:['Internal conversion analytics','Actual appointment data'],contradictions:[],material_limitations:['Exact internal pricing not confirmed','Decision-maker not yet confirmed','Revenue estimate based on public evidence'],confidence_basis:'HIGH'},
  contact:{name:'Sarah Mitchell',role:'Practice Manager',email:'sarah.mitchell@abcdentalcare.co.uk',phone:'+44 161 123 4567',domain:'abcdentalcare.co.uk',field_states:{business_identity:'VERIFIED',contact_identity:'VERIFIED',contact_role:'VERIFIED',email:'VERIFIED',phone:'VERIFIED',domain:'VERIFIED',decision_authority:'UNCONFIRMED'},provenance:{}},
  review:{review_id:'review-controlled',status:'INCOMPLETE',valid:false,completion_id:null,completed_at:null,limitation_set_digest:'controlled-digest'},
  outreach_eligible:false,next_action:null
};
const postOpportunity = {...baseOpportunity,workspace_id:'workspace-post',review:{...baseOpportunity.review,status:'COMPLETE',valid:true,completion_id:'completion-controlled',completed_at:'2026-07-24T10:37:00.000Z'},outreach_eligible:true};
const opportunities = [baseOpportunity,{...baseOpportunity,workspace_id:'workspace-b',rank:2,business:{business_name:'Elite Fitness Manchester',domain:'elitefitness.example'},confidence:'HIGH',review:{status:'NOT_STARTED',valid:false},recommendation:{...baseOpportunity.recommendation,title:'Lead generation and enquiry optimisation'}},{...postOpportunity,rank:3,business:{business_name:'Peak Performance Co.',domain:'peak.example'},confidence:'MEDIUM'},{...baseOpportunity,workspace_id:'workspace-d',rank:4,business:{business_name:'Bright Dental Clinic',domain:'bright.example'},confidence:'MEDIUM',review:{status:'INVALIDATED',valid:false}}];
const dashboard = { strongest_opportunity:baseOpportunity,portfolio:{total:20,priority:4,reviewed:7,invalidated:2},metrics:{estimated_consultant_fee_pipeline:{value:'£42,500',source_name:'Controlled commercial estimates'},converted_opportunities:{value:7,source_name:'Opportunity review completions'},average_consultant_fee:{value:'£6,070',source_name:'Controlled commercial estimates'},attributed_revenue:{value:'£18,400',source_name:'Authorised CRM attribution'}},insights:[{workspace_id:'workspace-pre',text:'ABC Dental Care remains the strongest current opportunity.'}],activity:[{workspace_id:'workspace-b',text:'New opportunity discovered — Elite Fitness Manchester'},{workspace_id:'workspace-post',text:'Review completed — Peak Performance Co.'}],follow_ups:[{action_id:'a1',type:'QUALIFY',due_at:'Tomorrow',state:'PLANNED'}],momentum:{state:'AVAILABLE',source_name:'Controlled commercial attribution',points:[18,26,35,42,55,64,72,88]}};

async function controlledPage(page) {
  await page.addInitScript(() => localStorage.setItem('token','controlled-render-token'));
  await page.route('**/api/config/features', route => route.fulfill({json:{opportunity_workspace:true}}));
  await page.route('**/api/config/personas', route => route.fulfill({json:{}}));
  await page.route('**/api/auth/me', route => route.fulfill({json:{user:{id:'controlled-user',email:'jason.bower@saiphlab.test',plan:'agency',unlocks_count:500}}}));
  await page.route('**/api/opportunity-workspaces/dashboard', route => route.fulfill({json:dashboard}));
  await page.route('**/api/opportunity-workspaces', route => route.fulfill({json:{opportunities,filters:{},ordering:'SERVER_DERIVED'}}));
  await page.route('**/api/opportunity-workspaces/workspace-pre/opportunity', route => route.fulfill({json:baseOpportunity}));
  await page.route('**/api/opportunity-workspaces/workspace-post/opportunity', route => route.fulfill({json:postOpportunity}));
  await page.route('**/api/opportunity-workspaces/**', route => route.fulfill({json:{communication_sent:false,transition_type:'PREPARE'}}));
}
async function capture(page, route, file, width, height, nav) {
  await page.setViewportSize({width,height}); await page.goto(route); await expect(page.getByRole('heading',{level:1})).toBeVisible();
  if (width < 1024) { await page.getByRole('button',{name:'Open navigation'}).click(); await expect(page.getByRole('link',{name:nav,exact:true})).toHaveAttribute('aria-current','page'); }
  else await expect(page.getByRole('link',{name:nav,exact:true})).toHaveAttribute('aria-current','page');
  const results = await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(item => ['serious','critical'].includes(item.impact))).toEqual([]);
  await page.screenshot({path:path.join(evidenceDir,file),fullPage:false});
}
test.beforeEach(async ({page}) => controlledPage(page));
test('dashboard desktop', async ({page}) => capture(page,'/dashboard','dashboard-desktop.png',1224,1285,'Home'));
test('dashboard mobile', async ({page}) => capture(page,'/dashboard','dashboard-mobile.png',390,844,'Home'));
test('opportunities desktop', async ({page}) => capture(page,'/opportunities','opportunities-desktop.png',1536,1024,'Opportunities'));
test('opportunities mobile', async ({page}) => capture(page,'/opportunities','opportunities-mobile.png',390,844,'Opportunities'));
test('pre-review desktop', async ({page}) => capture(page,'/opportunities/workspace-pre','pre-review-desktop.png',1536,1024,'Opportunities'));
test('pre-review mobile', async ({page}) => capture(page,'/opportunities/workspace-pre','pre-review-mobile.png',390,844,'Opportunities'));
test('post-review desktop', async ({page}) => capture(page,'/opportunities/workspace-post','post-review-desktop.png',1536,1024,'Opportunities'));
test('post-review mobile', async ({page}) => capture(page,'/opportunities/workspace-post','post-review-mobile.png',390,844,'Opportunities'));
