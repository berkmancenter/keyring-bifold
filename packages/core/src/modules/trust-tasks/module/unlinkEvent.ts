/**
 * Said when an agent is about to be unlinked from this phone, this phone's own or another linked one (vtaAgent `unlink`,
 * `unlinkAgent`), before anything of it is let go. What the phone keeps for that agent's identities goes with it: the
 * rooms' kept posts (rooms/messageCache) empty on it.
 *
 * @module trust-tasks/module/unlinkEvent
 */
export const VTA_UNLINKING_EVENT = 'vta:unlinking'
