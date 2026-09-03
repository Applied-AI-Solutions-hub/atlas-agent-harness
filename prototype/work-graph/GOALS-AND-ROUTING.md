# Goals and capability routing

## Purpose

Sparky and Atlas remain conversational agents. The work graph is their company directory and operating ledger: it explains which measured capability can perform each substantial step, why that route is eligible, what it may access, and what receipt proves completion.

The route decision is deterministic. It filters the live worker registry by capability, health, privacy class, owning credential, deadline, and resource budget. It does not ask another model which model to call and is not placed in front of ordinary chat.

## Route contract

A route answer contains a plain-language reason plus bounded executable steps. Each step names:

- the required capability;
- the selected worker or tool shelf entry;
- why it satisfies privacy, health, quality, and latency policy;
- its dependencies, deadline, and expected artifact;
- an approved fallback, or an explicit statement that none exists.

`capability-route.schema.json` is the machine contract. A route may say `needs-approval` or `unavailable`; it must never invent a worker merely to keep moving.

## Bounded self-goals

An agent may propose a goal for itself only beneath a user-authorized root request. It may activate the goal automatically only when the root explicitly permits self-directed work and every effect is read, research, draft, index proposal, or current-channel progress. Any mutation still needs the existing approval boundary.

A child goal must inherit the parent's owner, namespace, privacy ceiling, allowed capabilities, allowed effects, deadline, and remaining budgets. It may narrow those values but never widen them. Maximum child depth is two and maximum children is eight.

Every active tick must produce a small progress receipt containing the current phase, last successful action, new evidence digest, next required capability, action fingerprint, and remaining budget. Conversation history is not goal state.

## Loop stops

- The same action fingerprint may run at most twice.
- Two ticks without a new evidence digest force a replan.
- At most two replans are permitted.
- A third no-progress tick marks the goal `blocked` and reports the exact obstacle.
- Twenty-four steps, the deadline, or any exhausted search/token budget stops execution.
- Agents cannot create authority, credentials, recursive copies of the same goal, or goals that modify their own boot policy.
- Resumption requires new evidence, a changed external state, or explicit user direction.

## Delivery

Discord receives one acknowledgement, periodic `current phase / last success` updates for long work, and exactly one terminal message: `Completed`, `Blocked`, `Timed out`, `Failed`, or `Cancelled`. The detailed result belongs in the shared report artifact, not in the always-loaded agent prompt.

## Activation gate

The schemas and invariants are designed but self-goal creation is not yet model-facing. Activation requires database transition tests, budget-conservation tests, loop-replay tests, owner/privacy tests, and one controlled Discord canary for each agent.
