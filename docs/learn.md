# Learn: guided IT simulations

Learn replaces the former daily-question gate. Fred is no longer restricted by quiz completion, page counts, streaks, or CIO bypass logic. All authenticated IT staff can use Fred normally.

Learn is a self-paced simulation area at `/learn`, with a prominent entry button on every authenticated user's Home page. Exercises are divided into **At My Desk** and **Onsite**. Learners have ordinary support responsibilities and are not assumed to know which diagnostic questions to ask. Each scenario therefore supplies the question, explains why it matters, and points to the relevant Hub page.

The scenario has a predetermined state and outcome, but neither the correct choice nor final diagnosis is returned to the browser. The learner must open the relevant section, run the simulated check, examine the resulting observation, and interpret it. Choices remain unavailable until the check is run. Incorrect choices explain why the action would misdirect the investigation and allow another attempt.

Each step includes an isolated Fred training coach. Every request and response is marked `TRAINING EXERCISE — frozen simulation, not a live incident`. The coach uses the same configured AI model as Fred but receives no production tools, write permissions, hidden answer, future evidence, or final diagnosis. Before the learner runs a simulated check, Fred is explicitly told that the observation is locked. Afterward, she receives only that step's unlocked observation. Fred teaches terminology and diagnostic questions without completing the exercise for the learner.

Real SCCC incidents may be converted into training only as frozen, sanitized cases. Names, credentials, student data, sensitive configuration, and production-write capabilities must be removed. Completed incidents are the default source; a current issue requires a CIO-approved snapshot clearly labeled as a training copy.

The common workflow is:

1. Clarify the reported symptom and scope.
2. Choose the appropriate Hub evidence source.
3. Cross-check an independent signal.
4. Distinguish verified evidence from assumptions.
5. Identify the likely fault domain without exceeding the learner's role.
6. Resolve when possible or create an actionable escalation.
7. Preserve the outcome in the correct operational record.

Initial At My Desk scenarios cover gym Wi-Fi, student identity provisioning, SaaS/Azure availability, and post-incident continuity. Onsite scenarios cover building phones and room-to-core network paths. Together they exercise Buildings, Network, Network Map, Monitoring, Cisco Calling, Banner/EUP, Student Access, Azure, IT Apps, Incident Rooms, My Tasks, Risks, Processes, After-Action Reviews, and Weekly Logs.

Progress is stored per authenticated user in `learn_scenario_progress`, including current step, completion, attempts, and a compact answer history. Simulations never execute production changes. Running a completed scenario again resets only that user's progress for that scenario.

The retired `learning_gate_answers` data is left intact but is no longer read, written, exposed through a route, or recreated by schema reconciliation. It may be archived or removed later under an explicit retention decision.
