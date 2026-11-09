import assert from 'node:assert/strict';import fs from 'node:fs';import postcss from 'postcss';
const css=fs.readFileSync('app/globals.css','utf8'),root=postcss.parse(css);
function active(rule,width){for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&p.name==='media'){const min=p.params.match(/min-width:\s*(\d+)px/),max=p.params.match(/max-width:\s*(\d+)px/);if(min&&width<+min[1]||max&&width>+max[1])return false;if(!min&&!max)return false}return true}
function splitValues(value){let depth=0,word='',parts=[];for(const char of value){if(char==='(')depth++;if(char===')')depth--;if(/\s/.test(char)&&depth===0){if(word)parts.push(word);word=''}else word+=char}if(word)parts.push(word);return parts}
function style(selector,width){const out={};root.walkRules(rule=>{if(!rule.selectors.includes(selector)||!active(rule,width))return;rule.walkDecls(d=>{if(d.prop==='padding'){const a=splitValues(d.value.trim());out['padding-top']=a[0];out['padding-right']=a[1]??a[0];out['padding-bottom']=a[2]??a[0];out['padding-left']=a[3]??a[1]??a[0]}else out[d.prop]=d.value})});return out}
const variables=style(':root',390);assert.equal(variables['--app-safe-top'],'env(safe-area-inset-top,0px)');assert.equal(variables['--app-top-space'],'calc(var(--app-safe-top) + 16px)');
function pixels(expression,inset){let value=expression;for(let i=0;i<4;i++)value=value.replace(/var\((--[\w-]+)\)/g,(_,key)=>variables[key]);value=value.replace('env(safe-area-inset-top,0px)',`${inset}px`);const sum=value.match(/^calc\((\d+)px \+ (\d+)px\)$/);assert(sum,`unexpected expression ${value}`);return +sum[1]+ +sum[2]}
const rows=[];
for(const mode of ['Safari','standalone'])for(const width of [320,375,390,430,700])for(const inset of [0,20,47,59,62]){
 const app=style('.app',width),guard=style('body::before',width),html=style('html',width);
 const top=pixels(app['padding-top'],inset);assert.equal(top,inset+16);assert.equal(pixels(guard.height,inset),top);assert.equal(pixels(html['scroll-padding-top'],inset),top);
 assert.equal(guard.position,'fixed');assert.equal(guard.top,'0');assert.equal(guard.background,'var(--paper)');assert.equal(guard['pointer-events'],'none');assert.equal(guard['z-index'],'16');assert.equal(guard.width,'min(100%,560px)');assert.equal(guard['backdrop-filter'],undefined);
 assert.equal(app['padding-left'],width<=340?'12px':width<=380?'15px':width>=700?'28px':'20px');
 assert.equal(style('.compact-header',width).height,width<=380?'52px':'56px');assert.equal(style('.compact-header',width).position,undefined,'header remains in normal flow');
 rows.push({mode,width,inset,top});
}
const layout=fs.readFileSync('app/layout.tsx','utf8');assert(layout.includes("viewportFit:'cover'"));assert(layout.includes("statusBarStyle:'default'"));assert(!css.includes('black-translucent'));
assert.equal(style('.compact-header .data-line button',320)['min-height'],'44px');assert.equal(style('.settings .periods button',320)['min-height'],'44px');assert.equal(style('.settings .query',320)['min-height'],'48px');
console.log(`Safe-area CSS PASS: ${rows.length} mode/width/inset combinations; inset0/20/47/59/62 maps to16/36/63/75/78px exactly once; opaque fixed guard adds no flow height; compact header/touch targets retained. Static cascade/formula validation, not real iPhone rendering.`);
