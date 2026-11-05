import {api} from '../api-v1.mjs';
import {connectCatalog} from './catalog/api.mjs';
import {createRuntime} from './runtime.mjs';
import {reviewWindowClass} from './review-window.mjs';

let runtime;
Hooks.once('init', () => {
  runtime = createRuntime({game, hooks: Hooks, config: CONFIG});
  const ReviewWindow = reviewWindowClass();
  connectCatalog(runtime, options => new ReviewWindow(options).render({force: true}));
  game.modules.get('truesight').api = api;
  game.settings.registerMenu('truesight', 'review', {name: 'TRUESIGHT.Menu.Name', label: 'TRUESIGHT.Menu.Label',
    hint: 'TRUESIGHT.Menu.Hint', icon: 'fas fa-eye', type: ReviewWindow, restricted: false});
});
Hooks.once('ready', () => runtime.start());
