import { invoke } from '@forge/bridge';

/**
 * Drive a paginated resolver action that follows the standard offset/`completed`
 * batch contract: each call returns `{ success, completed, offset, ... }`.
 *
 * Used by the admin tools (backup export, migration scan, migration convert) so all
 * three share one loop instead of re-implementing it.
 *
 * Calls `onBatch(response)` for each successful batch. Resolves when a batch reports
 * `completed: true`. Throws the resolver's `error` value on the first unsuccessful
 * response (caller is responsible for surfacing it).
 *
 * @param {string} resolver   resolver function name, e.g. 'migrationData' / 'adminData'
 * @param {object} baseParams params merged into every invocation (e.g. {action, spaceKey})
 * @param {(res:object)=>void} onBatch called with each successful response
 * @param {number} [startOffset=0] initial offset
 */
export async function runBatched(resolver, baseParams, onBatch, startOffset = 0) {
  let offset = startOffset;
  let completed = false;

  while (!completed) {
    const response = await invoke(resolver, { ...baseParams, offset });

    if (!response || !response.success) {
      throw response?.error || 'error.generic';
    }

    onBatch(response);
    completed = response.completed;
    offset = response.offset;
  }
}
