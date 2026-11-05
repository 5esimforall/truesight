const same = (a,b) => a.length === b.length && a.every(id=>b.includes(id));
export function reviewRows(view, preview = null) {
  const before = [...view.groups.values()];
  const after = preview ? preview.groups.map(g=>({...g,members:g.members.map(m=>m.uuid)})) : before;
  const rows = after.map(group => {
    const previous = before.filter(g=>g.members.some(id=>group.members.includes(id)));
    const change = !preview ? 'current' : previous.some(g=>same(g.members,group.members)) ? 'unchanged' : previous.length ? 'adjusted' : 'added';
    return {...group, change, previous, name:view.entries.get(group.members[0])?.names?.[0] ?? group.key};
  });
  if (preview) for(const group of before) if(!after.some(g=>same(g.members,group.members))) {
    if(!after.some(g=>g.members.some(id=>group.members.includes(id)))) rows.push({...group,change:'removed',previous:[group],name:view.entries.get(group.members[0])?.names?.[0] ?? group.key});
  }
  const independent = preview ? preview.independent : [...view.entries.values()].filter(e=>!e.key).map(e=>({uuid:e.uuid,reason:e.warning ?? 'no-match'}));
  for(const entry of independent) rows.push({key:entry.uuid,name:view.entries.get(entry.uuid)?.names?.[0] ?? entry.name ?? entry.uuid,members:[entry.uuid],independent:true,reason:entry.reason,change:'independent',previous:[]});
  return rows;
}
export function filterReviewRows(rows, view, filter, query='') {
  const needle=query.trim().toLocaleLowerCase();
  return rows.filter(row=> {
    const match=filter==='independent' ? row.independent : filter==='excluded' ? row.independent&&row.reason==='excluded' : !row.independent && (filter==='all'||filter==='changes'&&['added','adjusted','removed'].includes(row.change)||filter==='risk'&&row.risk||filter===row.change);
    return match && (!needle || [row.name,row.key,...row.members.flatMap(id=>{const e=view.entries.get(id);return [...(e?.names??[]),e?.evidence?.identifier,...(e?.evidence?.source?.raw??[]).map(x=>x.value)];})].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle));
  });
}
