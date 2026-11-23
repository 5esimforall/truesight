import {GROUP_RULE_VERSION} from './identity.mjs';
import {affects} from '../changes.mjs';
import {CatalogError} from './service.mjs';

let service, openReview;
export function connectCatalog(value, open) { service = value; openReview = open; }
function current() {
  if (!service) throw new CatalogError('not-ready', 'Truesight has not initialized');
  return service;
}
export function readMembership(uuids) {
  const active = current();
  return typeof active.readMembership === 'function' ? active.readMembership(uuids) : active.read(uuids);
}
export const catalog = Object.freeze({
  apiVersion: 1,
  affects,
  getStatus: () => service?.getStatus() ?? {apiVersion: 1, ruleVersion: GROUP_RULE_VERSION, revision: 0, generation: 0, status: 'not-ready'},
  whenReady: options => current().whenReady(options),
  read: uuids => current().read(uuids),
  getMember: uuid => current().getMember(uuid),
  loadRuleEvidence: uuids => current().loadRuleEvidence(uuids),
  readNameDecisions: () => current().readNameDecisions(),
  readNameReview: options => current().readNameReview(options),
  readNameSet: (key, options) => current().readNameSet(key, options),
  previewNameDecision: request => current().previewNameDecision(request),
  preview: options => current().preview(options),
  apply: id => current().apply(id),
  undo: () => current().undo(),
  previewExclusion: request => current().previewExclusion(request),
  openReview: options => { current().assertManager(); return openReview(options); },
  registerPublications: (id, records) => current().registerPublications(id, records),
  unregisterPublications: id => current().unregisterPublications(id),
  sourceEnvironment: () => current().environment()
});
