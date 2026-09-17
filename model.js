/* Workflow Economics Lab — deterministic expected-flow model, v1.1.
   All numerical coefficients are illustrative, not fitted to research.
   UMD-style export keeps the same model executable in a browser and in Node. */
(function (root) {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const logistic = x => 1 / (1 + Math.exp(-x));
  const logit = p => Math.log(clamp(p, .0001, .9999) / (1 - clamp(p, .0001, .9999)));
  const defaults = {
    horizon: 26, demand: 20, variability: .35, coupling: .65, verifiability: .85,
    teamSize: 1, hoursPerPerson: 40, taskHours: 2, humanPrice: 100, value: 350, failureLoss: 200,
    aiFit: .72, manualFit: .95, aiPrice: 2, machineTime: .15, machineHours: 40,
    assistSaving: .5, assistOverhead: .06,
    serial: .2, drift: .008, discount: .08,
    learningScale: 100, noveltyPenalty: 1.8, capabilityGain: 1.8, computeGain: .8,
    detectionGain: 7, debtQuality: .8, debtFriction: .65, debtScale: 35,
    structuralDebt: .10, escapedDebt: 1.6, repairSuccess: .94, tuningEffect: 2,
    feedbackEffect: .35, tuningDecay: 80
  };
  const presets = [
    {id:'manual', name:'Manual expert', short:'Manual', color:'#77796f', ai:false, autonomy:0, setup:0, direct:1, review:.2, repair:1, compute:0, upkeep:1, tuning:0, parallel:1},
    {id:'rapid', name:'Vibe coding', short:'Vibe coding', color:'#cb673c', ai:true, autonomy:1, setup:1, direct:.17, review:.05, repair:.65, compute:1, upkeep:.25, tuning:.25, parallel:2},
    {id:'volume', name:'Mass generation', short:'Mass generation', color:'#b74967', ai:true, autonomy:1, setup:48, direct:.025, review:.025, repair:.1, compute:.8, upkeep:1, tuning:1, parallel:12},
    {id:'assisted', name:'Thoughtful assistance', short:'Assisted', color:'#547dab', ai:true, autonomy:0, setup:10, direct:.3, review:.2, repair:1, compute:1.5, upkeep:1.5, tuning:1, parallel:3},
    {id:'engineered', name:'Engineered automation', short:'Engineered', color:'#277962', ai:true, autonomy:1, setup:120, direct:.07, review:.28, repair:.95, compute:2.5, upkeep:4, tuning:10, parallel:8}
  ];
  const scenarios = {
    evolving: {label:'An evolving product', description:'Related tasks accumulate into a shared system. Shortcuts can make later work harder.', values:{}},
    repeatable: {label:'Repeatable, verifiable work', description:'Similar inputs, clear checks, and little carry-over between tasks.', values:{demand:60, variability:.1, coupling:.08, verifiability:.98, serial:.05, failureLoss:100}},
    novel: {label:'Novel work, costly mistakes', description:'Unfamiliar tasks, imperfect verification, and expensive defects.', values:{demand:8, variability:.85, coupling:.4, verifiability:.45, serial:.6, failureLoss:2000, value:900}},
    short: {label:'A short-lived experiment', description:'A small amount of disposable work and little time to recover setup effort.', values:{horizon:4, demand:6, variability:.35, coupling:0, failureLoss:20, value:300, serial:.1}}
  };
  const humanCapacity=p=>p.teamSize*p.hoursPerPerson;
  function economics(p, s, k, debt) {
    const burden = debt / (p.debtScale * p.taskHours);
    const autonomy=s.ai ? clamp(s.autonomy ?? 1) : 0;
    const craft=autonomy*k+(1-autonomy)*.9;
    const autonomousFirst=logistic(logit(p.aiFit)+p.computeGain*Math.log(Math.max(.1,s.compute))+p.capabilityGain*k
      -p.noveltyPenalty*p.variability*(1-k)-p.debtQuality*Math.log1p(burden));
    const expertFirst=logistic(logit(p.manualFit)-p.noveltyPenalty*p.variability*.35-p.debtQuality*Math.log1p(burden));
    const first=autonomy*autonomousFirst+(1-autonomy)*expertFirst;
    const autoDetect=1-Math.exp(-p.detectionGain*s.review*p.verifiability*(1+.4*k));
    const expertDetect=1-Math.exp(-p.detectionGain*s.review*p.verifiability*(1+.4*.9));
    // Mix flows AFTER conditional detection, rather than multiplying mixed probabilities.
    const caught=autonomy*(1-autonomousFirst)*autoDetect+(1-autonomy)*(1-expertFirst)*expertDetect;
    const detect=1-first>1e-12 ? caught/(1-first) : 0;
    const fix = clamp(p.repairSuccess / (1 + .45*p.variability + .2*burden));
    const repairFraction = caught*s.repair;
    const good = first + repairFraction*fix;
    const bad = Math.max(0,1-first-caught);
    const released = good+bad;
    const rejected = Math.max(0,1-released);
    const autoReleased=autonomousFirst+(1-autonomousFirst)*(1-autoDetect+autoDetect*s.repair*fix);
    const expertReleased=expertFirst+(1-expertFirst)*(1-expertDetect+expertDetect*s.repair*fix);
    const structuralYield=autonomy*autoReleased*(1-k)+(1-autonomy)*expertReleased*.1;
    // Expert-led assistance saves subtask time without replacing expert correctness
    // with standalone AI correctness. It still pays for interaction and API use.
    const assistSaving=s.ai ? p.assistSaving*(.8+.2*k)/(1+.2*p.variability) : 0;
    const interaction=s.ai ? p.assistOverhead*(1+p.variability*(1-k)) : 0;
    const expertDirect=s.ai ? 1-assistSaving+interaction : s.direct;
    const autoDirect=s.direct+.12*p.variability*(1-k);
    const directH=p.taskHours*(autonomy*autoDirect+(1-autonomy)*expertDirect)*(1+p.debtFriction*burden);
    const reviewH = p.taskHours * s.review * (1 + .3*burden);
    const repairH = p.taskHours * .65 * repairFraction * (1 + p.variability*.4 + burden*.5);
    const humanH = directH + reviewH + repairH;
    const machineH = s.ai ? p.machineTime * s.compute * (1+.3*burden) / (1+.5*k) : 0;
    const machineCost = s.ai ? p.aiPrice*s.compute*(1+.3*burden) : 0;
    const effectiveParallel = s.ai ? 1 / (p.serial + (1-p.serial)/s.parallel) : 1;
    return {burden,craft,autonomy,autonomousFirst,expertFirst,assistSaving,interaction,first,detect,fix,good,bad,released,rejected,structuralYield,directH,reviewH,repairH,humanH,machineH,machineCost,effectiveParallel};
  }
  function simulate(p, s, options={}) {
    const dtTarget=options.dt || .03125;
    let t=0,k=0,debt=0,setupLeft=s.setup,attempts=0,good=0,bad=0,shipped=0,backlog=0;
    let human=0,cash=0,loss=0,npv=0,setupH=0,directH=0,reviewH=0,repairH=0,upkeepH=0,tuningH=0;
    let lastRate=0,lastAttemptRate=0,lastHumanRate=0,lastMachineRate=0,lastCapacity=0,lastBottleneck='Setup',lastPeriodEffort=null;
    function point() {
      const e=economics(p,s,k,debt), spend=human*p.humanPrice+cash;
      return {t,k,debt,setupLeft,attempts,good,bad,shipped,backlog,human,cash,loss,spend,npv,
        net:p.value*good-loss-spend,setupH,directH,reviewH,repairH,upkeepH,tuningH,
        quality:shipped>1e-10 ? good/shipped : null,
        humanPerGood:good>1e-10 ? human/good : null,
        costPerGood:good>1e-10 ? (spend+loss)/good : null,
        throughput:t>0 ? good/t : 0, rate:lastRate, attemptRate:lastAttemptRate,
        humanRate:lastHumanRate,machineRate:lastMachineRate,capacity:lastCapacity,
        bottleneck:lastBottleneck,periodEffort:lastPeriodEffort,
        nextHuman:e.humanH/e.good, nextCost:(e.humanH*p.humanPrice+e.machineCost+e.bad*p.failureLoss)/e.good,
        nextQuality:e.good/e.released, firstPass:e.first, detection:e.detect,
        serviceHours:e.humanH+e.machineH, effectiveParallel:e.effectiveParallel};
    }
    const rows=[point()];
    while(t<p.horizon-1e-9) {
      const dt=Math.min(dtTarget,p.horizon-t);
      backlog += p.demand*dt;
      const budget=humanCapacity(p)*dt;
      const setup=Math.min(setupLeft,budget);
      setupLeft=Math.max(0,setupLeft-setup); setupH+=setup;
      // Setup occupies the full team. Other work uses only the remaining interval.
      const activeDt=dt-setup/humanCapacity(p);
      let available=budget-setup;
      const tuningWanted=s.tuning*Math.exp(-attempts/p.tuningDecay)*activeDt;
      const upkeepWanted=s.upkeep*activeDt;
      const overheadScale=Math.min(1,available/Math.max(1e-12,tuningWanted+upkeepWanted));
      const tuning=tuningWanted*overheadScale, upkeep=upkeepWanted*overheadScale;
      available=Math.max(0,available-tuning-upkeep);
      // Half of upkeep maintains infrastructure, half can retire accumulated debt.
      debt=Math.max(0,debt-upkeep*.5);
      const e=economics(p,s,k,debt);
      const humanCap=available/Math.max(1e-12,e.humanH);
      const machineCap=s.ai ? p.machineHours*activeDt*e.effectiveParallel/Math.max(1e-12,e.machineH) : Infinity;
      const demandCap=backlog/Math.max(1e-12,e.released);
      const n=Math.max(0,Math.min(humanCap,machineCap,demandCap));
      const useful=n*e.good, escaped=n*e.bad, released=useful+escaped;
      backlog=Math.max(0,backlog-released); attempts+=n;good+=useful;bad+=escaped;shipped+=released;
      const dh=n*e.directH,rh=n*e.reviewH,fh=n*e.repairH;
      const hh=setup+tuning+upkeep+dh+rh+fh;
      directH+=dh; reviewH+=rh; repairH+=fh;upkeepH+=upkeep;tuningH+=tuning;human+=hh;
      const aiCost=n*e.machineCost; cash+=aiCost;loss+=escaped*p.failureLoss;
      const stepNet=useful*p.value-escaped*p.failureLoss-hh*p.humanPrice-aiCost;
      npv+=stepNet/Math.pow(1+p.discount,(t+dt/2)/52);
      const debtAdded=p.coupling*p.taskHours*(p.escapedDebt*escaped+p.structuralDebt*n*e.structuralYield);
      debt+=debtAdded;
      const learning=(setup+p.tuningEffect*tuning+p.feedbackEffect*rh)/(p.learningScale*(1+2*p.variability));
      if(s.ai) k=clamp(1-(1-k)*Math.exp(-learning));
      if(s.ai) k*=Math.exp(-p.drift*dt);
      lastRate=useful/dt;lastAttemptRate=n/dt;lastHumanRate=hh/dt;lastMachineRate=n*e.machineH/dt;
      lastCapacity=activeDt>1e-10 ? Math.min(humanCap,machineCap)*e.good/activeDt : 0;
      lastPeriodEffort=useful>1e-10 ? hh/useful : null;
      lastBottleneck=activeDt<1e-10 ? 'Setup' : available<1e-10 ? 'Upkeep & tuning' : demandCap<=Math.min(humanCap,machineCap)+1e-9 ? 'Demand' : humanCap<=machineCap ? 'Human time' : 'Machine time';
      t=Math.min(p.horizon,t+dt);rows.push(point());
    }
    return rows;
  }
  function compare(p, strategies=presets, options={}) {
    const all=strategies.map(s=>({strategy:s,rows:simulate(p,s,options)}));
    const baseline=all.find(x=>x.strategy.id==='manual') || {rows:simulate(p,presets[0],options)};
    all.forEach(run=>run.rows.forEach((r,i)=>{r.delta=r.npv-baseline.rows[i].npv;}));
    return all;
  }
  function surface(p,s,baseline,steps=17) {
    if(!s.ai) {
      const r=simulate(p,s,{dt:.0625}).at(-1);
      return {baselineOnly:true,setup:[s.setup],review:[s.review*100],z:[[0]],quality:[[r.quality===null?null:100*r.quality]],effort:[[r.humanPerGood]],useful:[[r.good]]};
    }
    const setup=Array.from({length:steps},(_,i)=>240*i/(steps-1));
    const review=Array.from({length:steps},(_,i)=>.8*i/(steps-1));
    const z=[], quality=[], effort=[], useful=[];
    for(const r of review) {
      const zz=[],qq=[],ee=[],gg=[];
      for(const setupHours of setup) {
        const rows=simulate(p,{...s,setup:setupHours,review:r},{dt:.0625});
        const end=rows[rows.length-1];
        zz.push((end.npv-baseline)/1000);qq.push(end.quality===null?null:100*end.quality);ee.push(end.humanPerGood);gg.push(end.good);
      }
      z.push(zz);quality.push(qq);effort.push(ee);useful.push(gg);
    }
    return {setup,review:review.map(r=>r*100),z,quality,effort,useful};
  }
  // Shared multiplicative parameter uncertainty, seeded and paired across workflows.
  // Quantiles describe this chosen distribution; they are NOT empirical confidence intervals.
  function uncertainty(p,strategies,spread=.2,n=160,seed=1837) {
    let state=seed>>>0;
    const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return (state+.5)/4294967296;};
    const normal=()=>Math.sqrt(-2*Math.log(rand()))*Math.cos(2*Math.PI*rand());
    const perturbProbability=probability=>{const z=normal();return probability===0?0:logistic(logit(probability)+spread*z);};
    const samples=strategies.map(()=>[]);
    for(let i=0;i<n;i++) {
      const perturb=()=>Math.exp(spread*normal()-.5*spread*spread);
      const pp={...p,aiFit:perturbProbability(p.aiFit),manualFit:perturbProbability(p.manualFit),
        assistSaving:perturbProbability(p.assistSaving),assistOverhead:p.assistOverhead*perturb(),
        learningScale:p.learningScale*perturb(),escapedDebt:p.escapedDebt*perturb(),debtFriction:p.debtFriction*perturb(),
        aiPrice:p.aiPrice*perturb(),value:p.value*perturb(),failureLoss:p.failureLoss*perturb()};
      compare(pp,strategies,{dt:.0625}).forEach((run,j)=>samples[j].push(run.rows.at(-1).delta));
    }
    const q=(xs,f)=>{const a=xs.slice().sort((x,y)=>x-y),ix=(a.length-1)*f;return a[Math.floor(ix)]+(a[Math.ceil(ix)]-a[Math.floor(ix)])*(ix%1);};
    return samples.map((xs,i)=>({strategy:strategies[i],p10:q(xs,.1),p50:q(xs,.5),p90:q(xs,.9),share:xs.filter(x=>x>0).length/n}));
  }
  function sample(rows,time) {
    const t=clamp(time,0,rows.at(-1).t);
    let lo=0,hi=rows.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(rows[mid].t<=t)lo=mid;else hi=mid-1;}
    const a=rows[lo],b=rows[Math.min(lo+1,rows.length-1)];
    if(a.t===t||a===b)return {...a};
    const f=(t-a.t)/(b.t-a.t),r={...a,t};
    for(const key of Object.keys(a))if(typeof a[key]==='number'&&typeof b[key]==='number')r[key]=a[key]+f*(b[key]-a[key]);
    r.quality=r.shipped>1e-10?r.good/r.shipped:null;
    r.humanPerGood=r.good>1e-10?r.human/r.good:null;
    r.costPerGood=r.good>1e-10?(r.spend+r.loss)/r.good:null;
    r.throughput=t>0?r.good/t:0;
    return r;
  }
  const api={defaults,presets,scenarios,humanCapacity,economics,simulate,compare,surface,uncertainty,sample,logistic,logit};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.WorkflowModel=api;
})(typeof window!=='undefined'?window:globalThis);
