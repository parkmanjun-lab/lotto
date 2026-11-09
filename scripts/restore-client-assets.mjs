import {readFileSync,existsSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(readFileSync(resolve(root,'scripts/retained-client-assets.json'),'utf8'));
const actual=readdirSync(resolve(root,'compat/client'),{recursive:true,withFileTypes:true}).filter(x=>x.isFile()).map(x=>resolve(x.parentPath,x.name).slice(resolve(root,'compat/client').length+1)).sort();
if(JSON.stringify(actual)!==JSON.stringify(Object.keys(manifest.files).sort()))throw Error('Retained source set differs from bounded manifest; review stale generated assets');
const entries=Object.entries(manifest.files);if(entries.length>60)throw Error('Retained asset count exceeded');let total=0;
for(const [name,hash] of entries){
 if(!/^_next\/static\/(?:chunks\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js|css\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.css)$/.test(name))throw Error('Invalid retained asset path');
 const data=readFileSync(resolve(root,'compat/client',name));total+=data.length;
 if(total>4000000||createHash('sha256').update(data).digest('hex')!==hash)throw Error('Retained asset integrity failed');
 const target=resolve(root,'dist/client',name);
 if(existsSync(target)&&!readFileSync(target).equals(data))throw Error('Hash filename collision');
 mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data);
}
console.log(`Restored ${entries.length} prior hashed public assets (${total} bytes); no HTML/API responses retained.`);
