// A synthetic health journey for Sam: 24 sessions over twelve weeks, run once as real Pi sessions.
// Each session opens with its date, because all sessions are generated on one day.
// The history plants single facts, facts that change over time, four corrections, and three requests
// whose answers exist only in the mirror's replies.

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
];

export function firstPrompt(session: HistorySession, turn: string): string {
  return `(${session.date}) ${turn}`;
}
