import {readFile,writeFile} from 'node:fs/promises';
import {Resvg} from '@resvg/resvg-js';

const dir=new URL('../web/public/',import.meta.url);
const icon=await readFile(new URL('favicon.svg',dir),'utf8');
const social=await readFile(new URL('social-card.svg',dir),'utf8');
function png(svg,width,loadFonts=false){
 return new Resvg(svg,{fitTo:{mode:'width',value:width},font:{loadSystemFonts:loadFonts}}).render().asPng();
}
function ico(entries){
 // PNG-compressed ICO frames are supported by modern Windows and browsers.
 const header=Buffer.alloc(6+entries.length*16);
 header.writeUInt16LE(1,2);
 header.writeUInt16LE(entries.length,4);
 let offset=header.length;
 entries.forEach(([size,data],index)=>{
  const at=6+index*16;
  header[at]=size;
  header[at+1]=size;
  header.writeUInt16LE(1,at+4);
  header.writeUInt16LE(32,at+6);
  header.writeUInt32LE(data.length,at+8);
  header.writeUInt32LE(offset,at+12);
  offset+=data.length;
 });
 return Buffer.concat([header,...entries.map(([,data])=>data)]);
}
const favicons=[16,32,48].map(size=>[size,png(icon,size)]);
const assets=[
 ['favicon.ico',ico(favicons)],
 ['favicon-32.png',favicons[1][1]],
 ['apple-touch-icon.png',png(icon,180)],
 ['icon-192.png',png(icon,192)],
 ['icon-512.png',png(icon,512)],
 ['social-card.png',png(social,1200,true)]
];
await Promise.all(assets.map(([name,data])=>writeFile(new URL(name,dir),data)));
console.log('Generated browser icons, Apple touch icon and 1200x630 social preview');
