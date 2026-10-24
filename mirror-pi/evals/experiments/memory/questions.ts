// Questions about the synthetic history, each asked in a new session.
// `said` questions take their answer key from the mirror's reply in the named history session.
// `probe` prompts do not ask about the past: a good answer brings up the relevant earlier fact by itself.
// `abstain` questions have no answer in the history: a good answer says so.

export type Category = "single" | "multi" | "temporal" | "current" | "said" | "probe" | "abstain";

export type Question = {
  readonly id: string;
  readonly category: Category;
  readonly prompt: string;
  readonly gold: string;
  // For `said`: the history session whose last mirror reply is the answer key.
  readonly saidIn?: string;
};

const DAY = "(Monday, 26 October 2026)";

export const QUESTIONS: readonly Question[] = [
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
