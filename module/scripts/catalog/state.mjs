// @ts-check
/** @typedef {import('../../../types/api-v1.d.ts').ReviewSnapshot} ReviewSnapshot */
/** @typedef {import('../../../types/api-v1.d.ts').ReviewState} ReviewState */
import { GROUP_RULE_VERSION } from './identity.mjs';

const reviewReasons=new Set(['edition','source','rules','identifier','spell','identity','excluded','no-match',
  'awaiting-review','unknown-type','type-context','owner-context','context-conflict','context-difference','context-size','origin','retained-members','provider-loading','provider-unavailable','provider-identity']);

/**
 * @param {any} value
 * @returns {ReviewSnapshot | null}
 */
export function validSnapshot(value) {
  if (!value || value.version !== 1 || value.ruleVersion !== GROUP_RULE_VERSION
    || !value.records || typeof value.records !== 'object' || Array.isArray(value.records) || !value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups)) return null;
  if(!Array.isArray(value.decisions)||value.decisions.length>10000)return null;
  const decisionKeys=new Set();
  for(const d of value.decisions) {
    if(!d||!['same','different'].includes(d.kind)||typeof d.key!=='string'||!d.key.startsWith('reviewed-name:')||d.key.length>100||decisionKeys.has(d.key)
      ||typeof d.reason!=='string'||!d.reason.trim()||d.reason.length>1000
      ||!Array.isArray(d.members)||d.members.length<2||d.members.length>500||new Set(d.members).size!==d.members.length
      ||!d.evidence||typeof d.evidence!=='object'||Array.isArray(d.evidence)
      ||Object.keys(d.evidence).length!==d.members.length||d.members.some((/** @type {any} */ id)=>typeof id!=='string'||!Object.hasOwn(value.records,id)
        ||typeof d.evidence[id]!=='string'||d.evidence[id].length>12000))return null;
    if(d.kind==='same'?d.sides!==null:!Array.isArray(d.sides)||d.sides.length!==2||d.sides.some((/** @type {any} */ side)=>!Array.isArray(side)||!side.length)
      ||d.sides.flat().length!==d.members.length||new Set(d.sides.flat()).size!==d.members.length||d.sides.flat().some((/** @type {any} */ id)=>!d.members.includes(id)))return null;
    decisionKeys.add(d.key);
  }
  const records=Object.entries(value.records),groups=Object.entries(value.groups);
  if(records.length>100000||groups.length>50000)return null;
  for(const [uuid,r] of records)if(!r||uuid.length>500||typeof r.fingerprint!=='string'||r.fingerprint.length>2000
    || (r.nameFingerprint!==null&&typeof r.nameFingerprint!=='string')
    || (r.warning!==null&&!reviewReasons.has(r.warning)) || (r.reason!==null&&!reviewReasons.has(r.reason)) || (r.key!==null&&typeof r.key!=='string'))return null;
  for(const [key,g] of groups) {
    if(!g||key.length>500||typeof g.kind!=='string'||!g.kind||g.kind.length>100||g.kind.trim()!==g.kind||![null,'implementation'].includes(g.risk)
      || !Array.isArray(g.members)||g.members.length<2||new Set(g.members).size!==g.members.length
      || g.members.some((/** @type {any} */ id)=>!Object.hasOwn(value.records,id)||value.records[id].key!==key))return null;
    if(g.reason==='reviewed-name') {
      const decision=value.decisions.find((/** @type {any} */ d)=>d.key===key&&d.kind==='same');
      if(!decision||g.risk!==null||g.members.length!==decision.members.length||g.members.some((/** @type {any} */ id)=>!decision.members.includes(id))
        ||![null,'2014','2024'].includes(g.rules))return null;
    } else if(g.kind==='spell') {
      if(!['2014','2024'].includes(g.rules)||!Number.isInteger(g.level)||typeof g.school!=='string'
        ||!['identifier','source-suffix'].includes(g.reason))return null;
    } else if(!['item-identity','origin'].includes(g.reason)||g.risk!==null
      ||!g.context||typeof g.context!=='object'||Array.isArray(g.context)||JSON.stringify(g.context).length>1600
      ||(g.kind==='document'&&g.reason!=='origin')
      ||(g.reason==='origin'&&typeof g.context.origin!=='string')
      ||(g.kind==='document'?![null,'2014','2024'].includes(g.rules):!['2014','2024'].includes(g.rules)))return null;
  }
  for(const [uuid,r] of records)if(r.key&&(!Object.hasOwn(value.groups,r.key)||!value.groups[r.key].members.includes(uuid)))return null;
  return structuredClone(value);
}

/** @returns {ReviewState} */
export const emptyReview = () => ({schemaVersion: 1, revision: 0, active: null, previous: null, excluded: []});
/**
 * @param {any} value
 * @returns {ReviewState}
 */
export function readReview(value) {
  if (value == null) return emptyReview();
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.excluded) || value.excluded.some((/** @type {unknown} */ id) => typeof id !== 'string')
      || (value.active !== null && !validSnapshot(value.active))) throw new Error('Invalid review cache');
  if (value.previous !== null && (!value.previous || (value.previous.active !== null && !validSnapshot(value.previous.active))
      || !Array.isArray(value.previous.excluded) || value.previous.excluded.some((/** @type {unknown} */ id) => typeof id !== 'string'))) throw new Error('Invalid undo state');
  return structuredClone(value);
}

/** Recalculate only complete observed relationships. An absent member is not
 * evidence of deletion. Preserve a partly observed old group as a whole. */
/**
 * @param {ReviewSnapshot | null | undefined} previous
 * @param {ReviewSnapshot} calculated
 * @returns {ReviewSnapshot}
 */
export function mergeReviewSnapshot(previous, calculated) {
  if (!previous) return structuredClone(calculated);
  const next = structuredClone(calculated), retained = new Set();
  next.decisions=structuredClone(previous.decisions);
  for (const group of Object.values(previous.groups)) {
    if (group.members.some(id => !Object.hasOwn(calculated.records, id))) for (const id of group.members) retained.add(id);
  }
  for (const id of Object.keys(previous.records)) if (!Object.hasOwn(calculated.records, id)) retained.add(id);
  for (const [key, group] of Object.entries(next.groups)) {
    group.members = group.members.filter(id => !retained.has(id));
    if (group.members.length < 2) delete next.groups[key];
  }
  for (const record of Object.values(next.records)) if (record.key && !next.groups[record.key]) {
    record.reason = previous.groups[record.key]?.members.some(id => retained.has(id)) ? 'retained-members' : 'no-match';
    record.key = null;
  }
  // A retained group can share its semantic key with a newly computed group.
  // Preserve the old decision; do not silently attach newly discovered members.
  for (const [key, group] of Object.entries(previous.groups)) if (group.members.some(id => retained.has(id))) {
    for (const id of next.groups[key]?.members ?? []) { next.records[id].key = null; next.records[id].reason = 'retained-members'; }
    next.groups[key] = structuredClone(group);
  }
  for (const id of retained) next.records[id] = structuredClone(previous.records[id]);
  return next;
}
