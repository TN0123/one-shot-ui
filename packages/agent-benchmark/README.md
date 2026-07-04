# @one-shot-ui/agent-benchmark (internal)

Benchmarks how well coding agents (Claude, GPT) replicate a UI from a screenshot,
scored deterministically by one-shot-ui, across three tiers of tool involvement.

## Corpus

Download the Design2Code testset (484 `{id}.html` + `{id}.png` pairs) once from
<https://huggingface.co/datasets/SALT-NLP/Design2Code> into a local directory, e.g. `./corpus`.

## Run

```sh
bun run build            # ensure dist/cli.mjs exists (the harness shells out to it)
export OPENAI_API_KEY=sk-...        # required for gpt-* rows
# Claude rows use your Claude Code subscription; ANTHROPIC_API_KEY must be UNSET.

bun run dev:agent-benchmark run \
  --corpus-dir ./corpus \
  --agents claude-opus-4-8,gpt-5.4-mini \
  --limit 30 --tiers 0,1,2 --k 2
```

Outputs `agent-benchmark-out/leaderboard.json` and `leaderboard.html`.

Tiers: **0** cold (screenshot only) · **1** tool feedback loop (`compare`+`suggest-fixes`, K rounds) ·
**2** deterministic `converge`. The Tier-0→Tier-2 lift measures what the tool adds.
