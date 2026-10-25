export type LearnChoice = { label: string; result: string; correct: boolean };
export type LearnStep = {
  title: string;
  situation: string;
  coach: string;
  pageLabel: string;
  pageHref: string;
  evidence: string;
  question: string;
  choices: LearnChoice[];
};
export type LearnScenario = { id: string; title: string; mode: "desk" | "onsite"; summary: string; sections: string[]; minutes: number; steps: LearnStep[] };

export const LEARN_SCENARIOS: LearnScenario[] = [
  {
    id: "gym-no-wifi", title: "No Wi-Fi in the gym", mode: "desk", minutes: 12,
    summary: "Work from your desk, establish scope, cross-check building services, and route the issue without pretending to be a network engineer.",
    sections: ["Buildings", "Monitoring", "Cisco Calling", "Incident Rooms", "My Tasks"],
    steps: [
      { title: "Clarify the report", situation: "A caller says, ‘There is no Wi-Fi in the gym.’ That sentence is a symptom, not yet a diagnosis.", coach: "Start with questions the caller can answer. Scope tells you whether to investigate one device, Wi-Fi generally, or the entire building.", pageLabel: "User Guide", pageHref: "/user-guide", evidence: "Caller is available by phone; you are at your desk.", question: "What should you ask first?", choices: [
        { label: "Is this one device, several devices, or everyone in the gym?", correct: true, result: "Good. The caller says several people cannot join Wi-Fi, but wired gym equipment still works." },
        { label: "What model access point is installed?", correct: false, result: "The caller probably does not know, and that skips the most important first step: determine scope." },
        { label: "Tell everyone to reboot their computers.", correct: false, result: "That treats many devices as simultaneous failures without evidence. First establish scope." },
      ]},
      { title: "Check the building, not just the complaint", situation: "Several users are affected, but wired equipment reportedly works. You need an independent view of the building.", coach: "Open Buildings and search for the gym or Student Union. Look for device health and whether other services remain reachable.", pageLabel: "Buildings", pageHref: "/network/buildings", evidence: "Simulation: the Student Union building is operational; its managed switch is online.", question: "What does that evidence support?", choices: [
        { label: "The whole building is not down; narrow this toward wireless service.", correct: true, result: "Correct. A reachable building switch contradicts a total building outage." },
        { label: "The entire campus network is down.", correct: false, result: "That conflicts with the online building switch. Do not promote one symptom into a campus outage." },
        { label: "The switch must be replaced.", correct: false, result: "The switch is reachable. Replacement is not supported by the evidence." },
      ]},
      { title: "Cross-check another service", situation: "The building switch is online. One more independent service can tell you whether the building path is generally working.", coach: "Cisco Calling shows phones assigned to buildings. Online phones are evidence that power, access switching, and the upstream service path are functioning.", pageLabel: "Cisco Calling", pageHref: "/it-apps/cisco-calling", evidence: "Simulation: three assigned Student Union phones are online.", question: "What is the best interpretation?", choices: [
        { label: "The building path is working; investigate Wi-Fi/AP service rather than a total network outage.", correct: true, result: "Exactly. The fault domain is now wireless-specific or localized." },
        { label: "Phones and Wi-Fi are unrelated, so ignore this.", correct: false, result: "They are different services, but share enough infrastructure to provide valuable corroboration." },
        { label: "An online phone proves every access point is healthy.", correct: false, result: "It proves the broader path works, not that every wireless component is healthy." },
      ]},
      { title: "Ask the useful follow-up", situation: "Evidence points away from a building-wide outage and toward wireless service.", coach: "A support technician does not need switch commands here. Ask observable questions that help the network engineer identify the wireless scope.", pageLabel: "Monitoring", pageHref: "/monitoring", evidence: "Simulation: no building-wide reachability alert is active.", question: "Which caller question is most useful now?", choices: [
        { label: "Can users see the SCCC Wi-Fi name, and what exact message appears when they connect?", correct: true, result: "Good. ‘SSID missing’ and ‘authentication failed’ point to very different next owners and checks." },
        { label: "What spanning-tree priority is the gym using?", correct: false, result: "That is not a caller-facing question and is not supported by the current fault domain." },
        { label: "Can you configure the switch trunk for me?", correct: false, result: "Do not ask an end user to make infrastructure changes." },
      ]},
      { title: "Route and document", situation: "Users cannot see the SCCC Wi-Fi name in the gym. Building switches and phones remain online.", coach: "You have enough evidence to route this cleanly. Record symptom, scope, checks, and the evidence that narrowed the fault domain.", pageLabel: "Incident Rooms", pageHref: "/incidents", evidence: "Observed facts: SSID absent for several users; building switch and three assigned phones remain online; no building-wide alert is active.", question: "What is the right action?", choices: [
        { label: "Open an incident or task for network staff with scope and evidence; keep the caller updated.", correct: true, result: "Resolved as a support workflow. You did not repair an AP—you made the problem actionable without wasting two days." },
        { label: "Close the ticket because wired equipment works.", correct: false, result: "The reported service is still unavailable. Narrowing the cause is not the same as resolving it." },
        { label: "Escalate as a campus-wide emergency.", correct: false, result: "The evidence supports a localized wireless incident, not a campus-wide outage." },
      ]},
    ],
  },
  {
    id: "student-account-missing", title: "Student cannot access an account", mode: "desk", minutes: 10,
    summary: "Use Banner/EUP evidence, validate identifiers, and distinguish provisioning delay from an Entra mismatch.", sections: ["Banner", "Student Access", "Risks", "My Tasks"],
    steps: [
      { title: "Collect the minimum identifiers", situation: "A student says their account does not work.", coach: "Ask for the institutional student ID and school-issued email. Never ask for their password.", pageLabel: "Banner", pageHref: "/banner", evidence: "Simulation: student provides an 800-number and firstname.lastname@g.sccc.edu.", question: "What should you verify first?", choices: [
        { label: "Find the matching Banner/EUP audit record and compare ID, name, and email.", correct: true, result: "Correct. Start with the provisioning evidence already in the Hub." },
        { label: "Ask the student to send their password.", correct: false, result: "Never collect passwords. The audit record should answer the provisioning question." },
        { label: "Create a second account immediately.", correct: false, result: "Duplicates make identity problems worse. Verify the existing record first." },
      ]},
      { title: "Interpret verification", situation: "The EUP record exists but shows Entra verification failed because the email suffix differs.", coach: "Compare the institutional format and determine whether the source record or Entra identity is wrong.", pageLabel: "High School Student Access", pageHref: "/student-access", evidence: "Expected email is firstname.lastname@g.sccc.edu; observed Entra value uses a different domain.", question: "What is the fault domain?", choices: [
        { label: "Identity/provisioning mismatch, not a password-strength problem.", correct: true, result: "Correct. Route the mismatch with both values and the audit timestamp." },
        { label: "Wi-Fi outage.", correct: false, result: "Nothing in the evidence points to network reachability." },
        { label: "The student typed the password too slowly.", correct: false, result: "That is speculation and does not explain the verification mismatch." },
      ]},
      { title: "Create an actionable handoff", situation: "The mismatch must be corrected by the provisioning/identity owner.", coach: "Record exact non-secret identifiers, expected value, observed value, source timestamp, and requested correction.", pageLabel: "My Tasks", pageHref: "/items", evidence: "No credentials are needed or appropriate.", question: "Which handoff is useful?", choices: [
        { label: "Assign a task with student ID, expected email, observed mismatch, and audit link.", correct: true, result: "Complete. The next person can act without repeating discovery." },
        { label: "Write ‘account broken’ and assign it.", correct: false, result: "That forces the next person to repeat your work." },
        { label: "Paste a password into the task.", correct: false, result: "Credentials never belong in operational records." },
      ]},
    ],
  },
  {
    id: "saas-outage", title: "A SaaS application is unavailable", mode: "desk", minutes: 10,
    summary: "Separate local access, Azure/platform health, and vendor service failure before escalating.", sections: ["IT Apps", "Azure", "Monitoring", "Incident Rooms", "After-Action"],
    steps: [
      { title: "Establish scope", situation: "Multiple staff say an IT application will not load.", coach: "Ask whether other sites work and capture the exact URL and error. This separates general connectivity from one service.", pageLabel: "App Directory", pageHref: "/it-apps", evidence: "Simulation: other sites work; the same application fails for several users.", question: "Where should you focus?", choices: [
        { label: "The application/service path, not each employee's workstation.", correct: true, result: "Correct. Multiple users and one application establish useful scope." },
        { label: "Replace every workstation.", correct: false, result: "A shared symptom across devices argues against simultaneous workstation failure." },
        { label: "Assume the campus core is down.", correct: false, result: "Other sites work, which contradicts that assumption." },
      ]},
      { title: "Check owned infrastructure", situation: "The failing application may run on Azure infrastructure.", coach: "Use Azure and Monitoring to distinguish a stopped VM/resource problem from a vendor or application issue.", pageLabel: "Azure", pageHref: "/azure-vms", evidence: "Simulation: the VM is running and Azure Resource Health is available, but the application health check fails.", question: "What does that mean?", choices: [
        { label: "The host exists; investigate the application/service layer next.", correct: true, result: "Correct. Running infrastructure does not prove the application is healthy." },
        { label: "Everything is healthy because the VM is running.", correct: false, result: "A running VM can serve a broken application." },
        { label: "Azure is globally down.", correct: false, result: "Resource Health contradicts that conclusion." },
      ]},
      { title: "Coordinate and preserve evidence", situation: "The application health check fails while its VM and Azure platform remain healthy.", coach: "Open an incident with timestamps, affected URL, scope, and the checks already completed. After resolution, capture the lesson if it can recur.", pageLabel: "Incident Rooms", pageHref: "/incidents", evidence: "Observed facts: several users affected; other sites work; VM is running; Azure Resource Health is available; application health check fails.", question: "What is the best next action?", choices: [
        { label: "Create an incident and assign the application owner with the completed checks.", correct: true, result: "Complete. The escalation begins where your evidence ends." },
        { label: "Tell every user to keep refreshing indefinitely.", correct: false, result: "That neither diagnoses nor coordinates the outage." },
        { label: "Delete and recreate the VM.", correct: false, result: "That is destructive and unsupported by the evidence." },
      ]},
    ],
  },
  {
    id: "phone-building", title: "Onsite phone complaint", mode: "onsite", minutes: 9,
    summary: "Use Cisco Calling and Buildings together to distinguish one device, voice service, and building network impact.", sections: ["Cisco Calling", "Buildings", "Monitoring", "Incident Rooms"],
    steps: [
      { title: "Count before concluding", situation: "Someone says, ‘The phones are down in Allied Health.’", coach: "Use Cisco Calling to count assigned phones and their current states before calling the building down.", pageLabel: "Cisco Calling", pageHref: "/it-apps/cisco-calling", evidence: "Simulation: four assigned phones; one offline and three online.", question: "What can you say confidently?", choices: [
        { label: "One phone is affected; building voice service is still operating.", correct: true, result: "Correct. Three live phones are strong contradictory evidence against a building-wide outage." },
        { label: "Allied Health is completely down.", correct: false, result: "That conflicts with three online phones." },
        { label: "The core switch failed.", correct: false, result: "The evidence does not support a core failure." },
      ]},
      { title: "Cross-check the network", situation: "One phone is offline while three remain online.", coach: "Check Buildings for the local switch and related device health. This helps distinguish one endpoint/port from broader degradation.", pageLabel: "Buildings", pageHref: "/network/buildings", evidence: "Simulation: the Allied Health switch stack is online with no building-wide alert.", question: "What is the likely scope?", choices: [
        { label: "Single phone, cable, or access-port issue.", correct: true, result: "Correct. Route a bounded endpoint check rather than declaring an outage." },
        { label: "Campus-wide voice failure.", correct: false, result: "Both phone and network evidence contradict that." },
        { label: "Banner provisioning failure.", correct: false, result: "Banner is unrelated to the observed phone state." },
      ]},
    ],
  },
  {
    id: "switch-path", title: "Onsite room network failure", mode: "onsite", minutes: 12,
    summary: "Trace the room through descriptions, the access switch, uplink, and reciprocal core port before escalating.", sections: ["Network", "Network Map", "Buildings", "Monitoring", "Process Library"],
    steps: [
      { title: "Locate the room", situation: "AA109 reports no wired network. The room may not exist as its own map node.", coach: "Search port descriptions and building data. A room label may live on an access-switch interface rather than the topology map.", pageLabel: "Network", pageHref: "/network", evidence: "Simulation: AA109 appears in a port description on the Hobble access switch.", question: "What did you establish?", choices: [
        { label: "The likely access switch and local port serving the room.", correct: true, result: "Correct. Now trace upward instead of guessing at the core." },
        { label: "The exact root cause.", correct: false, result: "You found location, not cause." },
        { label: "The room does not exist because it is not a node.", correct: false, result: "Port descriptions can locate rooms that are not topology nodes." },
      ]},
      { title: "Trace both ends", situation: "The room's access port is known. You need the upstream path.", coach: "Use Network Map for the path, then compare the local uplink with the reciprocal upstream interface. One side showing up is not sufficient.", pageLabel: "Network Map", pageHref: "/network/map", evidence: "Simulation: local uplink is up, but the expected reciprocal Nexus port has rising errors and an intermittent neighbor.", question: "Where is the strongest fault evidence?", choices: [
        { label: "The uplink/reciprocal core-link path, not the room endpoint alone.", correct: true, result: "Correct. Both ends expose the conflict and narrow the fault domain." },
        { label: "The user's keyboard.", correct: false, result: "That does not explain reciprocal link errors." },
        { label: "Every switch on campus.", correct: false, result: "The evidence identifies a specific path." },
      ]},
      { title: "Escalate with a reproducible record", situation: "The link requires a network engineer, but your evidence is already useful.", coach: "Provide room, access port, local uplink, reciprocal core port, timestamps, and observed errors. Link the relevant runbook when available.", pageLabel: "Process Library", pageHref: "/processes", evidence: "A reversible validation and rollback belong with any proposed change.", question: "What should your handoff contain?", choices: [
        { label: "The complete path, conflicting states, timestamps, and requested validation.", correct: true, result: "Complete. The engineer starts with evidence rather than repeating discovery." },
        { label: "‘Network broken—please investigate.’", correct: false, result: "That discards the path you just established." },
        { label: "An unapproved trunk change.", correct: false, result: "Support staff should not make a high-impact infrastructure change." },
      ]},
    ],
  },
  {
    id: "close-the-loop", title: "Close the loop after an incident", mode: "desk", minutes: 8,
    summary: "Turn resolved work into tasks, a reusable process, risk follow-up, and an after-action record without duplicating noise.", sections: ["My Tasks", "Risks", "Process Library", "After-Action", "Weekly Log"],
    steps: [
      { title: "Separate outputs", situation: "A recurring outage is resolved. The timeline, remaining risk, and permanent fix are currently scattered in chat.", coach: "Different Hub records serve different purposes: task for follow-up, risk for unresolved exposure, process for repeatable response, and PIR for lessons.", pageLabel: "Post-Incident Reviews", pageHref: "/after-action", evidence: "Simulation: service restored, recurrence risk remains, and the successful checks can become a runbook.", question: "What is the best record set?", choices: [
        { label: "PIR for the event, risk for recurrence, process for the fix, and tasks for owners.", correct: true, result: "Correct. Each fact gets one durable home and a clear purpose." },
        { label: "Paste the entire chat into every section.", correct: false, result: "Duplication creates noise and conflicting versions." },
        { label: "Record nothing because service is restored.", correct: false, result: "That guarantees the next incident begins from zero." },
      ]},
      { title: "Make reporting automatic", situation: "The work also needs to appear in the employee's weekly record.", coach: "Concrete tasks and weekly-log entries should capture outcomes, not every conversational turn.", pageLabel: "Weekly Log", pageHref: "/entries", evidence: "Simulation: restoration, validation, and follow-up owners are known.", question: "What belongs in the weekly record?", choices: [
        { label: "Outcome, impact, validation, and meaningful follow-up—not raw troubleshooting chatter.", correct: true, result: "Complete. Reporting becomes evidence of work rather than a transcript landfill." },
        { label: "Every command prompt and typo.", correct: false, result: "Raw evidence belongs with the incident when needed, not in the executive work summary." },
        { label: "Only the ticket number with no result.", correct: false, result: "That hides the outcome and value of the work." },
      ]},
    ],
  },
];

export function getLearnScenario(id: string) { return LEARN_SCENARIOS.find(s => s.id === id) ?? null; }
export function evaluateLearnChoice(scenario: LearnScenario, stepIndex: number, choiceIndex: number) {
  const step = scenario.steps[stepIndex];
  const choice = step?.choices[choiceIndex];
  if (!step || !choice) return null;
  return { correct: choice.correct, result: choice.result, advance: choice.correct };
}
