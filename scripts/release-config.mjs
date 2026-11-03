import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function releaseEnvironment(environment,input) {
  if(environment==='local')return {KENKUI_AUTH_AUTHORITIES:'[]',VITE_KENKUI_AUTH_AUTHORITIES:'[]'};
  if(!['staging','production'].includes(environment))throw Error('Select local, staging or production explicitly');
  const origin=environment==='staging'?'https://api.staging.kenkui.fm':'https://api.kenkui.fm';
  const entries=input[environment];
  if(!Array.isArray(entries)||entries.length!==1)throw Error('Release requires the selected independently reviewed authority');
  const seenOrigins=new Set(),seenIssuers=new Set();
  const https=value=>{
    if(typeof value!=='string')throw Error('Invalid release authority');
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.href!==value||value.includes('?')||value.includes('#'))throw Error('Invalid release authority');
    return url;
  };
  // Validate the whole release input; one broken/unreviewed environment cannot add trust.
  for(const [name,list] of Object.entries(input)) {
    if(!['staging','production'].includes(name)||!Array.isArray(list))throw Error('Invalid release input');
    for(const entry of list) {
      if(!entry||typeof entry!=='object'||Object.keys(entry).sort().join(',')!=='apiOrigin,clientId,issuer,jwksUrl,resource')throw Error('Invalid release authority');
      const api=new URL(entry.apiOrigin),issuer=https(entry.issuer);https(entry.jwksUrl);
      if(api.protocol!=='https:'||api.origin!==entry.apiOrigin||entry.apiOrigin!==(name==='staging'?'https://api.staging.kenkui.fm':'https://api.kenkui.fm')||
        entry.resource!==entry.apiOrigin||issuer.pathname.endsWith('/')||typeof entry.clientId!=='string'||!entry.clientId.trim()||seenOrigins.has(entry.apiOrigin)||seenIssuers.has(issuer.origin))throw Error('Invalid release authority');
      seenOrigins.add(entry.apiOrigin);seenIssuers.add(issuer.origin);
    }
  }
  if(entries[0].apiOrigin!==origin)throw Error('Wrong release recipient');
  const encoded=JSON.stringify(entries);
  return {VITE_KENKUI_AUTH_AUTHORITIES:encoded,KENKUI_AUTH_AUTHORITIES:encoded,VITE_KENKUI_API_ORIGIN:origin,VITE_KENKUI_NATIVE_API_ORIGIN:origin};
}
export function loadRelease(environment) {
  return releaseEnvironment(environment,JSON.parse(readFileSync(new URL('../release/auth-authorities.json',import.meta.url),'utf8')));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [environment,flag,...command]=process.argv.slice(2),env=loadRelease(environment);
  if(flag==='--') {
    if(!command.length)throw Error('A build command is required');
    const result=spawnSync(command[0],command.slice(1),{stdio:'inherit',env:{...process.env,...env}});
    if(result.error)throw result.error;process.exit(result.status??1);
  }
  if(flag==='--github-env') {
    if(!process.env.GITHUB_ENV)throw Error('GITHUB_ENV is unavailable');
    for(const [name,value] of Object.entries(env))appendFileSync(process.env.GITHUB_ENV,`${name}=${value}\n`);
  } else if(flag && flag!=='--check')throw Error('Unknown release option');
  console.log('Validated Studio release: '+environment);
}
