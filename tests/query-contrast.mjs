import fs from'node:fs';import assert from'node:assert/strict';
const css=fs.readFileSync('app/globals.css','utf8'),delta=css.split('/* White primary-action lettering;')[1]?.split('/* Selected readable option02:')[0];assert(delta);assert(delta.includes('.settings .query{background:#c64d46;color:#ffffff}'));assert(delta.includes('.settings .query:active{background:#bd463f}'));assert(delta.includes('.settings .query:disabled{opacity:1}'));assert(!/font-size|height|padding|margin|width/.test(delta));
const lum=h=>h.match(/../g).map(v=>parseInt(v,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
for(const bg of['c64d46','bd463f']){const r=1.05/(lum(bg)+.05);assert(r>=4.5);console.log(`White on ${bg}: ${r.toFixed(2)}:1`)}
console.log('Primary query only: normal/active/disabled foreground readable; geometry unchanged.');
