/** Presentation of already-resolved source evidence; never reclassify a book. */
export function memberSources(source, label) {
  const refs=source?.references??[];
  const uncertain=source?.status!=='confirmed';
  const badges=refs.map(ref=>({label:ref.record?.label ?? (new Set(ref.candidates?.map(c=>c.family)).size===1 ? ref.candidates?.[0]?.familyLabel : null) ?? ref.raw,
    title:[ref.record?.title ?? ref.raw,ref.page].filter(Boolean).join(' · '),warning:uncertain})).filter(b=>b.label);
  if(uncertain||!badges.length)badges.push({label:label(!badges.length?'unknown':source?.status??'unknown'),title:(source?.raw??[]).map(r=>r.value).join(' · '),warning:true});
  return badges.filter((b,i,all)=>all.findIndex(x=>x.label===b.label)===i);
}
