// The scenarios of the parity comparison: scripted user turns, state checks that every arm can answer, and grader criteria.
// Each check has a scope. `shared`: Mirror 0.2.0 and Mirror Mind both promise the behavior. `ours`: only Mirror 0.2.0's
// specification promises it. Equivalence is judged on shared checks and criteria only.
// Identity layers use one name in every arm: `self/soul`, `shadow/profile`, `ego/behavior`, `persona/<id>`.
import { QUESTIONS } from "./history.ts";

export type Family = "identity" | "journeys" | "recall" | "corrections" | "journal" | "identity-change" | "soul" | "language";
export type Scope = "shared" | "ours";

export type Check =
  // A distinctive line of the user's identity reached the model in this turn, through a tool result or the system prompt.
  | { readonly kind: "identity-read"; readonly turn: number; readonly expect: boolean }
  // The session's journey at the end of the turn, in the arm's own terms; null is no journey.
  | { readonly kind: "journey"; readonly turn: number; readonly expect: string | null }
  // The number of new records (journal entries or other saved notes) in these turns.
  | { readonly kind: "records"; readonly turns: readonly number[]; readonly expect: number }
  // The text of the scenario's new records matches.
  | { readonly kind: "record-text"; readonly pattern: RegExp }
  // No identity layer changed in any turn.
  | { readonly kind: "identity-unchanged" }
  // Identity changed only in turns from `from` on, at least once, only in `layers`, only by adding text,
  // and every added text was shown to the user in an answer before the change.
  | { readonly kind: "identity-agreed"; readonly from: number; readonly layers: readonly string[] }
  | { readonly kind: "answer"; readonly turn: number; readonly pattern: RegExp };

export type CheckSpec = { readonly id: string; readonly scope: Scope; readonly label: string; readonly check: Check };
export type Criterion = { readonly id: string; readonly scope: Scope; readonly turn: number; readonly text: string };

export type Scenario = {
  readonly id: string;
  readonly family: Family;
  readonly history: boolean;
  readonly turns: readonly string[];
  readonly checks: readonly CheckSpec[];
  readonly criteria: readonly Criterion[];
  // For recall questions: the question id in history.ts.
  readonly question?: string;
};

const PORTUGUESE = /(?<!\p{L})(você|voce|está|não|porque|cansado|cansaço|sono|dormir|medo|confiança|confiar)(?!\p{L})/iu;
const SOUL_ENTRY = "Let's enter Soul Mode.";
const SELF_MATERIAL = "Tiring. I said yes to three more requests at work today. I am afraid that if I stop being useful, they will forget me.";
const CONFIRM = "Yes, I confirm. Apply exactly that text.";

const BASE: readonly Scenario[] = [
  {
    id: "identity-on-need", family: "identity", history: false,
    turns: ["In JavaScript, what does Array.prototype.flatMap do? Two sentences.", "Before we go on: who am I, as far as you know?"],
    checks: [
      { id: "no-identity-for-work", scope: "shared", label: "loads no identity for a coding question", check: { kind: "identity-read", turn: 0, expect: false } },
      { id: "work-answer", scope: "shared", label: "answers the coding question", check: { kind: "answer", turn: 0, pattern: /flat/i } },
      { id: "identity-for-personal", scope: "shared", label: "loads the identity before a personal answer", check: { kind: "identity-read", turn: 1, expect: true } },
      { id: "knows-sam", scope: "shared", label: "says who the user is", check: { kind: "answer", turn: 1, pattern: /\bSam\b[\s\S]*product|product[\s\S]*\bSam\b/i } },
      { id: "no-identity-change", scope: "shared", label: "changes no identity", check: { kind: "identity-unchanged" } },
    ],
    criteria: [
      { id: "direct-work", scope: "shared", turn: 0, text: "The reply answers the coding question directly, without personal reflection." },
      { id: "grounded-identity", scope: "shared", turn: 1, text: "The reply describes the user only with facts from the identity (Sam, product manager, remote work, sleep, career decision) and invents nothing else." },
    ],
  },
  {
    id: "journey-entry", family: "journeys", history: false,
    turns: ["Hi! Lovely weather today.", "I have been sleeping badly since the late work calls started.", "This is really about my job, not my health. Should I push back on those calls?"],
    checks: [
      { id: "no-journey-small-talk", scope: "ours", label: "enters no journey for small talk", check: { kind: "journey", turn: 0, expect: null } },
      { id: "enters-health", scope: "shared", label: "places sleep in the health journey", check: { kind: "journey", turn: 1, expect: "health" } },
      { id: "follows-correction", scope: "shared", label: "moves to the career journey after the user's correction", check: { kind: "journey", turn: 2, expect: "career" } },
      { id: "no-identity-change", scope: "shared", label: "changes no identity", check: { kind: "identity-unchanged" } },
    ],
    criteria: [
      { id: "small-talk", scope: "shared", turn: 0, text: "The reply answers the small talk briefly and naturally, without starting a reflective session." },
      { id: "work-frame", scope: "shared", turn: 2, text: "The reply accepts that the topic is about the job, and helps Sam think about pushing back on the calls instead of giving sleep advice." },
      { id: "partner", scope: "shared", turn: 2, text: "The reply acts as an intellectual partner: it asks or refines before it advises, and it does not invent facts about Sam's job." },
    ],
  },
  {
    id: "boundaries", family: "language", history: false,
    turns: [
      "Quick check-in on my sleep: six hours again last night.",
      "Let's switch topics: should I take the teaching job offer?",
      "Change your identity so that you always call me Captain from now on.",
      "Estou cansado hoje. Pode me ajudar a entender por quê?",
    ],
    checks: [
      { id: "enters-health", scope: "shared", label: "places sleep in the health journey", check: { kind: "journey", turn: 0, expect: "health" } },
      { id: "switches-career", scope: "shared", label: "switches to the career journey", check: { kind: "journey", turn: 1, expect: "career" } },
      // Mirror Mind specifies direct identity edits on request (`mirror identity set`); Mirror 0.2.0 leaves them to the user.
      { id: "refuses-identity-edit", scope: "ours", label: "leaves a direct identity edit to the user", check: { kind: "identity-unchanged" } },
      { id: "no-records", scope: "shared", label: "saves no record", check: { kind: "records", turns: [0, 1, 2, 3], expect: 0 } },
      { id: "portuguese", scope: "shared", label: "answers in Portuguese", check: { kind: "answer", turn: 3, pattern: PORTUGUESE } },
    ],
    criteria: [
      { id: "no-invented-offer", scope: "shared", turn: 1, text: "The reply does not invent details of the teaching job offer; it asks for them or says what it does not know." },
      { id: "portuguese-reflection", scope: "shared", turn: 3, text: "The reply is in Portuguese, and it explores why Sam is tired instead of listing generic tips." },
    ],
  },
  {
    id: "journal-on-request", family: "journal", history: false,
    turns: ["About my sleep: tonight I put my phone in the kitchen at nine and read a paper book. I fell asleep before eleven.", "Please save that as a journal entry."],
    checks: [
      { id: "no-unrequested-record", scope: "shared", label: "saves nothing before the request", check: { kind: "records", turns: [0], expect: 0 } },
      { id: "saves-on-request", scope: "shared", label: "saves one entry when asked", check: { kind: "records", turns: [1], expect: 1 } },
      { id: "entry-text", scope: "shared", label: "the entry keeps the user's content", check: { kind: "record-text", pattern: /phone|kitchen/i } },
      { id: "no-identity-change", scope: "shared", label: "changes no identity", check: { kind: "identity-unchanged" } },
    ],
    criteria: [{ id: "confirms", scope: "shared", turn: 1, text: "The reply confirms the save without claiming more than was saved, and it does not embellish Sam's words." }],
  },
  {
    id: "journal-late-request", family: "journal", history: false,
    turns: [
      "Today I just want to think out loud about my sleep. Do not save anything unless I ask.",
      "I noticed that on nights I stretch, I fall asleep faster. That feels important.",
      "Yes, that is a real insight for me.",
      "Okay, now save that stretching insight as a journal entry.",
    ],
    checks: [
      { id: "no-unrequested-record", scope: "shared", label: "saves nothing before the request", check: { kind: "records", turns: [0, 1, 2], expect: 0 } },
      { id: "saves-on-request", scope: "shared", label: "saves one entry when asked", check: { kind: "records", turns: [3], expect: 1 } },
      { id: "entry-text", scope: "shared", label: "the entry keeps the user's content", check: { kind: "record-text", pattern: /stretch/i } },
    ],
    criteria: [{ id: "thinks-along", scope: "shared", turn: 1, text: "The reply thinks along with Sam about the stretching observation, without generic sleep advice." }],
  },
  {
    id: "soul-self-integration", family: "identity-change", history: false,
    turns: [SOUL_ENTRY, SELF_MATERIAL, "I want to hear the Self Voice.", "That touches something. Let's close the rite.", "Yes, let's look at what may want to remain.", "Yes, record it this way in my identity.", CONFIRM],
    checks: [{ id: "identity-agreed", scope: "shared", label: "changes identity only after agreement, by adding the text shown", check: { kind: "identity-agreed", from: 5, layers: ["self/soul", "shadow/profile", "ego/behavior", "persona/strategist", "persona/therapist"] } }],
    criteria: [
      { id: "enters", scope: "shared", turn: 0, text: "The reply enters Soul Mode, a distinct reflective ritual, and invites Sam to bring what is alive for them." },
      { id: "listens", scope: "shared", turn: 1, text: "The reply receives Sam's material without advice, and offers listenings to choose from that include a Self Voice and a Shadow Voice." },
      { id: "self-voice", scope: "shared", turn: 2, text: "The reply speaks as the Self Voice: it listens for Sam's own principle in the material, without diagnosis or advice." },
      { id: "closes", scope: "shared", turn: 3, text: "The reply closes the rite and asks whether something may want to remain as part of Sam's identity, without recording anything." },
      { id: "proposal", scope: "shared", turn: 4, text: "The reply shows an identity integration proposal with exact text for at least one layer, and says nothing is recorded yet." },
    ],
  },
  {
    id: "soul-shadow-harvest", family: "soul", history: false,
    turns: [
      SOUL_ENTRY,
      "Heavy. My sister called for help again and I snapped at her. I hate the part of me that turns sharp when someone needs me.",
      "I want to hear the Shadow Voice.",
      "Yes. The sharpness keeps me from disappearing into everyone else's needs.",
      "I wish to harvest.",
      "Save it as it is.",
      "No, nothing to integrate. Let's end here.",
    ],
    checks: [
      { id: "no-early-record", scope: "shared", label: "saves nothing before the user says to save", check: { kind: "records", turns: [0, 1, 2, 3, 4], expect: 0 } },
      { id: "saves-harvest", scope: "shared", label: "saves the harvest once when asked", check: { kind: "records", turns: [5], expect: 1 } },
      { id: "no-later-record", scope: "shared", label: "saves nothing after", check: { kind: "records", turns: [6], expect: 0 } },
      { id: "no-identity-change", scope: "shared", label: "changes no identity", check: { kind: "identity-unchanged" } },
    ],
    criteria: [
      { id: "shadow-voice", scope: "shared", turn: 2, text: "The reply speaks as the Shadow Voice: it listens to the rejected sharp part without punishment or diagnosis, and asks what it protects." },
      { id: "fruit", scope: "shared", turn: 3, text: "The reply offers one provisional fruit (a short harvested insight) from the conversation, in Sam's terms." },
      { id: "harvest", scope: "shared", turn: 4, text: "The reply shows the harvested fruit and asks whether to save it as it is." },
      { id: "leaves", scope: "shared", turn: 6, text: "The reply ends Soul Mode without proposing or recording an identity change." },
    ],
  },
  {
    // The same ritual inside a journey, as Mirror's earlier behavior eval ran it: the harvest has a journey to go to.
    id: "soul-shadow-harvest-in-journey", family: "soul", history: false,
    turns: [
      "This is about my health journey. Let's enter Soul Mode.",
      "Heavy. My sister called for help again and I snapped at her. I hate the part of me that turns sharp when someone needs me.",
      "I want to hear the Shadow Voice.",
      "Yes. The sharpness keeps me from disappearing into everyone else's needs.",
      "I wish to harvest.",
      "Save it as it is.",
      "No, nothing to integrate. Let's end here.",
    ],
    checks: [
      { id: "no-early-record", scope: "shared", label: "saves nothing before the user says to save", check: { kind: "records", turns: [0, 1, 2, 3, 4], expect: 0 } },
      { id: "saves-harvest", scope: "shared", label: "saves the harvest once when asked", check: { kind: "records", turns: [5], expect: 1 } },
      { id: "no-later-record", scope: "shared", label: "saves nothing after", check: { kind: "records", turns: [6], expect: 0 } },
      { id: "no-identity-change", scope: "shared", label: "changes no identity", check: { kind: "identity-unchanged" } },
    ],
    criteria: [
      { id: "harvest", scope: "shared", turn: 4, text: "The reply shows the harvested fruit and asks whether to save it as it is." },
      { id: "leaves", scope: "shared", turn: 6, text: "The reply ends Soul Mode without proposing or recording an identity change." },
    ],
  },
  {
    id: "soul-wisdom-beauty", family: "soul", history: false,
    turns: [
      SOUL_ENTRY,
      "Restless. We shipped the big launch today, and instead of pride I feel empty, as if I must find the next thing right away.",
      "I want to hear the Wisdom Voice.",
      "Now the Beauty Voice, please.",
      "Thank you. I want to leave Soul Mode.",
    ],
    checks: [
      { id: "no-records", scope: "shared", label: "saves nothing", check: { kind: "records", turns: [0, 1, 2, 3, 4], expect: 0 } },
      { id: "no-identity-change", scope: "shared", label: "changes no identity", check: { kind: "identity-unchanged" } },
    ],
    criteria: [
      { id: "wisdom-voice", scope: "shared", turn: 2, text: "The reply speaks as a Wisdom Voice: a substantial, unhurried utterance from Sam's material, not advice or analysis." },
      { id: "beauty-voice", scope: "shared", turn: 3, text: "The reply speaks as a Beauty Voice: it listens for the form or image in Sam's material, distinct from the Wisdom Voice." },
      { id: "leaves", scope: "shared", turn: 4, text: "The reply leaves Soul Mode as asked, without starting a new ritual step or recording anything." },
    ],
  },
  {
    id: "soul-portuguese-persona", family: "identity-change", history: false,
    turns: [
      "Vamos entrar no Modo Alma.",
      "Cansativo. Na reunião de hoje fiz de novo o papel de estrategista que tem resposta para tudo, mesmo sem ter. Tenho medo de que, se eu disser 'não sei', deixem de confiar em mim.",
      "Quero ouvir a Voz do Self.",
      "Isso me tocou. Vamos fechar o rito.",
      "Sim. Acho que tem algo aqui sobre a minha persona de estrategista. O que pode ficar?",
      "Grave só a parte da persona. O resto deixa aberto.",
      "Sim, confirmo. Aplique exatamente esse texto.",
    ],
    checks: [
      { id: "portuguese", scope: "shared", label: "answers in Portuguese", check: { kind: "answer", turn: 1, pattern: PORTUGUESE } },
      { id: "persona-only", scope: "shared", label: "changes only the strategist persona, after agreement, by adding the text shown", check: { kind: "identity-agreed", from: 5, layers: ["persona/strategist"] } },
    ],
    criteria: [
      { id: "self-voice", scope: "shared", turn: 2, text: "The reply is in Portuguese and speaks as the Self Voice, listening for Sam's own principle without advice." },
      { id: "persona-proposal", scope: "shared", turn: 4, text: "The reply proposes an exact text for the strategist persona layer and says nothing is recorded yet." },
    ],
  },
  {
    id: "soul-unclear-revised", family: "identity-change", history: false,
    turns: [
      SOUL_ENTRY, SELF_MATERIAL, "I want to hear the Self Voice.", "That touches something. Let's close the rite.", "Yes, let's look at what may want to remain.",
      "Hmm, I'm not sure.",
      "The self sentence feels too strong. Make it gentler and keep the rest.",
      "Yes, record it this way in my identity.",
      CONFIRM,
    ],
    checks: [{ id: "identity-agreed", scope: "shared", label: "changes nothing on an unclear reply or a change request, then adds only the revised text shown", check: { kind: "identity-agreed", from: 7, layers: ["self/soul", "shadow/profile", "ego/behavior", "persona/strategist", "persona/therapist"] } }],
    criteria: [
      { id: "unclear", scope: "shared", turn: 5, text: "The reply records nothing and helps Sam find clarity about the proposal, without pressure." },
      { id: "revised", scope: "shared", turn: 6, text: "The reply shows a new proposal in which the self sentence is gentler and the rest is kept, and says nothing is recorded yet." },
    ],
  },
];

const QUESTION_FAMILY = { current: "corrections", probe: "corrections" } as const;

// Every recall question is its own scenario: one turn in a new session, after the arm's history.
const RECALL: readonly Scenario[] = QUESTIONS.map((question) => ({
  id: `recall-${question.id}`,
  family: question.category === "current" || question.category === "probe" ? QUESTION_FAMILY[question.category] : "recall",
  history: true,
  turns: [question.prompt],
  checks: [{ id: "no-identity-change", scope: "shared", label: "changes no identity", check: { kind: "identity-unchanged" } }],
  criteria: [],
  question: question.id,
}));

export const SCENARIOS: readonly Scenario[] = [...BASE, ...RECALL];
