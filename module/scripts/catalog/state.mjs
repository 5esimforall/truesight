import { GROUP_RULE_VERSION } from './identity.mjs';

export function validSnapshot(value) {
  if (!value || value.version !== 1 || value.ruleVersion !== GROUP_RULE_VERSION
    || !value.records || typeof value.records !== 'object' || Array.isArray(value.records) || !value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups)) return null;
  const records=Object.entries(value.records),groups=Object.entries(value.groups);
  if(records.length>100000||groups.length>50000)return null;
  for(const [uuid,r] of records)if(!r||uuid.length>500||typeof r.fingerprint!=='string'||r.fingerprint.length>2000
    || (r.nameFingerprint!==null&&typeof r.nameFingerprint!=='string') || (r.key!==null&&typeof r.key!=='string'))return null;
  for(const [key,g] of groups)if(!g||key.length>500||g.kind!=='spell'||!['2014','2024'].includes(g.rules)||!Number.isInteger(g.level)||typeof g.school!=='string'||![null,'implementation'].includes(g.risk)
    || !['identifier','source-suffix'].includes(g.reason)||!Array.isArray(g.members)||g.members.length<2
    || new Set(g.members).size!==g.members.length||g.members.some(id=>!Object.hasOwn(value.records,id)||value.records[id].key!==key))return null;
  for(const [uuid,r] of records)if(r.key&&(!Object.hasOwn(value.groups,r.key)||!value.groups[r.key].members.includes(uuid)))return null;
  return structuredClone(value);
}

export const reviewSettingKey = (world, user) => `review-${encodeURIComponent(world?.id ?? 'unknown')}-${encodeURIComponent(user?.id ?? user ?? 'unknown')}`;
export const emptyReview = () => ({schemaVersion: 1, revision: 0, active: null, previous: null, excluded: []});
export function readReview(value) {
  if (value == null) return emptyReview();
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.excluded) || value.excluded.some(id => typeof id !== 'string')
      || (value.active !== null && !validSnapshot(value.active))) throw new Error('Invalid or incompatible review state');
  if (value.previous && ((value.previous.active !== null && !validSnapshot(value.previous.active))
      || !Array.isArray(value.previous.excluded) || value.previous.excluded.some(id => typeof id !== 'string'))) throw new Error('Invalid undo state');
  return structuredClone(value);
}
