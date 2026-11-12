import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';
const out = '.hallmark/verification';
await mkdir(out, { recursive: true });
const scratch = await mkdtemp('/tmp/pwb-ink-');
const salt = randomBytes(16).toString('hex');
const password = randomBytes(20).toString('hex');
const services = [], results = [];
let browser;
async function start(port, mode) {
 const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),APP_ORIGIN:`http://127.0.0.1:${port}`,AUTH_MODE:mode,AUTH_USERNAME:'review',PASSWORD_HASH:salt+':'+scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex'),BOARD_DATA_DIR:scratch+'/'+port},stdio:['ignore','pipe','inherit']});
 services.push(child);
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('service exit '+code)));});
 return `http://127.0.0.1:${port}`;
}
async function inspect(page,name,{mask=[]}={}) {
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 await page.mouse.move(0,400);
 await page.screenshot({path:`${out}/${name}.png`,fullPage:true,mask});
 const scan=await new AxeBuilder({page}).analyze();
 const metrics=await page.evaluate(()=>{
  const root=document.querySelector('.workspace')||document.documentElement;
  const s=getComputedStyle(root), pairs=[['--ink','--paper'],['--secondary','--paper'],['--secondary','--surface'],['--on-action','--action'],['--feedback','--accent-wash'],['--danger','--danger-wash'],['--line','--surface'],['--focus','--paper']];
  const lum=h=>{let hex=h.trim().replace('#','');if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');const v=hex.match(/../g).slice(0,3).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
  const contrast=pairs.map(([a,b])=>{const x=lum(s.getPropertyValue(a)),y=lum(s.getPropertyValue(b));return {pair:[a,b],ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};});
  const computed=[...document.querySelectorAll('.board-label h1,.library h2,.archive-search,.share-dialog[open] p')].filter(e=>e.getClientRects().length).map(e=>({selector:e.className||e.tagName,color:getComputedStyle(e).color,font:getComputedStyle(e).font}));
  const small=[...document.querySelectorAll('button,input,label,p,h1,h2,legend,.control-label,.value-bubble,.zero-label,.save-state,.dropdown-menu-item,.ToolIcon__keybinding')].filter(e=>!e.closest('.excalidraw')&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,35),size:parseFloat(getComputedStyle(e).fontSize)})).filter(e=>e.size<14);
  return {width:innerWidth,scroll:document.documentElement.scrollWidth,contrast,small,computed};
 });
 results.push({name,violations:scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),...metrics});
 console.log(name, 'axe',scan.violations.map(v=>v.id),'small',metrics.small.length,'width',metrics.width,metrics.scroll);
}
async function menu(page,label){await page.getByRole('button',{name:'白板菜单',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+label+'(?:\\s|$)')}).click();}
try {
 const origin=await start(4195,'public'), authOrigin=await start(4196,'password');
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({locale:'zh-CN',viewport:{width:1440,height:900}});
 const page=await context.newPage();
 if(process.env.PWB_DEBUG)page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/api/current'))console.log('scene write',JSON.parse(r.postData()).scene.elements.map(e=>({type:e.type,deleted:e.isDeleted,w:e.width})));});
 await page.goto(origin);await page.locator('.canvas .excalidraw').waitFor();
 await inspect(page,'desktop');
 await menu(page,'白板档案');await inspect(page,'archive-empty');await page.keyboard.press('Escape');
 // Draw a real rectangle and verify automatic persistence, without test hooks.
 const autosave = page.waitForResponse(response => {
  const request = response.request();
  return response.ok() && request.method() === 'PUT' && response.url().endsWith('/api/current') &&
    request.postDataJSON().scene.elements.some(e => !e.isDeleted && e.type === 'rectangle' && e.width >= 250 && e.height >= 150);
 });
 await page.locator('label.ToolIcon').filter({has:page.getByRole('radio',{name:'矩形',exact:true})}).click();await page.mouse.move(460,260);await page.mouse.down();await page.mouse.move(760,450,{steps:12});await page.mouse.up();
 await autosave;
 await inspect(page,'shape-properties');await page.reload();await page.locator('.canvas .excalidraw').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<120&&d[i+1]<120&&d[i+2]<120&&d[i+3]>100)n++;return n>100;}));await inspect(page,'drawing-restored');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/current/save')&&r.status()===201);await menu(page,'保存副本');await saved;
 await menu(page,'白板档案');await inspect(page,'archive-full');await page.getByLabel('搜索档案').fill('不存在的档案');await inspect(page,'archive-no-results');await page.keyboard.press('Escape');
 await menu(page,'分享当前白板');await inspect(page,'share-before');
 await page.getByRole('button',{name:'创建编辑链接',exact:true}).click();await page.getByLabel('分享链接').waitFor();
 const shareUrl=await page.getByLabel('分享链接').inputValue();
 await inspect(page,'share-created',{mask:[page.getByLabel('分享链接')]});
 const guestContext=await browser.newContext({locale:'zh-CN'});const guest=await guestContext.newPage();await guest.goto(shareUrl);await guest.locator('.excalidraw').waitFor();
 await page.getByRole('button',{name:'撤销分享',exact:true}).click();await guest.getByRole('alert').waitFor();await inspect(guest,'revoked');await guest.close();
 await page.keyboard.press('Escape');
 await menu(page,'新建白板');await inspect(page,'new-confirm');await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'白板菜单',exact:true}).click();
 await inspect(page,'native-menu');
 await page.getByTestId('toggle-dark-mode').click();await page.keyboard.press('Escape');
 await page.waitForSelector('.excalidraw.theme--dark');await inspect(page,'dark-desktop');await menu(page,'分享当前白板');await inspect(page,'dark-share');await page.keyboard.press('Escape');
 await menu(page,'白板档案');await inspect(page,'dark-archive');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'白板菜单',exact:true}).click();await page.getByTestId('toggle-dark-mode').click();await page.keyboard.press('Escape');
 assert.equal(await page.locator('.default-sidebar-trigger').isVisible(),false,'library entry hidden');
 await page.locator('.help-icon').click();await inspect(page,'native-help');await page.keyboard.press('Escape');
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await inspect(page,`mobile-${width}`);
  await menu(page,'白板档案');await inspect(page,`archive-${width}`);await page.keyboard.press('Escape');
  await menu(page,'分享当前白板');await inspect(page,`share-${width}`);await page.keyboard.press('Escape');
 }
 await page.addStyleTag({content:'body :is(p,label,button,a,h1,h2,.save-state){line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}'});
 await menu(page,'分享当前白板');await inspect(page,'spacing-320');await page.keyboard.press('Escape');
 await page.setViewportSize({width:1440,height:900});await page.goto(origin);await page.locator('.canvas .excalidraw').waitFor();
 await menu(page,'白板档案');await page.locator('.library a').first().click();await page.waitForURL('**/boards/*');await page.locator('.canvas .excalidraw').waitFor();
 await menu(page,'修改白板名称');await inspect(page,'rename');await page.getByLabel('白板名称',{exact:true}).fill('Ink 验收白板');await page.getByLabel('白板名称',{exact:true}).press('Enter');await page.getByRole('main',{name:'Ink 验收白板',exact:true}).waitFor();
 await inspect(page,'saved-board');
 await page.setViewportSize({width:320,height:844});
 await page.goto(authOrigin);await page.getByRole('heading',{name:'打开你的白板'}).waitFor();await inspect(page,'login-320');
 await page.setViewportSize({width:1440,height:900});await inspect(page,'login-desktop');
 await page.getByLabel('用户名').fill('review');await page.getByLabel('密码',{exact:true}).fill('wrong');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('alert').waitFor();await inspect(page,'login-error');
 await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.canvas .excalidraw').waitFor();
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));
 assert.equal(results.flatMap(x=>x.violations).length,0,'axe violations');
 assert.equal(results.flatMap(x=>x.small).length,0,'undersized text');
 assert.ok(results.every(x=>x.scroll<=x.width),'horizontal overflow');
 assert.ok(results.every(x=>x.contrast.every((c,i)=>c.ratio>=(i>=6?3:4.5))),'token contrast');
 console.log('Ink verification passed');
} finally {
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));
 await browser?.close();
 for(const s of services){if(s.exitCode===null){const stopped=new Promise(r=>s.once('exit',r));s.kill();await stopped;}}
 await rm(scratch,{recursive:true,force:true});
}
