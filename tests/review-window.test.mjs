import test from 'node:test';
import assert from 'node:assert/strict';
import {connectCatalog} from '../module/scripts/catalog/api.mjs';
import {reviewWindowClass} from '../module/scripts/review-window.mjs';
import {CatalogService} from '../module/scripts/catalog/service.mjs';
import {groupingFixture} from './catalog-fixture.mjs';
import {reviewRows,filterReviewRows} from '../module/scripts/review-model.mjs';
class Element {
 constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.value='';this.attributes={};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attributes[k]=v;}
}
const descendants=n=>[n,...n.children.flatMap(descendants)];
function fixture(){const f=groupingFixture();return new CatalogService({index:()=>({status:'ready',results:f.rows}),environment:()=>f.environment,load:()=>null,save:async()=>{}});}
test('review opens current state without calculating, previews explicitly, and applies only on confirmation',async t=>{
 const keys=['game','document','foundry','Hooks'];const before=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));t.after(()=>Object.assign(globalThis,before));
 globalThis.game={i18n:{localize:k=>k}};globalThis.document={createElement:t=>new Element(t)};
 globalThis.foundry={applications:{api:{ApplicationV2:class{}}}};
 let hook;globalThis.Hooks={on:(_,cb)=>{hook=cb;return 1;},off:()=>{}};
 const service=fixture();let calculations=0;const calculate=service.preview.bind(service);service.preview=(...args)=>{calculations++;return calculate(...args);};connectCatalog(service);
 const Window=reviewWindowClass(),root=await new Window()._renderHTML();
 assert.equal(root.children[0].children[0].className,'ts-tabs');
 const find=key=>descendants(root).find(n=>n.tag==='button'&&n.textContent==='TRUESIGHT.'+key);
 assert.equal(descendants(root).find(n=>n.className==='ts-message').textContent,'');
 assert.equal(calculations,0);assert.equal(find('UI.Apply').hidden,true);
 await find('UI.Recalculate').onclick();assert.equal(calculations,1);assert.equal(service.getStatus().reviewed,false);assert.equal(find('UI.Apply').hidden,false);
 await find('UI.Discard').onclick();assert.equal(service.getStatus().reviewed,false);assert.equal(find('UI.Apply').hidden,true);
 await find('UI.Recalculate').onclick();await find('UI.Apply').onclick();assert.equal(service.getStatus().reviewed,true);assert.equal(find('UI.Apply').hidden,true);
 await find('UI.Recalculate').onclick();hook({changes:['names']});assert.equal(find('UI.Apply').hidden,false);hook({changes:['display']});assert.equal(find('UI.Apply').hidden,false);hook({changes:['identity']});assert.equal(find('UI.Apply').hidden,true);
 assert.ok(descendants(root).find(n=>n.className==='ts-error').textContent.includes('Stale'));
});
test('review model distinguishes unchanged, added, adjusted and dissolved groups and isolates independent entries',()=>{
 const entries=new Map(['a','b','c','d','e','f'].map(id=>[id,{uuid:id,names:['Name '+id],key:id<'e'?'g':null,evidence:{identifier:'identifier-'+id,source:{raw:[{value:'Book'}]}}}]));
 const view={entries,groups:new Map([['g',{key:'g',members:['a','b']}],['h',{key:'h',members:['c','d']}]])};
 const preview={groups:[{key:'g',members:[{uuid:'a'},{uuid:'e'}]},{key:'new',members:[{uuid:'f'}]}],independent:[{uuid:'b',reason:'excluded'}]};
 const rows=reviewRows(view,preview);assert.deepEqual(rows.map(r=>r.change),['adjusted','added','removed','independent']);
 assert.equal(filterReviewRows(rows,view,'changes').length,3);assert.equal(filterReviewRows(rows,view,'excluded').length,1);
 assert.equal(filterReviewRows(rows,view,'all','identifier-e').length,1);assert.equal(filterReviewRows(rows,view,'all','Book').length,3);
 assert.equal(reviewRows(view)[0].change,'current');
 const unchanged=reviewRows(view,{groups:[{key:'different',members:[{uuid:'b'},{uuid:'a'}]}],independent:[]});assert.equal(unchanged[0].change,'unchanged');
});
