const vm=require('vm'),fs=require('fs');
function load(){const w={};const c=vm.createContext({window:w});vm.runInContext(fs.readFileSync(__dirname+'/../../src/ai-prompt.js','utf8'),c,{timeout:5000});return w.Folio.aiPrompt;}
const a=load(),b=load();
console.log('system',a.system.length,'tools',JSON.stringify(a.tools).length,'names',a.tools.map(t=>t.name).join(','));
console.log('stable', a.system===b.system && JSON.stringify(a.tools)===JSON.stringify(b.tools));
const ex=a.system.slice(a.system.lastIndexOf('\n{')+1); JSON.parse(ex); console.log('example json ok', ex.length);
if(process.argv[2]) fs.writeFileSync(process.argv[2], a.system);
