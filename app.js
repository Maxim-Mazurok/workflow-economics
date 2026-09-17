/* UI and charts. No network requests; all calculations run locally. */
(() => {
  'use strict';
  const M=window.WorkflowModel,$=id=>document.getElementById(id);
  let p={...M.defaults},strategies=M.presets.map(s=>({...s})),focus='engineered',visible=new Set(strategies.map(s=>s.id));
  let runs=[],cursor=p.horizon,tab='outcomes',space=innerWidth<640?'2d':'3d',surfaceView='3d',surfaceData=null,uncertaintyData=null,revision=0;
  let playing=false,animationView=false,animationId=0,previousFrame=0,previousDraw=0;
  let cursorFrame=0,cursorBusy=false,cursorDirty=false,playbackBounds=null;
  let costLog=true,spaceInteracting=false,spaceRendering=0,fitSpace=false;
  let cameraState={eye:{x:1.55,y:1.55,z:1.05},center:{x:0,y:0,z:0},up:{x:0,y:0,z:1}};
  const newSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
  let simulationSeed=newSeed(),uncertaintyKey='',uncertaintyTimer=0;
  const colors={paper:'#f7f6f0',ink:'#283b34',muted:'#68716a',grid:'#dfe3d8'};
  const fmt=(x,n=1)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toLocaleString('en-US',{maximumFractionDigits:n,minimumFractionDigits:0});
  const money=x=>x===null||!Number.isFinite(x)?'—':(x<0?'−':'')+'$'+fmt(Math.abs(x),0);
  const signed=x=>(x>0?'+':'')+money(x);
  const percent=x=>x===null?'—':fmt(x*100,1)+'%';
  const last=xs=>xs[xs.length-1];
  const selected=()=>strategies.find(s=>s.id===focus);
  const runFor=id=>runs.find(r=>r.strategy.id===id);
  const at=run=>M.sample(run.rows,cursor);
  const config={responsive:true,displaylogo:false,scrollZoom:false,modeBarButtonsToRemove:['lasso2d','select2d','autoScale2d','hoverClosestCartesian','hoverCompareCartesian','toggleSpikelines'],toImageButtonOptions:{format:'png',scale:2}};
  const axis=title=>({title:{text:title,font:{size:10,color:colors.muted},standoff:10},gridcolor:colors.grid,zerolinecolor:'#aeb7a9',tickfont:{size:10,color:colors.muted},automargin:true});
  const layout=extra=>({paper_bgcolor:colors.paper,plot_bgcolor:colors.paper,font:{family:'Avenir Next, Segoe UI, sans-serif',color:colors.ink,size:11},margin:{l:56,r:12,t:14,b:43},showlegend:false,hovermode:'closest',uirevision:'stable',...extra});
  const chart=(id,data,l)=>Plotly.react($(id),data,layout(l),config);
  const controlSpecs={
    main:[
      ['horizon','Time horizon',1,104,1,'wk','Time available to recover the investment.'],
      ['demand','Incoming tasks',0,100,1,'/wk','Useful demand limits how much output can earn value.'],
      ['teamSize','Team size',1,20,1,'','People available for this workload.'],
      ['variability','Task variability',0,1,.01,'%','Novel inputs and edge cases reduce reusable learning.']
    ],
    economic:[
      ['hoursPerPerson','Available hours per person',1,60,1,'h/wk','Productive time allocated to this workload, shared across setup, delivery, and upkeep.'],
      ['taskHours','Manual production',.25,16,.25,'h/task','Before review or repair; scales the task size.'],
      ['humanPrice','Value of human time',0,300,5,'$/h','Opportunity cost of active hours, not automatic cash savings.'],
      ['value','Value per useful result',0,2000,25,'$','Realizable marginal value; defects earn zero.'],
      ['failureLoss','Loss per escaped defect',0,5000,25,'$','External loss, excluding repair labor already counted.'],
      ['discount','Annual discount rate',0,.5,.01,'%','Discounts future economic surplus.']
    ],
    advanced:[
      ['coupling','Carry-over between tasks',0,1,.01,'%','How much a shortcut burdens future work. Zero = disposable outputs.'],
      ['verifiability','Ease of verification',0,1,.01,'%','How well review effort can detect defects.'],
      ['aiFit','Autonomous AI first-pass fit',.05,.98,.01,'%','Standalone output correctness. This is separate from how much time an expert saves using AI interactively.'],
      ['assistSaving','Interactive assistance saving',0,.9,.01,'%','Potential reduction in expert production time. Context and variability modulate it; interaction overhead is charged separately.'],
      ['assistOverhead','Interaction overhead',0,.5,.01,'%','Share of manual production time spent directing and checking assistance, before variability.'],
      ['manualFit','Manual first-pass fit',.5,.999,.001,'%','Manual expert success before review, variability, or debt.'],
      ['aiPrice','Base API cost',.01,50,.25,'$/try','At 1× compute and zero debt.'],
      ['machineTime','Base machine latency',.01,8,.05,'h/try','At 1× compute; distinct from human attention.'],
      ['machineHours','Machine availability',1,168,1,'h/wk','Before parallelism; 168 permits continuous operation.'],
      ['serial','Serial machine work',0,1,.01,'%','Limits speedup from additional parallel slots.'],
      ['drift','Capability decay',0,.1,.001,'rate/wk','Continuous decay rate as the environment changes.']
    ],
    strategy:[
      ['autonomy','Autonomous task share',0,1,.01,'%','0% = expert-led work with AI support. 100% = AI drafts the complete result for review. Intermediate values mix task routes.'],
      ['setup','Initial setup',0,240,1,'h','Production waits while the available team builds the system.'],
      ['direct','Human production on AI drafts',.005,1.5,.005,'%','Human work per autonomously drafted candidate, relative to manual production. Expert-led work uses the interactive saving and overhead assumptions instead.'],
      ['review','Review per candidate',0,.8,.01,'%','Share of manual task time; not a percentage of outputs inspected.'],
      ['repair','Repair detected defects',0,1,.01,'%','Unrepaired or unsuccessfully repaired candidates return to the queue.'],
      ['compute','Compute per candidate',.25,6,.05,'×','Raises model effort, cost, and latency. No brand-specific price claims.'],
      ['upkeep','Ongoing upkeep',0,20,.25,'h/wk','Half maintains infrastructure; half pays down debt.'],
      ['tuning','Initial ongoing tuning',0,30,.25,'h/wk','Heavy tuning after launch, fading with attempted tasks.'],
      ['parallel','Parallel machine slots',1,32,1,'','Constrained by serial work and human gates.']
    ],
    coefficients:[
      ['learningScale','Learning scale',10,400,5,'h','Hours governing diminishing returns to capability.'],
      ['noveltyPenalty','Novelty penalty',0,4,.1,'','Log-odds penalty at maximum variability.'],
      ['capabilityGain','Capability gain',0,4,.1,'','Log-odds improvement at full capability.'],
      ['computeGain','Compute gain',0,2,.05,'','Correctness elasticity on log compute.'],
      ['detectionGain','Detection efficiency',0,15,.25,'','Review-hours multiplier for detection.'],
      ['debtQuality','Debt quality penalty',0,2,.05,'','Penalty on log(1 + debt burden).'],
      ['debtFriction','Debt labor friction',0,2,.05,'','Production-hour penalty per burden unit.'],
      ['debtScale','Debt normalization',5,150,5,'tasks','How many task-hours make one burden unit.'],
      ['structuralDebt','Structural debt rate',0,.5,.01,'','Hours relative to task size, before craftsmanship and coupling.'],
      ['escapedDebt','Debt from escaped defects',0,4,.1,'','Task-hour multiplier per escaped defect.'],
      ['repairSuccess','Base repair success',0,1,.01,'%','Reduced by variability and debt.'],
      ['tuningEffect','Tuning learning multiplier',0,5,.1,'×','Effective learning hours per tuning hour.'],
      ['feedbackEffect','Review learning multiplier',0,2,.05,'×','Effective learning hours per review hour.'],
      ['tuningDecay','Tuning decay scale',10,400,10,'tries','Attempt count at which tuning drops to 1/e of its initial rate.']
    ]
  };
  function buildControls(container,specs,isStrategy=false) {
    const root=$(container);root.replaceChildren();
    for(const [key,label,min,max,step,unit,help] of specs) {
      if(isStrategy&&!selected().ai&&['compute','parallel','tuning','autonomy'].includes(key))continue;
      const controlLabel=isStrategy&&!selected().ai&&key==='direct'?'Manual production effort':label;
      const value=(isStrategy?selected():p)[key],scale=unit==='%'?100:1;
      const id=(isStrategy?'s-':'p-')+key;
      const div=document.createElement('div');div.className='control';
      div.innerHTML=`<div class="control-title"><label for="${id}">${controlLabel}</label><span class="value-edit"><input id="${id}-number" aria-label="${controlLabel}, numeric value" type="number" min="${min*scale}" max="${max*scale}" step="${step*scale}"><span>${unit}</span></span></div><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" aria-describedby="${id}-help"><p class="control-help" id="${id}-help">${isStrategy&&!selected().ai&&key==='direct'?'Relative to the standard manual production time.':help}</p>`;
      root.appendChild(div);
      const range=$(id),num=$(id+'-number');range.value=value;num.value=+(value*scale).toFixed(4);
      const change=(v)=>{
        if(!Number.isFinite(v))return;
        v=Math.min(max,Math.max(min,v));
        (isStrategy?selected():p)[key]=v;range.value=v;num.value=+(v*scale).toFixed(4);
        if(key==='horizon')cursor=Math.min(cursor,v);
        if(key==='autonomy')updateControlSummaries();
        schedule();
      };
      range.addEventListener('input',()=>change(Number(range.value)));
      num.addEventListener('change',()=>change(Number(num.value)/scale));
    }
  }
  function updateControlSummaries(){
    $('capacity-summary').textContent=`${fmt(p.teamSize)} ${p.teamSize===1?'person':'people'} × ${fmt(p.hoursPerPerson)} h/week = ${fmt(M.humanCapacity(p))} available human hours/week.`;
    const s=selected();
    if($('s-direct')){$('s-direct').disabled=s.ai&&s.autonomy===0;$('s-direct-number').disabled=s.ai&&s.autonomy===0;}
    $('workflow-role').textContent=!s.ai?'Expert work without AI. This is the comparison baseline.':s.autonomy===0?'Expert-led: AI helps with research, documentation, code exploration, and implementation. The expert retains responsibility for the result.':s.autonomy===1?'Autonomous drafting: AI produces a candidate result, then human review and repair can improve it.':`${percent(s.autonomy)} autonomous drafting; ${percent(1-s.autonomy)} expert-led assistance.`;
  }
  function buildAllControls(){buildControls('main-controls',controlSpecs.main);buildControls('economic-controls',controlSpecs.economic);buildControls('advanced-controls',controlSpecs.advanced);buildControls('strategy-controls',controlSpecs.strategy,true);buildControls('coefficient-controls',controlSpecs.coefficients);updateControlSummaries();}
  let timer;
  function schedule(){clearTimeout(timer);timer=setTimeout(recalculate,90);}
  function recalculate(){
    pauseTimeline();runs=M.compare(p,strategies);revision++;surfaceData=null;uncertaintyData=null;uncertaintyKey='';playbackBounds=null;updateControlSummaries();
    $('time').max=p.horizon;$('time').value=cursor;$('horizon-label').textContent=fmt(p.horizon)+' weeks';
    $('uncertainty-status').textContent='The scenarios update automatically when this view is open.';
    if($('uncertaintyPlot').data)Plotly.purge($('uncertaintyPlot'));
    if(tab==='outcomes')renderOutcomes();else if(tab==='surface')renderSurface();
    window.labState={parameters:p,strategies,runs,get revision(){return revision;},get cursor(){return cursor;},get playing(){return playing;},get animationView(){return animationView;},get costLog(){return costLog;},get cameraInteracting(){return spaceInteracting;},get seed(){return simulationSeed;},get uncertaintyKey(){return uncertaintyKey;},get uncertainty(){return uncertaintyData;}};
  }
  function legend(){
    $('legend').replaceChildren();
    strategies.forEach(s=>{
      const b=document.createElement('button');b.setAttribute('aria-pressed',String(visible.has(s.id)));b.title='Show or hide '+s.name;
      b.innerHTML=`<span class="dot" style="background:${s.color}"></span>${s.name}`;
      b.onclick=()=>{if(visible.has(s.id)){if(visible.size>1)visible.delete(s.id);}else visible.add(s.id);playbackBounds=null;legend();renderOutcomes();};$('legend').appendChild(b);
    });
  }
  function selectWorkflow(id){focus=id;$('focus').value=id;buildControls('strategy-controls',controlSpecs.strategy,true);updateControlSummaries();surfaceData=null;if(tab==='outcomes')renderOutcomes();else if(tab==='surface')renderSurface();}
  function renderOutcomes(){
    updateTimeReadout();
    renderSpace();renderDetails();renderLines();renderAccounting();renderTable();
  }
  function paddedRange(values,fallback=[0,1],ceiling=Infinity){
    const finite=values.filter(Number.isFinite);
    if(!finite.length)return fallback;
    const min=finite.reduce((a,b)=>Math.min(a,b),Infinity),max=finite.reduce((a,b)=>Math.max(a,b),-Infinity);
    const pad=Math.max(max-min,Math.abs(max)*.1,.1)*.08;
    return [Math.max(0,min-pad),Math.min(ceiling,max+pad)];
  }
  function getPlaybackBounds(){
    if(playbackBounds)return playbackBounds;
    const rows=[];
    for(const run of runs.filter(r=>visible.has(r.strategy.id))){
      rows.push(...run.rows.filter(row=>row.good>=1));
      const i=run.rows.findIndex(r=>r.good>=1);
      if(i>0){const a=run.rows[i-1],b=run.rows[i],t=a.t+(1-a.good)*(b.t-a.t)/(b.good-a.good);rows.push(M.sample(run.rows,t));}
    }
    const cost=rows.map(r=>r.costPerGood),speed=rows.map(r=>r.throughput),quality=rows.map(r=>r.quality*100);
    if(visible.size<strategies.length)return playbackBounds={linearX:paddedRange(cost),logX:paddedRange(cost.map(c=>Math.log10(1+c))),y:paddedRange(speed),z:paddedRange(quality,[0,100],100)};
    const maxCost=Math.max(1,...cost),maxThroughput=Math.max(1,...speed);
    return playbackBounds={linearX:[0,maxCost*1.06],logX:[0,Math.log10(1+maxCost)*1.06],y:[0,maxThroughput*1.08],z:[0,100]};
  }
  function logCostTicks(range){
    const values=Array.from({length:6},(_,i)=>range[0]+(range[1]-range[0])*i/5);
    return {tickmode:'array',tickvals:values,ticktext:values.map(v=>{const dollars=Math.max(0,10**v-1);return dollars<10?'$'+fmt(dollars,2):money(dollars);})};
  }
  function spaceTraces(){
    const traces=[];
    const costX=r=>costLog?Math.log10(1+r.costPerGood):r.costPerGood;
    const threshold=animationView?1:1e-10;
    runs.filter(run=>visible.has(run.strategy.id)).forEach(run=>{
      const s=run.strategy,end=at(run),history=$('showPaths').checked?run.rows.filter(r=>r.t<=cursor&&r.good>=threshold):[];
      const valid=end.good>=threshold&&end.costPerGood!==null;
      let opacity=1;
      if(animationView){const entry=run.rows.findIndex(r=>r.good>=1);if(entry>=0){const a=run.rows[Math.max(0,entry-1)],b=run.rows[entry];const entryTime=a.t+(1-a.good)*(b.t-a.t)/Math.max(1e-12,b.good-a.good);opacity=Math.max(0,Math.min(1,(cursor-entryTime)/(p.horizon*.025)));}else opacity=0;}
      const common={name:s.name,legendgroup:s.id,hoverlabel:{bgcolor:s.color,font:{color:'#fff'}},meta:s.id};
      const hover='<b>'+s.name+'</b><br>Week '+cursor.toFixed(2)+'<br>Cost / useful: $%{customdata[0]:,.0f}<br>Useful / week: %{y:.2f}<br>Released quality: %{customdata[1]:.1f}%<extra></extra>';
      const point={...common,uid:'point-'+s.id,mode:space==='3d'?'markers':'markers+text',x:valid?[costX(end)]:[],y:valid?[end.throughput]:[],customdata:valid?[[end.costPerGood,end.quality*100]]:[],opacity,hovertemplate:hover};
      if(space==='3d'){
        if($('showPaths').checked)traces.push({...common,uid:'path-'+s.id,type:'scatter3d',mode:'lines',x:history.map(costX),y:history.map(r=>r.throughput),z:history.map(r=>r.quality*100),line:{color:s.color,width:s.id===focus?4:2},opacity:.3,hoverinfo:'skip'});
        traces.push({...point,type:'scatter3d',z:valid?[end.quality*100]:[],marker:{size:s.id===focus?9:6,color:s.color,line:{color:colors.paper,width:1}}});
      }else{
        if($('showPaths').checked)traces.push({...common,uid:'path-'+s.id,type:'scatter',mode:'lines',x:history.map(costX),y:history.map(r=>r.throughput),line:{color:s.color,width:1},opacity:.3,hoverinfo:'skip'});
        traces.push({...point,type:'scatter',text:valid?[s.short]:[],textposition:s.id==='engineered'?'top left':s.id==='assisted'?'top right':s.id==='manual'?'bottom center':'top center',textfont:{size:10,color:s.color},cliponaxis:false,marker:{size:9+(end.quality||0)*13,color:s.color,line:{color:s.id===focus?colors.ink:colors.paper,width:s.id===focus?2:1}}});
      }
    });
    return traces;
  }
  function updateSpaceInteraction(){
    const locked=playing&&space==='3d';
    $('tradeoff').classList.toggle('playback-locked',locked);
    document.querySelector('.plot-key .muted').textContent=space==='3d'?(locked?'Pause playback to rotate or inspect':'Drag to rotate · hover for details'):'Hover for values · click to inspect';
    $('playback-note').textContent='Playback view: fixed axes, '+(costLog?'logarithmic':'linear')+' cost spacing, and markers that fade in after 1 expected useful result. '+(locked?'3D interaction is disabled while playing; pause to rotate or inspect.':'Hover shows actual dollars.');
  }
  function bindSpaceInteraction(){
    const graph=$('tradeoff');
    if(graph._workflowInteractionBound)return;
    graph._workflowInteractionBound=true;
    graph.on('plotly_relayout',event=>{if(event['scene.camera'])cameraState=structuredClone(event['scene.camera']);});
    graph.addEventListener('pointerdown',event=>{if(!playing&&!event.target.closest('.modebar'))spaceInteracting=true;},true);
    const finish=()=>{
      if(!spaceInteracting)return;
      spaceInteracting=false;
      // A paused camera gesture changes no model data. Do not redraw on release:
      // Plotly commits its camera after pointerup, and an eager restyle resets it.
    };
    window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
  }
  function updateSpaceFrame(){
    // Playback locks 3D interaction. Paused gestures complete before data redraws.
    if(spaceInteracting||spaceRendering)return Promise.resolve();
    if(!animationView)return renderSpace();
    const graph=$('tradeoff'),traces=spaceTraces();
    if(!graph.data||graph.data.length!==traces.length||graph.data.some((trace,i)=>trace.uid!==traces[i].uid))return renderSpace();
    const fields=['x','y','customdata','hovertemplate','opacity'];
    if(space==='3d')fields.push('z');else fields.push('text');
    const update=Object.fromEntries(fields.map(key=>[key,traces.map(trace=>trace[key]??(key==='opacity'?1:[]))]));
    update['marker.size']=traces.map(trace=>trace.marker?.size??6);
    const noResults=!traces.some(t=>t.uid.startsWith('point-')&&t.x.length);
    const jobs=[Plotly.restyle(graph,update)];
    if(Boolean(graph.layout.annotations?.length)!==noResults)jobs.push(Plotly.relayout(graph,{annotations:noResults?spaceAnnotation():[]}));
    return Promise.all(jobs);
  }
  function spaceAnnotation(){return [{text:animationView?'Waiting for the first expected useful result.<br>Setup and costs are already counted.':'No useful work delivered yet.<br>Per-result metrics are undefined.',xref:'paper',yref:'paper',x:.5,y:.5,showarrow:false,font:{size:12,color:colors.muted}}];}
  function renderSpace(){
    if(spaceInteracting)return Promise.resolve();
    const traces=spaceTraces(),bounds=(animationView||(space==='2d'&&!fitSpace))?getPlaybackBounds():null,threshold=animationView?1:1e-10;
    const noResults=!runs.some(r=>visible.has(r.strategy.id)&&at(r).good>=threshold);
    const ax3=title=>({...axis(title),autorange:true,showbackground:false,gridcolor:colors.grid,zerolinecolor:colors.grid,title:{text:title,font:{size:11,color:colors.muted}},showspikes:false});
    let fixedX=bounds?{range:costLog?bounds.logX:bounds.linearX,autorange:false}:{};
    if(costLog){
      const values=traces.flatMap(t=>t.x),min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1;
      const span=Math.max(.1,max-min),range=bounds?bounds.logX:[Math.max(0,min-span*.1),max+span*.1];
      fixedX={...fixedX,range,autorange:false,...logCostTicks(range)};
    }
    const fixedY=bounds?{range:bounds.y,autorange:false}:{};
    const qualityRange=bounds?bounds.z:visible.size<strategies.length?paddedRange(traces.flatMap(t=>t.z||[]),[0,100],100):[0,100];
    const costTitle=costLog?'Cost / useful ($, log scale)':'Cost / useful ($)';
    const extra=space==='3d'?{margin:{l:0,r:0,b:0,t:0},scene:{xaxis:{...ax3(costTitle),...fixedX},yaxis:{...ax3('Useful / week'),...fixedY},zaxis:{...ax3('Quality (%)'),range:qualityRange,autorange:false},camera:structuredClone(cameraState),uirevision:'workflow-camera',dragmode:'orbit',aspectmode:'manual',aspectratio:{x:1.1,y:1,z:.78},bgcolor:colors.paper},uirevision:'tradeoff-3d-'+[...visible].sort().join(',')}:{xaxis:{...axis(costTitle),rangemode:'tozero',autorange:true,...fixedX},yaxis:{...axis('Useful results per week · average'),rangemode:'tozero',autorange:true,...fixedY},margin:{l:60,r:20,t:35,b:52},uirevision:'tradeoff-2d-'+[...visible].sort().join(',')};
    extra.annotations=noResults?spaceAnnotation():[];
    spaceRendering++;
    const plotted=chart('tradeoff',traces,extra).finally(()=>{spaceRendering--;bindSpaceInteraction();});
    $('plot-key-right').textContent=space==='3d'?'Higher throughput & quality are better':'Marker size = released quality';
    updateSpaceInteraction();
    $('playback-note').hidden=!animationView;$('fitCurrent').hidden=!animationView&&!(space==='2d'&&!fitSpace);

    $('tradeoff').removeAllListeners?.('plotly_click');
    $('tradeoff').on('plotly_click',e=>{const id=e.points?.[0]?.data?.meta;if(id)selectWorkflow(id);});
    return plotted;
  }
  function updateTimeReadout(){
    $('time-label').textContent='Week '+cursor.toFixed(2);
    $('time').setAttribute('aria-valuetext','Week '+cursor.toFixed(2));
  }
  function pauseTimeline(){
    playing=false;cancelAnimationFrame(animationId);previousFrame=0;updateSpaceInteraction();
    $('timePlay').textContent='▶ Play';$('timePlay').setAttribute('aria-label','Play timeline');$('timePlay').setAttribute('aria-pressed','false');
  }
  function queueCursorRender(){
    updateTimeReadout();cursorDirty=true;
    if(cursorFrame||cursorBusy)return;
    cursorFrame=requestAnimationFrame(async()=>{
      cursorFrame=0;cursorBusy=true;cursorDirty=false;
      try{
        const jobs=[updateSpaceFrame()];renderDetails();renderTable();
        for(const id of ['effort','value','speed','quality'])if($(id).data)jobs.push(Plotly.relayout($(id),{'shapes[0].x0':cursor,'shapes[0].x1':cursor}));
        const r=at(runFor(focus));$('accounting-total').textContent=fmt(r.human)+' active hours';
        if($('accounting').data)jobs.push(Plotly.restyle($('accounting'),{x:['setupH','tuningH','upkeepH','directH','reviewH','repairH'].map(k=>[r[k]])}));
        await Promise.all(jobs);
      }finally{cursorBusy=false;if(cursorDirty&&tab==='outcomes')queueCursorRender();}
    });
  }
  function moveCursor(value){cursor=Math.max(0,Math.min(p.horizon,value));$('time').value=cursor;queueCursorRender();}
  function playTimeline(){
    if(playing){pauseTimeline();return;}
    if(cursor>=p.horizon-1e-9)cursor=0;
    animationView=true;fitSpace=false;playing=true;spaceInteracting=false;previousFrame=0;previousDraw=0;updateSpaceInteraction();
    $('timePlay').textContent='Ⅱ Pause';$('timePlay').setAttribute('aria-label','Pause timeline');$('timePlay').setAttribute('aria-pressed','true');
    function frame(now){
      if(!playing)return;
      if(previousFrame)cursor+=(now-previousFrame)/1000*p.horizon/24*Number($('playSpeed').value);
      previousFrame=now;
      if(cursor>=p.horizon){
        if($('timeLoop').checked)cursor%=p.horizon;
        else{cursor=p.horizon;pauseTimeline();}
      }
      $('time').value=cursor;updateTimeReadout();
      if(now-previousDraw>=50||!playing){previousDraw=now;queueCursorRender();}
      if(playing)animationId=requestAnimationFrame(frame);
    }
    renderSpace();queueCursorRender();animationId=requestAnimationFrame(frame);
  }
  function renderDetails(){
    const s=selected(),r=at(runFor(focus));
    $('selected-name').textContent=s.name;$('selected-name').style.color=s.color;
    $('selected-status').textContent=r.setupLeft>0?'Building · '+fmt(r.setupLeft)+' setup hours remain':'Current limiting factor: '+r.bottleneck;
    $('selected-values').innerHTML=[['Useful results',fmt(r.good)],['Released quality',percent(r.quality)],['Hours / useful',fmt(r.humanPerGood,2)],['Cost / useful',money(r.costPerGood)],['Value vs. manual',signed(r.delta)]].map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    $('selected-insight').textContent=r.good===0?'Investment is accumulating, but no useful result exists yet. Per-result ratios stay undefined.':`${fmt(r.human)} active human hours have produced ${fmt(r.good)} useful results from ${fmt(r.attempts)} candidate attempts. ${fmt(r.debt)} remediation hours remain as debt.`;
  }
  const metricLabels={humanPerGood:['Human hours / useful','Human effort per useful result'],periodEffort:['Human hours / useful','Effort in the current production period'],nextHuman:['Human hours / useful','Labor for the next useful result'],human:['Cumulative human hours','Total human effort'],throughput:['Useful / week · average since start',''],rate:['Useful results / week',''],attemptRate:['Candidate attempts / week',''],good:['Cumulative useful results',''],backlog:['Unresolved tasks',''],quality:['Released quality (%)',''],firstPass:['First-pass success (%)',''],debt:['Remediation hours',''],k:['Reusable AI capability (%)','']};
  function timePlot(id,key,opts={}){
    const percentage=['quality','firstPass','k'].includes(key),scale=percentage?100:key==='delta'?.001:1;
    const traces=runs.filter(run=>visible.has(run.strategy.id)&&(key!=='k'||run.strategy.ai)).map(run=>({type:'scatter',mode:'lines',name:run.strategy.name,x:run.rows.map(r=>r.t),y:run.rows.map(r=>r[key]===null?null:r[key]*scale),connectgaps:false,line:{color:run.strategy.color,width:run.strategy.id===focus?2.8:1.8,dash:run.strategy.id==='manual'?'dot':'solid'},hovertemplate:`<b>${run.strategy.name}</b><br>Week %{x:.2f}<br>%{y:,.2f}${percentage?'%':''}<extra></extra>`}));
    const yaxis={...axis(opts.title||metricLabels[key][0]),rangemode:'tozero'};
    if(percentage){if(visible.size===strategies.length)yaxis.range=[0,101];else{yaxis.range=paddedRange(traces.flatMap(t=>t.y),[0,100],100);yaxis.autorange=false;}}
    if(id==='effort'&&key!=='human'&&$('effortLog').checked){yaxis.type='log';yaxis.title.text+=' · log scale';yaxis.dtick='D2';}
    chart(id,traces,{xaxis:{...axis('Weeks since start'),range:[0,p.horizon]},yaxis,shapes:[{type:'line',xref:'x',yref:'paper',x0:cursor,x1:cursor,y0:0,y1:1,line:{color:'#a8b5a4',width:1,dash:'dot'}}],hovermode:'x unified',hoverlabel:{font:{size:10},bgcolor:colors.paper},uirevision:revision+'-'+key+'-'+[...visible].sort().join(',')});
  }
  function renderLines(){
    const effort=$('effortMode').value;
    $('effort-heading').textContent=metricLabels[effort][1];
    $('effort-note').textContent={humanPerGood:'All human hours spent so far ÷ useful results delivered so far. Includes the full setup investment. Undefined until useful output exists.',periodEffort:'All human hours in each simulation interval ÷ useful results in that interval. Setup-only intervals are undefined, not zero.',nextHuman:'Expected candidate labor ÷ useful yield at the current state. Excludes sunk setup and recurring tuning/upkeep; this is not the all-in average.',human:'Every active hour counts: setup, production, review, repair, tuning, and upkeep. High totals may also accompany more useful output.'}[effort];
    timePlot('effort',effort);timePlot('value','delta',{title:'Cumulative value vs. manual ($000)'});timePlot('speed',$('speedMode').value);timePlot('quality',$('qualityMode').value);
  }
  function renderAccounting(){
    const s=selected(),r=at(runFor(focus));
    $('accounting-title').textContent='Where the human work goes · '+s.short;
    $('accounting-total').textContent=fmt(r.human)+' active hours';
    const categories=[['Setup','setupH','#324c40'],['Tuning','tuningH','#78947e'],['Upkeep','upkeepH','#bac7a9'],['Production','directH','#c8a078'],['Review','reviewH','#6989a0'],['Repair','repairH','#aa7180']];
    chart('accounting',categories.map(([name,key,color])=>({type:'bar',orientation:'h',name,x:[r[key]],y:['Human hours'],marker:{color},hovertemplate:`${name}: %{x:.1f} h<extra></extra>`})),{margin:{l:0,r:10,t:8,b:45},barmode:'stack',showlegend:true,legend:{orientation:'h',x:0,y:-.6,font:{size:10},itemwidth:30},xaxis:{...axis(''),rangemode:'tozero'},yaxis:{visible:false},bargap:.55});
  }
  function renderTable(){
    $('results').innerHTML=runs.map(run=>{const s=run.strategy,r=at(run);return `<tr class="${s.id===focus?'focused-row':''}"><td><button data-focus="${s.id}"><span class="dot" style="background:${s.color}"></span>${s.name}</button></td><td>${fmt(r.good)} / ${fmt(r.shipped)}</td><td>${percent(r.quality)}</td><td>${money(r.costPerGood)}</td><td>${fmt(r.humanPerGood,2)}</td><td>${fmt(r.backlog)}</td><td class="${r.delta<0?'negative':'positive'}">${signed(r.delta)}</td></tr>`;}).join('');
    $('results').querySelectorAll('button').forEach(b=>b.onclick=()=>selectWorkflow(b.dataset.focus));
  }
  function renderSurface(){
    const s=selected();
    const manual=!s.ai;
    document.querySelector('.surface-toolbar').hidden=manual;
    for(const id of ['surfaceMetric','surface3d','surface2d','refreshSurface'])$(id).disabled=manual;
    if(manual){
      $('surface-description').textContent='Manual expert is the reference workflow. Comparing these same settings with themselves gives exactly zero.';
      chart('surfacePlot',[{type:'scatter',mode:'lines',x:[0,p.horizon],y:[0,0],line:{color:s.color,width:2},hovertemplate:'Week %{x:.1f}<br>Manual vs. itself: $0<extra></extra>'}],{xaxis:{...axis('Weeks since start'),range:[0,p.horizon]},yaxis:{...axis('Value relative to manual ($)'),range:[-1,1],tickvals:[0]},annotations:[{text:'Manual vs. the same manual baseline = $0',xref:'paper',yref:'paper',x:.5,y:.8,showarrow:false,font:{size:15,color:colors.muted}}]});
      $('surface-note').textContent='The manual baseline stays identical on both sides of this comparison. Select an AI workflow to explore its setup-versus-review investment landscape.';
      $('surface-summary').textContent='There is no investment landscape for the reference itself. The uncertainty comparison below still includes all workflows, with manual fixed at $0.';
      requestUncertainty();return;
    }
    $('surface-note').textContent='Every grid point reruns the model for the full horizon. Setup and review vary; other choices stay fixed to this workflow. The marker is the current configuration. This is a conditional response surface, not a universal frontier. Review is a fraction of manual task time.';
    $('surface-description').textContent=`${s.name} · ${fmt(p.horizon)}-week horizon. Vary upfront setup and per-candidate review while holding its other choices constant.`;
    if(!surfaceData){const base=last(M.simulate(p,strategies.find(x=>x.id==='manual'),{dt:.0625})).npv;surfaceData=M.surface(p,s,base);surfaceData.base=base;}
    const metric=$('surfaceMetric').value,labels={z:'Value vs. manual ($000)',quality:'Released quality (%)',effort:'Human hours / useful',useful:'Useful results'};
    const scale=metric==='z'?[[0,'#af644f'],[.48,'#ece6d2'],[1,'#277962']]:[[0,'#e9e7d5'],[.5,'#8daa8c'],[1,'#245e4c']];
    const z=surfaceData[metric],selectedResult=last(M.simulate(p,s,{dt:.0625}));
    const markerValue={z:(selectedResult.npv-surfaceData.base)/1000,quality:selectedResult.quality===null?null:selectedResult.quality*100,effort:selectedResult.humanPerGood,useful:selectedResult.good}[metric];
    const common={x:surfaceData.setup,y:surfaceData.review,z,colorscale:scale,colorbar:{title:{text:labels[metric],side:'right',font:{size:10}},thickness:12,len:.65,tickfont:{size:10}},hovertemplate:'Setup: %{x:.0f} h<br>Review: %{y:.0f}% of manual task time<br>'+labels[metric]+': %{z:,.2f}<extra></extra>'};
    const traces=surfaceView==='3d'?[{...common,type:'surface',contours:{z:{show:true,usecolormap:true,highlightcolor:'#3d5947',project:{z:true}}},opacity:.95},{type:'scatter3d',mode:'markers',x:[s.setup],y:[s.review*100],z:[markerValue],marker:{size:6,color:colors.ink,line:{color:colors.paper,width:2}},name:'Current settings',hovertemplate:'<b>Current settings</b><br>Setup %{x:.0f} h<br>Review %{y:.1f}%<br>'+labels[metric]+': %{z:,.2f}<extra></extra>'}]:[{...common,type:'contour',contours:{coloring:'heatmap',showlabels:true},line:{width:.5,color:'#b4c1b2'}},{type:'scatter',mode:'markers',x:[s.setup],y:[s.review*100],marker:{size:12,color:colors.ink,line:{color:colors.paper,width:2}},hovertemplate:'Current settings<extra></extra>'}];
    const extra=surfaceView==='3d'?{margin:{l:0,r:60,b:10,t:0},scene:{xaxis:{...axis('Initial setup (h)'),showbackground:false},yaxis:{...axis('Review (% of manual hours)'),showbackground:false},zaxis:{...axis(labels[metric]),showbackground:false},camera:{eye:{x:1.4,y:-1.65,z:1.1}},aspectmode:'manual',aspectratio:{x:1.2,y:1.1,z:.8}},uirevision:'surface-'+metric}:{margin:{l:60,r:85,b:50,t:20},xaxis:axis('Initial setup (human hours)'),yaxis:axis('Review (% of manual task hours)'),uirevision:'contour-'+metric};
    if(!Number.isFinite(markerValue))traces.pop();
    if(z.some(row=>row.some(v=>Number.isFinite(v))))chart('surfacePlot',traces,extra);
    else chart('surfacePlot',[],{xaxis:{visible:false},yaxis:{visible:false},annotations:[{text:'No useful output in this slice.<br>This per-result metric is undefined.',xref:'paper',yref:'paper',x:.5,y:.5,showarrow:false,font:{size:14,color:colors.muted}}]});
    let best={value:-Infinity};surfaceData.z.forEach((row,j)=>row.forEach((v,i)=>{if(v>best.value)best={value:v,i,j};}));
    $('surface-summary').textContent=`Within this sampled slice, the highest modeled value occurs at ${fmt(surfaceData.setup[best.i],0)} setup hours and ${fmt(surfaceData.review[best.j],0)}% review effort: ${signed(best.value*1000)} relative to manual over ${fmt(p.horizon)} weeks. This is a grid maximum under these assumptions, not a recommended optimum.`;
    requestUncertainty();
  }
  function requestUncertainty(){
    const spread=Number($('spread').value),key=revision+':'+spread+':'+simulationSeed;
    if(uncertaintyData&&uncertaintyKey===key){renderUncertainty();return;}
    clearTimeout(uncertaintyTimer);$('runUncertainty').disabled=true;
    $('uncertainty-status').textContent='Calculating 160 paired scenarios…';
    uncertaintyTimer=setTimeout(()=>{
      if(tab!=='surface'){$('runUncertainty').disabled=false;return;}
      try{
        uncertaintyData=M.uncertainty(p,strategies,spread,160,simulationSeed);uncertaintyKey=key;renderUncertainty();
        $('uncertainty-status').textContent=`160 paired scenarios · seed ${simulationSeed} · median and 10–90% range. New draw uses a different seed; keeping this seed makes assumption changes comparable.`;
      }finally{$('runUncertainty').disabled=false;}
    },50);
  }
  function renderUncertainty(){
    const traces=uncertaintyData.map(d=>({type:'scatter',mode:'markers',name:d.strategy.name,x:[d.p50/1000],y:[d.strategy.name],marker:{size:9,color:d.strategy.color},error_x:{type:'data',symmetric:false,array:[(d.p90-d.p50)/1000],arrayminus:[(d.p50-d.p10)/1000],color:d.strategy.color,thickness:3,width:6},hovertemplate:`<b>${d.strategy.name}</b><br>10th: ${money(d.p10)}<br>Median: ${money(d.p50)}<br>90th: ${money(d.p90)}<br>Above manual in ${fmt(d.share*100,0)}% of assumed draws<extra></extra>`}));
    chart('uncertaintyPlot',traces,{margin:{l:155,r:25,t:22,b:52},xaxis:axis('Value vs. manual ($000) · median and 10–90% range'),yaxis:{...axis(''),categoryorder:'array',categoryarray:strategies.map(s=>s.name).reverse()},shapes:[{type:'line',x0:0,x1:0,y0:0,y1:1,xref:'x',yref:'paper',line:{color:'#8e9e8a',dash:'dot',width:1}}],uirevision:revision});
  }
  function setTab(name){
    if(name!=='outcomes')pauseTimeline();
    tab=name;document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!=='view-'+name);
    document.querySelectorAll('.tab').forEach(b=>{b.classList.toggle('active',b.dataset.tab===name);b.setAttribute('aria-selected',String(b.dataset.tab===name));});
    if(name==='outcomes')renderOutcomes();if(name==='surface')renderSurface();
  }
  function download(content,name,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportCSV(){
    const keys=['t','attempts','good','bad','shipped','backlog','quality','human','setupH','directH','reviewH','repairH','upkeepH','tuningH','cash','loss','spend','costPerGood','humanPerGood','periodEffort','nextHuman','throughput','rate','debt','k','npv','delta'];
    const headers=['week','candidate_attempts','useful_results','escaped_defects','released_results','unresolved_backlog','released_quality_fraction','active_human_hours','setup_hours','production_hours','review_hours','repair_hours','upkeep_hours','tuning_hours','api_spend_dollars','external_loss_dollars','labor_and_api_dollars','all_in_dollars_per_useful','cumulative_human_hours_per_useful','period_human_hours_per_useful','next_useful_labor_hours','average_useful_per_week','current_useful_per_week','debt_remediation_hours','capability_fraction','discounted_surplus_dollars','value_vs_manual_dollars'];
    const csv=['workflow,'+headers.join(',')];runs.forEach(run=>run.rows.forEach(r=>csv.push(run.strategy.id+','+keys.map(k=>r[k]===null?'':Number(r[k]).toFixed(6)).join(','))));
    download(csv.join('\n'),'workflow-economics-data.csv','text/csv');
  }
  function setScenario(key){p={...M.defaults,...M.scenarios[key].values};cursor=p.horizon;$('scenario-description').textContent=M.scenarios[key].description;buildAllControls();legend();recalculate();}
  $('scenario').innerHTML=Object.entries(M.scenarios).map(([key,s])=>`<option value="${key}">${s.label}</option>`).join('');
  $('focus').innerHTML=strategies.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');$('focus').value=focus;
  $('scenario').onchange=()=>setScenario($('scenario').value);
  $('focus').onchange=()=>selectWorkflow($('focus').value);
  $('reset').onclick=()=>{animationView=false;fitSpace=false;focus='engineered';strategies=M.presets.map(s=>({...s}));$('focus').value=focus;visible=new Set(M.presets.map(s=>s.id));$('scenario').value='evolving';setScenario('evolving');};
  $('restore-workflow').onclick=()=>{Object.assign(selected(),M.presets.find(s=>s.id===focus));buildControls('strategy-controls',controlSpecs.strategy,true);recalculate();};
  $('time').oninput=()=>{pauseTimeline();cursor=Number($('time').value);queueCursorRender();};
  $('timeStart').onclick=()=>{pauseTimeline();moveCursor(0);};
  $('timeEnd').onclick=()=>{pauseTimeline();moveCursor(p.horizon);};
  $('timePlay').onclick=playTimeline;
  $('fitCurrent').onclick=()=>{pauseTimeline();animationView=false;fitSpace=true;renderSpace();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseTimeline();});
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  $('showPaths').onchange=renderSpace;
  $('logCost').onchange=()=>{costLog=$('logCost').checked;renderSpace();};
  $('effortLog').onchange=renderLines;
  ['effortMode','speedMode','qualityMode'].forEach(id=>$(id).onchange=renderLines);
  function segmented(ids,callback){ids.forEach(id=>$(id).onclick=()=>{ids.forEach(other=>{$(other).classList.toggle('active',id===other);$(other).setAttribute('aria-pressed',String(id===other));});callback(id);});}
  segmented(['space3d','space2d'],id=>{space=id==='space3d'?'3d':'2d';renderSpace();});
  segmented(['surface3d','surface2d'],id=>{surfaceView=id==='surface3d'?'3d':'2d';renderSurface();});
  $('surfaceMetric').onchange=renderSurface;
  $('refreshSurface').onclick=()=>{surfaceData=null;renderSurface();};
  $('simulationSeed').value=simulationSeed;
  $('runUncertainty').onclick=()=>{simulationSeed=newSeed();$('simulationSeed').value=simulationSeed;requestUncertainty();};
  $('simulationSeed').onchange=()=>{const seed=Number($('simulationSeed').value);if(!Number.isInteger(seed)||seed<0||seed>4294967295){$('simulationSeed').value=simulationSeed;return;}simulationSeed=seed;requestUncertainty();};
  $('spread').onchange=requestUncertainty;
  $('exportCSV').onclick=exportCSV;
  $('saveConfig').onclick=()=>download(JSON.stringify({version:2,scenario:$('scenario').value,parameters:p,strategies:strategies.map(s=>({id:s.id,...Object.fromEntries(controlSpecs.strategy.map(([key])=>[key,s[key]]))})),focus,cursor,simulationSeed,spread:Number($('spread').value)},null,2),'workflow-economics-assumptions.json','application/json');
  $('loadConfig').onclick=()=>$('configFile').click();
  $('configFile').onchange=async()=>{
    try{
      const f=$('configFile').files[0];if(!f)return;if(f.size>100000)throw Error('File is too large.');const data=JSON.parse(await f.text());if(![1,2].includes(data.version)||!data.parameters||!Array.isArray(data.strategies))throw Error('Unrecognized assumptions file.');
      const validate=(target,values,specs)=>{for(const [key,,min,max] of specs){const n=values[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error('Invalid value for '+key);target[key]=n;}};
      const values=data.version===1?{...M.defaults,...data.parameters}:data.parameters;
      if(data.version===1){values.teamSize=Math.max(1,Math.ceil(data.parameters.humanHours/40));values.hoursPerPerson=data.parameters.humanHours/values.teamSize;}
      const np={...M.defaults};validate(np,values,[...controlSpecs.main,...controlSpecs.economic,...controlSpecs.advanced,...controlSpecs.coefficients]);
      const ns=M.presets.map(s=>{let v=data.strategies.find(x=>x.id===s.id);if(!v)throw Error('Missing workflow: '+s.id);if(data.version===1)v={...v,autonomy:s.ai?1:0};const next={...s};validate(next,v,controlSpecs.strategy.filter(([key])=>s.ai||!['compute','parallel','tuning','autonomy'].includes(key)));return next;});
      if(data.version===2&&(!Number.isInteger(data.simulationSeed)||data.simulationSeed<0||data.simulationSeed>4294967295||![.1,.25,.5].includes(data.spread)))throw Error('Invalid simulation seed or spread.');
      if(data.version===2){simulationSeed=data.simulationSeed;$('simulationSeed').value=simulationSeed;$('spread').value=data.spread;}
      p=np;strategies=ns;focus=ns.some(s=>s.id===data.focus)?data.focus:'engineered';cursor=Math.max(0,Math.min(p.horizon,Number.isFinite(data.cursor)?data.cursor:p.horizon));$('focus').value=focus;
      $('scenario').value=M.scenarios[data.scenario]?data.scenario:'evolving';$('scenario-description').textContent='Loaded assumptions. The charts use your saved values.';buildAllControls();legend();recalculate();$('config-status').textContent=data.version===1?'Assumptions loaded. Legacy AI routes were preserved; restore a workflow’s defaults to use the updated preset.':'Assumptions loaded.';
    }catch(err){$('config-status').textContent='Could not load: '+err.message;}finally{$('configFile').value='';}
  };
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>document.querySelectorAll('.view:not([hidden]) .js-plotly-plot').forEach(el=>Plotly.Plots.resize(el)),150);});
  ['space3d','space2d'].forEach(id=>{const active=id==='space'+space;$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));});
  setScenario('evolving');window.workflowLabReady=true;
})();
