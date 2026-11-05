/** Name collisions are review candidates, never identity or alias evidence. */
export const normalizeName = value => typeof value === 'string'
  ? value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') : '';
const unique = values => [...new Set(values)].sort();
const json = value => JSON.stringify(value ?? null,(_key,value)=>value instanceof Set?[...value].sort():value===undefined?null:value);
const present = value => value !== undefined && value !== null && value !== '';

export function nameEvidence(item, indexed, original, identifier) {
  const evidence = [];
  const add = (value, source) => {const key=normalizeName(value);if(key)evidence.push({key,value,source});};
  add(item.name,'display');
  for (const value of [indexed.originalName,indexed.flags?.babele?.originalName,item.originalName,item.flags?.babele?.originalName]) add(value,'original');
  // Only a complete, corroborated bilingual pair can supply a translated name.
  const bilingual = item.name?.match(/^([\p{Script=Han}\s·，、：:（）()《》“”「」『』—-]+)\s+([A-Za-z][A-Za-z0-9\s'’:,()&.!+/-]*)$/u);
  if (bilingual && (normalizeName(bilingual[2])===normalizeName(original)
    || normalizeName(bilingual[2]).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')===identifier)) {
    add(bilingual[1].trim(),'bilingual');add(bilingual[2],'bilingual');
  }
  return evidence.filter((e,i)=>evidence.findIndex(v=>v.key===e.key&&v.source===e.source)===i);
}

export function comparisonFields(entry) {
  const system=entry.system, context=entry.context;
  return JSON.parse(json({documentType:entry.documentType,type:entry.type,rules:entry.rules,identifier:entry.id,
    category:system.type?.value,subtype:system.type?.subtype,baseItem:system.type?.baseItem,
    owners:context?.owners,requirements:system.requirements,level:entry.spell?entry.level:context?.level??system.prerequisites?.level,
    prerequisites:system.prerequisites,school:entry.school,rarity:system.rarity,magicalBonus:system.magicalBonus}));
}

// Bind decisions to their complete inputs, including missing/conflicting raw
// context. Changing those inputs reopens review; renaming case/spacing does not.
export function decisionEvidence(entry) {
  return json([entry.fingerprint,comparisonFields(entry),unique(entry.nameEvidence.map(e=>e.key)),entry.system.source??null]);
}
export function decisionCurrent(decision, described) {
  return decision.members.every(id=>described.has(id)&&decision.evidence[id]===decisionEvidence(described.get(id)));
}
const separatedBy = (decision,a,b) => decision.sides.some((side,index)=>side.includes(a)&&decision.sides[1-index].includes(b));

export function compareRelationship(a,b,{keys=new Map(),decisions=[]}={}) {
  if(keys.get(a.uuid)&&keys.get(a.uuid)===keys.get(b.uuid))return {status:'grouped',basis:'reviewed-group'};
  const explicit=decisions.find(d=>d.kind==='different'&&separatedBy(d,a.uuid,b.uuid));
  if(explicit)return {status:'separate',basis:'user',reason:explicit.reason};
  // Conflicting source evidence cannot prove a generation boundary. Unknown
  // type/category values cannot prove a different kind of rule object either.
  if(!a.sourceConflict&&!b.sourceConflict) {
    if(a.rules&&b.rules&&a.rules!==b.rules)return {status:'separate',basis:'generation'};
    const physical=new Set(['weapon','equipment','consumable','tool','loot','container','backpack']);
    const ruleKinds=new Set(['spell','feat','class','subclass','race','background','facility']);
    const domain=e=>e.documentType!=='Item'?e.documentType:ruleKinds.has(e.type)?e.type:physical.has(e.type)?'physical':null;
    const da=domain(a),db=domain(b);
    if(da&&db&&da!==db&&!['unknown-type','type-context'].includes(a.warning)&&!['unknown-type','type-context'].includes(b.warning))return {status:'separate',basis:'object'};
  }
  return {status:'pending',basis:'unresolved'};
}


export function comparePair(a,b,options={}) {
  const fieldsA=comparisonFields(a),fieldsB=comparisonFields(b),clues=[];
  for(const field of Object.keys(fieldsA)) {
    const left=fieldsA[field],right=fieldsB[field];
    if(json(left)!==json(right)) clues.push({field,left:left??null,right:right??null,kind:present(left)&&present(right)?'difference':'missing'});
  }
  for(const entry of [a,b])if(entry.warning)clues.push({field:'diagnostic',member:entry.uuid,code:entry.warning,kind:'diagnostic'});
  return {...compareRelationship(a,b,options),clues};
}

// Cells share applied membership and every input that can explain separation.
// Comparing representatives avoids quadratic scans of large edition families;
// member-level differences are still computed for each displayed pair.
function relationshipCells(members,described,keys,decisions) {
  const sides=new Map(),cells=new Map();
  for(const decision of decisions)if(decision.kind==='different')for(const [index,side] of decision.sides.entries())for(const id of side) {
    if(!sides.has(id))sides.set(id,[]);sides.get(id).push([decision.key,index]);
  }
  for(const id of members) {
    const e=described.get(id),signature=json([keys.get(id)??id,e.rules,e.sourceConflict,e.documentType,e.type,
      ['unknown-type','type-context'].includes(e.warning),sides.get(id)??[]]);
    if(!cells.has(signature))cells.set(signature,[]);cells.get(signature).push(id);
  }
  return [...cells.values()];
}
function* cellPairs(cells) {
  for(let i=0;i<cells.length;i++)for(let j=i;j<cells.length;j++)if(i!==j||cells[i].length>1)yield [cells[i],cells[j]];
}
export function buildNameSets(described, keys, decisions=[]) {
  const buckets=new Map(),sets=new Map();
  const current=decisions.filter(d=>decisionCurrent(d,described));
  for(const entry of described.values())for(const evidence of entry.nameEvidence) {
    if(!buckets.has(evidence.key))buckets.set(evidence.key,new Set());
    buckets.get(evidence.key).add(entry.uuid);
  }
  for(const [name,ids] of buckets) {
    if(ids.size<2)continue;
    const members=[...ids].sort(),signature=json(members);
    if(sets.has(signature)){sets.get(signature).matches.push(name);continue;}
    // Keep existing reviewed units intact in the presentation.
    const units=new Map();
    for(const id of members){const key=keys.get(id)??id;if(!units.has(key))units.set(key,[]);units.get(key).push(id);}
    let pending=false;
    for(const [left,right] of cellPairs(relationshipCells(members,described,keys,current))) {
      if(compareRelationship(described.get(left[0]),described.get(right[0]),{keys,decisions:current}).status==='pending'){pending=true;break;}
    }
    if(!pending)continue;
    const entries=members.map(id=>described.get(id)),fields=entries.map(comparisonFields);
    const differences=Object.keys(fields[0]).filter(field=>new Set(fields.map(value=>json(value[field]))).size>1);
    sets.set(signature,{differences,warnings:unique(entries.map(e=>e.warning).filter(Boolean)),key:name,name:described.get(members[0]).names[0],members,matches:[name],
      groups:[...units].map(([key,ids])=>({key:keys.get(ids[0])??null,members:ids})),
      entryCount:members.length,groupCount:[...units.keys()].filter(key=>keys.get(units.get(key)[0])).length});
  }
  return [...sets.values()].sort((a,b)=>a.key.localeCompare(b.key));
}

export function nameSetPairs(set,described,keys,decisions,{offset=0,limit=25}={}) {
  const current=decisions.filter(d=>decisionCurrent(d,described)),result=[];
  let position=0;
  const cells=relationshipCells(set.members,described,keys,current);
  outer:for(const status of ['pending','separate','grouped'])for(const [lefts,rights] of cellPairs(cells)) {
    if(compareRelationship(described.get(lefts[0]),described.get(rights[0]),{keys,decisions:current}).status!==status)continue;
    const count=lefts===rights?lefts.length*(lefts.length-1)/2:lefts.length*rights.length;
    if(position+count<=offset){position+=count;continue;}
    for(let i=0;i<lefts.length;i++)for(let j=lefts===rights?i+1:0;j<rights.length;j++) {
      if(position++<offset)continue;
      const left=lefts[i],right=rights[j];
      result.push({left,right,...comparePair(described.get(left),described.get(right),{keys,decisions:current})});
      if(result.length===limit)break outer;
    }
  }
  return {pairs:result,total:set.members.length*(set.members.length-1)/2,offset,limit};
}

/** Decisions are explicit review records. Incomplete observation retains them
 * but cannot activate them or supply missing evidence. */
export function applyNameDecisions(snapshot,described,decisions,excluded=[]) {
  snapshot.decisions=structuredClone(decisions);
  const current=decisions.filter(d=>decisionCurrent(d,described)),blocked=new Set(excluded);
  const detach=id=>{
    const record=snapshot.records[id];if(!record)return;
    const group=snapshot.groups[record.key];
    if(group){group.members=group.members.filter(member=>member!==id);if(group.members.length<2){
      for(const member of group.members){snapshot.records[member].key=null;snapshot.records[member].reason='no-match';}
      delete snapshot.groups[record.key];
    }}
    record.key=null;record.reason=record.warning??'no-match';
  };
  // Explicit separation wins over automatic identity on later recalculation.
  for(const d of current.filter(d=>d.kind==='different')) {
    let serial=0;
    for(const [key,group] of Object.entries(snapshot.groups)) {
      if(!d.sides.every(side=>side.some(id=>group.members.includes(id))))continue;
      // Split a conflicting automatic family along the two reviewed sides.
      // Unmentioned members form their own remainder, never an inferred side.
      const parts=[...d.sides.map(side=>group.members.filter(id=>side.includes(id))),group.members.filter(id=>!d.members.includes(id))];
      delete snapshot.groups[key];
      for(const part of parts) {
        const splitKey=`reviewed-split:${d.key}:${serial++}`;
        if(part.length>1)snapshot.groups[splitKey]={...group,members:part};
        for(const id of part){snapshot.records[id].key=part.length>1?splitKey:null;snapshot.records[id].reason=part.length>1?null:snapshot.records[id].warning??'no-match';}
      }
    }
  }
  for(const d of current.filter(d=>d.kind==='same')) {
    if(d.members.some(id=>blocked.has(id)))continue;
    if(current.some(other=>other.kind==='different'&&other.sides.every(side=>side.some(id=>d.members.includes(id)))))continue;
    for(const id of d.members)detach(id);
    const key=d.key,first=described.get(d.members[0]);
    snapshot.groups[key]={kind:first.kind,rules:first.rules,context:{},risk:null,reason:'reviewed-name',members:[...d.members]};
    for(const id of d.members){const e=described.get(id);snapshot.records[id]={fingerprint:e.fingerprint,nameFingerprint:null,key,warning:e.warning,reason:null};}
  }
  return snapshot;
}
