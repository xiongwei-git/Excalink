import {execFileSync,execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:https';
import http from 'node:http';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=mkdtempSync('/tmp/pwb-ta-');
const image='ghcr.io/tinyauthapp/tinyauth@sha256:220aa235c76393a73fece831d7ba967b8698d3907fd8e3c4c952f699c7b142a5';
const name='pwb-ta-'+randomBytes(5).toString('hex');
const password=randomBytes(24).toString('hex');
const client='pwbtest';
writeFileSync(dir+'/dns.cjs', `const dns=require('node:dns');const lookup=dns.lookup;
dns.lookup=function(host,...args){return lookup.call(this,host==='tinyauth.localhost'?'127.0.0.1':host,...args);};`);
const issuer='https://tinyauth.localhost:4196';
const origin='http://127.0.0.1:4197';
const docker=(args,env=process.env)=>execFileSync('docker',args,{encoding:'utf8',env,stdio:['ignore','pipe','pipe']}).trim();
const users=['owner','guest'].map(username=>docker(['run','--rm',image,'user','create','--username',username,'--password',password]).match(new RegExp(username+':[^\\s]+'))?.[0]);
assert.ok(users.every(Boolean));
const env={...process.env,TINYAUTH_APPURL:issuer,TINYAUTH_AUTH_SUBDOMAINSENABLED:'false',TINYAUTH_AUTH_USERS:users.join(','),
 TINYAUTH_LABELPROVIDER:'none',TINYAUTH_VERSIONCHECK_ENABLED:'false',
 TINYAUTH_OIDC_CLIENTS_TEST_CLIENTID:client,TINYAUTH_OIDC_CLIENTS_TEST_CLIENTSECRET:randomBytes(32).toString('hex'),
 TINYAUTH_OIDC_CLIENTS_TEST_TRUSTEDREDIRECTURIS:origin+'/auth/callback',TINYAUTH_OIDC_CLIENTS_TEST_NAME:'Whiteboard test'};
const keys=Object.keys(env).filter(k=>k.startsWith('TINYAUTH_'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:tinyauth.localhost','-keyout',dir+'/key','-out',dir+'/cert'],{stdio:'ignore'});
const proxy=createServer({key:readFileSync(dir+'/key'),cert:readFileSync(dir+'/cert')},(req,res)=>{
 const back=http.request({hostname:'127.0.0.1',port:4195,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-host':'tinyauth.localhost:4196','x-forwarded-for':'127.0.0.1'}},reply=>{
  res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
 });
 back.on('error',()=>{res.writeHead(502);res.end();});req.pipe(back);
});
const uuid=createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8','hex')).update('owner:'+client).digest().subarray(0,16);
uuid[6]=(uuid[6]&15)|80;uuid[8]=(uuid[8]&63)|128;
const subject=uuid.toString('hex').replace(/^(........)(....)(....)(....)/,'$1-$2-$3-$4-');
let child,browser;
try {
 docker(['run','-d','--name',name,'-p','127.0.0.1:4195:3000',...keys.flatMap(k=>['-e',k]),image],env);
 await new Promise(r=>proxy.listen(4196,r));
 const {stdout:ready}=await promisify(execFile)('curl',['-fSs','--resolve','tinyauth.localhost:4196:127.0.0.1','--cacert',dir+'/cert','--retry','8','--retry-all-errors','--retry-delay','1',issuer+'/.well-known/openid-configuration'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const discovery=JSON.parse(ready);assert.equal(discovery.issuer,issuer);
 child=spawn(process.execPath,['src/server.js'],{env:{...process.env,NODE_OPTIONS:'--require='+dir+'/dns.cjs',NODE_EXTRA_CA_CERTS:dir+'/cert',BOARD_DATA_DIR:dir+'/boards',PORT:'4197',AUTH_MODE:'oidc',OIDC_ISSUER:issuer,OIDC_CLIENT_ID:client,OIDC_CLIENT_SECRET:env.TINYAUTH_OIDC_CLIENTS_TEST_CLIENTSECRET,OIDC_SUBJECT:subject},stdio:['ignore','pipe','inherit']});
 await Promise.race([new Promise(r=>child.stdout.once('data',r)),new Promise((_,j)=>child.once('exit',c=>j(Error('app exit '+c))))]);
 browser=await chromium.launch({channel:'chrome'});
 for(const username of ['owner','guest']){
  const context=await browser.newContext({locale:'zh-CN',ignoreHTTPSErrors:true});
  const page=await context.newPage();page.setDefaultTimeout(8000);
  await page.goto(origin);
  await page.getByRole('link',{name:'使用身份服务登录'}).click();
  await page.locator('input[name=username], input[autocomplete=username]').first().fill(username);
  await page.locator('input[type=password]').first().fill(password);
  await page.locator('button[type=submit]').first().click();
  const consent=page.getByRole('button',{name:/authorize|allow|continue|同意|授权/i}).first();
  if(await consent.waitFor({timeout:4500}).then(()=>true,()=>false))await consent.click();
  await page.waitForURL(url=>url.origin===origin && url.pathname==='/');
  const status=(await (await context.request.get(origin+'/auth/session')).json()).owner;
  assert.equal(status,username==='owner');
  console.log('Tinyauth real account',username==='owner'?'authorized':'denied');
  await context.close();
 }
} finally {
 await browser?.close();child?.kill();proxy.close();

 try {docker(['rm','-f','-v',name]);}catch{}
 rmSync(dir,{recursive:true,force:true});
}
