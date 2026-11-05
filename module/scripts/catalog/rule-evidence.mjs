/** Read rule content only on request; never materialize virtual importer UUIDs. */
function plain(value) {
  if(typeof value!=='string')return '';
  if(typeof DOMParser==='function') {
    const doc=new DOMParser().parseFromString(value.replace(/<\/(?:p|div|li|h[1-6])>/gi,'$&\n'),'text/html');
    for(const el of doc.querySelectorAll('script,style'))el.remove();
    return doc.body.textContent.trim();
  }
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
}
function entriesText(value,depth=0) {
  if(depth>20)return '';
  if(typeof value==='string')return value.replace(/\{@(\w+) ([^{}]+)\}/g,(_m,tag,body)=>{const parts=body.split('|');return ['dice','damage','d20','hit'].includes(tag)?parts[1]||parts[0]:parts[2]||parts[0];});
  if(Array.isArray(value))return value.map(v=>entriesText(v,depth+1)).filter(Boolean).join('\n');
  if(!value||typeof value!=='object')return '';
  return [value.name,...['entries','entry','items','rows'].map(k=>entriesText(value[k],depth+1))].filter(Boolean).join('\n');
}
export async function readRuleEvidence(entry,environment,described) {
  const uuid=entry.uuid,external=environment.externalIdentities?.get(uuid);
  if(uuid.startsWith('@'))return external?.status==='ready'?{uuid,status:'ready',text:plain(entriesText(external.ruleEntries)),
    source:entry.source,provider:external.trace,usage:null,progressions:[]}:{uuid,status:'unavailable'};
  const parts=uuid.split('.');let document;
  if(parts[0]==='Compendium') {
    const pack=environment.packs?.get(parts.slice(1,3).join('.'));
    if(pack?.visible!==true)return {uuid,status:'unavailable'};
    document=await pack.getDocument(parts.at(-1));
  } else {
    document=(environment.collections?.get(parts[0])??(parts[0]==='Item'?environment.items:environment.actors))?.get(parts[1]);
    if(parts.length===4)document=(parts[2]==='Item'?document?.items:document?.pages)?.get(parts[3]);
  }
  if(!document)return {uuid,status:'unavailable'};
  const system=document.system??{},usage=system.uses?{max:system.uses.max??null,recovery:structuredClone(system.uses.recovery??[])}:null;
  const scale=typeof usage?.max==='string'?usage.max.match(/^@scale\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/):null;
  const progressions=[];
  if(scale)for(const parent of described.values()) {
    if(!['class','subclass'].includes(parent.type)||parent.id!==scale[1]||parent.rules!==entry.rules)continue;
    for(const advancement of parent.system.advancement??[])if(advancement.type==='ScaleValue'&&advancement.configuration?.identifier===scale[2])
      progressions.push({uuid:parent.uuid,name:parent.names[0],scale:structuredClone(advancement.configuration.scale??{})});
  }
  return {uuid,status:'ready',text:plain(system.description?.value??system.description??''),source:entry.source,provider:null,usage,progressions};
}
