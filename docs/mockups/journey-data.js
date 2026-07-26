/* Strategos experience map — data.
   emo: 0 = frustrated/anxious (bottom), 1 = confident/delighted (top). */

window.STRATEGOS_JOURNEYS = [
  {
    id: 'member',
    kanji: '問',
    name: 'The member',
    sub: 'mon · to ask',
    who: 'Anyone in the org who uses AI to get work done — a developer, analyst, marketer, or ops teammate. Lives in the Console. Wants an answer or a working draft, and wants to trust that what they send is allowed and what they get back is private.',
    goal: 'Get real work done with the best model for the task — without thinking about routers, keys, or quotas.',
    quote: '“Just give me an answer I can trust, and tell me where it ran.”',
    stages: [
      {
        kanji: '門', no: 'Phase 01', name: 'Arrive', emo: 0.5, emoLabel: 'Curious',
        does: ['Opens an SSO invite', 'Picks a workspace scope', 'Sees their lane — models & ceiling'],
        thinks: '“Am I in the right place? What am I allowed to do here?”',
        touch: ['Sign-in', 'Workspace ⌘K', 'Your lane'],
        friction: 'Role and space are assigned silently — the member can’t see what their tier permits or what budget they share.',
        opportunity: 'A one-screen “here’s your lane” welcome: your space, your models, your monthly ceiling.',
        gap: 'No first-run orientation in Console — the member is dropped straight into Home.',
        resolved: {
          friction: 'Home opens with a “Your lane” card tied to the active workspace — its classification, models & ceiling, all visible.',
          opportunity: 'the lane is reopenable from the header and follows a global workspace switcher (⌘K) — company / department / team / personal.',
          gap: 'first-run orientation now lives on Home (persisted, dismissible).'
        }
      },
      {
        kanji: '答', no: 'Phase 02', name: 'Ask', emo: 0.78, emoLabel: 'Delighted',
        does: ['Types a question in Ask', 'Picks (or auto-routes) a model', 'Reads the answer + exec badge'],
        thinks: '“That was fast — and it tells me it ran on my device.”',
        touch: ['Ask', 'ExecBadge', 'Model picker'],
        friction: 'Auto-routing is invisible: the member can’t tell why a given model answered, or what it cost.',
        opportunity: 'The ExecBadge is the trust moment — extend it to show cost + why-this-model inline.',
        gap: 'No way to pin a preferred model or save the answer as a reusable snippet.',
        resolved: {
          friction: 'every answer shows the model, a “why this model” panel with the routing reason, and the call cost.',
          opportunity: 'ExecBadge now carries model + cost + an expandable routing rationale.',
          gap: 'pin-a-model (stops auto-routing) and save-as-snippet both shipped.'
        }
      },
      {
        kanji: '工', no: 'Phase 03', name: 'Build', emo: 0.4, emoLabel: 'Fiddly',
        does: ['Moves to Playground', 'Attaches retrieval / a tool', 'Iterates on a prompt'],
        thinks: '“Why did retrieval miss? Which tool am I even allowed to call?”',
        touch: ['Playground', 'Retrieval modes', 'MCP tools'],
        friction: 'Retrieval modes + tool allow-lists aren’t explained at point of use — failures look like the model’s fault.',
        opportunity: 'An inspector that shows what was retrieved, which tool ran, and on what — turn guesswork into a trace.',
        gap: 'No prompt templates or saved Playground sessions; every iteration starts cold.',
        resolved: {
          friction: 'each retrieval layer has a “use when” note, and a Tools panel shows your allow-list (what’s allowed / blocked) inline.',
          opportunity: 'an inline inspector reveals the retrieved chunks — or the SQL that ran, on which warehouse.',
          gap: 'shared templates + save-a-session both shipped in Playground.'
        }
      },
      {
        kanji: '蔵', no: 'Phase 04', name: 'Reuse', emo: 0.64, emoLabel: 'Productive',
        does: ['Saves work to Library', 'Opens a doc workspace', 'Shares within the workspace'],
        thinks: '“Good — I can find this again and hand it to a teammate.”',
        touch: ['Library', 'Library doc', 'Workspaces'],
        friction: 'Library is read-leaning today; editing and sharing a document feel like a separate, half-built surface.',
        opportunity: 'Make Library the home of reusable assets — templates, shared prompts, space knowledge.',
        gap: 'No team-visible templates or a shared knowledge base the member can contribute to.',
        resolved: {
          friction: 'docs edit inline, and Share (space / specific people / tenant) is one click in the workspace.',
          opportunity: 'a “Reusable assets” home gathers templates, saved prompts and Playground sessions — and Library is scoped to the active workspace, so the separate spaces sidebar is gone.',
          gap: 'shared templates are usable, and you contribute via Save-as-template (from a doc or a session).'
        }
      },
      {
        kanji: '繰', no: 'Phase 05', name: 'Automate', emo: 0.48, emoLabel: 'Intrigued',
        does: ['Explores the Workflows preview', 'Reads a flow — trigger → steps', 'Sees a run trace + governance tab'],
        thinks: '“I can see where this is going — but I can’t switch it on yet.”',
        touch: ['Workflows · v2', 'Builder', 'Runs'],
        friction: 'A good result in Ask or Playground is still a dead end in v1 — nothing makes the one-off actually repeatable yet.',
        opportunity: 'Promote a proven recipe into a governed workflow: a trigger, a chain of steps, a run history — the whole module is designed and previewable.',
        gap: 'Workflows (both flows and ReAct agents) are gated to a v2 preview — Run, create and edit are disabled; nothing executes unattended in v1.',
        preview: {
          friction: 'the Workflows module is built and explorable — flows, a step builder, run history and a governance tab — but marked v2 preview, so Run / create / edit are off.',
          opportunity: 'each workflow shows its Runs history (status, cost, what it touched) and a Governance tab (allowed tools, budget, approval gates) as a design preview.',
          gap: 'flows and ReAct agents both land in v2 — v1 ships the design, not live execution.'
        }
      },
      {
        kanji: '限', no: 'Phase 06', name: 'Stay in bounds', emo: 0.34, emoLabel: 'Anxious',
        does: ['Checks Activity', 'Hits a budget or policy limit', 'Reads why a request was blocked'],
        thinks: '“I’m blocked and I don’t know if it’s me, my team, or a rule.”',
        touch: ['Activity', 'Budget meter', 'Cascade'],
        friction: 'A block reads as a dead end — no visible remaining budget, no path to request more.',
        opportunity: 'Turn the limit into a conversation: show the cascade you sit under and a one-tap “ask admin”.',
        gap: 'No personal budget meter, no in-product appeal/request-increase flow.',
        resolved: {
          friction: 'Activity shows your live ceiling; at 100% you drop to the free local model — never a hard wall.',
          opportunity: 'the org → dept → you cascade is visible, with a one-tap Request increase to your admin — which now lands in the admin’s approval queue.',
          gap: 'personal budget meter + a request-increase flow (amount, reason, pending state) shipped.'
        }
      }
    ],
    flows: [
      {
        title: 'Ask a governed question',
        note: 'The everyday path — and the one moment the gateway has to earn trust.',
        steps: [
          { label: 'Open Ask', sub: 'Workspace' },
          { label: 'Type prompt', sub: 'free text' },
          { kind: 'decision', tag: '制', label: 'Policy + budget check', sub: 'gateway' },
          { label: 'Route to model', sub: 'on-device / eu-west-2', flag: true },
          { label: 'Answer + ExecBadge', sub: 'where it ran' },
          { kind: 'terminal', label: 'Save to Library', sub: 'optional' }
        ]
      },
      {
        title: 'Build with retrieval + a tool',
        note: 'Where capability meets confidence — the inspector turns guesswork into a trace.',
        steps: [
          { label: 'Open Playground', sub: 'Tools' },
          { label: 'Pick retrieval mode', sub: 'KB / file' },
          { kind: 'decision', tag: '具', label: 'Tool allowed?', sub: 'allow-list' },
          { label: 'Run + inspect trace', sub: 'inline inspector' },
          { kind: 'terminal', label: 'Promote to a workflow', sub: 'repeatable' }
        ]
      },
      {
        title: 'Turn a task into a workflow',
        note: 'The repeatable layer — designed end-to-end but gated to a v2 preview; a proven one-off will become a governed automation once it ships.',
        steps: [
          { label: 'Proven result', sub: 'Ask / Playground' },
          { label: 'Save as workflow', sub: 'Workflows' },
          { kind: 'decision', tag: '繰', label: 'Trigger?', sub: 'schedule / event / manual' },
          { label: 'Chain the steps', sub: 'list or canvas' },
          { kind: 'decision', tag: '盾', label: 'Review gate?', sub: 'tools + budget' },
          { kind: 'terminal', label: 'Runs unattended', sub: 'with run history' }
        ]
      }
    ]
  },

  {
    id: 'admin',
    kanji: '制',
    name: 'The admin',
    sub: 'sei · to govern',
    who: 'The gateway operator — IT, platform, or security owner. Lives in the Admin portal. Accountable for cost, compliance, and keeping every model reachable through one address.',
    goal: 'Stand up one governed endpoint for the whole org, mapped to its real hierarchy, and prove control without becoming a bottleneck.',
    quote: '“One address, every model — and a budget that cascades the way the org actually works.”',
    stages: [
      {
        kanji: '通', no: 'Phase 01', name: 'Connect', emo: 0.46, emoLabel: 'Effortful',
        does: ['Adds router connections', 'Registers models', 'Sets routing rules'],
        thinks: '“Is every provider reachable, and which run locally vs. via the gateway?”',
        touch: ['Connections', 'Models', 'Routing'],
        friction: 'Connections, Models and Routing are three separate screens for one mental task: “make models reachable”.',
        opportunity: 'A setup spine that links connect → register → route, with device-capability shown per model.',
        gap: 'No health/coverage view confirming every advertised model actually resolves.',
        resolved: {
          friction: 'a Gateway setup spine on Overview links connect → register → route as one task.',
          opportunity: 'the spine carries device-capability (on-device vs gateway) per step.',
          gap: 'a coverage check now confirms every advertised model resolves end-to-end (8 / 8).'
        }
      },
      {
        kanji: '組', no: 'Phase 02', name: 'Shape the org', emo: 0.34, emoLabel: 'Strained',
        does: ['Invites members', 'Builds the role/org tree', 'Allocates cascading budgets'],
        thinks: '“Our org is org → dept → team. Will the budget actually flow down that shape?”',
        touch: ['Members & roles', 'Onboarding', 'Org tree'],
        friction: 'Mapping a real hierarchy and a cascading budget onto a flat role list is the hardest, least-guided step.',
        opportunity: 'A visual hierarchy builder where budget allocation cascades down the same tree as permissions.',
        gap: 'Generic hierarchical roles + budget cascade are designed but not yet an editable tree.',
        resolved: {
          friction: 'the hierarchy is now an editable builder — add levels, rename, set a cap on each.',
          opportunity: 'budget cascades down the same tree as permissions, with live alloc-vs-cap headroom.',
          gap: 'the tree is fully editable (add / rename / re-cap / remove), not a static mock.'
        }
      },
      {
        kanji: '盾', no: 'Phase 03', name: 'Govern', emo: 0.5, emoLabel: 'Cautious',
        does: ['Writes governance policy', 'Sets MCP + tool allow-lists', 'Locks or opens features per role'],
        thinks: '“What’s locked, what can a team override, and who can register a tool?”',
        touch: ['Governance', 'MCP servers', 'Feature mgmt'],
        friction: 'The policy model (workspace-default → space-override → user-preference) isn’t legible — hard to see who wins.',
        opportunity: 'Show the effective policy for any member: the resolved value and which layer set it.',
        gap: 'Editors are read-only today; feature governance (locked / overridable) not yet built.',
        resolved: {
          friction: 'an Effective-policy resolver shows, per member, each policy’s value and which layer set it (workspace → space → you).',
          opportunity: 'a live Policy enforcement panel shows each guardrail, its applied/blocked counts (24h) and last-fired — and drills into any block to show its cause, with validate / correct actions that tune the policy.',
          gap: 'feature governance shipped — each feature is lockable or overridable per role.'
        }
      },
      {
        kanji: '観', no: 'Phase 04', name: 'Operate', emo: 0.7, emoLabel: 'In control',
        does: ['Watches live Requests', 'Audits a flagged call', 'Traces who ran what, where'],
        thinks: '“I can see every request and prove where it executed.”',
        touch: ['Usage patterns', 'Governance', 'Overview'],
        friction: 'Audit is reactive — there’s no alerting, so admins find issues by scrolling rather than being told.',
        opportunity: 'The usage surface is the strongest signal — anchor proactive alerts and anomaly flags off it.',
        gap: 'No alerts/notifications, no device-fleet view of where execution actually lands.',
        resolved: {
          friction: 'the old ledger is reframed as Usage patterns — routing & usage health: what’s falling back, what’s used, and the exceptions worth tracing.',
          opportunity: 'proactive Alerts surface budget, policy-block and provider-health thresholds on the Overview.',
          gap: 'a Device-fleet view shows every device and whether it executes on-device or via the gateway.'
        }
      },
      {
        kanji: '算', no: 'Phase 05', name: 'Account', emo: 0.55, emoLabel: 'Accountable',
        does: ['Reviews Budgets & billing', 'Issues scoped API keys', 'Manages service accounts'],
        thinks: '“Spend by team, and a programmable key our own apps can use safely.”',
        touch: ['Budgets & billing', 'API keys', 'Service accounts'],
        friction: 'Spend is reported in aggregate; tracing cost back down the org tree to a team takes manual work.',
        opportunity: 'Budgets that read against the same cascade — every team’s burn against its allocated ceiling.',
        gap: 'Tenant API keys + service-account identities are scoped but not yet a managed surface.',
        resolved: {
          friction: 'every API key / service account meters against the same cascade, so spend traces straight to a team.',
          opportunity: 'budgets and key usage both read against the org → dept → user tree — and a budget-request approval queue now consumes member requests (approve / reject), closing the member’s Stay-in-bounds loop.',
          gap: 'an API keys & service-accounts surface shipped — scope, spend-vs-cap and revoke per identity.'
        }
      }
    ],
    flows: [
      {
        title: 'Onboard a department with a cascading budget',
        note: 'The setup that defines whether the gateway maps to the real org — or fights it.',
        steps: [
          { label: 'Create department', sub: 'org tree' },
          { label: 'Add teams + members', sub: 'invite / SSO' },
          { kind: 'decision', tag: '組', label: 'Inherit or override role?', sub: 'per node' },
          { label: 'Allocate budget', sub: 'cascades down', flag: true },
          { kind: 'terminal', label: 'Department live', sub: 'caps active' }
        ]
      },
      {
        title: 'A request is blocked → audit → adjust',
        note: 'The control loop — and where the member’s anxiety meets the admin’s evidence.',
        steps: [
          { label: 'Member request', sub: 'Console' },
          { kind: 'decision', tag: '制', label: 'Policy / budget hit', sub: 'gateway' },
          { label: 'Blocked + logged', sub: 'audit trail', flag: true },
          { label: 'Admin reviews', sub: 'Governance' },
          { label: 'Adjust policy or cap', sub: 'Governance', flag: true },
          { kind: 'terminal', label: 'Member unblocked', sub: 'notified' }
        ]
      }
    ]
  }
];

window.STRATEGOS_FOCUS = {
  title: 'Where to focus',
  sub: 'Read across both journeys, three gaps moved the experience most — each sat at a low point on a curve and unlocked a flow that used to stall. All three have shipped. A fourth theme — repeatable automation — is designed end-to-end but gated to a v2 preview, so it’s the edge still ahead, not a live capability.',
  cards: [
    {
      rank: '01 · highest leverage', tone: 'op',
      title: 'The hierarchy + cascade builder',
      body: 'The admin’s deepest dip (Shape the org) and the member’s (Stay in bounds) are the same missing object: a visual org tree where budgets cascade down the structure that governs permissions.',
      tags: ['Admin · Phase 02', 'Member · Phase 05', 'Roadmap P3'], done: true
    },
    {
      rank: '02 · trust multiplier', tone: 'op',
      title: 'Make the invisible legible',
      body: 'Extend the ExecBadge with cost + why-this-model, and surface the effective policy for any member. The gateway’s decisions become explanations instead of mysteries.',
      tags: ['Member · Phase 02', 'Admin · Phase 03', 'Cross-cutting'], done: true
    },
    {
      rank: '03 · close the loop', tone: 'fr',
      title: 'From block to conversation',
      body: 'Pair a personal budget meter + request-increase flow (member) with proactive alerts on the admin Overview. The blocked-request flow stops being a dead end — the request now lands in an admin approval queue. Remaining thread: the queue isn’t yet a proactive alert, so the admin still finds it by looking.',
      tags: ['Member · Phase 06', 'Admin · Phase 05', 'Roadmap P3'], done: true
    },
    {
      rank: '04 · the live edge', tone: 'op',
      title: 'Repeatable automation',
      body: 'The member’s “Automate” moment: a workflow with a trigger, steps on a List or DAG canvas, a run history and a governance tab. The whole module is designed and explorable — but gated to a v2 preview: nothing runs unattended in v1, and ReAct agents sit behind the same gate.',
      tags: ['Member · Phase 05', 'Workflows · v2', 'Roadmap P4 · agents'], preview: true
    }
  ]
};
