import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
/** Exercise the installed CN UID/hash protocol in an isolated JS context.
 * Raw loader results come from local files, not a live Foundry session. */
export async function installedCnFixture(data) {
 const root=join(data,'modules/plutonium-cn'),context=vm.createContext({I18nUtil:{get:key=>key}});
 for(const file of ['parser.js','utils.js'])vm.runInContext(await readFile(join(root,'js/5et',file),'utf8'),context,{filename:file,timeout:5000});
 const api=vm.runInContext('({data:DataUtil,urls:UrlUtil})',context),entities=[];
 for(const file of ['class-fighter.json','class-sidekick.json']) {
   const data=JSON.parse(await readFile(join(root,'data/class',file),'utf8'));
   entities.push(...data.class.map(e=>({...e,__prop:'class'})),...data.classFeature.filter(e=>e.ENG_name==='Indomitable').map(e=>({...e,__prop:'classFeature'})));
 }
 const hash=entity=>api.urls.URL_TO_HASH_BUILDER[entity.__prop==='class'?'classes.html':entity.__prop](entity);
 const items=entities.map(e=>{
   const tag=e.__prop,uid=api.data.proxy.getUid(tag,e,{isMaintainCase:true}),name=tag==='class'?e.name:`${e.className} ${e.level}; ${e.name}`;
   return {__source:'quick-insert',uuid:`@${tag}[${uid}|${name}]`,name,source:e.source,subType:tag==='class'?'class':'feat',documentType:'Item',system:{},
     dragData:{tagTag:tag,tagText:uid,page:tag==='class'?'classes.html':tag,source:e.source,hash:hash(e)},
     get(){throw Error('Import is forbidden');}};
 });
 api.loader={async pCacheAndGet(page,source,key){const prop=['classes.html','raw_class'].includes(page)?'class':page;
   return structuredClone(entities.find(e=>e.__prop===prop&&e.source.toLowerCase()===source.toLowerCase()&&hash(e)===key));}};
 return {api,items,entities};
}
