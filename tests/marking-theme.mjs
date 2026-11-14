import fs from 'node:fs';import assert from 'node:assert/strict';
const css=fs.readFileSync('app/marking-theme.css','utf8'),layout=fs.readFileSync('app/layout.tsx','utf8');
assert(layout.indexOf("import './globals.css'")<layout.indexOf("import './marking-theme.css'"),'theme loads after globals');
assert(!/backdrop-filter:\s*blur/.test(css),'no backdrop blur (mobile scrolling cost)');
assert(css.includes('backdrop-filter:none'),'tab bar blur removed');
assert(/@media \(prefers-reduced-motion:reduce\)/.test(css),'reduced motion respected');
assert(!/infinite/.test(css.replace(/\[aria-busy="true"\][^}]*}/,'')),'only the busy refresh icon loops');
for(const m of css.matchAll(/animation:[^;}]*?([\d.]+)s/g))assert(Number(m[1])<=0.7,`animation ${m[0]} at most .7s`);
for(const m of css.matchAll(/@keyframes [\w-]+\{([^@]*?)\}\}/g))assert(!/(width|height|top|left|margin|padding)\s*:/.test(m[1]),'keyframes animate transform/opacity only');
const luminance=h=>{const c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
for(const [fg,bg] of [['6b6d80','f3f4f7'],['6b6d80','ffffff'],['bc2358','ffffff'],['bc2358','fbe7ef'],['ffffff','1a1b2e'],['9a5b00','ffffff'],['24804f','ffffff'],['c0303b','ffffff'],['1a1b2e','f3f4f7'],['45475e','fbe7ef']]){const r=ratio(fg,bg);assert(r>=4.5,`${fg}/${bg}: ${r}`)}
assert(fs.existsSync('public/fonts/archivo-condensed-700.woff2')&&fs.statSync('public/fonts/archivo-condensed-700.woff2').size<12000,'small self-hosted numeral font');
assert(fs.existsSync('public/fonts/Archivo-OFL.txt'));
console.log('MARKING THEME PASS: load order, no blur, reduced motion, short transform-only motion, 10 contrast pairs >= 4.5:1, font subset.');
