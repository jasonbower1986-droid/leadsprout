/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import fs from 'node:fs';
import {
  dashboardFixture as dashboard,
  opportunityList as opportunities,
  postReviewOpportunity as postOpportunity,
  preReviewOpportunity as baseOpportunity,
} from './controlled-render-fixture.js';

const evidenceDir = process.env.COI_EVIDENCE_DIR || path.resolve('../outputs/commercial-opportunity-design');
fs.mkdirSync(evidenceDir, {recursive:true});

async function controlledPage(page) {
  await page.addInitScript(() => localStorage.setItem('token','controlled-render-token'));
  await page.route('**/api/config/features', route => route.fulfill({json:{opportunity_workspace:true}}));
  await page.route('**/api/config/personas', route => route.fulfill({json:{}}));
  await page.route('**/api/auth/me', route => route.fulfill({json:{user:{id:'controlled-user',email:'jason.bower@saiphlab.test',plan:'agency',unlocks_count:500}}}));
  await page.route('**/api/opportunity-workspaces/dashboard', route => route.fulfill({json:dashboard}));
  await page.route('**/api/opportunity-workspaces', route => route.fulfill({json:{opportunities,filters:{},ordering:'SERVER_DERIVED'}}));
  await page.route('**/api/opportunity-workspaces/workspace-pre/opportunity', route => route.fulfill({json:baseOpportunity}));
  await page.route('**/api/opportunity-workspaces/workspace-post/opportunity', route => route.fulfill({json:postOpportunity}));
  await page.route('**/api/opportunity-workspaces/*/start-outreach', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({json:{communication_sent:false,transition_type:'PREPARE'}});
  });
}
async function capture(page, route, file, width, height, nav) {
  await page.setViewportSize({width,height});
  await page.goto(route);
  await expect(page.getByRole('main').first()).toBeVisible();
  const navigation = page.locator('#primary-navigation');
  await expect(navigation.getByRole('link',{name:nav,exact:true})).toHaveAttribute('aria-current','page');
  if (width < 1024) {
    const menuButton = page.getByRole('button',{name:'Open navigation'});
    await menuButton.click();
    await expect(navigation).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menuButton).toBeFocused();
    await expect(menuButton).toHaveAttribute('aria-expanded','false');
  }
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.documentElement.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(0);
  expect(overflow.root).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(item => ['serious','critical'].includes(item.impact))).toEqual([]);
  await page.screenshot({path:path.join(evidenceDir,file),fullPage:false});
}
test.beforeEach(async ({page}) => controlledPage(page));
test('dashboard desktop disclosure closed', async ({page}) => {
  await capture(page,'/dashboard','dashboard-desktop.png',1536,1024,'Home');
  await expect(page.getByRole('dialog',{name:'Estimated Client Upside'})).toHaveCount(0);
});
test('dashboard desktop disclosure opened and Escape returns focus', async ({page}) => {
  await page.setViewportSize({width:1536,height:1024});
  await page.goto('/dashboard');
  const disclosure = page.getByRole('button',{name:'Show estimated client upside details'});
  await expect(disclosure).toHaveAttribute('aria-expanded','false');
  await disclosure.click();
  await expect(page.getByRole('dialog',{name:'Estimated Client Upside'})).toBeVisible();
  await expect(disclosure).toHaveAttribute('aria-expanded','true');
  const results = await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(item => ['serious','critical'].includes(item.impact))).toEqual([]);
  await page.screenshot({path:path.join(evidenceDir,'dashboard-desktop-disclosure.png'),fullPage:false});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Estimated Client Upside'})).toHaveCount(0);
  await expect(disclosure).toBeFocused();
});
test('dashboard mobile', async ({page}) => capture(page,'/dashboard','dashboard-mobile.png',390,844,'Home'));
test('dashboard 320px reflow', async ({page}) => capture(page,'/dashboard','dashboard-320.png',320,844,'Home'));
test('dashboard portfolio tabs are keyboard operated from controlled records', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/dashboard');
  const priority = page.getByRole('tab',{name:/Priority/});
  const all = page.getByRole('tab',{name:/All Opportunities/});
  await priority.focus();
  await page.keyboard.press('ArrowRight');
  await expect(all).toBeFocused();
  await expect(all).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel').getByText('Elite Fitness Manchester')).toBeVisible();
});
test('pre-review desktop', async ({page}) => capture(page,'/opportunities/workspace-pre','pre-review-desktop.png',1536,1024,'Opportunities'));
test('pre-review mobile', async ({page}) => capture(page,'/opportunities/workspace-pre','pre-review-mobile.png',390,844,'Opportunities'));
test('pre-review 320px reflow', async ({page}) => capture(page,'/opportunities/workspace-pre','pre-review-320.png',320,844,'Opportunities'));
test('post-review desktop', async ({page}) => capture(page,'/opportunities/workspace-post','post-review-desktop.png',1536,1024,'Opportunities'));
test('post-review mobile', async ({page}) => capture(page,'/opportunities/workspace-post','post-review-mobile.png',390,844,'Opportunities'));
test('post-review 320px reflow', async ({page}) => capture(page,'/opportunities/workspace-post','post-review-320.png',320,844,'Opportunities'));
test('governed opportunity actions retain keyboard state', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/opportunities/workspace-pre');
  const review = page.getByRole('button',{name:'Review opportunity',exact:true});
  const locked = page.getByRole('button',{name:'Start outreach',exact:true});
  await expect(review).toBeEnabled();
  await review.focus();
  await expect(review).toBeFocused();
  await expect(locked).toBeDisabled();
  await page.goto('/opportunities/workspace-post');
  const start = page.getByRole('button',{name:'Start outreach',exact:true});
  await expect(start).toBeEnabled();
  await start.focus();
  await expect(start).toBeFocused();
  await expect(page.getByText('Choosing a next action does not send or record communication.')).toBeVisible();
  await expect(page.getByRole('link',{name:/Download proposal summary/})).toBeVisible();
});
