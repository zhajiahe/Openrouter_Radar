import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';

// Resolve deployment-specific social/canonical URLs during HTML generation.
// Self-hosted instances may override the config value with VITE_SITE_ORIGIN.
function siteOrigin(){
 const config=JSON.parse(readFileSync(resolve(process.cwd(),'wrangler.jsonc'),'utf8')) as {vars?:{APP_ORIGIN?:string}};
 const configured=process.env.VITE_SITE_ORIGIN||config.vars?.APP_ORIGIN;
 if(!configured)throw new Error('Set APP_ORIGIN (or VITE_SITE_ORIGIN) before building the site');
 const url=new URL(configured);
 if(url.protocol!=='https:'&&url.hostname!=='localhost')throw new Error('Public site origin must use HTTPS');
 return url.origin;
}

export default defineConfig({
 root:'web',
 plugins:[{
  name:'radar-public-origin',
  transformIndexHtml(html){return html.replaceAll('__SITE_ORIGIN__',siteOrigin());}
 }],
 build:{outDir:'dist',emptyOutDir:true},
 server:{proxy:{'/api':'http://localhost:8787','/feed.xml':'http://localhost:8787'}}
});
