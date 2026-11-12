import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright';

const origin='http://127.0.0.1:4199';
const dataDir=await mkdtemp('/tmp/pwb-mcp-compat-');
const password=randomBytes(32).toString('base64url');
const salt=randomBytes(16);
const env={...process.env, PORT:'4199', APP_ORIGIN:origin, BOARD_DATA_DIR:dataDir,
 AUTH_MODE:'password', AUTH_USERNAME:'compat-owner', PASSWORD_HASH:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),
 MCP_BOARD_ORIGIN:origin, MCP_CHROME_CHANNEL:'chrome'};
const service=spawn(process.execPath,['src/server.js'],{env,stdio:['ignore','pipe','inherit']});
const client=new Client({name:'compat-test',version:'1'});
const tested=new Set();
let browser;
async function call(name,args={},isError=false){
 const result=await client.callTool({name,arguments:args},undefined,{timeout:45000});
 assert.equal(Boolean(result.isError),isError,JSON.stringify(result.content).slice(0,1000));
 tested.add(name);
 return result.content[0];
}
const scene=async()=>JSON.parse((await call('query_elements')).text);
const shape=(id,x,y)=>({id,type:'rectangle',x,y,width:100,height:60});
try {
 await Promise.race([new Promise(r=>service.stdout.once('data',r)),new Promise((_,j)=>service.once('exit',c=>j(Error('server exit '+c))))]);
 const login=await fetch(origin+'/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({username:env.AUTH_USERNAME,password})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const issued=await fetch(origin+'/api/settings/mcp/keys',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},
  body:JSON.stringify({name:'Compatibility test',transport:'stdio',scope:'write',days:30})});
 assert.equal(issued.status,201);
 const {token}=await issued.json();
 await client.connect(new StdioClientTransport({command:process.execPath,args:['src/mcp.js'],env:{...env,MCP_TOKEN:token}}));
 const catalog=(await client.listTools()).tools;
 assert.equal(catalog.length,27);
 await call('create_element',{...shape('a',80,130),text:'First',strokeWidth:3,fontFamily:'sans'});
 await call('batch_create_elements',{elements:[shape('b',235,180),shape('c',450,250)]});
 await call('create_element',{id:'link',type:'arrow',x:185,y:160,startElementId:'a',endElementId:'b',endArrowhead:null});
 await call('update_element',{id:'a',backgroundColor:'#eeeeee',x:90});
 let state=await scene();
 assert.equal(state.scene.elements.find(x=>x.id==='a').x,90);
 assert.equal(state.scene.elements.find(x=>x.id==='link').endBinding.elementId,'b');
 const filtered=JSON.parse((await call('query_elements',{type:'rectangle',filter:{strokeWidth:3},bbox:{x_max:120}})).text);
 assert.deepEqual(filtered.scene.elements.map(e=>e.id),['a']);
 assert.equal(JSON.parse((await call('get_element',{id:'a'})).text).element.id,'a');
 await call('lock_elements',{elementIds:['a']});
 assert.ok((await scene()).scene.elements.find(x=>x.id==='a').locked);
 await call('unlock_elements',{elementIds:['a']});
 const group=JSON.parse((await call('group_elements',{elementIds:['a','b']})).text).groupId;
 assert.ok(group);
 await call('ungroup_elements',{groupId:group});
 assert.equal((await scene()).scene.elements.find(x=>x.id==='a').groupIds.length,0);
 await call('align_elements',{elementIds:['a','b','c'],alignment:'top'});
 assert.equal(new Set((await scene()).scene.elements.filter(x=>['a','b','c'].includes(x.id)).map(x=>x.y)).size,1);
 await call('distribute_elements',{elementIds:['a','b','c'],direction:'horizontal'});
 await call('duplicate_elements',{elementIds:['a'],offsetX:30,offsetY:20});
 await call('get_resource',{resource:'scene'});
 await call('get_resource',{resource:'library'});
 await call('describe_scene');
 await call('read_diagram_guide');
 await call('export_to_excalidraw_url',{},true);
 await call('export_scene',{filePath:'/should-not-be-written.excalidraw'},true);
 await call('export_scene');
 await call('snapshot_scene',{name:'checkpoint'});
 await call('delete_element',{id:'c'});
 assert.ok((await scene()).scene.elements.find(x=>x.id==='c').isDeleted);
 await call('restore_snapshot',{name:'checkpoint'});
 assert.equal((await scene()).scene.elements.find(x=>x.id==='c').isDeleted,false);
 await call('import_scene',{mode:'merge',data:JSON.stringify({elements:[shape('imported',600,310)]})});
 await call('create_from_mermaid',{mermaidDiagram:'flowchart LR\n A[Start] --> B[Done]',config:{flowchart:{curve:'linear'}}});
 assert.ok((await scene()).scene.elements.length>=10);
 const png=await call('get_canvas_screenshot',{scale:1,elementIds:['a','b']});
 assert.equal(Buffer.from(png.data,'base64').subarray(1,4).toString(),'PNG');
 const svg=await call('export_to_image',{format:'svg',background:false,elementIds:['a']});
 assert.match(svg.text,/<svg/);
 browser=await chromium.launch({channel:'chrome'});
 const context=await browser.newContext();
 const separator=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:origin}]);
 const page=await context.newPage();
 await page.goto(origin);
 await page.locator('.excalidraw__canvas.interactive').waitFor();
 await call('set_viewport',{zoom:1.5,offsetX:30,offsetY:20});
 await page.getByText('150%',{exact:true}).waitFor();
 await page.locator(".excalidraw__canvas.interactive").click({position:{x:700,y:500}});
 await page.keyboard.press("ControlOrMeta+a");
 await page.waitForTimeout(150);

 const selection=await call('get_selection');
 assert.ok(Array.isArray(JSON.parse(selection.text).selectedElementIds));
 assert.ok(JSON.parse(selection.text).selectedElementIds.includes("a"));

 await call('clear_canvas',{confirm:true});
 state=await scene();
 assert.ok(state.scene.elements.every(e=>e.isDeleted));
 const response=await fetch(origin+'/api/current/new',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({generation:state.generation,revision:state.revision})});
 assert.equal(response.status,200);
 await call('create_element',shape('stale',1,1),true);
 await call('restore_snapshot',{name:'checkpoint'},true);
 await call('update_element',{id:'a',boardId:'archive',x:10},true);
 assert.equal(tested.size,catalog.length);
 console.log(tested.size+' tool names exercised, local Mermaid, PNG/SVG, viewport and policy boundaries passed');
} finally {
 await browser?.close();
 await client.close();
 if (service.exitCode === null && service.signalCode === null) {
  const stopped = new Promise(resolve => service.once('exit', resolve));
  service.kill();
  await stopped;
 }
 await rm(dataDir, { recursive: true, force: true });
}
