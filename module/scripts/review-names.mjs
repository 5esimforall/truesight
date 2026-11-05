/** Render diagnostic name relationships without changing reviewed membership. */
export function renderNameSet({row,detail,view,previewId,catalog,t,node,button,member,onDecision,drafts,pairOffset=0,onPairPage,ruleEvidence=new Map()}) {
  const set=catalog.readNameSet(row.key,{previewId,offset:pairOffset});
  const format=value=>value==null||value===''?t('Names.Unknown'):typeof value==='object'?JSON.stringify(value):String(value);
  const label=id=>`${set.members.indexOf(id)+1}. ${view.entries.get(id)?.names?.[0]??id}`;
  const loadRules=async ids=>{
    const generation=catalog.getStatus().generation;
    const values=await catalog.loadRuleEvidence(ids);
    if(catalog.getStatus().generation===generation)for(const value of values)ruleEvidence.set(value.uuid,value);
  };
  const ruleContent=(id,{load=true}={})=>{
    const rules=node('section',null,'ts-rule-evidence'),content=ruleEvidence.get(id);
    if(load){const control=button('Names.LoadRules',()=>loadRules([id]));control.setAttribute('data-ts-focus','rules:'+id);rules.append(control);}
    if(!content)return rules;
    rules.append(node('h4',t('Names.RuleContent')));
    if(content.status!=='ready')rules.append(node('p',t('Names.RulesUnavailable')));
    else {
      rules.append(node('pre',content.text||t('Names.NoRuleText'),'ts-rule-text'));
      if(content.provider){const trace=node('details',null,'ts-technical');trace.append(node('summary',t('UI.Technical')),node('p',t('Names.ProviderTrace',{provider:content.provider.provider,owner:content.provider.ownerName,source:content.provider.source,uid:content.provider.uid})));rules.append(trace);}
      if(content.usage)rules.append(node('h4',t('Names.UsageConfig')),node('pre',JSON.stringify(content.usage,null,2),'ts-rule-text'));
      for(const progression of content.progressions)rules.append(node('p',t('Names.ScaleSource',{name:progression.name,uuid:progression.uuid})),node('pre',JSON.stringify(progression.scale,null,2),'ts-rule-text'));
    }
    return rules;
  };
  detail.append(node('h2',row.name),node('p',t('Names.Matches',{names:set.matches.join(' / ')})),
    node('p',t('Names.SetSummary',{entries:set.entryCount,groups:set.groupCount})),node('p',t('Names.Hint'),'ts-name-hint'));
  const clues=[...set.differences.map(field=>t('Names.Field.'+field)),...set.warnings.map(code=>t('Grouping.Review.'+code))];
  if(clues.length)detail.append(node('p',t('Names.Clues',{clues:clues.join(' · ')}),'ts-name-hint'));
  const sections=[];
  for(const [index,group] of set.groups.entries()) {
    const section=node('section',null,'ts-name-unit');
    section.append(node('h3',group.key?t('Names.Group',{number:index+1}):t('Names.Independent')));
    for(const id of group.members) {
      const card=member(id),evidence=set.evidence[id];
      card.append(node('p',t('Names.EntryNumber',{number:set.members.indexOf(id)+1})));
      const metadata=node('details',null,'ts-technical');metadata.append(node('summary',t('Names.Metadata')));
      metadata.append(node('p',t('Names.NameEvidence',{names:evidence.names.map(e=>`${e.value} (${t('Names.Evidence.'+e.source)})`).join(' / ')})));
      const fields=node('dl',null,'ts-name-fields');
      const required=['documentType','type','rules','identifier',...(evidence.fields.type==='feat'?['owners','requirements','level','prerequisites']:evidence.fields.type==='spell'?['level','school']:[])];
      for(const field of new Set([...required,...Object.keys(evidence.fields).filter(key=>evidence.fields[key]!=null&&evidence.fields[key]!=='')])) {
        fields.append(node('dt',t('Names.Field.'+field)),node('dd',format(evidence.fields[field])));
      }
      metadata.append(fields);card.append(metadata);
      const concise=['requirements','level','school'].filter(field=>evidence.fields[field]!=null&&evidence.fields[field]!=='').map(field=>`${t('Names.Field.'+field)}: ${format(evidence.fields[field])}`);
      if(concise.length)card.append(node('p',concise.join(' · ')));
      if(evidence.warning)card.append(node('p',t('Grouping.Review.'+evidence.warning),'ts-risk'));
      card.append(ruleContent(id));section.append(card);
    }
    sections.push(section);
  }
  detail.append(node('h3',t('Names.Relationships')));
  for(const pair of set.pairs) {
    const section=node('section',null,'ts-name-pair');
    section.append(node('p',`${label(pair.left)} ↔ ${label(pair.right)}`),node('p',t('Names.Basis.'+pair.basis)));
    const refs=node('details',null,'ts-technical');refs.append(node('summary',t('Names.PairEntries')),node('code',pair.left),node('code',pair.right));section.append(refs);
    const compare=button('Names.CompareRules',()=>loadRules([pair.left,pair.right]));compare.setAttribute('data-ts-focus','compare:'+JSON.stringify([pair.left,pair.right]));section.append(compare);
    if(ruleEvidence.has(pair.left)&&ruleEvidence.has(pair.right)) {
      section.append(node('p',t('Names.RuleHint'),'ts-name-hint'));
      const comparison=node('div',null,'ts-rule-comparison');
      for(const id of [pair.left,pair.right]) {
        const column=node('section');column.append(node('h4',label(id)),ruleContent(id,{load:false}));comparison.append(column);
      }
      section.append(comparison);
    }
    if(pair.reason)section.append(node('p',pair.reason));
    if(pair.clues.length) {
      const clues=node('ul',null,'ts-name-clues');
      for(const clue of pair.clues)clues.append(node('li',clue.kind==='diagnostic'
        ?`${label(clue.member)}: ${t('Grouping.Review.'+clue.code)}`
        :`${t('Names.Field.'+clue.field)}: ${format(clue.left)} ↔ ${format(clue.right)}`));
      section.append(clues);
    }
    if(pair.status==='pending'&&!previewId) {
      const explanation=node('textarea');explanation.maxLength=1000;explanation.rows=2;
      explanation.placeholder=t('Names.DecisionReason');explanation.setAttribute('aria-label',t('Names.DecisionReason'));
      const controls=node('div',null,'ts-actions');
      const same=button('Names.Same',()=>onDecision({left:pair.left,right:pair.right,kind:'same',reason:explanation.value}));
      const different=button('Names.Different',()=>onDecision({left:pair.left,right:pair.right,kind:'different',reason:explanation.value}));
      const draftKey=JSON.stringify([pair.left,pair.right]);explanation.value=drafts.get(draftKey)??'';
      same.disabled=different.disabled=!explanation.value.trim();
      explanation.oninput=()=>{drafts.set(draftKey,explanation.value);same.disabled=different.disabled=!explanation.value.trim();};
      controls.append(same,different);section.append(explanation,controls);
    }
    detail.append(section);
  }
  const pagination=node('nav',null,'ts-pagination');
  const previous=button('UI.Previous',()=>onPairPage(Math.max(0,set.offset-set.limit))),next=button('UI.Next',()=>onPairPage(set.offset+set.limit));
  previous.disabled=set.offset===0;next.disabled=set.offset+set.limit>=set.total;
  pagination.append(previous,node('span',t('Names.PairPage',{from:set.total?set.offset+1:0,to:Math.min(set.total,set.offset+set.limit),total:set.total})),next);
  detail.append(pagination,node('h3',t('Names.Members')),...sections);
}

export function renderDecisionPreview({preview,detail,view,t,node}) {
  if(!preview?.decision)return;
  const decision=preview.decision;
  const box=node('section',null,'ts-risk ts-decision-preview');
  box.append(node('h3',t('Names.Preview.'+decision.request.kind)),node('p',decision.reason),
    node('p',t('Names.Affected',{count:decision.members.length})),node('p',t('Names.PreviewHint')));
  for(const [index,side] of (decision.sides??[decision.members]).entries()) {
    if(decision.sides)box.append(node('h3',t('Names.Side',{number:index+1})));
    for(const id of side)box.append(node('p',`${view.entries.get(id)?.names?.[0]??id} · ${id}`));
  }
  if(decision.comparison.fields.length||decision.comparison.entries.some(entry=>entry.warning)) {
    const comparison=node('details',null,'ts-technical');comparison.append(node('summary',t('Names.AllAffectedClues')));
    for(const entry of decision.comparison.entries) {
      comparison.append(node('p',`${view.entries.get(entry.uuid)?.names?.[0]??entry.uuid} · ${entry.uuid}`));
      for(const field of decision.comparison.fields)comparison.append(node('p',`${t('Names.Field.'+field)}: ${entry.fields[field]==null?t('Names.Unknown'):JSON.stringify(entry.fields[field])}`));
      if(entry.warning)comparison.append(node('p',t('Grouping.Review.'+entry.warning)));
    }
    box.append(comparison);
  }
  for(const pair of decision.clues) {
    const group=node('details',null,'ts-technical');group.append(node('summary',t('Names.PreviewClues')),
      node('code',pair.left),node('code',pair.right));
    for(const clue of pair.clues)group.append(node('p',clue.kind==='diagnostic'?t('Grouping.Review.'+clue.code):
      `${t('Names.Field.'+clue.field)}: ${JSON.stringify(clue.left)} ↔ ${JSON.stringify(clue.right)}`));
    box.append(group);
  }
  detail.append(box);
}
