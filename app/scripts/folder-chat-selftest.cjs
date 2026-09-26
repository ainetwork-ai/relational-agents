// Isolated route test: real NextRequest/Response and path boundary, mocked account services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const next = require('next/server');
function compile(file, deps) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`)(id => {
    if (!(id in deps)) throw new Error(`Unexpected dependency: ${id}`);
    return deps[id];
  }, module, module.exports);
  return module.exports;
}
const boundary = compile('../src/lib/ainui-boundary.ts', {});
let user = 'owner', creator = 'owner', calls = 0, lastBody;
const source = '/api/aindrive/links/11111111-1111-1111-1111-111111111111';
const route = compile('../src/app/api/ainui/folder-chat/route.ts', {
  'next/server': next,
  '@/lib/auth/middleware': { requireAuth: async () => user ? {user:{id:user}} : {error:new Response('',{status:401})} },
  '@/lib/aindrive': { requestAindriveFolderChat: async (link, body) => {
    calls++; lastBody = body;
    return new Response('data: {"type":"RUN_FINISHED"}\n\n', {headers:{'content-type':'text/event-stream'}});
  } },
  '@/lib/aindrive-account': { runAs: async (id, fn) => {assert.equal(id,user); return fn();} },
  '@/lib/aindrive-teamspace': { teamspaceDrive: async () => ({link:{driveId:'drive1',root:'shared'},drive:{createdBy:creator}}) },
  '@/lib/aindrive-user': { userLink: async () => null },
  '@/lib/aindrive-file-sale': { mayOpen: async () => true },
  '@/lib/ainui-boundary': boundary,
});
const request = body => new next.NextRequest('http://test/api/ainui/folder-chat', {method:'POST',body:JSON.stringify(body)});
(async () => {
  const r = await route.POST(request({source,path:'shared/sub',q:'What is here?',agentId:'cloud'}));
  assert.equal(r.status,200); assert.equal(r.headers.get('content-type'),'text/event-stream');
  assert.equal(await r.text(),'data: {"type":"RUN_FINISHED"}\n\n'); assert.equal(lastBody.path,'shared/sub');
  for (const bad of ['other','shared/../secret','shared-other']) assert.equal((await route.POST(request({source,path:bad,q:'q'}))).status,403);
  creator='someone-else'; assert.equal((await route.POST(request({source,path:'shared',q:'q'}))).status,403);
  user=''; assert.equal((await route.POST(request({source,path:'shared',q:'q'}))).status,401);
  assert.equal(calls,1);
  console.log('Folder chat relay checks passed: ownership, subtree boundaries, account identity and SSE passthrough.');
})().catch(e => {console.error(e);process.exitCode=1;});
