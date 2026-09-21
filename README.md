# Turn Router for BB

A personal fork of [jjcm/bb-plugin-autorouter](https://github.com/jjcm/bb-plugin-autorouter), based on commit 82313237ac608b3969b5925d30009676ffbf6adb.

Routes each **new Codex turn** from BB's native composer. `Auto` is a choice at the top right of the model dropdown, including the compact layout without search. Selecting a model or reasoning level leaves Auto mode; select Auto again to resume routing. Existing running turns retain their selection.

## Policy

- Rate the next message with a bounded excerpt of recent conversation and pending plan items; do not assume follow-ups are easy.
- Obvious, narrowly defined text corrections skip inference.
- Default classifier: GPT-5.6 Luna low through the local Codex CLI and existing sign-in. Runs ephemerally in an empty temporary directory with read-only sandbox, shell/unified execution, web, apps, plugins and subagents disabled; project instructions omitted. Temporary files are removed on completion or timeout. This uses the local server machine's Codex sign-in.
- Optional compatible chat-completions classifier supports a user-selected model/provider, including DeepSeek or Kimi. Configure an HTTPS base URL and exact model in settings, and the API key in BB's secure setting. No tools are supplied. Enabling this sends draft text and recent conversation excerpts to that provider and may incur API charges.
- Confidence below 0.65, classifier failure, unseen attachments, or active work preserves the current model/effort. No silent provider changes.
- Match capability demand to measured options, then prefer lower benchmark cost. Complexity also limits effort (medium for simple tasks, high for routine tasks, xhigh/max for demanding work). Premium preference has less effect on simple tasks.
- Keep an adequate current selection when potential savings are small. This is a heuristic for reducing model switches, not a claim of measured Codex cache savings.
- Explicit `use Astra high` style requests take precedence. Ultra has no comparable published score and remains an explicit/manual choice. Unmeasured combinations are never assigned fabricated scores.

## Benchmark provenance

`benchmark-data.json` uses **Artificial Analysis Intelligence Index v4.3.2** scores and its cost per Intelligence Index task. Retrieved 2026-09-21. Every row includes a primary-source model URL. This is a consistent general-capability benchmark, **not** CursorBench or the Coding Agent Index. Do not mix scales. Costs are published benchmark estimates, not subscription usage rates. Refresh the snapshot and re-run policy tests when the source methodology changes.

Routing thresholds in `benchmarks.ts` are deliberately separate from measured data. At the default preference, demanding work can reach Astra; at maximum preference/difficulty, Astra max is eligible. No published comparable Ultra data is available.

## BB integration

Requires Plugin SDK 0.4.104. Uses `useComposer().experimental_setSelection()` and `experimental_submit()` so native attachments, mentions, permissions, service tier, environment selection and error recovery remain owned by BB. Same-provider model changes preserve the thread through BB's normal picker mechanism. The router never clears, forks, stops or sends to another thread.

BB has no model-picker extension slot or model-rewriting dispatch hook. A small cleanup-owned content script inserts the Auto choice and intercepts local Enter/send-button events. It targets `form[data-promptbox]`, `data-promptbox-submit-action` and the native picker trigger’s `aria-controls` portal relationship and model button IDs (with or without search), verified against the installed BB bundle. These selectors may change in future BB versions. Reload cleanup and input handling have DOM tests. CLI/API sends, queued-message editors and side chats are not automatically routed.

Auto state is per composer in browser local storage. A selected manual model disables Auto for that thread in that window/profile. The latest route and reason are shown above the composer. Routing logs contain model/type/scores only, never prompts or classifier credentials.

## Development and installation

```sh
npm install
npm test
npm run typecheck
bb plugin build .
bb plugin install . --yes
```

Optional bounded live classifier check (uses the existing Codex sign-in on one synthetic prompt):

```sh
TURN_ROUTER_LIVE=1 npm test -- classifier-live.test.ts
```

The local plugin ID is `turn-router`, separate from `autorouter`. Disable the old plugin after this one is installed and healthy. Roll back with `bb plugin disable turn-router` and `bb plugin enable autorouter`. No BB application files are modified.
