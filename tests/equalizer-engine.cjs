const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const ts=require('typescript');
const root=path.join(__dirname,'../src');const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const module={exports:{}};cache.set(file,module.exports);const src=fs.readFileSync(file,'utf8');const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const requireLocal=id=>id==='react'?require('react'):id.startsWith('.')?load(path.resolve(path.dirname(file),id)+(path.extname(id)?'':'.ts')):require(id);vm.runInNewContext(code,{module,exports:module.exports,require:requireLocal,console,window:{setTimeout,clearTimeout},setTimeout,clearTimeout,URL,Float32Array,Uint32Array,Map,WeakMap,Date,Math});return module.exports;}
(async()=>{const {AudioAnalyzerEngine}=load(root+'/audioEngine.ts');const engine=new AudioAnalyzerEngine();let passed=0;const check=(truth,name)=>{assert(truth,name);passed++;console.log('PASS '+name);};
// Missing EQ integration must fail here before any implementation.
check(typeof engine.setEqualizer==='function','engine exposes original/EQ control');
let initial=engine.getMeasurementInfo().epoch;
engine.setEqualizer({low:{gain:4}});check(engine.getMeasurementInfo().epoch===initial,'editing stored B while A is selected preserves A measurement');
engine.setEqualizer({mode:'B'});check(engine.getMeasurementInfo().epoch>initial,'selecting B starts fresh measurement even without playback');
initial=engine.getMeasurementInfo().epoch;engine.setEqualizer({mode:'B'});check(engine.getMeasurementInfo().epoch===initial,'selecting active mode again does not reset measurement');
engine.setEqualizer({mid:{gain:3}});check(engine.getMeasurementInfo().epoch>initial,'editing active B starts fresh measurement');
const state=engine.getEqualizerState();state.low.gain=999;check(engine.getEqualizerState().low.gain===4,'callers cannot mutate engine EQ settings');
engine.setEqualizer({low:{gain:Infinity,frequency:-20},mid:{q:0},outputGain:-100});const safe=engine.getEqualizerState();check(Number.isFinite(safe.low.gain)&&safe.low.frequency>=20&&safe.mid.q>0&&safe.outputGain>=-24,'invalid and excessive EQ values cannot reach audio parameters');
engine.setEqualizer({mode:'A'});check(engine.getEqualizerState().mid.gain===3,'returning to A preserves B settings');
check(engine.getMeasurementInfo().processing.mode==='A','measurement reports identify original versus EQ');
check(engine.getAudioElement()===null&&!engine.getMeasurementInfo().running,'changing EQ does not create a source or start playback');
console.log('PASS '+passed+' EQ engine checks');})().catch(e=>{console.error(e);process.exitCode=1;});
