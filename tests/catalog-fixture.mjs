// Synthetic metadata: no production UUIDs, installed-package versions or item lists.
export function spell(id,patch={}) {
  const {system={},...rest}=patch;
  return {item:{uuid:`Compendium.fixture.spells.Item.${id}`,name:'Example Spell',documentType:'Item',subType:'spell',package:'fixture.spells',
    ...rest,system:{identifier:'example-spell',source:{rules:'2014',book:'PHB'},level:4,school:'con',...system}}};
}
export function groupingFixture() {
  const rows=[spell('old1'),spell('old2',{system:{source:{rules:'2014',book:'SRD 5.1'}}}),
    spell('new1',{system:{source:{rules:'2024',book:'PHB 2024'}}}),spell('new2',{system:{source:{rules:'2024',book:'SRD 5.2'}}}),
    spell('risk1',{name:'Conjure Example',originalName:'Conjure Example',system:{identifier:'conjure-example',source:{rules:'2014',book:'TCE'}}}),
    spell('risk2',{name:'例示召唤 Conjure Example (TCE)',originalName:'Conjure Example (TCE)',system:{identifier:'conjure-example-tce',source:{rules:'2014',book:'TCE'}}})];
  return {rows,environment:{packs:new Map(),modules:new Map(),system:{id:'dnd5e'}}};
}
