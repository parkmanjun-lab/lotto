import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=resolve(root,'lib/app-version.ts');
const files=[];
function walk(path){if(!existsSync(path))return;for(const item of readdirSync(path,{withFileTypes:true})){const child=resolve(path,item.name);if(item.isDirectory())walk(child);else if(item.isFile()&&child!==output)files.push(child)}}
for(const directory of ['app','components','hooks','lib','public','build','scripts','db','drizzle','compat'])walk(resolve(root,directory));
for(const name of ['middleware.ts','package.json','package-lock.json','vite.config.ts','next.config.ts','tsconfig.json','.openai/hosting.json'])if(existsSync(resolve(root,name)))files.push(resolve(root,name));
const hash=createHash('sha256');
for(const file of files.sort()){hash.update(relative(root,file));hash.update('\0');hash.update(readFileSync(file));hash.update('\0')}
const version=hash.digest('hex').slice(0,24);
const source=`// Generated from application source by scripts/app-version.mjs. Do not edit.\nexport const APP_VERSION = '${version}';\n`;
if(!existsSync(output)||readFileSync(output,'utf8')!==source)writeFileSync(output,source);
console.log(`App version: ${version}`);
