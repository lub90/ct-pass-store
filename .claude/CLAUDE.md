## Development workflow (Superpowers + additional reviews)

### Flow
1. New features always start with the Superpowers "brainstorming" skill. For security-relevant features, create or update docs/threat-model.md during brainstorming: assets worth protecting, attacker types, main attack scenarios, and accepted risks.
2. After the spec and plan are written (writing-plans), always proactively propose "subagent-driven-development" for implementation.
3. Implementation strictly follows test-driven-development (red, green, refactor).
4. Do not change or replace the Superpowers process itself. The additional reviews below are extra steps around it, never instead of its own reviews.

### Marking security-critical tasks
When writing the plan, mark every task that touches cryptography, authentication, authorization, secret storage, or handling of untrusted input as "[security-critical]".

### Review point A: after security-critical tasks
For a task marked [security-critical]: once Superpowers' own reviews for that task have approved it, dispatch the `test-reviewer` and `security-reviewer` subagents on that task's diff before moving on.
- If either returns CHANGES_REQUIRED, send the CRITICAL and IMPORTANT findings back to an implementer subagent as a fix, following TDD, and let Superpowers' own reviews check the fix as usual.
- Then the reviewer(s) that requested changes review again, until they return APPROVED.
- Only then continue with the next task.

### Review point B: at the end of the branch (always)
When all tasks of the plan are done and before finishing the development branch:
1. Dispatch `test-reviewer` and `security-reviewer` on the full branch diff (not just the last task), with the spec and the plan.
2. Turn every CRITICAL and IMPORTANT finding into a new task appended to the plan.
3. Work through these tasks with subagent-driven-development exactly like any other task (TDD + Superpowers' own reviews).
4. Then run both reviewers on the full branch diff again. Repeat until both return APPROVED.
5. As an independent second check, run Claude Code's built-in `/security-review` on the branch. If you cannot invoke it yourself, ask the maintainer to run it and wait for the result. Treat its CRITICAL and IMPORTANT findings like those of the security-reviewer (new tasks, then re-check). If it contradicts the security-reviewer or flags something listed as an accepted risk, ask the maintainer.
6. Only then proceed with finishing the development branch.

### Extended security review
The `security-reviewer` always runs in standard mode within this workflow (review points A and B). Only run it in extended mode (with tools and fuzzing) when the maintainer explicitly asks for an "extended security review".

### Limits and conflicts
- MINOR findings: collect them, then fix them or explicitly justify dropping them in the final report.
- After 3 review rounds at the same review point without approval: stop and ask the maintainer, with a short summary of the disputed points.
- If reviewers contradict each other, security wins; if unclear, ask the maintainer.

### Final report
For the maintainer at the end: the verdicts of both extra reviewers per review point, the number of rounds, and any open MINOR findings.