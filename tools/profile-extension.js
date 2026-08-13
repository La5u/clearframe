#!/usr/bin/env node
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const waiters = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const typical = process.argv.includes('--typical');
const staticNodes = typical ? 1200 : 6000, dynamicNodes = typical ? 200 : 1000;

const page = `<!doctype html><meta charset="utf-8"><title>ClearFrame full profile</title><main id="articles"></main><script>
const params=new URLSearchParams(location.search), browser=params.get('browser'), extension=params.get('extension')==='1';
const root=document.querySelector('#articles'), started=performance.now(), fragment=document.createDocumentFragment();
for(let i=0;i<${staticNodes};i++){const p=document.createElement('p');p.textContent=i%8===0?'A shocking warning reportedly reveals a devastating secret.':'The committee published its ordinary quarterly report after the meeting.';fragment.appendChild(p)}
root.appendChild(fragment);
let initialMs=null, dynamicStart=null, styleAdds=0, finished=false;
function addDynamic(){const f=document.createDocumentFragment();for(let i=0;i<${dynamicNodes};i++){const p=document.createElement('p');p.textContent='Over the moon after an ordinary report';f.appendChild(p)}root.appendChild(f)}
function send(){if(finished)return;finished=true;fetch('/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({browser,extension,staticNodes:${staticNodes},dynamicNodes:${dynamicNodes},characters:document.body.innerText.length,initialMs,dynamicMs:dynamicStart===null?null:performance.now()-dynamicStart,heapMb:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,styles:styleAdds})})}
const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.id==='cf-highlight-styles'){styleAdds++;if(initialMs===null){initialMs=performance.now()-started;dynamicStart=performance.now();addDynamic()}else send()}});
observer.observe(document.documentElement,{childList:true,subtree:true});
if(!extension)requestAnimationFrame(()=>requestAnimationFrame(()=>{initialMs=performance.now()-started;dynamicStart=performance.now();addDynamic();setTimeout(send,250)}));
setTimeout(send,20000);
</script>`;

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/profile')) { res.writeHead(200, {'content-type':'text/html'}); res.end(page); return; }
  if (req.url === '/result' && req.method === 'POST') { let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const value=JSON.parse(body);waiters.get(`${value.browser}:${value.extension}`)?.(value);res.writeHead(204);res.end()});return; }
  res.writeHead(404);res.end();
});

function processRss(rootPid, browser) {
  const rows=execFileSync('ps',['-eo','pid=,ppid=,rss=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/));
  let roots=[String(rootPid)];
  if(browser==='firefox') {
    const firefox=rows.find(([,ppid,,comm])=>roots.includes(ppid)&&comm.includes('firefox'));
    if(firefox) roots=[firefox[0]];
  }
  const ids=new Set(roots);let changed=true;
  while(changed){changed=false;for(const [pid,ppid] of rows)if(ids.has(ppid)&&!ids.has(pid)){ids.add(pid);changed=true}}
  return Math.round(rows.filter(([pid])=>ids.has(pid)).reduce((sum,row)=>sum+Number(row[2]||0),0)/1024);
}

async function run(browser, extension, port) {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),`clearframe-profile-${browser}-`));
  const url=`http://127.0.0.1:${port}/profile?browser=${browser}&extension=${extension?1:0}`;
  let command,args;
  if(browser==='chromium') {
    command='/usr/bin/chromium';args=['--headless=new','--no-sandbox','--disable-gpu','--no-first-run',`--user-data-dir=${profile}`];
    if(extension)args.push(`--disable-extensions-except=${path.join(ROOT,'dist')}`,`--load-extension=${path.join(ROOT,'dist')}`);
    args.push(url);
  } else if(extension) {
    command=process.execPath;args=[path.join(ROOT,'node_modules','web-ext','bin','web-ext.js'),'run','-s',path.join(ROOT,'dist-firefox'),'-t','firefox-desktop','-f','/usr/bin/firefox','--no-reload','--no-input','--start-url',url,'--args=-headless'];
  } else { command='/usr/bin/firefox';args=['--headless','--profile',profile,url]; }
  const child=spawn(command,args,{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',data=>error+=data);
  const result=await Promise.race([new Promise(resolve=>waiters.set(`${browser}:${extension}`,resolve)),delay(30000).then(()=>{throw new Error(`${browser} ${extension?'extension':'baseline'} timeout: ${error.slice(-500)}`)})]);
  await delay(500);const rssMb=processRss(child.pid,browser);child.kill('SIGTERM');waiters.delete(`${browser}:${extension}`);await delay(500);
  fs.rmSync(profile,{recursive:true,force:true});return {...result,rssMb};
}

server.listen(0,'127.0.0.1',async()=>{try{const port=server.address().port;for(const browser of ['chromium','firefox']){const baseline=await run(browser,false,port),extension=await run(browser,true,port);const result={browser,baseline,extension,memoryOverheadMb:extension.rssMb-baseline.rssMb};console.log(JSON.stringify(result));const initialBudget=typical?300:1000,dynamicBudget=typical?250:350;if(extension.initialMs>initialBudget||extension.dynamicMs>dynamicBudget)throw new Error(`${browser} exceeded performance budget`);if(browser==='chromium'&&extension.heapMb-baseline.heapMb>(typical?15:25))throw new Error('Chromium exceeded heap budget');}}finally{server.close()}});
