// @ts-check
import {createRefreshQueue} from './refresh.mjs';
import {affects} from '../changes.mjs';
import {loadCorpus, readCorpus, sourceError} from './corpus.mjs';
import {collectNamePairs} from './translations.mjs';
import {itemGroups, nameEvidence} from './groups.mjs';
import {planAliases, resolveItemAlias} from './resolver.mjs';
import {inScope, rulesEdition} from './scope.mjs';

/** @type {import('../../../types/api-v1.d.ts').TruesightNamesApi} */
export const core = Object.freeze({apiVersion: 1, affects, createRefreshQueue, loadCorpus, readCorpus, sourceError,
  collectNamePairs, itemGroups, nameEvidence, planAliases, resolveItemAlias, inScope, rulesEdition});
