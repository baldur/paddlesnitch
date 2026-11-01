// The words the paddle summary must not use (voice.ts, summaryProblems). In
// their own file so copy-style.test.ts can skip this list and still check the
// voice card and its examples.
// Words and phrases that make it sound like a generic AI coach. Matched as
// whole words, case-insensitively.
export const BANNED_PHRASES = [
  'great job', 'great work', 'nice work', 'nice job', 'well done', 'good job', 'keep it up', 'keep up the',
  'impressive', 'impressively', 'amazing', 'awesome', 'fantastic', 'incredible', 'remarkable', 'exceptional',
  'excellent', 'outstanding', 'stellar', 'solid', 'rock-solid', 'journey', 'testament', 'showcase', 'showcasing',
  'showcased', 'kudos', 'poise', 'gem', 'jewel', 'second nature', 'muscle memory', 'next level', 'dial in',
  'dialled in', 'fade', 'fades', 'faded', 'fading', 'next time', 'crushed', 'crushing', 'smashed', 'nailed', 'you\'ve got this', 'foundation', 'truly', 'clearly',
  'it\'s clear', 'masterclass', 'standout', 'stand out', 'stands out', 'stood out',
  'commendable', 'noteworthy', 'particularly', 'significant', 'significantly', 'shone', 'dedication', 'determination',
  'endurance', 'stamina', 'resilience', 'progress', 'improvement', 'powerful', 'efficient', 'efficiency',
  'let\'s', 'keep pushing', 'push your', 'excited', 'i noticed', 'consider', 'focus on', 'focusing', 'session', 'sessions',
]

// Claims about how they paddled or felt, which the numbers can't show.
export const UNSUPPORTED_CLAIMS = [
  'blade', 'blades', 'catch', 'rotation', 'posture', 'technique', 'felt', 'feel', 'feeling', 'fatigue', 'tired',
  'tiring', 'effortless', 'relaxed', 'crisp', 'smooth', 'smoothly', 'clean', 'confident', 'confidence', 'focused',
  'determined', 'enjoyed', 'fun', 'despite', 'even with', 'even though', 'rhythm', 'glide', 'control', 'skill',
  'unchanged',
]


// Common US spellings the athlete profile must not use (profileProblems), with
// the British form to ask for instead. Short on purpose: the words a paddler's
// profile is likely to need. "meter" is British for an instrument (a power
// meter), but a profile won't mean that. No -ize forms: British English allows them.
export const US_SPELLINGS: Record<string, string> = {
  favor: 'favour', favors: 'favours', favored: 'favoured', favoring: 'favouring', favorite: 'favourite', favorites: 'favourites',
  color: 'colour', colors: 'colours', center: 'centre', centers: 'centres', centered: 'centred',
  meter: 'metre', meters: 'metres', kilometer: 'kilometre', kilometers: 'kilometres',
  behavior: 'behaviour', behaviors: 'behaviours', practicing: 'practising', gray: 'grey', colored: 'coloured',
  favorable: 'favourable', traveled: 'travelled', traveling: 'travelling', harbor: 'harbour', liter: 'litre',
}
