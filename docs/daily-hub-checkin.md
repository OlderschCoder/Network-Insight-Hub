# Daily Hub check-in

The Daily Hub check-in builds practical familiarity without blocking emergency assistance. Non-CIO users receive three deterministic, randomized questions per local calendar day. The pool spans Network, Buildings, Monitoring, Cisco Calling, Azure, Banner/EUP, Incidents, Risks, Projects, Reports, Processes, the User Guide, and Fred file/console workflows.

Answers are compared case-insensitively with harmless punctuation and spacing ignored. Incorrect attempts can be retried. Fred provides guided hints for routine questions until the day's three questions are complete, but incidents, outages, security issues, accessibility needs, and urgent operational work remain unrestricted. CIO accounts have an authenticated bypass; no shared override secret is stored or distributed.

Progress separately reports today's correct answers, qualifying days within the current three-day window, and distinct pages measured by authenticated page-view telemetry. Required learning events remain distinguishable from organic engagement in interpretation; page targets are presented as orientation progress, not proof of meaningful adoption.

Question selection is stable for a user and day so refreshing cannot reshuffle the assignment. Answers are stored in `learning_gate_answers`; page progress uses `product_usage_events`.
