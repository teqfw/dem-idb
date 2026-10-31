import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

test('DEM repositories and schema lifecycle on real browser IndexedDB', {timeout:90000}, async () => {
    const testRoot = fileURLToPath(new URL('../../',import.meta.url));
    const root = process.env.IDB_PACKAGE_ROOT ?? testRoot;
    const dem = fileURLToPath(new URL('../',import.meta.resolve('@teqfw/dem/conformance')));
    const di = fileURLToPath(new URL('./',import.meta.resolve('@teqfw/di')));
    let receive;
    const result = new Promise(resolve => { receive = resolve; });
    const server = createServer(async (req,res) => {
        if (req.url === '/result') { let body=''; for await (const part of req) body+=part; receive(JSON.parse(body)); res.end('ok'); return; }
        if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
        if (req.url === '/') { res.setHeader('Content-Type','text/html'); res.end(`<script type="module">import('/test/browser/Suite.mjs').catch(error=>fetch('/result',{method:'POST',body:JSON.stringify({error:error.stack})}));</script>`); return; }
        const url = new URL(req.url,'http://localhost');
        const [base,relative] = url.pathname.startsWith('/test/') ? [testRoot,url.pathname.slice(1)] : url.pathname.startsWith('/dem/') ? [dem,url.pathname.slice(5)] : url.pathname.startsWith('/di/') ? [resolve(di,'..'),url.pathname.slice(4)] : [root,url.pathname.slice(1)];
        const path = resolve(base,relative);
        if (!path.startsWith(resolve(base)+'/')) { res.writeHead(403).end(); return; }
        try { res.setHeader('Content-Type','text/javascript'); res.end(await readFile(path)); } catch (error) { console.log('HTTP missing',path,error.message); res.writeHead(404).end(); }
    });
    const profile = await mkdtemp(join(tmpdir(),'dem-idb-browser-'));
    let chrome, timer;
    try {
        await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
        chrome = spawn(process.env.CHROME_PATH ?? 'google-chrome',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}/`],{stdio:['ignore','ignore','pipe']});
        let stderr=''; chrome.stderr.on('data',chunk => {stderr=(stderr+chunk).slice(-8000);});
        const observed = await Promise.race([result,new Promise((_,reject)=>{
            timer=setTimeout(()=>reject(new Error('Browser timeout: '+stderr)),60000);
            chrome.once('error',reject); chrome.once('exit',code=>reject(new Error('Chrome exited: '+code+' '+stderr)));
        })]);
        assert.equal(observed.error,undefined,observed.error);
        if (process.env.DEM_COMPARE_OUTPUT) await writeFile(process.env.DEM_COMPARE_OUTPUT,JSON.stringify(observed));
        for (const row of observed.results) console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.name}${row.error ? '\n'+row.error : ''}`);
        assert.ok(observed.results.length >= 16);
        assert.deepEqual(observed.results.filter(row=>!row.passed),[]);
        console.log(observed.browser);
    } finally {
        clearTimeout(timer);
        if (chrome && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve=>chrome.once('close',resolve)); }
        await new Promise(resolve=>server.close(resolve));
        await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
});
