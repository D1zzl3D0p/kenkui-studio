import { expect,it } from 'vitest';
import { releaseEnvironment } from '../scripts/release-config.mjs';
const pin={apiOrigin:'https://api.staging.kenkui.fm',issuer:'https://auth.invalid/db/auth',jwksUrl:'https://auth.invalid/db/auth/jwks',clientId:'public',resource:'https://api.staging.kenkui.fm'};
it('derives web/native pins and selected origin from one validated release input',()=>{
  const env=releaseEnvironment('staging',{staging:[pin],production:[]});
  expect(env.VITE_KENKUI_AUTH_AUTHORITIES).toBe(env.KENKUI_AUTH_AUTHORITIES);
  expect(JSON.parse(env.KENKUI_AUTH_AUTHORITIES)).toEqual([pin]);
  expect(env.VITE_KENKUI_NATIVE_API_ORIGIN).toBe(pin.apiOrigin);
});
it('fails official releases closed on missing, duplicate, mixed or malformed authority',()=>{
  for(const pins of [[],[pin,pin],[{...pin,resource:'https://wrong.invalid'}],[{...pin,apiOrigin:'https://api.kenkui.fm'}],[{...pin,extra:true}],[{...pin,clientId:''}]])expect(()=>releaseEnvironment('staging',{staging:pins,production:[]})).toThrow();
  expect(()=>releaseEnvironment('production',{staging:[pin],production:[]})).toThrow();
  expect(releaseEnvironment('local',{}).KENKUI_AUTH_AUTHORITIES).toBe('[]');
});
