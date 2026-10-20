import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';

const baseline=path.resolve('artifacts/baseline');
const current=path.resolve('artifacts/current');
const diffDir=path.resolve('artifacts/diff');
fs.mkdirSync(diffDir,{recursive:true});
function files(dir,root=dir){
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const full=path.join(dir,e.name);
  return e.isDirectory()?files(full,root):e.name.endsWith('.png')?[path.relative(root,full)]:[];
 });
}
const pairs=files(current).sort();
const records=[];
for(const rel of pairs){
 const previous=path.join(baseline,rel);
 const next=path.join(current,rel);
 if(!fs.existsSync(previous)){records.push({file:rel,notice:'无基线（新增截图）'});continue;}
 const a=PNG.sync.read(fs.readFileSync(previous));
 const b=PNG.sync.read(fs.readFileSync(next));
 if(a.width!==b.width||a.height!==b.height){
  records.push({file:rel,notice:`尺寸变化：${a.width}×${a.height} → ${b.width}×${b.height}`});
  continue;
 }
 const diff=new PNG({width:a.width,height:a.height});
 const changed=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:.1,includeAA:false});
 const ratio=100*changed/(a.width*a.height);
 if(changed){
  const out=path.join(diffDir,rel);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,PNG.sync.write(diff));
 }
 records.push({file:rel,notice:`${ratio.toFixed(2)}% 像素变化`});
}
const lines=[
 '# Browser visual comparison',
 '',
 '同一套固定 API Mock + 相同 Chromium / 视口渲染：PR 分支与 main 基线的逐像素差异。此表用于评审，**视觉变化不自动视为缺陷**；布局/交互断言是阻断项。',
 '',
 '| 截图 | 变化 |',
 '| --- | --- |',
 ...records.map(r=>`| \`${r.file}\` | ${r.notice} |`),
 '',
 '截图、差异图和 Playwright trace 见构建的 visual-qa artifact。',
 '',
];
const markdown=lines.join('\n');
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/visual-diff.md',markdown);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown);
console.log(markdown);
