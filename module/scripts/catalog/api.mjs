import {CatalogError} from './service.mjs';

let service, openReview;
export function connectCatalog(value, open) { service = value; openReview = open; }
function current() {
  if (!service) throw new CatalogError('not-ready', 'Truesight has not initialized');
  return service;
}
export const catalog = Object.freeze({
  apiVersion: 1,
  getStatus: () => service?.getStatus() ?? {apiVersion: 1, ruleVersion: 1, revision: 0, generation: 0, status: 'not-ready'},
  whenReady: options => current().whenReady(options),
  read: uuids => current().read(uuids),
  getMember: uuid => current().getMember(uuid),
  preview: options => current().preview(options),
  apply: id => current().apply(id),
  undo: () => current().undo(),
  exclude: uuid => current().exclude(uuid),
  restoreExcluded: () => current().restoreExcluded(),
  openReview: options => { current(); return openReview(options); },
  registerPublications: (id, records) => current().registerPublications(id, records),
  unregisterPublications: id => current().unregisterPublications(id),
  sourceEnvironment: () => current().environment()
});
