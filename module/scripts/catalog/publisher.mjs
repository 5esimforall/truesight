/** One native designated GM, one browser session. Presence is deliberately
 * fail-closed: a lost session is not expired while its user remains online.
 * This is cooperative coordination, not a server-side transaction or ACL. */
export function createPublisher({game, hooks, changed = () => {}, settleMs = 500}) {
  const channel = 'module.truesight', sessions = new Map();
  let ready = false, busy = false, timer, started = false;
  const own = () => game.socket?.id;
  const announce = (kind = 'hello') => {
    if (!own() || !game.user?.isGM) return;
    const data = {kind, session: own(), userId: game.user.id, busy};
    receive(data, true); game.socket.emit(channel, data);
  };
  const receive = (data, local = false) => {
    if (!data || typeof data.session !== 'string' || !game.users?.get(data.userId)?.isGM) return;
    if (!['hello', 'present', 'bye'].includes(data.kind)) return;
    if (data.kind === 'bye') {
      if (!sessions.get(data.session)?.busy) sessions.delete(data.session);
    } else sessions.set(data.session, {userId: data.userId, busy: data.busy === true});
    if (data.kind === 'hello' && !local) announce('present');
    changed();
  };
  const reset = () => {
    ready = false; sessions.clear(); clearTimeout(timer); announce();
    timer = setTimeout(() => {ready = true; changed();}, settleMs);
    changed();
  };
  const status = () => {
    const user = game.user, publisher = game.users?.activeGM;
    let publishReason = null;
    if (!user?.isGM || !user.can?.('SETTINGS_MODIFY')) publishReason = 'review-forbidden';
    else if (!ready || !game.socket?.connected || !own()) publishReason = 'publisher-not-ready';
    else if (publisher?.id !== user.id) publishReason = 'publisher-other-gm';
    else if ([...sessions.values()].filter(s => s.userId === user.id).length !== 1) publishReason = 'publisher-multiple-sessions';
    else if ([...sessions.entries()].some(([id, s]) => id !== own() && s.busy)) publishReason = 'publisher-busy';
    return {canPublish: !publishReason, publishReason, publisherId: publisher?.id ?? null};
  };
  const disconnected = () => {ready = false; changed();};
  const connected = (user, active) => {
    if (!active) for (const [id, s] of sessions) if (s.userId === user.id && !s.busy) sessions.delete(id);
    changed();
  };
  const bye = () => announce('bye');
  let connectionHook;
  return {
    status,
    start() {
      if (started) return; started = true;
      game.socket.on(channel, receive); game.socket.on('connect', reset); game.socket.on('disconnect', disconnected);
      connectionHook = hooks.on('userConnected', connected);
      globalThis.addEventListener?.('pagehide', bye); reset();
    },
    begin() {const state = status(); if (!state.canPublish) throw Object.assign(new Error(state.publishReason), {code: state.publishReason}); busy = true; announce('present');},
    end() {busy = false; announce('present');},
    destroy() {
      if (!started) return; bye(); clearTimeout(timer); ready = false;
      game.socket.off(channel, receive); game.socket.off('connect', reset); game.socket.off('disconnect', disconnected);
      hooks.off('userConnected', connectionHook); globalThis.removeEventListener?.('pagehide', bye);
    }
  };
}
