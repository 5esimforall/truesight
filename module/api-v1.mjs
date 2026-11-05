/** Public, versioned ESM entry. Consumers may import this file, never scripts/.
 * The same objects are exposed at game.modules.get('truesight').api. */
import * as publications from './scripts/catalog/publications.mjs';
import * as resolution from './scripts/catalog/source-resolution.mjs';
import {catalog} from './scripts/catalog/api.mjs';
import {core as names} from './scripts/names/api.mjs';
export {canonicalUuid, GROUP_INDEX_FIELDS} from './scripts/catalog/identity.mjs';
export const apiVersion = 1;
export const sources = Object.freeze({...publications, ...resolution});
export {catalog, names};
export const api = Object.freeze({apiVersion, catalog, names, sources});
