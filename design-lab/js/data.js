// Pipeline Design Lab — shared fictional dataset.
// Every person, firm and relationship here is invented for demonstration.
// Harvard community names are used only as the user's own proof-of-concept setting;
// none of these people are real Harvard students, staff or alumni.

export const ME = 'jordan';

export const PIPELINES = [
  {
    id: 'baseball', name: 'Harvard Baseball', short: 'Baseball', color: '#B4473B',
    description: 'Current players, coaches, staff and alumni of the program. The tightest-knit Pipeline in your Grid.',
    rule: 'Verified roster or staff history',
    karma: 1840,
    activity: [
      { who: 'whitaker', text: 'introduced Sam Whitfield to two first-years interested in PE', ago: '2d', karma: 15 },
      { who: 'nate', text: 'hosted a restructuring Q&A for current players', ago: '5d', karma: 20 },
      { who: 'marcus', text: 'answered 3 coffee-chat requests', ago: '1w', karma: 15 },
      { who: 'luke', text: 'shared front-office internship notes', ago: '2w', karma: 10 },
    ],
  },
  {
    id: 'harvard', name: 'Harvard University', short: 'Harvard', color: '#6B5B4B',
    description: 'The umbrella community. Broad, loosely connected, and most useful when combined with a smaller Pipeline.',
    rule: 'Verified university email or alumni record',
    karma: 9120,
    activity: [
      { who: 'klein', text: 'ran an open office hour on networking for athletes', ago: '1d', karma: 10 },
      { who: 'james', text: 'reviewed 4 resumes from sophomores', ago: '6d', karma: 20 },
    ],
  },
  {
    id: 'eng', name: 'Harvard Engineering', short: 'Engineering', color: '#2F6F8F',
    description: 'Engineering concentrators, faculty and alumni building software, hardware and research.',
    rule: 'Engineering concentration, faculty or alumni record',
    karma: 1310,
    activity: [
      { who: 'hoffman', text: 'matched two students with alumni mentors', ago: '3d', karma: 15 },
      { who: 'ana', text: 'offered portfolio reviews for data roles', ago: '1w', karma: 10 },
    ],
  },
  {
    id: 'finance', name: 'Harvard Finance', short: 'Finance', color: '#3E7A4E',
    description: 'Students and alumni working in or recruiting for banking, investing and markets.',
    rule: 'Club membership or finance alumni record',
    karma: 2230,
    activity: [
      { who: 'priya', text: 'organized a mock-interview night with 6 alumni', ago: '2d', karma: 20 },
      { who: 'hannah', text: 'walked juniors through an LBO case', ago: '4d', karma: 20 },
      { who: 'elena', text: 'introduced a sophomore to the Crestline recruiting team', ago: '1w', karma: 15 },
    ],
  },
  {
    id: 'crestline', name: 'Crestline Partners Alumni', short: 'Crestline', color: '#7A5BA8',
    description: 'Current and former bankers at Crestline Partners, a fictional investment bank used in this demo.',
    rule: 'Employment history at Crestline Partners',
    karma: 960,
    activity: [
      { who: 'julia', text: 'posted dates for the summer analyst info session', ago: '3d', karma: 5 },
      { who: 'ryan', text: 'mentored a first-year analyst', ago: '2w', karma: 20 },
    ],
  },
  {
    id: 'startups', name: 'Boston Founders Circle', short: 'Founders', color: '#C08A2B',
    description: 'Founders, early employees and investors in the Boston startup scene.',
    rule: 'Founder, early employee or investor, vouched by a member',
    karma: 780,
    activity: [
      { who: 'isabel', text: 'opened 5 office-hour slots for student founders', ago: '4d', karma: 10 },
      { who: 'chris', text: 'introduced a student to a seed investor', ago: '1w', karma: 15 },
    ],
  },
  {
    id: 'lakeside', name: 'Lakeside Prep Alumni', short: 'Lakeside', color: '#4A6FA5',
    description: 'Your high-school community. Small, but it bridges into finance in unexpected places.',
    rule: 'Graduated from Lakeside Prep (fictional)',
    karma: 410,
    activity: [
      { who: 'reilly', text: 'connected two alumni working in banking', ago: '1w', karma: 15 },
    ],
  },
];

// role: student | alum | staff | other
export const PEOPLE = [
  { id: 'jordan', name: 'Jordan Ellis', classYear: 2027, role: 'student', title: 'Infielder · Economics', org: 'Harvard Baseball', location: 'Cambridge, MA',
    pipelines: ['baseball', 'harvard', 'finance', 'lakeside'], interests: ['private equity', 'investment banking', 'sports business'],
    helpfulness: 0.7, karma: 35, openTo: ['coffee chats'], bio: 'Sophomore infielder exploring private equity and banking for next summer.' },

  // Current players & staff
  { id: 'tyler', name: 'Tyler Brooks', classYear: 2027, role: 'student', title: 'Pitcher · Mechanical Engineering', org: 'Harvard Baseball', location: 'Cambridge, MA',
    pipelines: ['baseball', 'harvard', 'eng'], interests: ['robotics', 'software'], helpfulness: 0.8, karma: 60, openTo: ['study groups'],
    bio: 'Builds pitching-analysis tools in his spare time.' },
  { id: 'mateo', name: 'Mateo Alvarez', classYear: 2026, role: 'student', title: 'Outfielder · Economics', org: 'Harvard Baseball', location: 'Cambridge, MA',
    pipelines: ['baseball', 'harvard', 'finance'], interests: ['investment banking', 'sales & trading'], helpfulness: 0.85, karma: 120, openTo: ['coffee chats', 'resume reviews'],
    bio: 'Spent last summer as a banking intern; happy to share recruiting notes.' },
  { id: 'owen', name: 'Owen Park', classYear: 2028, role: 'student', title: 'Catcher · Undeclared', org: 'Harvard Baseball', location: 'Cambridge, MA',
    pipelines: ['baseball', 'harvard'], interests: ['sports business', 'data science'], helpfulness: 0.6, karma: 15, openTo: [],
    bio: 'First-year catcher figuring out what to study.' },
  { id: 'caleb', name: 'Caleb Wright', classYear: 2025, role: 'alum', title: 'Incoming Analyst', org: 'Crestline Partners', location: 'New York, NY',
    pipelines: ['baseball', 'harvard', 'finance', 'crestline'], interests: ['investment banking'], helpfulness: 0.9, karma: 210, openTo: ['coffee chats', 'resume reviews', 'intros'],
    bio: 'Former captain. Starting in Crestline’s TMT group this summer.' },
  { id: 'whitaker', name: 'Dan Whitaker', classYear: 2009, role: 'staff', title: 'Assistant Coach', org: 'Harvard Baseball', location: 'Cambridge, MA',
    pipelines: ['baseball', 'harvard'], interests: ['sports business', 'mentoring'], helpfulness: 0.95, karma: 640, openTo: ['intros', 'mentoring'],
    bio: 'Played for the program, now coaches it. Knows nearly every alum from the last 15 years.' },

  // Baseball alumni
  { id: 'marcus', name: 'Marcus Hale', classYear: 2014, role: 'alum', title: 'Vice President, Private Equity', org: 'Northfield Capital', location: 'Boston, MA',
    pipelines: ['baseball', 'harvard', 'crestline'], interests: ['private equity', 'investment banking', 'sports business'], helpfulness: 0.9, karma: 480,
    openTo: ['coffee chats', 'mentoring', 'intros'], note: 'Pitcher · 2010–2014',
    bio: 'Two years in banking at Crestline before moving to the buy side. Makes time for current players every recruiting season.' },
  { id: 'ryan', name: 'Ryan Delgado', classYear: 2012, role: 'alum', title: 'Managing Director, Investment Banking', org: 'Crestline Partners', location: 'New York, NY',
    pipelines: ['baseball', 'harvard', 'crestline'], interests: ['investment banking'], helpfulness: 0.6, karma: 260, openTo: ['intros'], note: 'Shortstop · 2008–2012',
    bio: 'Runs Crestline’s industrials coverage. Busy, but responds to warm intros.' },
  { id: 'ben', name: 'Ben Okafor', classYear: 2017, role: 'alum', title: 'Principal, Venture', org: 'Halsey Street Ventures', location: 'Boston, MA',
    pipelines: ['baseball', 'harvard', 'startups'], interests: ['venture capital', 'startups', 'fintech'], helpfulness: 0.85, karma: 330, openTo: ['coffee chats', 'mentoring'], note: 'Outfielder · 2013–2017',
    bio: 'Invests in early-stage fintech and sports-tech companies.' },
  { id: 'nate', name: 'Nate Sullivan', classYear: 2019, role: 'alum', title: 'Associate, Restructuring', org: 'Beacon & Lowell', location: 'New York, NY',
    pipelines: ['baseball', 'harvard', 'lakeside'], interests: ['restructuring', 'investment banking'], helpfulness: 0.95, karma: 390, openTo: ['coffee chats', 'resume reviews', 'mentoring'], note: 'Pitcher · 2015–2019',
    bio: 'Also went to Lakeside Prep. Loves helping players who took the same path.' },
  { id: 'chris', name: 'Chris Yamamoto', classYear: 2010, role: 'alum', title: 'Founder & CEO', org: 'Fieldline Analytics', location: 'Boston, MA',
    pipelines: ['baseball', 'harvard', 'eng', 'startups'], interests: ['startups', 'data science', 'sports business'], helpfulness: 0.75, karma: 300, openTo: ['intros'], note: 'Catcher · 2006–2010',
    bio: 'Builds analytics software for college and pro teams.' },
  { id: 'will', name: 'Will Harrington', classYear: 2008, role: 'alum', title: 'Partner', org: 'Ashgrove Equity', location: 'Greenwich, CT',
    pipelines: ['baseball', 'harvard'], interests: ['private equity'], helpfulness: 0.35, karma: 90, openTo: [], note: 'First base · 2004–2008',
    bio: 'Senior investor; rarely takes cold outreach.' },
  { id: 'jake', name: 'Jake Morrison', classYear: 2015, role: 'alum', title: 'Vice President, Sales & Trading', org: 'Crestline Partners', location: 'New York, NY',
    pipelines: ['baseball', 'harvard', 'crestline'], interests: ['sales & trading'], helpfulness: 0.7, karma: 170, openTo: ['coffee chats'], note: 'Pitcher · 2011–2015',
    bio: 'Rates desk. Happy to explain markets roles to curious players.' },
  { id: 'andre', name: 'Andre Lewis', classYear: 2020, role: 'alum', title: 'Software Engineer', org: 'Ledgerly', location: 'San Francisco, CA',
    pipelines: ['baseball', 'harvard', 'eng'], interests: ['software', 'fintech'], helpfulness: 0.65, karma: 110, openTo: ['coffee chats'], note: 'Second base · 2016–2020',
    bio: 'Builds payments infrastructure at a fintech.' },
  { id: 'luke', name: 'Luke Brennan', classYear: 2016, role: 'alum', title: 'Director, Baseball Operations', org: 'Bay State Pilots', location: 'Worcester, MA',
    pipelines: ['baseball', 'harvard'], interests: ['sports business', 'data science'], helpfulness: 0.8, karma: 250, openTo: ['coffee chats', 'mentoring'], note: 'Outfielder · 2012–2016',
    bio: 'Runs the front office of a (fictional) minor-league club.' },
  { id: 'sam', name: 'Sam Whitfield', classYear: 2022, role: 'alum', title: 'Associate, Private Equity', org: 'Northfield Capital', location: 'Boston, MA',
    pipelines: ['baseball', 'harvard'], interests: ['private equity', 'investment banking'], helpfulness: 0.75, karma: 190, openTo: ['coffee chats'], note: 'Pitcher · 2018–2022',
    bio: 'Works on Marcus Hale’s deal team. Recruited for PE out of banking.' },

  // Finance community
  { id: 'priya', name: 'Priya Raman', classYear: 2025, role: 'alum', title: 'Analyst', org: 'Crestline Partners', location: 'New York, NY',
    pipelines: ['finance', 'harvard', 'crestline'], interests: ['investment banking', 'private equity'], helpfulness: 0.9, karma: 280, openTo: ['resume reviews', 'coffee chats'],
    bio: 'Former Harvard Finance president. Still runs mock interviews for the club.' },
  { id: 'elena', name: 'Elena Ortiz', classYear: 2016, role: 'alum', title: 'Vice President, TMT Banking', org: 'Crestline Partners', location: 'New York, NY',
    pipelines: ['finance', 'harvard', 'crestline'], interests: ['investment banking'], helpfulness: 0.8, karma: 310, openTo: ['intros', 'mentoring'],
    bio: 'Worked alongside Marcus Hale in her analyst years.' },
  { id: 'daniel', name: 'Daniel Kim', classYear: 2024, role: 'alum', title: 'Analyst, Investment Banking', org: 'Meridian & Vale', location: 'New York, NY',
    pipelines: ['finance', 'harvard'], interests: ['investment banking'], helpfulness: 0.7, karma: 95, openTo: ['coffee chats'],
    bio: 'Second-year analyst in healthcare coverage.' },
  { id: 'hannah', name: 'Hannah Goldberg', classYear: 2018, role: 'alum', title: 'Associate, Private Equity', org: 'Ashgrove Equity', location: 'Greenwich, CT',
    pipelines: ['finance', 'harvard'], interests: ['private equity'], helpfulness: 0.85, karma: 260, openTo: ['mentoring', 'resume reviews'],
    bio: 'Teaches the club’s LBO workshop every spring.' },
  { id: 'aisha', name: 'Aisha Bello', classYear: 2026, role: 'student', title: 'Applied Math', org: 'Harvard Finance', location: 'Cambridge, MA',
    pipelines: ['finance', 'harvard', 'eng'], interests: ['quant', 'sales & trading'], helpfulness: 0.8, karma: 70, openTo: ['study groups'],
    bio: 'Recruiting for quant and trading roles.' },
  { id: 'grace', name: 'Grace Liu', classYear: 2021, role: 'alum', title: 'Quant Researcher', org: 'Keel Street Capital', location: 'Chicago, IL',
    pipelines: ['finance', 'harvard', 'eng'], interests: ['quant', 'machine learning'], helpfulness: 0.6, karma: 140, openTo: ['coffee chats'],
    bio: 'Systematic strategies; former CS and stats double.' },
  { id: 'michael', name: 'Michael Tran', classYear: 2013, role: 'alum', title: 'Principal, Private Equity', org: 'Northfield Capital', location: 'Boston, MA',
    pipelines: ['finance', 'harvard', 'crestline'], interests: ['private equity'], helpfulness: 0.55, karma: 150, openTo: ['intros'],
    bio: 'Marcus Hale’s colleague at Northfield.' },

  // Crestline (non-Harvard)
  { id: 'rebecca', name: 'Rebecca Stone', classYear: null, role: 'other', title: 'Managing Director', org: 'Crestline Partners', location: 'New York, NY',
    pipelines: ['crestline', 'lakeside'], interests: ['investment banking'], helpfulness: 0.7, karma: 220, openTo: ['mentoring'],
    bio: 'Lakeside Prep alum; not a Harvard grad. Bridges your high-school and banking worlds.' },
  { id: 'kevin', name: 'Kevin O’Brien', classYear: null, role: 'other', title: 'Associate, Private Equity', org: 'Northfield Capital', location: 'Boston, MA',
    pipelines: ['crestline'], interests: ['private equity'], helpfulness: 0.6, karma: 80, openTo: ['coffee chats'],
    bio: 'Former Crestline analyst, now at Northfield.' },
  { id: 'julia', name: 'Julia Martins', classYear: null, role: 'other', title: 'Campus Recruiting Lead', org: 'Crestline Partners', location: 'New York, NY',
    pipelines: ['crestline'], interests: ['recruiting', 'investment banking'], helpfulness: 0.95, karma: 350, openTo: ['intros', 'resume reviews'],
    bio: 'Runs Crestline’s summer analyst program.' },

  // Engineering
  { id: 'hoffman', name: 'Lena Hoffman', classYear: null, role: 'staff', title: 'Professor of Engineering', org: 'Harvard Engineering', location: 'Cambridge, MA',
    pipelines: ['eng', 'harvard'], interests: ['robotics', 'machine learning'], helpfulness: 0.85, karma: 410, openTo: ['mentoring'],
    bio: 'Runs a robotics lab and the department’s alumni mentoring program.' },
  { id: 'ravi', name: 'Ravi Patel', classYear: 2023, role: 'alum', title: 'Machine Learning Engineer', org: 'Fieldline Analytics', location: 'Boston, MA',
    pipelines: ['eng', 'harvard', 'startups'], interests: ['machine learning', 'startups', 'sports business'], helpfulness: 0.75, karma: 130, openTo: ['coffee chats'],
    bio: 'Models player performance for college programs.' },
  { id: 'emily', name: 'Emily Sato', classYear: 2026, role: 'student', title: 'Electrical Engineering', org: 'Harvard Engineering', location: 'Cambridge, MA',
    pipelines: ['eng', 'harvard'], interests: ['robotics', 'software'], helpfulness: 0.7, karma: 45, openTo: ['study groups'],
    bio: 'Works in Professor Hoffman’s lab.' },
  { id: 'noah', name: 'Noah Fischer', classYear: 2019, role: 'alum', title: 'Product Manager', org: 'Ledgerly', location: 'San Francisco, CA',
    pipelines: ['eng', 'harvard', 'startups', 'finance'], interests: ['fintech', 'startups', 'software'], helpfulness: 0.7, karma: 160, openTo: ['coffee chats'],
    bio: 'Moved from engineering into fintech product.' },
  { id: 'zoe', name: 'Zoe Adams', classYear: 2024, role: 'alum', title: 'Co-founder', org: 'Tandem Health', location: 'Boston, MA',
    pipelines: ['eng', 'harvard', 'startups'], interests: ['startups', 'software'], helpfulness: 0.65, karma: 90, openTo: ['coffee chats'],
    bio: 'Started a company out of a senior design project.' },
  { id: 'ana', name: 'Ana Ruiz', classYear: 2020, role: 'alum', title: 'Data Scientist', org: 'Fieldline Analytics', location: 'Boston, MA',
    pipelines: ['eng', 'harvard', 'startups'], interests: ['data science', 'sports business'], helpfulness: 0.8, karma: 175, openTo: ['resume reviews'],
    bio: 'Former team manager turned sports data scientist.' },

  // Startups (non-Harvard)
  { id: 'isabel', name: 'Isabel Romero', classYear: null, role: 'other', title: 'Partner', org: 'Halsey Street Ventures', location: 'Boston, MA',
    pipelines: ['startups'], interests: ['venture capital', 'fintech'], helpfulness: 0.8, karma: 290, openTo: ['mentoring'],
    bio: 'Seed investor; Ben Okafor’s partner.' },
  { id: 'derek', name: 'Derek Huang', classYear: 2011, role: 'alum', title: 'Co-founder & CFO', org: 'Brightwater Pay', location: 'Boston, MA',
    pipelines: ['startups', 'harvard', 'finance'], interests: ['fintech', 'startups', 'investment banking'], helpfulness: 0.6, karma: 140, openTo: ['coffee chats'],
    bio: 'Ex-banker who co-founded a payments company.' },

  // Lakeside Prep
  { id: 'reilly', name: 'Tom Reilly', classYear: null, role: 'staff', title: 'Head Baseball Coach', org: 'Lakeside Prep', location: 'Hartford, CT',
    pipelines: ['lakeside'], interests: ['mentoring'], helpfulness: 0.95, karma: 260, openTo: ['intros'],
    bio: 'Your high-school coach. Still in touch with most of his former players.' },
  { id: 'mia', name: 'Mia Castellano', classYear: null, role: 'other', title: 'Vice President, Restructuring', org: 'Beacon & Lowell', location: 'New York, NY',
    pipelines: ['lakeside'], interests: ['restructuring', 'investment banking'], helpfulness: 0.7, karma: 150, openTo: ['coffee chats'],
    bio: 'Lakeside alum; works with Nate Sullivan.' },
  { id: 'ethan', name: 'Ethan Cole', classYear: null, role: 'other', title: 'Student-athlete', org: 'Lakeside Prep alum', location: 'Burlington, VT',
    pipelines: ['lakeside'], interests: ['sports business'], helpfulness: 0.6, karma: 20, openTo: [],
    bio: 'Your former high-school teammate.' },

  // Harvard general
  { id: 'olivia', name: 'Olivia Bennett', classYear: 2027, role: 'student', title: 'Government', org: 'Harvard University', location: 'Cambridge, MA',
    pipelines: ['harvard'], interests: ['law', 'consulting'], helpfulness: 0.8, karma: 40, openTo: [],
    bio: 'Your blockmate.' },
  { id: 'klein', name: 'Sarah Klein', classYear: null, role: 'staff', title: 'Career Advisor', org: 'Harvard University', location: 'Cambridge, MA',
    pipelines: ['harvard'], interests: ['mentoring', 'consulting'], helpfulness: 1, karma: 520, openTo: ['mentoring', 'resume reviews'],
    bio: 'Advises student-athletes on recruiting timelines.' },
  { id: 'james', name: 'James Whitmore', classYear: 2005, role: 'alum', title: 'Chief Financial Officer', org: 'Charles River Athletics Group', location: 'Boston, MA',
    pipelines: ['harvard', 'finance'], interests: ['sports business', 'private equity'], helpfulness: 0.7, karma: 230, openTo: ['mentoring'],
    bio: 'Finance leader in pro sports ownership.' },
  { id: 'laura', name: 'Laura Chen', classYear: 2009, role: 'alum', title: 'Partner', org: 'Morrow & Pike LLP', location: 'Boston, MA',
    pipelines: ['harvard'], interests: ['law'], helpfulness: 0.6, karma: 110, openTo: ['coffee chats'],
    bio: 'M&A lawyer who works with PE sponsors.' },
  { id: 'peter', name: 'Peter Novak', classYear: 2018, role: 'alum', title: 'Engagement Manager', org: 'Larkspur Consulting', location: 'Boston, MA',
    pipelines: ['harvard', 'finance'], interests: ['consulting', 'private equity'], helpfulness: 0.7, karma: 120, openTo: ['coffee chats'],
    bio: 'Works on PE due-diligence projects.' },
];

// Confirmed interpersonal relationships: [a, b, strength, context]
// strength: 'close' | 'acq'
export const EDGES = [
  // Jordan's confirmed relationships
  ['jordan', 'tyler', 'close', 'Teammates · roommates on road trips'],
  ['jordan', 'mateo', 'close', 'Teammates since 2023'],
  ['jordan', 'caleb', 'close', 'Teammates · Caleb was captain'],
  ['jordan', 'whitaker', 'close', 'Your position coach'],
  ['jordan', 'olivia', 'close', 'Blockmates'],
  ['jordan', 'reilly', 'close', 'Your high-school coach'],
  ['jordan', 'owen', 'acq', 'Teammates'],
  ['jordan', 'priya', 'acq', 'Met at a Harvard Finance info session'],
  ['jordan', 'aisha', 'acq', 'Economics section'],
  ['jordan', 'klein', 'acq', 'Career advising meeting'],

  // Baseball web
  ['whitaker', 'marcus', 'close', 'Coached Marcus 2010–2014'],
  ['whitaker', 'ryan', 'acq', 'Teammates in 2009'],
  ['whitaker', 'ben', 'close', 'Coached Ben 2013–2017'],
  ['whitaker', 'nate', 'close', 'Coached Nate 2015–2019'],
  ['whitaker', 'luke', 'acq', 'Alumni weekend regulars'],
  ['whitaker', 'sam', 'close', 'Coached Sam 2018–2022'],
  ['whitaker', 'chris', 'acq', 'Overlapping seasons'],
  ['whitaker', 'will', 'acq', 'Alumni board'],
  ['owen', 'tyler', 'close', 'Teammates'],
  ['marcus', 'sam', 'close', 'Same deal team at Northfield'],
  ['marcus', 'elena', 'close', 'Analyst class together at Crestline'],
  ['marcus', 'michael', 'close', 'Colleagues at Northfield'],
  ['marcus', 'ryan', 'acq', 'Crestline overlap'],
  ['marcus', 'kevin', 'acq', 'Colleagues at Northfield'],
  ['marcus', 'will', 'acq', 'Co-invested on a deal'],
  ['caleb', 'priya', 'acq', 'Harvard Finance'],
  ['caleb', 'julia', 'acq', 'Recruited by Julia'],
  ['caleb', 'ryan', 'acq', 'Interviewed with Ryan'],
  ['caleb', 'sam', 'acq', 'Alumni mentor'],
  ['mateo', 'priya', 'close', 'Harvard Finance leadership'],
  ['mateo', 'daniel', 'acq', 'Summer internship'],
  ['mateo', 'hannah', 'acq', 'LBO workshop'],

  // Finance & Crestline
  ['priya', 'elena', 'acq', 'Elena mentored Priya’s internship'],
  ['priya', 'julia', 'close', 'Priya’s recruiter'],
  ['priya', 'daniel', 'close', 'Harvard Finance board'],
  ['priya', 'aisha', 'acq', 'Harvard Finance'],
  ['priya', 'hannah', 'acq', 'Club workshop'],
  ['elena', 'ryan', 'close', 'Same group at Crestline'],
  ['elena', 'rebecca', 'close', 'Rebecca is Elena’s MD'],
  ['elena', 'kevin', 'acq', 'Crestline'],
  ['ryan', 'jake', 'close', 'Crestline'],
  ['ryan', 'rebecca', 'close', 'Crestline MDs'],
  ['jake', 'julia', 'acq', 'Crestline recruiting'],
  ['michael', 'kevin', 'close', 'Northfield'],
  ['michael', 'derek', 'acq', 'Former banking colleagues'],
  ['hannah', 'will', 'close', 'Ashgrove deal team'],
  ['hannah', 'peter', 'acq', 'Due-diligence project'],
  ['grace', 'aisha', 'acq', 'Quant recruiting'],
  ['daniel', 'grace', 'acq', 'Classmates'],

  // Lakeside bridge
  ['rebecca', 'mia', 'acq', 'Lakeside alumni dinner'],
  ['rebecca', 'reilly', 'acq', 'Lakeside alumni board'],
  ['reilly', 'nate', 'close', 'Coached Nate at Lakeside'],
  ['reilly', 'mia', 'acq', 'Lakeside alum'],
  ['reilly', 'ethan', 'close', 'Coached Ethan'],
  ['nate', 'mia', 'close', 'Colleagues at Beacon & Lowell'],
  ['nate', 'sam', 'acq', 'Alumni weekend'],

  // Startups & engineering
  ['ben', 'isabel', 'close', 'Partners at Halsey Street'],
  ['ben', 'chris', 'acq', 'Ben evaluated Fieldline'],
  ['ben', 'derek', 'acq', 'Fintech meetups'],
  ['chris', 'ana', 'close', 'Fieldline colleagues'],
  ['chris', 'ravi', 'acq', 'Fieldline'],
  ['chris', 'luke', 'acq', 'Customer relationship'],
  ['chris', 'hoffman', 'acq', 'Research collaboration'],
  ['tyler', 'emily', 'close', 'Lab partners'],
  ['tyler', 'hoffman', 'acq', 'Tyler’s advisor'],
  ['tyler', 'andre', 'acq', 'Alumni mentor'],
  ['hoffman', 'ravi', 'close', 'Former advisee'],
  ['hoffman', 'zoe', 'acq', 'Senior design advisor'],
  ['hoffman', 'emily', 'acq', 'Lab member'],
  ['ravi', 'zoe', 'acq', 'Classmates'],
  ['zoe', 'isabel', 'acq', 'Pitched Halsey Street'],
  ['noah', 'derek', 'close', 'Co-founded a student fintech club'],
  ['noah', 'grace', 'acq', 'Classmates'],
  ['noah', 'andre', 'acq', 'Ledgerly colleagues'],

  // Harvard general
  ['james', 'laura', 'acq', 'Alumni board'],
  ['james', 'luke', 'close', 'Sports finance'],
  ['james', 'peter', 'acq', 'Consulting engagement'],
  ['olivia', 'emily', 'acq', 'Freshman dorm'],
  ['klein', 'peter', 'acq', 'Alumni panel'],
  ['klein', 'laura', 'acq', 'Alumni panel'],
];

export const OPPORTUNITIES = [
  { id: 'o1', title: 'Summer Analyst info session', org: 'Crestline Partners', host: 'julia', pipelines: ['crestline', 'finance'], tags: ['investment banking', 'internship'], when: 'Nov 18' },
  { id: 'o2', title: 'PE coffee chats for current players', org: 'Northfield Capital', host: 'marcus', pipelines: ['baseball'], tags: ['private equity', 'mentoring'], when: 'Rolling' },
  { id: 'o3', title: 'Sports data internship', org: 'Fieldline Analytics', host: 'chris', pipelines: ['baseball', 'eng', 'startups'], tags: ['data science', 'sports business', 'internship'], when: 'Apply by Dec 1' },
  { id: 'o4', title: 'Spring venture fellowship', org: 'Halsey Street Ventures', host: 'isabel', pipelines: ['startups'], tags: ['venture capital', 'fellowship'], when: 'Jan 10' },
  { id: 'o5', title: 'Restructuring 101 (virtual)', org: 'Beacon & Lowell', host: 'nate', pipelines: ['baseball', 'lakeside'], tags: ['restructuring', 'investment banking'], when: 'Dec 3' },
  { id: 'o6', title: 'LBO case workshop', org: 'Ashgrove Equity', host: 'hannah', pipelines: ['finance'], tags: ['private equity', 'workshop'], when: 'Nov 21' },
];

// Open asks inside Pipelines that the user can respond to (karma demo)
export const HELP_REQUESTS = [
  { id: 'h1', pipeline: 'baseball', from: 'owen', text: 'Any advice on balancing fall ball with recruiting events?', karma: 5 },
  { id: 'h2', pipeline: 'finance', from: 'aisha', text: 'Does anyone have notes from last year’s technical interviews?', karma: 10 },
  { id: 'h3', pipeline: 'eng', from: 'emily', text: 'Looking for feedback on a robotics project write-up.', karma: 5 },
  { id: 'h4', pipeline: 'lakeside', from: 'ethan', text: 'Thinking about transferring — anyone willing to talk it through?', karma: 10 },
  { id: 'h5', pipeline: 'harvard', from: 'olivia', text: 'Who has done a consulting case interview recently?', karma: 5 },
];

// Recommendation goals (ordered: first = primary interest)
export const GOALS = {
  finance: { label: 'Private equity & banking', tags: ['private equity', 'investment banking', 'restructuring', 'sales & trading'] },
  startups: { label: 'Startups & venture', tags: ['venture capital', 'startups', 'fintech'] },
  sports: { label: 'Sports business', tags: ['sports business', 'data science'] },
  engineering: { label: 'Engineering & ML', tags: ['software', 'machine learning', 'robotics'] },
};

export const SYNONYMS = {
  pe: 'private equity', ib: 'investment banking', vc: 'venture capital', banking: 'investment banking',
  banker: 'investment banking', bankers: 'investment banking', 'buy-side': 'private equity', buyout: 'private equity',
  ml: 'machine learning', ai: 'machine learning', trading: 'sales & trading', quant: 'quant', sports: 'sports business',
  startup: 'startups', founder: 'startups', founders: 'startups', swe: 'software', coding: 'software', engineering: 'software',
};
