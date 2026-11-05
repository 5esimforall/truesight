export function providerFixture(entities) {
  const hash=e=>JSON.stringify([e.name,e.source]);
  const classes=entities.filter(e=>e.kind==='class'),features=entities.filter(e=>e.kind!=='class');
  const items=entities.map(e=>{
    const tag=e.kind==='class'?'class':e.subclassShortName?'subclassFeature':'classFeature';
    const uid=JSON.stringify({name:e.name,source:e.source,className:e.className,classSource:e.classSource,level:e.level,subclassShortName:e.subclassShortName,subclassSource:e.subclassSource});
    return {__source:'quick-insert',uuid:`@${tag}[${encodeURIComponent(uid)}|${e.name}]`,name:e.name,source:e.source,subType:tag==='class'?'class':'feat',documentType:'Item',system:{},
      dragData:{tagTag:tag,tagText:encodeURIComponent(uid),page:tag,source:e.source,hash:hash(e)},
      get(){throw Error('must not import');},onDrag(){return this.dragData;}};
  });
  let reads=0;
  const api={loader:{async pCacheAndGet(page,source,key){reads++;return structuredClone(entities.find(e=>e.source===source&&hash(e)===key));}},
    urls:{URL_TO_HASH_BUILDER:{'classes.html':hash,subclass:e=>hash({...e,name:e.shortName})}},
    data:{proxy:{unpackUid:(_tag,uid)=>JSON.parse(decodeURIComponent(uid))}}};
  return {items,api,get reads(){return reads;}};
}
export const examples=()=>[
  {kind:'class',name:'战士',ENG_name:'Fighter',source:'PHB',edition:'classic'},
  {name:'勇气',ENG_name:'Resolve',source:'PHB',className:'战士',classSource:'PHB',level:9,entries:['You can retry once. At level 13, twice.']},
  {kind:'class',name:'武者协力者',ENG_name:'Warrior Sidekick',source:'TCE',edition:'classic'},
  {name:'勇气',ENG_name:'Resolve',source:'TCE',className:'武者协力者',classSource:'TCE',level:11,entries:['You can retry once. At level 18, twice.']}
];
