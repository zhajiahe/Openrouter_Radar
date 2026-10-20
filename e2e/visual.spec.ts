import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {installApiMocks,MODEL_ID,IMAGE_ID} from './mock-api';

const widths=[375,390,768,1024,1440];
const captureDir=process.env.VISUAL_CAPTURE_DIR||'artifacts/current';
const baseline=process.env.VISUAL_CAPTURE_ONLY==='1';

async function capture(page:Page,filename:string){
 const file=path.join(captureDir,filename);
 fs.mkdirSync(path.dirname(file),{recursive:true});
 await page.screenshot({path:file,fullPage:true,animations:'disabled',caret:'hide'});
}
async function checkDocument(page:Page,width:number){
 if(baseline)return;
 const result=await page.evaluate(()=>{
  const doc=document.documentElement;
  return {viewport:window.innerWidth,document:doc.scrollWidth,body:document.body.scrollWidth};
 });
 expect(result.viewport,'Expected tested viewport').toBe(width);
 expect(result.document,'Unexpected whole-page horizontal overflow').toBeLessThanOrEqual(width+2);
 expect(result.body,'Body overflows mobile viewport').toBeLessThanOrEqual(width+2);
}
async function goto(page:Page){
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('navigation',{name:'主要导航'})).toBeVisible();
}
test.beforeEach(async({page})=>{
 await page.clock.install({time:new Date('2026-10-20T12:00:00Z')});
 await page.addInitScript(()=>localStorage.setItem('radar-theme','light'));
 await installApiMocks(page);
});
for(const width of widths){
 test.describe('responsive '+width+'px',()=>{
  test.use({viewport:{width,height:900},deviceScaleFactor:1});
  test('overview, charts and dark mode',async({page})=>{
   const errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await goto(page);
   await expect(page.getByRole('heading',{name:'市场动态'})).toBeVisible();
   await expect(page.locator('.analytics-grid .chart-panel')).toHaveCount(3);
   await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();
   await checkDocument(page,width);
   await capture(page,`${width}/overview-light.png`);
   const theme=page.getByRole('button',{name:'切换深色/浅色主题'});
   await theme.click();
   await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
   await checkDocument(page,width);
   await capture(page,`${width}/overview-dark.png`);
   if(!baseline)expect(errors,'Uncaught browser errors').toEqual([]);
  });
  test('catalog, model details, history and responsive tables',async({page})=>{
   const errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await goto(page);
   await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'Models'}).click();
   await expect(page.locator('.model-main')).toHaveCount(3);
   await checkDocument(page,width);
   await capture(page,`${width}/catalog.png`);
   await page.locator('.model-main').filter({hasText:'GPT 5.6'}).click();
   await expect(page.locator('.detail-panel')).toContainText(MODEL_ID);
   await expect(page.getByRole('heading',{name:'Provider 报价'})).toBeVisible();
   await expect(page.locator('.radar-provider-table tbody tr')).toHaveCount(2);
   await expect(page.locator('.historic-card')).toContainText('实际观测点');
   await checkDocument(page,width);
   await capture(page,`${width}/model-detail.png`);
   // Explicitly confirm only table's own container scrolls on narrow screens.
   if(!baseline&&width<=390){
    const scroll=await page.locator('.radar-provider-table').evaluate(el=>({
     table:el.getBoundingClientRect().width,
     wrapper:el.closest('.scroll-x')?.getBoundingClientRect().width||0,
     canScroll:(el.closest('.scroll-x')?.scrollWidth||0)>(el.closest('.scroll-x')?.clientWidth||0)
    }));
    expect(scroll.canScroll||scroll.table<=scroll.wrapper+2,'Prices must fit or be horizontally scrollable').toBeTruthy();
   }
   // Search the complete model directory and verify the server-backed result.
   const search=page.getByRole('textbox',{name:'搜索模型名称或 ID'});
   await search.fill('claude');
   await expect(page.locator('.model-main')).toHaveCount(1);
   await expect(page.locator('.model-main')).toContainText('Claude');
   await checkDocument(page,width);
   if(!baseline)expect(errors,'Uncaught browser errors').toEqual([]);
  });
  test('changes, navigation, auth and keyboard access',async({page})=>{
   const errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await goto(page);
   const nav=page.getByRole('navigation',{name:'主要导航'});
   await nav.getByRole('button',{name:'Changes'}).click();
   await expect(page.locator('.events-table tbody tr')).toHaveCount(3);
   await checkDocument(page,width);
   await capture(page,`${width}/changes.png`);
   await nav.getByRole('button',{name:'通知'}).click();
   await expect(page.getByRole('heading',{name:'通知中心'})).toBeVisible();
   await checkDocument(page,width);
   await page.getByRole('button',{name:/登录 \/ 注册/}).first().click();
   await expect(page.getByRole('textbox',{name:'电子邮箱'})).toBeVisible();
   await capture(page,`${width}/account.png`);
   await checkDocument(page,width);
   if(!baseline)expect(errors,'Uncaught browser errors').toEqual([]);
  });
 });
}
for(const width of [390,1440]){
 test.describe('specialized pricing '+width+'px',()=>{
  test.use({viewport:{width,height:900},deviceScaleFactor:1});
  test('image billing unit and detail fallback',async({page})=>{
   await goto(page);
   await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'Models'}).click();
   await page.locator('.model-main').filter({hasText:'Studio Image Generator'}).click();
   await expect(page.locator('.detail-panel')).toContainText(IMAGE_ID);
   await expect(page.locator('.detail-quick-price')).toContainText('按计费项');
   await expect(page.locator('.historic-card')).toContainText('图片计费');
   await capture(page,`${width}/image-model.png`);
   await checkDocument(page,width);
  });
 });
}
