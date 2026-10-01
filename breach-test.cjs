const fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(process.cwd()+'/src/audioEngine.ts','utf8');
const code=source.slice(source.indexOf('class LoudnessProcessor extends'),source.indexOf('`;',source.indexOf('class LoudnessProcessor extends')));
let Processor,latest;
vm.runInThisContext('global.sampleRate=48000;global.AudioWorkletProcessor=class { constructor(){this.port={postMessage:m=>{global.latest=m.metrics}}} };global.registerProcessor=(name,p)=>global.Processor=p;');
vm.runInThisContext(code); Processor=global.Processor;
function readWav(file){const b=fs.readFileSync(file);let fmt,data;for(let o=12;o+8<=b.length;){let n=b.readUInt32LE(o+4),id=b.toString('ascii',o,o+4);if(id==='fmt ')fmt=b.subarray(o+8,o+8+n);if(id==='data')data=b.subarray(o+8,o+8+n);o+=8+n+(n%2)}
 const count=fmt.readUInt16LE(2),sr=fmt.readUInt32LE(4),bits=fmt.readUInt16LE(14),size=bits/8;const frames=data.length/(count*size);let channels=Array.from({length:count},()=>new Float32Array(frames));
 for(let i=0,o=0;i<frames;i++)for(let c=0;c<count;c++,o+=size) channels[c][i]=data.readIntLE(o,size)/2**(bits-1);
 return {channels,sr,frames};}
const root='/Users/de4c/Downloads/ebu-loudness-test-setv05';let files=fs.readdirSync(root).filter(f=>/\.wav$/i.test(f));if(process.argv[2])files=files.filter(f=>new RegExp(process.argv[2]).test(f));let results=[];
for(const name of files){const {channels,sr,frames}=readWav(path.join(root,name));global.sampleRate=sr;const p=new Processor();const t=Date.now();for(let i=0;i<frames;i+=128)p.process([channels.map(c=>c.subarray(i,Math.min(i+128,frames)))],[]);
 const m=global.latest;results.push({name,channels:channels.length,...m});console.log(JSON.stringify({name,channels:channels.length,...m,seconds:(Date.now()-t)/1000}));fs.writeFileSync('/private/tmp/breach-ebu-corrected.json',JSON.stringify(results,null,2));}
const assert=require('assert');const tests=results.filter(x=>/^seq-/.test(x.name));let checks=0;
function close(value,expected,tolerance,name){assert(Math.abs(value-expected)<=tolerance,`${name}: ${value} expected ${expected} ±${tolerance}`);checks++}
for(const r of tests){const n=r.name;
 if(/^seq-3341-[1345]-/.test(n)||n.includes('3341-6-')||n.includes('3341-7_')||n.includes('3341-2011-8_'))close(r.integrated,-23,.1,n);
 if(/^seq-3341-2-/.test(n))close(r.integrated,-33,.1,n);
 if(n.includes('3341-10-'))close(r.maxShortTerm,-23,.1,n);
 if(n.includes('3341-13-'))close(r.maxMomentary,-23,.1,n);
 if(/^seq-3341-11-/.test(n))close(r.maxShortTerm,-19,.1,n);
 if(/^seq-3341-14-/.test(n))close(r.maxMomentary,-19,.1,n);
 const t=n.match(/^seq-3341-(1[5-9]|2[0-3])-/);if(t){const id=+t[1],expected=id<=18?-6:id===19?3:0;assert(r.maxPeak>=expected-.4&&r.maxPeak<=expected+.2,`${n}: ${r.maxPeak}`);checks++}
 const l=n.match(/^seq-3342-([1-4])-/);if(l)close(r.lra,[10,5,20,15][+l[1]-1],1,n);
 if(n.includes('3341-7_'))close(r.lra,5,1,n);
 if(n.includes('3341-2011-8_'))close(r.lra,15,1,n);
}
console.log(`PASS ${checks} numerical checks across ${results.length} files`);
// Synthetic regressions isolate reset, mono weighting, phase validity, and sample-rate adaptation.
for(const sr of [44100,48000,96000]){global.sampleRate=sr;const p=new Processor();const data=new Float32Array(sr*4);for(let i=0;i<data.length;i++)data[i]=.1*Math.sin(2*Math.PI*1000*i/sr);for(let i=0;i<data.length;i+=128)p.process([[data.subarray(i,i+128),data.subarray(i,i+128)]],[]);close(global.latest.crestFactor,3.01,.1,'stereo crest '+sr);assert(global.latest.phaseCorrelationValid);close(global.latest.phaseCorrelation,1,1e-9,'mono correlation');const stereo=global.latest.integrated;p.resetMetrics();for(let i=0;i<data.length;i+=128)p.process([[data.subarray(i,i+128)]],[]);close(stereo-global.latest.integrated,10*Math.log10(2),.001,'native mono '+sr);p.resetMetrics();assert(p.maxPeak===0&&p.samples===0&&p.gateCounts.every(x=>x===0));
 p.process([[new Float32Array(2048),new Float32Array(2048)]],[]);assert(!global.latest.phaseCorrelationValid,'silence invalid');
 p.resetMetrics();p.process([[data.subarray(0,2048),new Float32Array(2048)]],[]);assert(!global.latest.phaseCorrelationValid,'one silent channel invalid');}
console.log('PASS sample-rate, crest, mono, reset, and silent-channel regressions');
for(const [pattern,key,size] of [['3341-9-','shortTerm','sSize'],['3341-12-','momentary','mSize']]){
 const file=files.find(f=>f.includes(pattern));const {channels,sr,frames}=readWav(path.join(root,file));global.sampleRate=sr;const p=new Processor();let min=Infinity,max=-Infinity;
 for(let i=0;i<frames;i+=128){p.process([channels.map(c=>c.subarray(i,i+128))],[]);if(p.samples>=p[size]){const level=p.loudness((key==='shortTerm'?p.sSum:p.mSum)/p[size]);min=Math.min(min,level);max=Math.max(max,level)}}
 close(min,-23,.1,file+' minimum');close(max,-23,.1,file+' maximum');console.log('PASS continuous '+file+' range '+min+' to '+max);
}
for(const [pattern,segment,key] of [['3341-11-',6,'maxS'],['3341-14-',.8,'maxM']]){
 const file=files.find(f=>f.includes(pattern));const {channels,sr,frames}=readWav(path.join(root,file));global.sampleRate=sr;const p=new Processor();let step=0;
 for(let i=0;i<frames;i+=128){p.process([channels.map(c=>c.subarray(i,i+128))],[]);if(p.samples>=(step+1)*segment*sr&&step<20){close(p.loudness(p[key]),-38+step,.1,file+' step '+step);step++}}
 assert.equal(step,20);console.log('PASS all 20 successive maxima '+file);
}
for(const r of results){
 if(/^seq-3341-[12]-/.test(r.name)){const expected=r.name.startsWith('seq-3341-1-')?-23:-33;close(r.momentary,expected,.1,r.name+' M');close(r.shortTerm,expected,.1,r.name+' S')}
 if(r.name.startsWith('1kHz Sine')){const expected=-Number(r.name.match(/-(\d+) LUFS/)[1]);close(r.integrated,expected,.1,r.name)}
 if(r.name.startsWith('EBU-reference'))close(r.integrated,-23,.1,r.name);
}
global.sampleRate=48000;
const tone=new Float32Array(48000);for(let i=0;i<tone.length;i++)tone[i]=.5*Math.sin(Math.PI*i/2+Math.PI/4);
let referencePeak;
for(const chunk of [17,128,2048]){const p=new Processor();for(let i=0;i<tone.length;i+=chunk)p.process([[tone.subarray(i,i+chunk),tone.subarray(i,i+chunk)]],[]);if(referencePeak===undefined)referencePeak=p.maxPeak;close(p.maxPeak,referencePeak,1e-12,'continuous TP chunk '+chunk)}
const p=new Processor(),opposite=Float32Array.from(tone,x=>-x);p.process([[tone.subarray(0,2048),opposite.subarray(0,2048)]],[]);close(global.latest.phaseCorrelation,-1,1e-9,'opposite polarity');
console.log('PASS calibration, polarity, and true-peak render-boundary regressions');
