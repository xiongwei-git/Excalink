import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4198';
const scratch=await mkdtemp('/tmp/pwb-zoom-');
const ext=scratch+'/extension';
await mkdir(ext);
await writeFile(ext+'/manifest.json',JSON.stringify({manifest_version:3,name:'Temporary zoom test',
  version:'1.0',permissions:['tabs'],background:{service_worker:'worker.js'}}));
await writeFile(ext+'/worker.js','chrome.runtime.onInstalled.addListener(() => {});');
const output=process.env.PWB_SCREENSHOTS || '/tmp';
const service=spawn(process.execPath,['src/server.js'],{
  env:{...process.env,AUTH_MODE:'public',PORT:'4198',APP_ORIGIN:origin,BOARD_DATA_DIR:scratch+'/data'},
  stdio:['ignore','pipe','inherit'],
});
let context;
try {
 await Promise.race([new Promise(resolve=>service.stdout.once('data',resolve)),
   new Promise((_,reject)=>service.once('exit',code=>reject(Error('preview exited '+code))))]);
 context=await chromium.launchPersistentContext(scratch+'/profile',{
  ...(process.env.PWB_CHROMIUM ? {executablePath:process.env.PWB_CHROMIUM} : {channel:'chromium'}),
  args:['--disable-extensions-except='+ext,'--load-extension='+ext],viewport:{width:1280,height:900}
 });
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:8000});
 const page=await context.newPage();
 await page.goto(origin);
 await page.locator('.canvas .excalidraw').waitFor();
 const before=await page.evaluate(()=>devicePixelRatio);
 const zoom=await worker.evaluate(async url=>{
  const tab=(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith(url));
  await chrome.tabs.setZoom(tab.id,2);
  return chrome.tabs.getZoom(tab.id);
 },origin);
 assert.equal(zoom,2);
 await page.waitForFunction(r=>devicePixelRatio>=r*1.99,before);
 await page.waitForTimeout(350);
 const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dpr:devicePixelRatio}));
 assert.ok(metrics.scrollWidth<=metrics.width);
 const menu = page.getByRole('button', {name:'白板菜单'});
 await menu.focus();
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'白板档案',exact:true}).press('Enter');
 await page.getByRole('heading',{name:'白板档案'}).waitFor();
 await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭白板档案');
 await page.keyboard.press('Escape');
 await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '白板菜单');
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'分享副本',exact:true}).press('Enter');
 const dialog=page.getByRole('dialog');
 await dialog.waitFor();
 await dialog.getByRole('button',{name:'创建共享副本'}).click();
 await page.getByLabel('分享链接').waitFor();
 await page.screenshot({path:output+'/pwb-200-dialog.png',mask:[page.getByLabel('分享链接')]});
 const a=await new AxeBuilder({page}).analyze();
 console.log('200% dialog axe',a.violations.map(v=>v.id));
 await page.keyboard.press('Escape');
 await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '白板菜单');

 await page.screenshot({path:output+'/pwb-200-workspace.png'});
 await page.setViewportSize({width:640,height:900});
 await page.waitForFunction(() => innerWidth === 320);
 await page.addStyleTag({content:
   '.bar,.rename,.library,.share-dialog{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}.share-dialog p{margin-bottom:2em!important}'});
 const narrow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 assert.equal(narrow.width,320);
 assert.equal(narrow.scrollWidth,320);
 await page.screenshot({path:output+'/pwb-200-narrow.png'});
 console.log('browser zoom and keyboard passed',zoom,metrics);
} finally {
 await context?.close();
 if (service.exitCode===null && service.signalCode===null) {
  const stopped=new Promise(resolve=>service.once('exit',resolve));
  service.kill();
  await stopped;
 }
 await rm(scratch,{recursive:true,force:true});
}
