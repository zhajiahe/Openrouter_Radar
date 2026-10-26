import {test,expect} from '@playwright/test';
import {installApiMocks} from './mock-api';

test.beforeEach(async({page})=>{
 await page.clock.install({time:new Date('2026-10-20T12:00:00Z')});
 await installApiMocks(page);
});

test('catalog filters and selected-model hash have refreshable shareable URLs',async({page})=>{
 await page.goto('/?view=catalog&q=claude&sort=name&max_input_price=0.1');
 await expect(page.getByRole('textbox',{name:/搜索模型名称或 ID/})).toHaveValue('claude');
 await expect(page.locator('.model-main')).toHaveCount(1);
 await page.reload();
 await expect(page.getByRole('textbox',{name:/搜索模型名称或 ID/})).toHaveValue('claude');
 await expect(page.locator('.model-main')).toHaveCount(1);
 await page.locator('.model-main').first().click();
 await expect(page).toHaveURL(/#model=anthropic/);
 await page.getByRole('textbox',{name:/搜索模型名称或 ID/}).fill('gpt');
 await expect(page).not.toHaveURL(/#model=/);
 await expect(page).toHaveURL(/q=gpt/);
 await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'Changes'}).click();
 await expect(page).toHaveURL(/view=events/);
 await page.goBack();
 await expect(page.getByRole('heading',{name:/Models/})).toBeVisible();
 await expect(page.getByRole('textbox',{name:/搜索模型名称或 ID/})).toHaveValue('gpt');
});

test('video output never appears free based on zero token metadata',async({page})=>{
 const model={
  id:'alibaba/happyhorse-fixture',name:'HappyHorse video fixture',context_length:0,updated_at:1_760_000_000,
  model_kind:'standard',lifecycle_status:'active',lowest_input:0,provider_count:1,
  capabilities_json:JSON.stringify({architecture:{input_modalities:['text','image'],output_modalities:['video']}})
 };
 const endpoint={id:'video-ep',provider:'Video Provider',tag:'default',source:'provider',status:'active',
  input_price:'0',output_price:'0',checked_at:1_760_000_000,
  pricing_json:JSON.stringify({video:{unit:'second',cost_usd:'0.2'}})};
 await page.route('**/api/models?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[model],page:1,limit:30,total:1})}));
 await page.route('**/api/model?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
  model,endpoints:[endpoint],collection:{status:'fresh',last_attempt:1_760_000_000,last_success:1_760_000_000,last_error:null,age_seconds:60,active_endpoints:1,missing_endpoints:0}
 })}));
 await page.goto('/?view=catalog');
 await expect(page.locator('.model-list')).toContainText('Token 计价不适用');
 await expect(page.locator('.model-list')).not.toContainText('无上下文限制');
 await page.locator('.model-main').click();
 await expect(page.locator('.detail-panel')).toContainText('未采集 / 不适用');
 await expect(page.locator('.detail-panel')).toContainText('实际计费单位各异');
 await expect(page.locator('.detail-panel')).not.toContainText('USD / 1M tokens · 活跃端点');
});

test('analytics errors remain localized and retain last successful snapshot',async({page})=>{
 let failing=false;
 await page.route('**/api/analytics?**',route=>failing?
  route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Internal server error',requestId:'audit-fixture'})}):route.fallback());
 await page.goto('/');
 await expect(page.locator('.analytics-grid .chart-panel')).toHaveCount(3);
 await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();
 failing=true;
 await page.getByRole('button',{name:'刷新市场图表'}).click();
 await expect(page.locator('.chart-inline-error')).toContainText('市场统计服务暂时不可用');
 await expect(page.locator('.chart-inline-error')).not.toContainText('Internal server error');
 await expect(page.locator('.analytics-summary')).toContainText('历史缓存');
 await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();
});

test('320px changes use mobile cards and an accessible navigation menu',async({page})=>{
 await page.setViewportSize({width:320,height:740});
 await page.goto('/');
 await page.getByRole('button',{name:'打开页面导航'}).click();
 await page.getByRole('menuitem',{name:'Changes'}).click();
 await expect(page.locator('.events-mobile-cards .event-mobile-card')).toHaveCount(3);
 await expect(page.locator('.events-desktop-table')).toBeHidden();
 await expect(page.locator('.event-mobile-card').first()).toContainText('Provider');
 await expect(page.locator('.event-mobile-card').first().locator('time')).toHaveAttribute('title',/2026/);
 await expect(page.locator('.event-mobile-card').first().locator('summary')).toContainText('完整事件时间');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
 expect(overflow).toBeFalsy();
});
