'use strict';
const assert=require('node:assert/strict');
const M=require('./model.js');
const p={...M.defaults};
let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const near=(a,b,epsilon=1e-7)=>Math.abs(a-b)<epsilon;

// Accounting identities and physical bounds must hold across dissimilar workloads.
for(const scenario of Object.values(M.scenarios)) {
  const pp={...p,...scenario.values};
  for(const run of M.compare(pp)) {
    const initial=run.rows[0];
    check(initial.delta===0&&initial.npv===0&&initial.human===0,'all accounts start at zero');
    check(initial.humanPerGood===null&&initial.costPerGood===null&&initial.quality===null,'zero-denominator metrics undefined');
    for(let i=1;i<run.rows.length;i++) {
      const r=run.rows[i],prev=run.rows[i-1];
      check(near(r.good+r.bad,r.shipped),'released = useful + escaped');
      check(near(r.shipped+r.backlog,pp.demand*r.t),'task conservation');
      check(near(r.setupH+r.directH+r.reviewH+r.repairH+r.upkeepH+r.tuningH,r.human),'human hour conservation');
      check(r.human-prev.human<=M.humanCapacity(pp)*(r.t-prev.t)+1e-7,'human capacity respected');
      check(near(r.spend,r.human*pp.humanPrice+r.cash),'cost accounting');
      check(near(r.net,r.good*pp.value-r.loss-r.spend),'value accounting');
      check(r.k>=0&&r.k<=1&&r.debt>=0&&r.backlog>=0,'state bounds');
      check(r.quality===null||(r.quality>=0&&r.quality<=1),'probability bounds');
      check(r.attempts>=r.shipped-1e-8,'candidate conservation');
      for(const [key,v] of Object.entries(r))if(typeof v==='number')check(Number.isFinite(v),'finite '+key);
    }
  }
}

const e={...M.presets.find(s=>s.id==='engineered')};
const er=M.simulate(p,e);
check(er.filter(r=>r.t<=e.setup/M.humanCapacity(p)).every(r=>r.good===0),'no output during setup');
const first=er.find(r=>r.good>0),end=er.at(-1);
check(first.humanPerGood>end.humanPerGood*5,'early cumulative effort includes setup');
check(M.simulate({...p,demand:0},e).every(r=>r.good===0&&r.humanPerGood===null),'zero demand does not invent results or ratios');
check(M.simulate({...p,coupling:0},M.presets[1]).every(r=>r.debt===0),'no carry-over means no accumulated debt');
check(M.simulate({...p,horizon:1},e).at(-1).good===0,'unfinished setup never delivers output');
check(M.compare(p)[0].rows.every(r=>r.delta===0),'manual is its own exact baseline');

// Review affects genuine and apparent correctness separately.
const zeroReview=M.economics(p,{...e,review:0},.2,0);
check(near(zeroReview.detect,0)&&near(zeroReview.released,1),'no review passes all candidates');
check(zeroReview.bad>0,'unreviewed errors remain possible');
const unverifiable=M.economics({...p,verifiability:0},e,.2,0);
check(unverifiable.detect===0,'unverifiable tasks defeat review');
const perfect=M.economics({...p,aiFit:.9999,manualFit:.9999,noveltyPenalty:0},e,1,0);
check(perfect.good>.99,'high fit can deliver high quality');
check(M.economics({...p,serial:1},e,.2,0).effectiveParallel===1,'fully serial work cannot be accelerated with slots');
check(M.economics({...p,serial:0},e,.2,0).effectiveParallel===e.parallel,'independent machine work uses all slots');
const machineLimited=M.simulate({...p,machineHours:1,machineTime:8,demand:100},e);
check(machineLimited.at(-1).bottleneck==='Machine time','machine capacity can become limiting');
check(M.simulate({...p,teamSize:1,hoursPerPerson:1}, {...e,setup:0,upkeep:10,tuning:10}).at(-1).good===0,'overhead cannot exceed capacity or create free production');

// Changing the name cannot change the outcome; all presets use the same laws.
const renamed=M.simulate(p,{...e,id:'different',name:'Different',color:'red'});
check(near(renamed.at(-1).net,end.net),'labels are not causal');

// Numerical refinement check, including discrete setup boundaries.
for(const s of M.presets) {
  const coarse=M.simulate(p,s,{dt:.03125}).at(-1),fine=M.simulate(p,s,{dt:.015625}).at(-1);
  check(Math.abs(coarse.good-fine.good)/Math.max(1,fine.good)<.01,'useful outputs converge below 1%');
  check(Math.abs(coarse.human-fine.human)/Math.max(1,fine.human)<.01,'human hours converge below 1%');
  check(Math.abs(coarse.npv-fine.npv)<Math.max(250,Math.abs(fine.npv)*.015),'NPV converges within 1.5% or $250');
}
const u=M.uncertainty(p,M.presets,.25,20,42),u2=M.uncertainty(p,M.presets,.25,20,42);
check(JSON.stringify(u)===JSON.stringify(u2),'seeded uncertainty is reproducible');
check(u.every(x=>x.p10<=x.p50&&x.p50<=x.p90),'ordered quantiles');
check(u[0].p10===0&&u[0].p90===0,'paired baseline uncertainty is exactly zero');
// Expert-led help changes time, without substituting autonomous result quality.
const expert=M.presets.find(s=>s.id==='assisted');
const expertLow=M.economics({...p,aiFit:.05},expert,.2,0);
const expertHigh=M.economics({...p,aiFit:.98},expert,.2,0);
check(near(expertLow.good,expertHigh.good)&&near(expertLow.bad,expertHigh.bad),'autonomous fit does not determine expert-led quality');
const manual=M.economics(p,M.presets[0],.2,0);
check(near(expertLow.good,manual.good)&&near(expertLow.bad,manual.bad),'same expert and same review preserve conditional quality');
check(expertLow.directH<manual.directH,'productive interactive assistance can save expert time');
const overhead=M.economics({...p,assistSaving:0,assistOverhead:.5},expert,.2,0);
check(overhead.directH>manual.directH,'assistance can slow the expert down when overhead exceeds savings');
const autonomous=M.economics(p,{...expert,autonomy:1},.2,0);
const blended=M.economics(p,{...expert,autonomy:.5},.2,0);
check(near(blended.good,(expertLow.good+autonomous.good)/2),'mixture combines useful flows');
check(near(blended.bad,(expertLow.bad+autonomous.bad)/2),'mixture combines escaped-defect flows');
check(near(blended.structuralYield,(expertLow.structuralYield+autonomous.structuralYield)/2),'structural debt respects branch-specific releases');
const novel={...p,...M.scenarios.novel.values};
check(M.compare(novel).find(r=>r.strategy.id==='assisted').rows.at(-1).delta>0,'novel preset illustrates expert-led assistance benefit');
check(M.compare({...novel,assistSaving:0,assistOverhead:.3}).find(r=>r.strategy.id==='assisted').rows.at(-1).delta<0,'benefit is not forced by the label');
const manualSurface=M.surface(p,M.presets[0],123);
check(manualSurface.baselineOnly&&manualSurface.z.flat().every(v=>v===0),'manual surface is a true self-comparison');
check(M.humanCapacity({...p,teamSize:3,hoursPerPerson:25})===75,'team capacity = people times allocated hours');
const team=M.simulate({...p,teamSize:3,hoursPerPerson:25},e);
check(team.every(r=>r.human<=75*r.t+1e-7),'team budget is conserved');
for(const time of [0,.013,.107,3.011,7.789,26]){
  const row=M.sample(er,time);
  check(near(row.t,time),'timeline samples the requested time without snapping');
  check(near(row.good+row.bad,row.shipped),'interpolated task accounting');
  check(row.good<=1e-10?row.humanPerGood===null:near(row.humanPerGood,row.human/row.good),'ratios are recomputed from interpolated totals');
}
const different=M.uncertainty(p,M.presets,.25,20,43);
check(JSON.stringify(different)!==JSON.stringify(u),'different seeds yield different parameter draws');
console.log('PASS: '+checks.toLocaleString()+' model assertions across four workloads, plus accounting, startup, bottleneck, convergence, and reproducibility checks.');
