import { identifySource, prepareSourceEnvironment } from "./source-resolution.mjs";
import {IDENTITY_FIELDS, DOCUMENT_TYPES, validIdentifier, prepareOwners, itemContext} from "./item-identity.mjs";

import {nameEvidence, decisionCurrent} from './name-review.mjs';

// Metadata only: never load documents, descriptions, activities or effects.
export const GROUP_INDEX_FIELDS = Object.freeze(["originalName", "flags.babele.originalName", "flags.chris-premades.info.identifier", "flags.gambits-premades.gpsUuid", ...IDENTITY_FIELDS]);
export const GROUP_RULE_VERSION = 3;
const text = value => typeof value === "string" ? value.trim() : "";
const english = value => /^[A-Za-z][A-Za-z0-9\s'’:,()&.!+/-]*$/.test(text(value));
const nameKey = value => text(value).normalize("NFKC").toLowerCase().replace(/’/g,"'").replace(/\s+/g," ");
const slug = value => nameKey(value).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const identifier = validIdentifier;
// Current Quick Insert compendium results omit the document type segment.
export function canonicalUuid(item) {
  const uuid = text(typeof item === "string" ? item : item?.uuid);
  const type = typeof item === "string" ? "Item" : item?.documentType;
  if (/^Compendium\.[^.]+\.[^.]+\.[^.]+$/.test(uuid) && ["Item", ...DOCUMENT_TYPES].includes(type)) {
    const parts=uuid.split("."); parts.splice(3,0,type); return parts.join(".");
  }
  return uuid;
}
export function normalizeGrouping(value = {}) {
  return {excluded: [...new Set((Array.isArray(value.excluded) ? value.excluded : []).filter(id => typeof id === 'string' && id.length < 500))]};
}
export function editionEvidence(item, environment={}) {
  const source=identifySource(item,environment);
  return {rules:source.rules,conflict:source.status==="edition-conflict"};
}
export function isSrdSource(item, environment={}) {
  const packId=item.package || canonicalUuid(item).match(/^Compendium\.([^.]+\.[^.]+)\./)?.[1];
  const pack=environment.packs?.get(packId);
  const pkg=pack?.metadata?.packageType==="system"?environment.system:environment.modules?.get(pack?.metadata?.packageName);
  const books=Object.keys(pkg?.flags?.dnd5e?.sourceBooks??{});
  const source=item.system?.source;
  return [source,source?.book,source?.custom,pack?.metadata?.flags?.dnd5e?.sourceBook,
    books.length===1?books[0]:null,pack?.title,pack?.metadata?.label,item.packageName]
    .some(value=>/\bsrd(?:\b|\d)|\bsystem reference document\b/i.test(text(value)));
}
function indexEntry(item, environment) {
  const packId=item.package || canonicalUuid(item).match(/^Compendium\.([^.]+\.[^.]+)\./)?.[1];
  if (packId) return environment.packs?.get(packId)?.index?.get(canonicalUuid(item).split(".").at(-1)) ?? item;
  const parts=canonicalUuid(item).split('.');
  const collection=environment.collections?.get(parts[0]) ?? (parts[0]==='Item'?environment.items:parts[0]==='Actor'?environment.actors:null);
  const document=collection?.get(parts[1]);
  if(parts.length===4) return (parts[2]==='Item'?document?.items:parts[2]==='JournalEntryPage'?document?.pages:null)?.get(parts[3])??item;
  return document??item;
}
function originalName(item, entry) {
  const original=[entry.originalName,entry.flags?.babele?.originalName,item.originalName,item.flags?.babele?.originalName].find(english);
  if(original)return text(original);
  // For untranslated or natively bilingual packs without originalName, require
  // the COMPLETE English segment to reproduce the COMPLETE stored identifier.
  // A bilingual prefix may contain only Han text/separators, never skipped
  // English qualifiers. This is corroboration, not arbitrary tail stripping.
  const name=text(item.name);
  const bilingual=name.match(/^[\p{Script=Han}\s·，、：:（）()《》“”「」『』—-]+\s+([A-Za-z][A-Za-z0-9\s'’:,()&.!+/-]*)$/u);
  const candidate=english(name)?name:bilingual?.[1];
  return candidate&&slug(candidate)===item.system?.identifier?text(candidate):"";
}
function describe(result, environment) {
  const item=result.item,uuid=canonicalUuid(item),external=environment.externalIdentities?.get(uuid),
    supplied=external?.status==='ready'?external:null,indexed=indexEntry(item,environment);
  const system={...item.system,...indexed.system},type=supplied?.type??item.subType;
  const source=identifySource(supplied?{uuid:item.uuid,source:item.source,system:{...system,source:{...system.source,rules:supplied.rules,page:supplied.page}}}:item,environment);
  const id=supplied?.identifier??identifier(system.identifier),name=supplied?.originalName??originalName(item,indexed);
  const suffix=name.match(/^(.+?)\s+\(([^()]+)\)$/);
  let base=nameKey(name),suffixBook=null;
  if(suffix) {
    const candidates=environment.sourceCatalog.lookup(suffix[2]);
    const references=source.references.filter(ref=>ref.record).map(ref=>ref.record.id);
    const matched=candidates.filter(book=>references.includes(book.id));
    if(matched.length===1){base=nameKey(suffix[1]);suffixBook=matched[0].id;}
  }
  const spell=(!environment.system?.id||environment.system.id==="dnd5e")&&item.documentType==="Item"&&item.subType==="spell";
  const suppliedConflict=supplied&&((system.identifier&&system.identifier!==supplied.identifier)||(item.subType&&item.subType!==supplied.type));
  const suppliedEdition=supplied&&['2014','2024'].includes(system.source?.rules)&&system.source.rules!==supplied.rules;
  const warning=suppliedEdition?'edition':suppliedConflict?'context-conflict':external&&!supplied?external.warning:source.status==="edition-conflict"?"edition":source.status==="source-conflict"?"source":
    !spell?null:!source.rules?"rules":!id?"identifier":
    !Number.isInteger(system.level)||system.level<0||system.level>9||!["abj","con","div","enc","evo","ill","nec","trs"].includes(system.school)?"spell":null;
  const fingerprint=JSON.stringify([item.documentType,item.subType,id,source.rules,system.level??null,system.school??null,
    source.status==="edition-conflict"||source.status==="source-conflict"?source.status:null]);
  const nameFingerprint=JSON.stringify([base,suffixBook]);
  const automated=Boolean(indexed.flags?.["chris-premades"]?.info?.identifier || indexed.flags?.["gambits-premades"]?.gpsUuid);
  return {result,uuid,spell,id,rules:source.rules,level:system.level,school:system.school,warning,fingerprint,nameFingerprint,
    type,system,source,externalContext:supplied?.context,trace:supplied?.trace,nameEvidence:nameEvidence(item,supplied?{...indexed,originalName:name}:indexed,name,id),documentType:item.documentType,sourceConflict:Boolean(suppliedEdition)||["edition-conflict","source-conflict"].includes(source.status),
    origin:text(indexed._stats?.compendiumSource ?? item._stats?.compendiumSource),
    base,suffixBook,names:[item.name,name].filter(Boolean),tags:automated?["automation"]:[],srd:isSrdSource(item,environment),key:null,risk:null,kind:null};
}
const isOwnerEntry = entry => entry?.documentType === 'Item' && ['class', 'subclass', 'race', 'background'].includes(entry.type);

function finalizeEntry(entry, owners, environment) {
  entry.kind=entry.spell?'spell':entry.documentType==='Item'?entry.type:'document';
  entry.context=null;entry.reason=null;entry.groupReason='identifier';
  if (entry.spell) return;
  const knownDocument=entry.documentType==='Item'||DOCUMENT_TYPES.includes(entry.documentType)
    || Object.hasOwn(environment.system?.documentTypes??{},entry.documentType);
  const isItem=entry.documentType==='Item'&&(!environment.system?.id||environment.system.id==='dnd5e');
  const identity=isItem?(entry.externalContext?{context:entry.externalContext}:itemContext(entry,owners,environment)):{context:{documentType:entry.documentType,type:entry.type??null}};
  entry.warning=entry.warning||(!knownDocument||identity.warning==='unknown-type'?'unknown-type':isItem&&!entry.rules?'rules':isItem&&!entry.id?'identifier':identity.warning??null);
  entry.context=identity.context??null;
  const origin=canonicalUuid({uuid:entry.origin,documentType:entry.documentType});
  const originParts=origin.split('.');
  const validOrigin=originParts.length===5&&originParts[0]==='Compendium'&&originParts[3]===entry.documentType;
  if (!isItem) {
    entry.kind='document';
    const uuidParts=entry.uuid.split('.');
    const selfOrigin=uuidParts.length===5&&uuidParts[0]==='Compendium'&&uuidParts[3]===entry.documentType?entry.uuid:null;
    entry.groupReason='origin';
    entry.context={...entry.context,origin:validOrigin?origin:selfOrigin};
    if (!validOrigin&&!selfOrigin) entry.reason='origin';
  } else {
    entry.warning=entry.warning||(!entry.rules?'rules':!entry.id?'identifier':null);
    // Provenance can supply otherwise missing ownership, never resolve an
    // explicit conflict or erase the item's type/generation constraints.
    if (entry.warning==='owner-context'&&validOrigin&&entry.rules&&entry.id) {
      entry.warning=null;entry.groupReason='origin';
      entry.context={origin,category:text(entry.system.type?.value),subtype:text(entry.system.type?.subtype),
        requirements:nameKey(entry.system.requirements),level:entry.system.prerequisites?.level??null,
        prerequisites:[...(entry.system.prerequisites?.items??[])].sort(),classIdentifier:text(entry.system.classIdentifier)};
    }
  }
  entry.fingerprint=JSON.stringify(['identity-v2',entry.documentType,entry.type,entry.id,entry.rules,entry.context,entry.warning]);
  if(entry.fingerprint.length>2000) {
    entry.warning='context-size';entry.context=null;
    // Oversized metadata never participates in grouping. Bound its diagnostic
    // record without using a lossy signature to establish identity.
    entry.fingerprint=JSON.stringify(['context-size',entry.fingerprint.length,entry.fingerprint.slice(0,1000)]);
  }
}

export function describeGroupingIndexWithOwners(results, environment={}) {
  environment=prepareSourceEnvironment(environment);
  const entries=new Map(results.map(result=>{const entry=describe(result,environment);return [entry.uuid,entry];}));
  const owners=prepareOwners(entries);
  for (const entry of entries.values()) finalizeEntry(entry, owners, environment);
  return {entries, owners, environment};
}

export function describeGroupingIndex(results, environment={}) {
  return describeGroupingIndexWithOwners(results, environment).entries;
}

export function updateDescribedGroupingIndex(previousDescribed, previousOwners, results, environment, dirtyUuids) {
  if (!previousDescribed || !previousOwners || !(dirtyUuids instanceof Set)) {
    return describeGroupingIndexWithOwners(results, environment);
  }
  environment = prepareSourceEnvironment(environment);
  const nextEntries = new Map();
  const toFinalize = [];
  let ownersChanged = false;
  for (const result of results) {
    const uuid = canonicalUuid(result.item);
    const prev = previousDescribed.get(uuid);
    if (prev && !dirtyUuids.has(uuid) && prev.result.item === result.item) {
      nextEntries.set(uuid, prev.result === result ? prev : {...prev, result});
      continue;
    }
    if (prev && isOwnerEntry(prev)) { ownersChanged = true; break; }
    environment.sourceCache?.delete(result.item);
    const entry = describe(result, environment);
    if (isOwnerEntry(entry)) { ownersChanged = true; break; }
    nextEntries.set(uuid, entry);
    toFinalize.push(entry);
  }
  if (!ownersChanged) {
    for (const [uuid, prev] of previousDescribed) {
      if (!nextEntries.has(uuid) && isOwnerEntry(prev)) { ownersChanged = true; break; }
    }
  }
  if (ownersChanged) {
    return describeGroupingIndexWithOwners(results, {...environment, sourceCache: new WeakMap()});
  }
  for (const entry of toFinalize) finalizeEntry(entry, previousOwners, environment);
  return {entries: nextEntries, owners: previousOwners, environment};
}
function addTo(map,key,value) {if(!map.has(key))map.set(key,[]);map.get(key).push(value);}

/** Explicit computation, never invoked by ordinary search/index refresh. */
export function calculateGrouping(results,environment={},preferences=normalizeGrouping(),{includeRisk=false}={}) {
  return calculateDescribedGrouping(describeGroupingIndex(results,environment),preferences,{includeRisk});
}

// Work on fresh entry records: normalized metadata can be shared across reads
// and previews, while candidate warnings and membership remain computation-local.
const copyEntries = entries => new Map([...entries].map(([id, entry]) => [id, {...entry}]));
export function calculateDescribedGrouping(described,preferences=normalizeGrouping(),{includeRisk=false}={}) {
  const entries=copyEntries(described),buckets=new Map(),excluded=new Set(preferences.excluded??[]);
  for(const entry of entries.values()) if(!entry.warning&&!excluded.has(entry.uuid)&&(entry.groupReason!=='origin'||entry.context?.origin)) {
    const key=entry.spell?`spell:${entry.rules}:${entry.id}`:
      JSON.stringify([entry.documentType,entry.type,entry.rules,entry.groupReason==='origin'?entry.context.origin:entry.id]);
    addTo(buckets,key,entry);
  }
  const candidates=new Map(),names=new Map();
  for(const [key,members] of buckets) {
    if(members[0].spell) {
      if(new Set(members.map(e=>`${e.level}:${e.school}`)).size!==1){for(const e of members)e.warning="spell";continue;}
      const candidate={key,members,risk:null,reason:"identifier"};candidates.set(key,candidate);
      for(const base of new Set(members.map(e=>e.base).filter(Boolean)))addTo(names,`${members[0].rules}:${base}`,candidate);
    } else {
      const contexts=new Map();
      for (const entry of members) addTo(contexts,JSON.stringify(entry.context),entry);
      for (const compatible of contexts.values()) {
        if (contexts.size>1) for (const entry of compatible) entry.reason='context-difference';
        const contextKey=JSON.stringify([...JSON.parse(key),compatible[0].context]);
        if(contextKey.length>500){for(const entry of compatible)entry.warning='context-size';continue;}
        candidates.set(contextKey,{key:contextKey,members:compatible,risk:null,
          reason:compatible[0].groupReason==='origin'?'origin':'item-identity'});
      }
    }
  }
  if(includeRisk) for(const related of names.values()) {
    const clusters=[...new Set(related)].filter(c=>candidates.has(c.key));
    if(clusters.length<2)continue;
    const members=clusters.flatMap(c=>c.members);
    // No transitive name chains or ambiguous roots. Every member must have
    // the same corroborated full base name when available; at least one suffix
    // and exactly one unsuffixed identifier family are required. Missing names
    // in that root family inherit only its already validated identifier link.
    if(new Set(members.map(e=>e.base).filter(Boolean)).size!==1||new Set(members.map(e=>`${e.level}:${e.school}`)).size!==1)continue;
    const roots=clusters.filter(c=>c.members.some(e=>e.base&&!e.suffixBook));
    if(roots.length!==1||!members.some(e=>e.suffixBook))continue;
    if(clusters.filter(c=>c!==roots[0]).some(c=>c.members.some(e=>!e.suffixBook)))continue;
    const root=roots[0];
    for(const c of clusters)if(c!==root)candidates.delete(c.key);
    root.members=members;root.risk="implementation";root.reason="source-suffix";
  }
  const groups=Object.create(null),records=Object.create(null);
  for(const candidate of candidates.values())if(candidate.members.length>1) {
    groups[candidate.key]={kind:candidate.members[0].kind,context:candidate.members[0].context,rules:candidate.members[0].rules,level:candidate.members[0].level,school:candidate.members[0].school,risk:candidate.risk,reason:candidate.reason,members:candidate.members.map(e=>e.uuid).sort()};
    for(const e of candidate.members){e.key=candidate.key;e.risk=candidate.risk;}
  }
  for(const e of entries.values())records[e.uuid]={fingerprint:e.fingerprint,nameFingerprint:e.risk?e.nameFingerprint:null,key:e.key,
    warning:excluded.has(e.uuid)?"excluded":e.warning,reason:e.key?null:excluded.has(e.uuid)?"excluded":e.warning??e.reason??"no-match"};
  return {version:1,ruleVersion:GROUP_RULE_VERSION,createdAt:Date.now(),includeRisk,records,groups,decisions:[]};
}

/** Applied membership only. New/changed/unauthorized records never acquire a
 * family during refresh; names and package versions are not identities. */
export function buildGroupingCatalog(results,environment={},snapshot=null,preferences=normalizeGrouping()) {
  return buildDescribedGroupingCatalog(describeGroupingIndex(results,environment),snapshot,preferences);
}
export function buildDescribedGroupingCatalog(described,snapshot=null,preferences=normalizeGrouping()) {
  const entries=copyEntries(described),groups=new Map(),excluded=new Set(preferences.excluded??[]);
  const confirmed=new Set((snapshot?.decisions??[]).filter(d=>d.kind==='same'&&decisionCurrent(d,described)).map(d=>d.key));
  let changed=0;
  for(const entry of entries.values()) {
    const previous=snapshot?.records?.[entry.uuid];
    const group=previous?.key&&snapshot?.groups?.[previous.key],manual=group?.reason==='reviewed-name';
    const current=previous&&previous.fingerprint===entry.fingerprint&&(!previous.nameFingerprint||previous.nameFingerprint===entry.nameFingerprint)&&(!manual||confirmed.has(previous.key));
    if(!current||snapshot?.ruleVersion!==GROUP_RULE_VERSION||(previous?.warning==="excluded")!==excluded.has(entry.uuid))changed++;
    if(previous?.key&&!current)entry.warning=entry.warning||"identity";
    if(excluded.has(entry.uuid))entry.warning="excluded";
    if(snapshot?.ruleVersion===GROUP_RULE_VERSION&&current&&(!entry.warning||manual)&&!excluded.has(entry.uuid)&&group?.members.includes(entry.uuid)) {
      entry.key=previous.key;entry.risk=group.risk;entry.kind=group.kind;addTo(groups,entry.key,entry);
    } else if(current&&previous?.warning&&previous.warning!=="excluded"&&!entry.warning)entry.warning=previous.warning;
    entry.reason=entry.key?null:entry.warning??(current&&previous.reason!=='excluded'?previous.reason:entry.reason??'awaiting-review');
  }
  for(const uuid of Object.keys(snapshot?.records??{}))if(!entries.has(uuid))changed++;
  return {entries,groups,changed};
}

export function groupingDiff(previous,next,preferences=normalizeGrouping()) {
  const old=previous?.groups??{},groups=next.groups;
  const membership=snapshot=>new Map(Object.entries(snapshot).flatMap(([key,g])=>g.members.map(id=>[id,key])));
  const before=membership(old),after=membership(groups);
  let added=0,merged=0,split=0;
  for(const g of Object.values(groups)) {
    const parents=new Set(g.members.map(id=>before.get(id)).filter(Boolean));
    if(!parents.size)added++;
    if(parents.size>1)merged++;
  }
  for(const g of Object.values(old))if(new Set(g.members.map(id=>after.get(id)??id)).size>1)split++;
  return {added,merged,split,groups:Object.keys(groups).length,joined:after.size,
    independent:Object.values(next.records).filter(r=>!r.key).length,risky:Object.values(groups).filter(g=>g.risk).length};
}
