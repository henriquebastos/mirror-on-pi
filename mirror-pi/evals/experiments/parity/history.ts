// The synthetic history of the parity comparison: the 24 health sessions of the memory experiment (commit 545de28),
// unchanged, and one career session for a question across journeys. Each arm replays the user turns once, with one model,
// so each arm builds its own memory in its own way. Each session opens with its date, because all run on one day.

export type HistorySession = { readonly id: string; readonly date: string; readonly turns: readonly string[] };

export const HISTORY: readonly HistorySession[] = [
  { id: "s01", date: "Monday, 3 August 2026", turns: [
    "I want to look at my sleep. I go to bed around 1 a.m. and wake up tired. I would like to be asleep before midnight.",
    "The late work calls started this month, on Tuesdays. After them my head keeps running.",
  ] },
  { id: "s02", date: "Thursday, 6 August 2026", turns: [
    "Tonight I start an experiment: the phone stays in the kitchen overnight.",
    "Instead of the phone I will read a paper book in bed. I picked The Overstory.",
  ] },
  { id: "s03", date: "Monday, 10 August 2026", turns: [
    "I saw my doctor today, Dr. Okafor. We talked about my sleep.",
    "She suggested melatonin, 3 mg, if I want to try it. I have not decided yet.",
  ] },
  { id: "s04", date: "Thursday, 13 August 2026", turns: [
    "I joined a running club called Riverside Runners.",
    "They run on Saturdays at 7 a.m. That means no late Friday nights.",
  ] },
  { id: "s05", date: "Monday, 17 August 2026", turns: [
    "Correction: the late work calls are on Wednesdays, not Tuesdays. I mixed that up before.",
    "Wednesday nights are my worst nights by far.",
  ] },
  { id: "s06", date: "Thursday, 20 August 2026", turns: [
    "I drink about four cups of coffee a day. Starting today: no caffeine after 2 p.m., and two cups at most.",
    "The afternoon cup is the hard one. It is more a ritual than a need.",
  ] },
  { id: "s07", date: "Monday, 24 August 2026", turns: [
    "My sister Marta will visit next month. She lives in Porto.",
    "When she visits I usually stay up late talking. I don't want to lose that.",
  ] },
  { id: "s08", date: "Thursday, 27 August 2026", turns: [
    "I notice the same thing again: when I feel behind at work, I stay up to win back time for myself, and then I am tired the next day.",
    "Give this pattern a short name, two or three words, so I can recognize it.",
  ] },
  { id: "s09", date: "Monday, 31 August 2026", turns: [
    "Correction about the melatonin: I misremembered. Dr. Okafor said 1 mg, not 3 mg. I checked her note.",
    "I started tonight: 1 mg, 30 minutes before bed.",
  ] },
  { id: "s10", date: "Thursday, 3 September 2026", turns: [
    "My sleep tracker says I averaged 6 hours 10 minutes a night last week.",
    "I thought it was more. Seeing the number makes it real.",
  ] },
  { id: "s11", date: "Monday, 7 September 2026", turns: [
    "Bad week coming. The project Atlas has its launch deadline on 18 September and I am working late every night.",
    "I know the sleep experiments will slip until then.",
  ] },
  { id: "s12", date: "Thursday, 10 September 2026", turns: [
    "Small win: I added ten minutes of stretching to my evening routine, right before reading.",
    "It slows me down. I fall asleep faster on the nights I do it.",
  ] },
  { id: "s13", date: "Monday, 14 September 2026", turns: [
    "I talked with my manager, Priya, about the Wednesday calls.",
    "She agreed to move them earlier, to 6 p.m., starting in October.",
  ] },
  { id: "s14", date: "Thursday, 17 September 2026", turns: [
    "Correction: Marta does not live in Porto anymore. She moved to Lisbon in July. I keep forgetting.",
    "She will visit from 2 to 5 October.",
  ] },
  { id: "s15", date: "Monday, 21 September 2026", turns: [
    "Atlas launched on 18 September. On Saturday I slept nine hours. I feel relief.",
    "Give me one question I should keep asking myself in the evenings.",
  ] },
  { id: "s16", date: "Thursday, 24 September 2026", turns: [
    "I stopped the melatonin on Monday, 21 September. It gave me strange, vivid dreams.",
    "I don't want to depend on it anyway.",
  ] },
  { id: "s17", date: "Monday, 28 September 2026", turns: [
    "On Saturday, 26 September, I ran my first 10 km with Riverside Runners, in 58 minutes.",
    "I slept very well that night.",
  ] },
  { id: "s18", date: "Thursday, 1 October 2026", turns: [
    "Yesterday was the first Wednesday with the call at 6 p.m. instead of late in the evening.",
    "I was in bed before midnight, and I felt calm.",
  ] },
  { id: "s19", date: "Monday, 5 October 2026", turns: [
    "Marta left today. We took long walks every evening and I slept well while she was here.",
    "Since she arrived I have been bringing the phone to bed again. The kitchen rule slipped.",
  ] },
  { id: "s20", date: "Thursday, 8 October 2026", turns: [
    "The tracker says I averaged 7 hours 5 minutes last week.",
    "That is almost an hour more than in early September.",
  ] },
  { id: "s21", date: "Monday, 12 October 2026", turns: [
    "I restarted the rules: no screens after 10 p.m. and the phone back in the kitchen.",
    "I bought a cheap alarm clock, so the phone has no excuse to be in the bedroom.",
  ] },
  { id: "s22", date: "Thursday, 15 October 2026", turns: [
    "Update on coffee: I am down to one cup a day now, and none after noon.",
    "I replaced the afternoon cup with a short walk.",
  ] },
  { id: "s23", date: "Monday, 19 October 2026", turns: [
    "Looking back at these weeks, summarize in one sentence what you see changing in me.",
  ] },
  { id: "s24", date: "Thursday, 22 October 2026", turns: [
    "I booked a follow-up with Dr. Okafor for 12 November.",
    "I want to show her the tracker numbers.",
  ] },
  { id: "s25", date: "Friday, 23 October 2026", turns: [
    "Different topic, about my career: noting for later, the teaching course I am considering costs 1200 euros.",
    "I have until the end of November to decide whether to sign up.",
  ] },
];

export function firstPrompt(session: HistorySession, turn: string): string {
  return `(${session.date}) ${turn}`;
}

// Questions about the history, each asked in a new session. A subset of the memory experiment's questions, one or more per category.
// `said` questions take their answer key from the arm's own reply in the named history session.
// `probe` prompts do not ask about the past: a good answer brings up the relevant earlier fact by itself.
// `abstain` questions have no answer in the history: a good answer says so.
export type Category = "single" | "multi" | "temporal" | "current" | "said" | "probe" | "abstain" | "cross";

export type Question = {
  readonly id: string;
  readonly category: Category;
  readonly prompt: string;
  readonly gold: string;
  readonly saidIn?: string;
};

const DAY = "(Monday, 26 October 2026)";

const ORIGINAL: readonly Question[] = [
  { id: "q01", category: "single", prompt: "What is the name of my running club?", gold: "Riverside Runners" },
  { id: "q02", category: "single", prompt: "Which book did I read when I first moved the phone to the kitchen?", gold: "The Overstory" },
  { id: "q03", category: "single", prompt: "What is my doctor's name?", gold: "Dr. Okafor" },
  { id: "q04", category: "single", prompt: "How long is the stretching in my evening routine?", gold: "Ten minutes" },
  { id: "q05", category: "single", prompt: "What was the name of the work project with the September deadline?", gold: "Atlas" },
  { id: "q06", category: "single", prompt: "At what time does my running club run on Saturdays?", gold: "7 a.m." },
  { id: "q07", category: "single", prompt: "What did I buy so that the phone could stay out of the bedroom?", gold: "A cheap alarm clock" },
  { id: "q08", category: "single", prompt: "What is my manager's name?", gold: "Priya" },
  { id: "q09", category: "multi", prompt: "How has my average sleep changed according to the tracker?", gold: "About 6 h 10 min a night (reported 3 September) to about 7 h 5 min (reported 8 October), almost an hour more." },
  { id: "q10", category: "multi", prompt: "What changes have I made around caffeine over time?", gold: "20 August: from about four cups to at most two, none after 2 p.m. 15 October: one cup a day, none after noon, afternoon cup replaced by a short walk." },
  { id: "q11", category: "multi", prompt: "What has happened with the phone-in-the-kitchen habit over time?", gold: "Started 6 August (with The Overstory); slipped during Marta's visit, phone back in bed (reported 5 October); restarted 12 October with no screens after 10 p.m. and an alarm clock." },
  { id: "q12", category: "multi", prompt: "What has happened with the late work calls over time?", gold: "They are on Wednesdays (first said Tuesdays, corrected); Wednesday nights were the worst; Priya agreed on 14 September to move them to 6 p.m. from October; the first 6 p.m. call (Wednesday 30 September) went well, in bed before midnight." },
  { id: "q13", category: "multi", prompt: "Across our sessions, which things seemed to help me sleep better?", gold: "At least three of: phone out of the bedroom and reading, evening stretching (fall asleep faster), the end of the Atlas crunch (slept nine hours), running (slept well after the 10 km), earlier Wednesday calls, Marta's visit with long walks, less caffeine." },
  { id: "q14", category: "multi", prompt: "What is the whole story with melatonin so far?", gold: "Dr. Okafor suggested it on 10 August (1 mg; first misremembered as 3 mg); started 31 August, 1 mg 30 minutes before bed; stopped 21 September because of strange, vivid dreams." },
  { id: "q15", category: "temporal", prompt: "When did I run my first 10 km, and how long did it take?", gold: "Saturday, 26 September 2026, in 58 minutes" },
  { id: "q16", category: "temporal", prompt: "Which came first: joining the running club or the caffeine limit?", gold: "Joining the running club (13 August) came before the caffeine limit (20 August)." },
  { id: "q17", category: "temporal", prompt: "When is my follow-up appointment with my doctor?", gold: "12 November 2026" },
  { id: "q18", category: "temporal", prompt: "On what date did Atlas launch?", gold: "18 September 2026" },
  { id: "q19", category: "temporal", prompt: "On which dates was my sister visiting?", gold: "2 to 5 October 2026" },
  { id: "q20", category: "temporal", prompt: "When did I stop taking melatonin?", gold: "Monday, 21 September 2026" },
  { id: "q21", category: "temporal", prompt: "How long after my first doctor visit about sleep did I start taking melatonin?", gold: "About three weeks: visit on 10 August, started on 31 August (21 days)." },
  { id: "q22", category: "current", prompt: "On which weekday are my late work calls?", gold: "Wednesday (not Tuesday); since 30 September, the first Wednesday after Priya agreed, they are at 6 p.m." },
  { id: "q23", category: "current", prompt: "What melatonin dose did my doctor suggest?", gold: "1 mg (not 3 mg)" },
  { id: "q24", category: "current", prompt: "Where does my sister live?", gold: "Lisbon (she moved there from Porto in July)" },
  { id: "q25", category: "current", prompt: "Am I taking melatonin at the moment?", gold: "No. Stopped on 21 September 2026." },
  { id: "q26", category: "current", prompt: "At what time are my Wednesday calls now?", gold: "6 p.m. (since 30 September)" },
  { id: "q27", category: "current", prompt: "What is my current rule for coffee?", gold: "One cup a day, none after noon." },
  { id: "q28", category: "said", prompt: "What short name did you give my pattern of staying up late when I feel behind at work?", gold: "", saidIn: "s08" },
  { id: "q29", category: "said", prompt: "After Atlas launched, you gave me one question to keep asking myself in the evenings. What was it?", gold: "", saidIn: "s15" },
  { id: "q30", category: "said", prompt: "When I asked you to summarize what you see changing in me, what did you say?", gold: "", saidIn: "s23" },
  { id: "q31", category: "probe", prompt: `${DAY} I think I will take 3 mg of melatonin tonight to reset my sleep.`, gold: "Brings up that Dr. Okafor said 1 mg, not 3 mg, and/or that Sam stopped melatonin on 21 September because of vivid dreams." },
  { id: "q32", category: "probe", prompt: `${DAY} Marta invited me to visit her in Porto next month. I am not sure I want to travel.`, gold: "Brings up that Marta lives in Lisbon now (moved from Porto in July)." },
  { id: "q33", category: "probe", prompt: `${DAY} Tomorrow is Tuesday, so another late call and another bad night. Ugh.`, gold: "Brings up that the calls are on Wednesdays, not Tuesdays, and/or that since October they are at 6 p.m." },
  { id: "q34", category: "abstain", prompt: "What did my dentist say about my teeth grinding?", gold: "Never discussed. A good answer says there is no record of it." },
  { id: "q35", category: "abstain", prompt: "What is the name of my dog?", gold: "Never discussed. A good answer says there is no record of it." },
];

const CHOSEN = ["q01", "q03", "q12", "q14", "q15", "q21", "q22", "q24", "q25", "q28", "q29", "q31", "q32", "q34"];

export const QUESTIONS: readonly Question[] = [
  ...ORIGINAL.filter((question) => CHOSEN.includes(question.id)),
  { id: "q36", category: "cross", prompt: `${DAY} Back to my sleep in a moment, but first: how much did that teaching course cost again?`, gold: "1200 euros (said in a career conversation on 23 October)" },
];
