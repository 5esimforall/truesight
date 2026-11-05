import {validIdentifier} from '../catalog/item-identity.mjs';
const key=value=>typeof value==='string'?value.normalize('NFKC').trim().toLowerCase():'';
const english=entity=>[entity?.ENG_name,entity?.name].find(value=>typeof value==='string'&&/^[A-Za-z][A-Za-z\d '\u2019:(),.&!+/-]*$/.test(value))??null;
const slug=entity=>validIdentifier(key(english(entity)).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));
const editions={classic:'2014',one:'2024'};
const supported=new Set(['class','classFeature','subclassFeature']);
export function cnReference(item) {
  if(item?.__source!=='quick-insert'||!/^@(class|classFeature|subclassFeature)\[/.test(item.uuid??''))return null;
  const drag=item.dragData,match=item.uuid.match(/^@(\w+)\[([^\]]+)\]$/);
  if(!drag||!match||drag.tagTag!==match[1]||!supported.has(drag.tagTag)||typeof drag.tagText!=='string'
    ||!match[2].startsWith(drag.tagText+'|')||typeof drag.page!=='string'||typeof drag.source!=='string'||typeof drag.hash!=='string')return {error:'provider-identity'};
  return {tag:drag.tagTag,uid:drag.tagText,page:drag.page,source:drag.source,hash:drag.hash};
}

/** Optional read-only provider. No imports, patches, document creation, or
 * static dependency on the CN bundle. All calls use its already-loaded data APIs. */
export function createPlutoniumCnProvider({module,capabilities}) {
  let epoch=0,records=new Map(),loading=false,stopped=false;
  return {
    get records(){return records;},get loading(){return loading;},
    invalidate(){epoch++;records=new Map([...records].map(([id])=>[id,{status:'pending',warning:'provider-loading'}]));loading=false;},
    stop(){stopped=true;epoch++;records=new Map();loading=false;},
    async refresh(items) {
      if(stopped)return false;
      const turn=++epoch,references=items.map(item=>({item,ref:cnReference(item)})).filter(row=>row.ref);
      const active=module()?.active===true,api=capabilities();
      const usable=active&&typeof api.loader?.pCacheAndGet==='function'&&typeof api.data?.proxy?.unpackUid==='function'
        &&typeof api.urls?.URL_TO_HASH_BUILDER?.['classes.html']==='function';
      records=new Map(references.map(({item,ref})=>[item.uuid,{status:'pending',warning:ref.error??(usable?'provider-loading':'provider-unavailable')} ]));
      loading=usable&&references.length>0;
      if(!loading)return true;
      const cache=new Map(),next=new Map();
      const load=(page,source,hash)=>{
        const id=JSON.stringify([page,source,hash]);
        if(!cache.has(id))cache.set(id,Promise.resolve().then(()=>api.loader.pCacheAndGet(page,source,hash,{isCopy:true})));
        return cache.get(id);
      };
      let cursor=0;
      const worker=async()=>{while(cursor<references.length&&!stopped&&turn===epoch){const {item,ref}=references[cursor++];
        try {
          if(ref.error||(ref.tag==='class'&&item.subType!=='class'))throw Error('provider-identity');
          const entity=await load(ref.page,ref.source,ref.hash);
          if(!entity||key(entity.source)!==key(ref.source))throw Error('provider-identity');
          const uid=api.data.proxy.unpackUid(ref.tag,ref.uid);
          if(key(uid.name)!==key(entity.name)||key(uid.source)!==key(entity.source))throw Error('provider-identity');
          let parent=entity,child=null;
          if(ref.tag!=='class') {
            if(!Number.isInteger(entity.level)||entity.level<1||entity.level>20||uid.level!==entity.level
              ||key(uid.className)!==key(entity.className)||key(uid.classSource)!==key(entity.classSource))throw Error('provider-identity');
            parent=await load('raw_class',entity.classSource,api.urls.URL_TO_HASH_BUILDER['classes.html']({name:entity.className,source:entity.classSource}));
            if(!parent||key(parent.name)!==key(entity.className)||key(parent.source)!==key(entity.classSource))throw Error('provider-identity');
            if(ref.tag==='subclassFeature') {
              if(key(uid.subclassShortName)!==key(entity.subclassShortName)||key(uid.subclassSource)!==key(entity.subclassSource)
                ||typeof api.urls.URL_TO_HASH_BUILDER.subclass!=='function')throw Error('provider-identity');
              child=await load('raw_subclass',entity.subclassSource,api.urls.URL_TO_HASH_BUILDER.subclass({name:entity.subclassShortName,shortName:entity.subclassShortName,source:entity.subclassSource,className:entity.className,classSource:entity.classSource}));
              if(!child||key(child.className)!==key(entity.className)||key(child.classSource)!==key(entity.classSource)||key(child.shortName??child.name)!==key(entity.subclassShortName)||key(child.source)!==key(entity.subclassSource))throw Error('provider-identity');
            }
          }
          const rules=editions[parent.edition],identifier=slug(entity),owner=slug(parent),subclass=child&&slug(child);
          if(!rules||!identifier||!owner||(child&&!subclass)||(editions[entity.edition]&&editions[entity.edition]!==rules))throw Error('provider-identity');
          const context=ref.tag==='class'?{category:'',subtype:'',baseItem:''}:
            {category:'class',subtype:'',baseItem:'',owners:[{type:child?'subclass':'class',identifier:child?subclass:owner,classIdentifier:child?owner:null}],
              level:entity.level,prerequisites:[],requirements:null};
          // Undeclared constraints cannot be silently discarded to form a group.
          if(entity.prerequisite||entity.prerequisites)throw Error('provider-identity');
          next.set(item.uuid,{status:'ready',identifier,rules,context,originalName:english(entity),
            type:ref.tag==='class'?'class':'feat',trace:{provider:'plutonium-cn',...ref,ownerName:english(child??parent),ownerSource:(child??parent).source,edition:parent.edition},
            ruleEntries:structuredClone(entity.entries??[]),page:entity.page??null});
        }catch(error){next.set(item.uuid,{status:'failed',warning:error.message==='provider-identity'?'provider-identity':'provider-unavailable',trace:{provider:'plutonium-cn',...ref}});}
      }};
      await Promise.all(Array.from({length:Math.min(8,references.length)},worker));
      if(stopped||turn!==epoch)return false;
      records=module()?.active===true?next:new Map(references.map(({item})=>[item.uuid,{status:'failed',warning:'provider-unavailable'}]));loading=false;return true;
    }
  };
}
