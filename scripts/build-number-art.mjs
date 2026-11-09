import fs from 'node:fs/promises';
import sharp from 'sharp';
import {ball} from '../design/number-art/approved-renderer.mjs';
const images={reference:'data:image/png;base64,'+(await fs.readFile('design/number-art/reference03.png')).toString('base64'),added:'data:image/png;base64,'+(await fs.readFile('design/number-art/missing-digits.png')).toString('base64')};
await fs.mkdir('public/numbers-v19',{recursive:true});
for(let n=1;n<=45;n++){
 const art=ball(n,0,0,152,images).replace(/<circle[^>]*\/>/,'');
 await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="152" height="152">${art}</svg>`)).png({compressionLevel:9}).toFile(`public/numbers-v19/${n}.png`);
}
console.log('Generated 45 approved number assets at 4x resolution.');
