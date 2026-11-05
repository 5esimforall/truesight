import {loadCorpus, readCorpus, sourceError} from './corpus.mjs';
import {collectNamePairs} from './translations.mjs';
import {itemGroups, nameEvidence} from './groups.mjs';
import {planAliases} from './resolver.mjs';
import {inScope, rulesEdition} from './scope.mjs';

export const core = Object.freeze({apiVersion: 1, loadCorpus, readCorpus, sourceError,
  collectNamePairs, itemGroups, nameEvidence, planAliases, inScope, rulesEdition});
