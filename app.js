const defaultItems = [
  { id: 'edu', label: 'Education', value: 'Harvard University · Computer Science, Class of 2027', state: 'pending' },
  { id: 'skills', label: 'Skills', value: 'Java, C, Python, React, SQL', state: 'pending' },
  { id: 'experience', label: 'Experience', value: 'Software Engineering Intern · Northstar Labs · Summer 2025', state: 'pending' }
];

const people = [
  { id: 'maya', name: 'Maya Chen', role: 'SWE @ Stripe', context: 'Harvard alum · 2nd degree', image: 'photo-1534528741775-53994a69daeb', color: 'f4d2bd' },
  { id: 'jordan', name: 'Jordan Ellis', role: 'Founder @ Common Thread', context: 'Builds in edtech · 1st degree', image: 'photo-1506794778202-cad84cf45f1d', color: 'cedfeb' },
  { id: 'alex', name: 'Alex Rivera', role: 'Product @ Figma', context: 'Shared interest in design', image: 'photo-1531123897727-8f129e1688ce', color: 'e8d7bc' },
  { id: 'sam', name: 'Sam Okafor', role: 'CS @ MIT', context: '3 mutual connections', image: 'photo-1507003211169-0a1dd7228f2d', color: 'ded4ef' }
];

const defaultOpportunities = [
  { id: 'job-stripe-intern', kind: 'job', title: 'Product engineering intern', organization: 'Stripe', location: 'San Francisco, CA · Hybrid', description: 'Join a product engineering team building reliable financial tools. Ideal for students who enjoy solving thoughtful technical problems with a close-knit team.', tags: ['Internship', 'Software engineering'], author: 'Pipeline picks', url: '', createdAt: '2026-10-02' },
  { id: 'group-harvard-builders', kind: 'group', title: 'Build weekend: looking for a frontend collaborator', organization: 'Harvard Product Builders', location: 'Cambridge, MA · In person', description: 'We’re putting together a small team to prototype a tool for student communities. Bring React experience, curiosity, and a few hours this weekend.', tags: ['Project', 'React'], author: 'Harvard Product Builders', url: '', createdAt: '2026-10-01' },
  { id: 'job-vercel-summer', kind: 'job', title: 'Software engineering intern, summer', organization: 'Vercel', location: 'Remote · United States', description: 'Help improve the tools developers use to build and ship for the web. Students interested in frontend infrastructure and developer experience are encouraged to apply.', tags: ['Internship', 'Developer tools'], author: 'Pipeline picks', url: '', createdAt: '2026-09-29' },
  { id: 'group-climate-volunteer', kind: 'group', title: 'Community climate data project', organization: 'Boston Student Climate Coalition', location: 'Boston, MA · Flexible', description: 'Help local groups turn public environmental data into clear, useful resources. We’re looking for contributors interested in data, design, and community outreach.', tags: ['Volunteer', 'Data'], author: 'Boston Student Climate Coalition', url: '', createdAt: '2026-09-27' }
];

const jobCategories = ['Internship', 'Full-Time', 'Part-Time', 'Research', 'Job'];

const opportunityEnrichment = {
  'job-stripe-intern': {
    category: 'Internship', arrangement: 'Hybrid', location: 'San Francisco, CA', industry: 'Fintech', nodeId: 'stripe',
    skills: ['Python', 'React', 'SQL', 'APIs'],
    about: 'Stripe builds financial infrastructure for the internet, helping businesses of every size accept payments and manage money online.',
    responsibilities: ['Ship product features alongside a team of engineers and designers.', 'Write and review production code with guidance from senior engineers.', 'Investigate user problems and turn them into thoughtful improvements.', 'Present your project to the wider team at the end of the internship.'],
    qualifications: ['Currently pursuing a degree in computer science or a related field.', 'Experience with Python, JavaScript, or a similar language.', 'Curiosity about how reliable systems and good product experiences fit together.']
  },
  'group-harvard-builders': {
    category: 'Project', arrangement: 'In person', location: 'Cambridge, MA', industry: 'Technology', nodeId: 'harvard',
    skills: ['React', 'JavaScript', 'UI design'],
    about: 'Harvard Product Builders is a student group that prototypes useful tools for campus communities over short, hands-on build weekends.',
    responsibilities: ['Build the frontend of a prototype tool for student communities.', 'Pair with a designer and a backend teammate to ship a working demo.', 'Share what you learn with the wider builders group.'],
    qualifications: ['Comfortable building interfaces with React or a similar framework.', 'Available for a few hours this weekend.', 'No prior hackathon experience required.']
  },
  'job-vercel-summer': {
    category: 'Internship', arrangement: 'Remote', location: 'Remote', industry: 'Technology',
    skills: ['JavaScript', 'React', 'Node.js', 'Developer tools'],
    about: 'Vercel provides the developer tools and cloud infrastructure that help teams build, preview, and ship fast web experiences.',
    responsibilities: ['Improve tools that developers use to build and ship for the web.', 'Collaborate with a distributed team through code review and design discussions.', 'Own a scoped project from first idea to release.'],
    qualifications: ['Interest in frontend infrastructure and developer experience.', 'Familiarity with JavaScript or TypeScript.', 'Comfortable working asynchronously in a remote team.']
  },
  'group-climate-volunteer': {
    category: 'Volunteer', arrangement: 'Hybrid', location: 'Boston, MA', industry: 'Climate & Sustainability',
    skills: ['Python', 'Data analysis', 'Design', 'Outreach'],
    about: 'The Boston Student Climate Coalition connects student groups across the city to work on practical local environmental projects.',
    responsibilities: ['Turn public environmental data into clear resources for local groups.', 'Help design simple visuals and explainers for neighborhood organizers.', 'Join outreach conversations with community partners.'],
    qualifications: ['Interest in climate and community work.', 'Basic data skills or design experience is helpful.', 'A few flexible hours each week.']
  }
};

const additionalOpportunities = [
  { id: 'job-figma-design-eng', kind: 'job', category: 'Internship', title: 'Design engineering intern', organization: 'Figma', location: 'Remote', arrangement: 'Remote', industry: 'Design', nodeId: 'figma', skills: ['React', 'TypeScript', 'Design systems', 'CSS'], description: 'Work at the boundary of design and engineering, building polished interface details and prototyping new collaboration ideas with product and design teammates.', about: 'Figma makes collaborative design software used by product teams to design, prototype, and build together.', responsibilities: ['Prototype and ship interface improvements with design partners.', 'Contribute to shared components and design systems.', 'Test ideas quickly and share what you learn with the team.'], qualifications: ['Strong interest in both design and frontend engineering.', 'Experience with React, CSS, or TypeScript.', 'A portfolio or projects that show attention to detail.'], author: 'Pipeline picks', url: '', createdAt: '2026-10-07' },
  { id: 'job-common-thread-founding', kind: 'job', category: 'Internship', title: 'Founding engineer intern', organization: 'Common Thread', location: 'Boston, MA', arrangement: 'Hybrid', industry: 'Education', nodeId: 'common-thread', skills: ['React', 'Python', 'SQL', 'Product thinking'], description: 'Join an early-stage edtech startup and help build the first version of tools that let people learn together. You will work directly with the founder and shape the product.', about: 'Common Thread is an early-stage education technology company focused on helping people learn together.', responsibilities: ['Build and ship features end to end alongside the founding team.', 'Talk with early users and turn feedback into product improvements.', 'Help set up the engineering foundations of a young product.'], qualifications: ['Comfortable working in a small, fast-moving team.', 'Experience building web apps with React or Python.', 'Excited by education and community-centered products.'], author: 'Common Thread', url: '', createdAt: '2026-10-06' },
  { id: 'group-mit-fintech-case', kind: 'group', category: 'Competition', title: 'Fintech case competition team needs a backend teammate', organization: 'MIT Fintech Society', location: 'Cambridge, MA', arrangement: 'In person', industry: 'Fintech', nodeId: 'mit', groupId: 'mit-fintech-society', skills: ['Python', 'SQL', 'Data analysis'], description: 'We are forming a cross-campus team for a fintech case competition and need someone who can build data pipelines and a simple backend for our prototype.', about: 'MIT Fintech Society is a student club exploring financial technology, responsible software, and the future of finance.', responsibilities: ['Build the data pipeline and backend for the team prototype.', 'Work with teammates on strategy, demo, and final presentation.', 'Attend two evening working sessions on campus.'], qualifications: ['Experience with Python and SQL.', 'Interest in financial technology.', 'Students from any Boston-area school are welcome.'], author: 'MIT Fintech Society', url: '', createdAt: '2026-10-05' },
  { id: 'job-harvard-hci-research', kind: 'job', category: 'Research', title: 'Research assistant, human-computer interaction', organization: 'Harvard HCI Research Lab', location: 'Cambridge, MA', arrangement: 'In person', industry: 'Research', nodeId: 'harvard', skills: ['Python', 'JavaScript', 'User research'], description: 'Support a research team studying how people interact with collaborative tools. You will help build study prototypes, run sessions with participants, and analyze results.', about: 'A Harvard research group studying how people use software to collaborate, learn, and make decisions together.', responsibilities: ['Build and maintain small web prototypes for user studies.', 'Help run and document sessions with participants.', 'Clean and analyze study data with the research team.'], qualifications: ['Harvard students preferred; open to all levels.', 'Experience with Python or JavaScript.', 'Interest in research and human-centered design.'], author: 'Harvard HCI Research Lab', url: '', createdAt: '2026-10-04' },
  { id: 'group-harvard-robotics-rover', kind: 'group', category: 'Project', title: 'Software teammates for our autonomous rover project', organization: 'Harvard Robotics Team', location: 'Cambridge, MA', arrangement: 'In person', industry: 'Robotics & Hardware', nodeId: 'harvard', groupId: 'harvard-robotics', skills: ['C', 'Python', 'ROS', 'Embedded systems'], description: 'The robotics team is looking for software-minded members to help with navigation and sensor code for this year’s autonomous rover competition entry.', about: 'The Harvard Robotics Team is a student group building robotics projects, hardware experiments, and software for autonomous systems.', responsibilities: ['Write navigation and sensor-processing code for the rover.', 'Test software on hardware with the mechanical team.', 'Document and hand off your work to future members.'], qualifications: ['Experience with C or Python.', 'Curiosity about robotics; no hardware experience needed.', 'Time for weekly team meetings.'], author: 'Harvard Robotics Team', url: '', createdAt: '2026-10-03' },
  { id: 'job-northstar-associate', kind: 'job', category: 'Full-Time', title: 'Associate software engineer', organization: 'Northstar Labs', location: 'Boston, MA', arrangement: 'Hybrid', industry: 'Technology', nodeId: 'northstar', skills: ['Java', 'SQL', 'APIs', 'Testing'], description: 'A full-time role for recent graduates joining a software team that builds internal platforms. Interns from past summers are encouraged to apply.', about: 'Northstar Labs is a software company where teams build and maintain products for business customers.', responsibilities: ['Build and test backend services in Java.', 'Work in a small team with regular code reviews and mentorship.', 'Help improve reliability and documentation of internal tools.'], qualifications: ['Degree in computer science or a related field by next summer.', 'Experience with Java and SQL.', 'Previous internship or project experience is a plus.'], author: 'Northstar Labs', url: '', createdAt: '2026-09-30' },
  { id: 'group-entrepreneurship-cofounder', kind: 'group', category: 'Collaboration', title: 'Looking for a technical co-founder for an edtech idea', organization: 'Harvard College Entrepreneurship Forum', location: 'Cambridge, MA', arrangement: 'Hybrid', industry: 'Education', groupId: 'harvard-entrepreneurship', skills: ['React', 'Python', 'Product thinking'], description: 'A student founder in our community is looking for a technical partner to build and test an early prototype for peer tutoring and study groups.', about: 'The Harvard College Entrepreneurship Forum is a community for students exploring startups, early-stage teams, and new ideas.', responsibilities: ['Build a first prototype with the founder.', 'Run user interviews with students to test the idea.', 'Decide together what to build next.'], qualifications: ['Experience building a web app end to end.', 'Interest in startups and education.', 'Comfortable with ambiguity and fast iteration.'], author: 'Harvard College Entrepreneurship Forum', url: '', createdAt: '2026-09-25' }
];

const gridNodes = [
  { id: 'truman', name: 'Truman Pauley', category: 'person', meta: 'You · Computer science', x: 50, y: 49, image: 'photo-1500648767791-00dcc994a43e', description: 'Your profile is the starting point for every path on this grid. You are studying computer science at Harvard and exploring software, product, and community.', connection: 'Your education, skills, and projects connect you to people and roles across the grid.' },
  { id: 'harvard', name: 'Harvard University', category: 'school', meta: 'Computer Science · 2027', x: 20, y: 22, icon: 'graduation-cap', description: 'Your education creates shared context with alumni working across technology, product, and early-stage companies.', connection: 'Your Harvard background connects you directly to Maya Chen and to a wider alumni network.' },
  { id: 'maya', name: 'Maya Chen', category: 'person', meta: 'SWE @ Stripe · Harvard alum', x: 41, y: 16, image: 'photo-1534528741775-53994a69daeb', description: 'Maya is a software engineer at Stripe and a Harvard alum. Her path combines a strong computer science foundation with product-focused engineering.', connection: 'You share Harvard. Maya is a warm connection who can offer a first-hand view of product engineering at Stripe.' },
  { id: 'stripe', name: 'Stripe', category: 'organization', meta: 'Fintech · San Francisco', x: 14, y: 10, icon: 'building-2', description: 'Stripe builds financial infrastructure and hires engineers who care about reliable systems and thoughtful product experiences.', connection: 'Maya Chen is a Harvard alum in software engineering at Stripe.' },
  { id: 'northstar', name: 'Northstar Labs', category: 'organization', meta: 'Software · Past experience', x: 13, y: 49, icon: 'building-2', description: 'Your software engineering internship gave you hands-on experience shipping software with a team.', connection: 'Your internship ties your Java experience to a practical software engineering path.' },
  { id: 'java', name: 'Java', category: 'skill', meta: 'Skill · Programming', x: 33, y: 37, icon: 'code-2', description: 'Java is one of the skills listed on your profile and a useful foundation for backend and platform engineering.', connection: 'Your Java experience connects your Northstar Labs internship to software engineering roles.' },
  { id: 'python', name: 'Python', category: 'skill', meta: 'Skill · Programming', x: 23, y: 73, icon: 'code-2', description: 'Python gives you a flexible base for automation, data work, and rapid prototyping.', connection: 'Your Python skill is reinforced by your open-source project work.' },
  { id: 'open-source', name: 'Open-source project', category: 'project', meta: 'Project · Developer tools', x: 40, y: 76, icon: 'blocks', description: 'Your project work shows how you apply technical skills beyond coursework and collaborate in the open.', connection: 'Your project draws on Python and gives you a shared interest with builders across the grid.' },
  { id: 'react', name: 'React', category: 'skill', meta: 'Skill · Frontend', x: 53, y: 85, icon: 'code-2', description: 'React is a practical bridge between your engineering foundation and user-facing product work.', connection: 'Your React experience is a direct signal for product engineering roles.' },
  { id: 'sam', name: 'Sam Okafor', category: 'person', meta: 'CS @ MIT · 3 mutuals', x: 66, y: 29, image: 'photo-1507003211169-0a1dd7228f2d', description: 'Sam is a computer science student at MIT who is interested in developer tools and early-stage teams.', connection: 'You share a computer science background and three mutual connections.' },
  { id: 'mit', name: 'MIT', category: 'school', meta: 'Computer Science · Cambridge', x: 84, y: 17, icon: 'graduation-cap', description: 'MIT is part of the local Boston and Cambridge technology community, with overlapping student and founder networks.', connection: 'Sam studies computer science at MIT and shares three mutual connections with you.' },
  { id: 'jordan', name: 'Jordan Ellis', category: 'person', meta: 'Founder @ Common Thread', x: 82, y: 43, image: 'photo-1506794778202-cad84cf45f1d', description: 'Jordan founded Common Thread, an education technology startup, and is open to meeting builders interested in early-stage companies.', connection: 'Jordan is connected to Sam and the Common Thread team through the local founder community.' },
  { id: 'common-thread', name: 'Common Thread', category: 'organization', meta: 'Edtech · Early stage', x: 87, y: 61, icon: 'building-2', description: 'Common Thread is an early-stage education technology company focused on helping people learn together.', connection: 'Jordan Ellis founded Common Thread and is building its early product team.' },
  { id: 'alex', name: 'Alex Rivera', category: 'person', meta: 'Product @ Figma', x: 69, y: 59, image: 'photo-1531123897727-8f129e1688ce', description: 'Alex works in product at Figma and is interested in the intersection of software, design, and collaboration.', connection: 'Your React skill and product engineering interests overlap with Alex’s work at Figma.' },
  { id: 'figma', name: 'Figma', category: 'organization', meta: 'Design software · Remote', x: 87, y: 77, icon: 'panels-top-left', description: 'Figma makes collaborative design software and brings engineers, designers, and product teams together.', connection: 'Alex Rivera works in product at Figma and can share how engineering and design collaborate.' },
  { id: 'product-engineer', name: 'Product engineer', category: 'role', meta: 'Career path · Strong fit', x: 68, y: 84, icon: 'route', description: 'Product engineers combine software craft with a feel for user needs. Your React experience, internship, and interest in building make this a natural path to explore.', connection: 'Your React skill links to this path; Alex Rivera can offer a product-side perspective, and Maya Chen can share an engineering perspective.' }
];

const gridEdges = [
  ['truman', 'harvard', 'studies at'], ['harvard', 'maya', 'alumni'], ['maya', 'stripe', 'works at'],
  ['truman', 'northstar', 'internship'], ['northstar', 'java', 'used in'], ['truman', 'java', 'skill'],
  ['truman', 'python', 'skill'], ['python', 'open-source', 'used in'], ['truman', 'open-source', 'built'],
  ['truman', 'react', 'skill'], ['react', 'product-engineer', 'relevant skill'], ['truman', 'sam', 'shared field'],
  ['sam', 'mit', 'studies at'], ['sam', 'jordan', 'mutual network'], ['jordan', 'common-thread', 'founded'],
  ['truman', 'alex', 'shared interests'], ['alex', 'figma', 'works at'], ['alex', 'product-engineer', 'product perspective']
];

const groupCatalog = [
  { id: 'harvard-university', name: 'Harvard University', type: 'University', memberCount: 26420, membership: 'Verified Member', verified: true, access: 'request', icon: 'graduation-cap', description: 'A university community connecting students, alumni, faculty, and builders across disciplines.', memberIds: ['maya', 'sam', 'jordan'], relatedGroupIds: ['harvard-financial-analysts', 'harvard-entrepreneurship', 'harvard-student-agencies'], gridNodeIds: ['harvard', 'maya', 'truman'] },
  { id: 'harvard-financial-analysts', name: 'Harvard Financial Analysts Club', type: 'Club', memberCount: 685, membership: 'Member', verified: true, access: 'request', icon: 'chart-no-axes-combined', description: 'Students learning financial analysis through workshops, company research, and peer-led projects.', memberIds: ['maya', 'alex'], relatedGroupIds: ['harvard-university', 'harvard-entrepreneurship'], gridNodeIds: ['harvard', 'stripe', 'truman'] },
  { id: 'harvard-entrepreneurship', name: 'Harvard College Entrepreneurship Forum', type: 'Club', memberCount: 1320, membership: 'Member', verified: true, access: 'request', icon: 'lightbulb', description: 'A community for Harvard students exploring startups, early-stage teams, and new ideas.', memberIds: ['jordan', 'maya', 'sam'], relatedGroupIds: ['harvard-university', 'harvard-student-agencies'], gridNodeIds: ['harvard', 'common-thread', 'truman'] },
  { id: 'harvard-student-agencies', name: 'Harvard Student Agencies', type: 'Organization', memberCount: 1200, membership: 'Verified Member', verified: true, access: 'request', icon: 'building-2', description: 'A student-run organization building practical experience through real operating businesses and services.', memberIds: ['sam', 'maya'], relatedGroupIds: ['harvard-university', 'harvard-entrepreneurship'], gridNodeIds: ['harvard', 'northstar', 'truman'] },
  { id: 'harvard-robotics', name: 'Harvard Robotics Team', type: 'Team', memberCount: 84, verified: true, access: 'request', icon: 'bot', description: 'Students collaborating on robotics projects, hardware experiments, and software for autonomous systems.', memberIds: ['sam', 'alex'], relatedGroupIds: ['harvard-university', 'cs50-fall-2026'], gridNodeIds: ['harvard', 'java', 'truman'] },
  { id: 'cs50-fall-2026', name: 'CS50 Fall 2026', type: 'Class', memberCount: 1840, verified: true, access: 'open', icon: 'book-open', description: 'A course community for learners building a strong foundation in computer science and programming.', memberIds: ['sam', 'alex', 'maya'], relatedGroupIds: ['harvard-university', 'harvard-robotics'], gridNodeIds: ['harvard', 'java', 'python'] },
  { id: 'northstar-alumni', name: 'Northstar Labs Alumni Network', type: 'Company', memberCount: 96, verified: false, access: 'request', icon: 'briefcase-business', description: 'Past and present Northstar Labs teammates staying connected across software and product roles.', memberIds: ['maya', 'jordan'], relatedGroupIds: ['harvard-university', 'boston-product-builders'], gridNodeIds: ['northstar', 'java', 'truman'] },
  { id: 'boston-product-builders', name: 'Boston Product Builders', type: 'Organization', memberCount: 612, verified: false, access: 'open', icon: 'blocks', description: 'A cross-company community of people building useful products around Boston.', memberIds: ['alex', 'jordan', 'maya'], relatedGroupIds: ['northstar-alumni', 'harvard-entrepreneurship'], gridNodeIds: ['product-engineer', 'alex', 'truman'] },
  { id: 'mit-fintech-society', name: 'MIT Fintech Society', type: 'Club', memberCount: 348, verified: true, access: 'request', icon: 'landmark', description: 'Students exploring financial technology, responsible software, and the systems behind modern finance.', memberIds: ['sam', 'jordan'], relatedGroupIds: ['harvard-financial-analysts', 'harvard-university'], gridNodeIds: ['mit', 'stripe', 'sam'] },
  { id: 'harvard-outing-club', name: 'Harvard Outing Club', type: 'Club', memberCount: 940, verified: true, access: 'open', icon: 'mountain', description: 'A student community organizing outdoor trips, skill-sharing, and time outside the classroom.', memberIds: ['maya', 'sam'], relatedGroupIds: ['harvard-university', 'harvard-student-agencies'], gridNodeIds: ['harvard', 'maya', 'truman'] },
  { id: 'mit-alumni-network', name: 'MIT Alumni Network', type: 'University', memberCount: 8900, verified: true, access: 'request', icon: 'graduation-cap', description: 'A university community connecting MIT students and alumni working across technology and research.', memberIds: ['sam'], relatedGroupIds: ['mit-fintech-society', 'harvard-university'], gridNodeIds: ['mit', 'sam'] }
];

const groupTypeIcons = {
  University: 'graduation-cap', Team: 'bot', Club: 'users-round', Class: 'book-open',
  Company: 'briefcase-business', Organization: 'building-2'
};

const defaultProfile = {
  name: 'Truman Pauley',
  headline: 'Computer science student',
  location: 'Boston, MA',
  school: 'Harvard University',
  bio: 'Curious builder exploring the intersection of software, people, and big ideas.',
  photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=128&q=80'
};

const defaultMessageThreads = [
  {
    id: 'maya',
    personId: 'maya',
    messages: [
      { sender: 'them', text: 'Hey Truman — I’d love to compare notes on product engineering and what your Harvard path prepared you for.', time: '2h ago' },
      { sender: 'me', text: 'Absolutely. I’m curious how your work at Stripe balances shipping fast with real product thinking.', time: '1h ago' },
      { sender: 'them', text: 'A lot of it comes down to solving real user problems, not just writing code for the sake of it.', time: 'just now' }
    ]
  },
  {
    id: 'jordan',
    personId: 'jordan',
    messages: [
      { sender: 'them', text: 'I like the way your profile is framed around learning and building. Want to swap notes on early-stage teams?', time: 'Yesterday' },
      { sender: 'me', text: 'Definitely. I’d love to hear how you think about the transition from building to founding.', time: 'Yesterday' }
    ]
  },
  {
    id: 'alex',
    personId: 'alex',
    messages: [
      { sender: 'them', text: 'Your React work stood out to me. Want to compare notes on product design workflows?', time: 'Mon' },
      { sender: 'me', text: 'Yes — I’m always looking for better ways to translate design intent into clearer product decisions.', time: 'Mon' }
    ]
  },
  {
    id: 'sam',
    personId: 'sam',
    messages: [
      { sender: 'them', text: 'If you’re still exploring developer tooling, I’d love to compare what your MIT and Harvard experience taught you.', time: 'Wed' }
    ]
  },
  {
    id: 'sarah',
    personId: 'sarah',
    messages: []
  }
];

const state = {
  items: loadItems(),
  resumeData: loadResumeData(),
  groupMemberships: loadGroupMemberships(),
  createdGroups: loadCreatedGroups(),
  opportunityPosts: loadOpportunityPosts(),
  savedOpportunities: loadOpportunityIds('orbit-saved-opportunities'),
  interestedOpportunities: loadOpportunityIds('orbit-interested-opportunities'),
  opportunityFilters: { tab: 'for-you', search: '', location: 'all', type: 'all', industry: 'all', sort: 'relevant', savedOnly: false },
  openOpportunityId: null,
  activeGroupFilter: 'all',
  editingSkills: false,
  profile: loadProfile(),
  connected: new Set(JSON.parse(localStorage.getItem('orbit-connected') || '[]')),
  saved: new Set(JSON.parse(localStorage.getItem('orbit-saved') || '[]')),
  toastTimer: null,
  selectedGridNode: null,
  gridZoom: 1,
  cropScale: 1,
  cropBaseScale: 1,
  cropLeft: 0,
  cropTop: 0,
  cropPointer: null,
  cropObjectUrl: null,
  messageThreads: loadMessageThreads(),
  activeMessageThreadId: null,
  messagePickerOpen: false
};

const connectionProfiles = {
  maya: {
    path: ['You', 'Harvard University', 'Maya Chen'],
    summary: 'Your alumni connection gives you a natural way to ask about product engineering at Stripe.',
    shared: ['Harvard University', 'Product engineering', 'Software development'],
    details: 'You both came through Harvard and have a shared interest in building software that makes real user impact.'
  },
  jordan: {
    path: ['You', 'Harvard Entrepreneurship', 'Jordan Ellis'],
    summary: 'You share an early-stage founder mindset and a strong interest in building community-driven ideas.',
    shared: ['Entrepreneurship', 'Early-stage teams', 'Education technology'],
    details: 'Jordan is connected through the Harvard ecosystem and likes to meet builders exploring new ideas and teams.'
  },
  alex: {
    path: ['You', 'React', 'Alex Rivera', 'Figma'],
    summary: 'Your frontend skills and product curiosity overlap with Alex’s design and product work at Figma.',
    shared: ['React', 'Product thinking', 'Figma'],
    details: 'You can naturally talk about design systems, product decisions, and how engineering and design collaborate.'
  },
  sam: {
    path: ['You', 'Computer Science', 'Sam Okafor'],
    summary: 'You share a CS background and strong interest in real-world builder communities.',
    shared: ['Computer Science', 'MIT network', 'Developer tools'],
    details: 'You have a common foundation in software and can ask about how they think about the transition from study to building.'
  },
  sarah: {
    path: ['You', 'Harvard Baseball', 'Michael Lee', 'Sarah Chen'],
    summary: 'You’re connected through a shared Harvard baseball network and a mutual interest in finance and career transitions.',
    shared: ['Harvard Baseball', 'Investment banking', 'Career exploration'],
    details: 'Michael Lee is a strong bridge here, giving you a natural opening to ask about her path into investment banking.'
  }
};

function loadMessageThreads() {
  try {
    const saved = JSON.parse(localStorage.getItem('orbit-message-threads') || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    // Fall through to defaults.
  }
  return defaultMessageThreads.map(thread => ({ ...thread, messages: thread.messages.map(message => ({ ...message })) }));
}

function persistMessageThreads() {
  localStorage.setItem('orbit-message-threads', JSON.stringify(state.messageThreads));
}

function syncMessagePickerState() {
  const picker = document.querySelector('#message-picker');
  if (picker) picker.hidden = !state.messagePickerOpen;
}

function getPersonById(personId) {
  return people.find(person => person.id === personId) || {
    id: personId,
    name: personId === 'sarah' ? 'Sarah Chen' : 'New connection',
    role: personId === 'sarah' ? 'Investment Banking @ Morgan Stanley' : 'Your network',
    image: personId === 'sarah' ? 'photo-1487412720507-e7ab37603c6f' : 'photo-1500648767791-00dcc994a43e',
    context: personId === 'sarah' ? 'Harvard alum · Finance' : 'Connected through the Grid'
  };
}

function getConnectionProfile(personId) {
  return connectionProfiles[personId] || {
    path: ['You', 'Shared network', 'This person'],
    summary: 'You have overlapping interests and a common builder network.',
    shared: ['Career curiosity', 'Shared community'],
    details: 'This is a natural conversation starter based on your current overlap.'
  };
}

function generateOpeners(personId) {
  const person = getPersonById(personId);
  const profile = getConnectionProfile(personId);
  const baseLink = personId === 'sarah'
    ? 'Harvard Baseball network and your investment banking path.'
    : `${profile.path[1]} and your shared focus on ${profile.shared[0].toLowerCase()}.`;
  const variations = [
    `Hi ${person.name} — I found you through the ${profile.path[1]} network and noticed you’re in ${person.role.toLowerCase()}. I’d love to hear about your experience getting into the field.`,
    `Hey ${person.name} — I saw our connection through ${profile.path[1]} and wanted to ask how that path shaped your work in ${person.role.split('@')[1]?.trim() || 'your current role'}.`,
    `Hi ${person.name} — I noticed we’re connected through ${baseLink} I’d love to hear what you’ve learned from the transition so far.`
  ];

  if (personId === 'sarah') {
    return [
      `Hi Sarah — I found you through the Harvard Baseball network and noticed you're working in investment banking. I'd love to hear about your experience getting into the industry.`,
      `Hey Sarah — I saw our overlap through Harvard Baseball and wanted to ask how your path from campus to investment banking came together.`,
      `Hi Sarah — I noticed we’re connected through the Harvard Baseball community, and I’d love to hear what you’ve learned most in your work so far.`
    ];
  }

  return variations;
}

function renderMessageThreads() {
  const list = document.querySelector('#message-thread-list');
  const searchInput = document.querySelector('#messages-search');
  if (!list || !searchInput) return;

  const search = searchInput.value.trim().toLowerCase();
  const filteredThreads = state.messageThreads.filter(thread => {
    const person = getPersonById(thread.personId);
    const haystack = `${person.name} ${person.role} ${thread.messages.at(-1)?.text || ''}`.toLowerCase();
    return !search || haystack.includes(search);
  });

  if (!filteredThreads.length) {
    list.innerHTML = '<div class="empty-message-state compact">No matching conversations.</div>';
    return;
  }

  list.innerHTML = filteredThreads.map(thread => {
    const person = getPersonById(thread.personId);
    const preview = thread.messages.length ? thread.messages[thread.messages.length - 1].text : 'Start a conversation with a thoughtful opener.';
    const isActive = thread.id === state.activeMessageThreadId;
    return `
      <button type="button" class="message-thread ${isActive ? 'active' : ''}" data-message-thread="${thread.id}">
        <img src="https://images.unsplash.com/${person.image}?auto=format&fit=crop&w=96&q=80" alt="${escapeHTML(person.name)}" />
        <span class="message-thread-copy">
          <strong>${escapeHTML(person.name)}</strong>
          <small>${escapeHTML(person.role)}</small>
          <span>${escapeHTML(preview.slice(0, 42))}${preview.length > 42 ? '…' : ''}</span>
        </span>
        <span class="message-thread-time">${thread.messages.length ? 'Now' : 'New'}</span>
      </button>
    `;
  }).join('');

  const picker = document.querySelector('#message-picker-list');
  const threadIds = new Set(filteredThreads.map(thread => thread.personId));
  const contacts = people.filter(person => !threadIds.has(person.id));
  picker.innerHTML = contacts.map(person => `
    <button type="button" class="message-picker-person" data-start-person="${person.id}">
      <img src="https://images.unsplash.com/${person.image}?auto=format&fit=crop&w=96&q=80" alt="${escapeHTML(person.name)}" />
      <span>
        <strong>${escapeHTML(person.name)}</strong>
        <small>${escapeHTML(person.role)}</small>
      </span>
    </button>
  `).join('');
}

function renderConnectionPanel(personId) {
  const panel = document.querySelector('#connection-panel-content');
  if (!panel) return;

  const profile = getConnectionProfile(personId);
  const person = getPersonById(personId);
  const flow = profile.path.map((step, index) => {
    const isArrow = index < profile.path.length - 1;
    return `
      <span class="connection-pill">${escapeHTML(step)}${isArrow ? '<i data-lucide="arrow-right"></i>' : ''}</span>
    `;
  }).join('');

  const shared = profile.shared.map(item => `<div class="connection-list-item"><span class="dot"></span><span>${escapeHTML(item)}</span></div>`).join('');

  panel.innerHTML = `
    <div class="connection-panel-card">
      <section class="connection-panel-section">
        <h4>Connection path</h4>
        <div class="connection-chain">${flow}</div>
      </section>
      <section class="connection-panel-section">
        <h4>Why this feels natural</h4>
        <p>${escapeHTML(profile.summary)}</p>
      </section>
      <section class="connection-panel-section">
        <h4>Shared context</h4>
        <div class="connection-list">${shared}</div>
      </section>
      <section class="connection-panel-section">
        <h4>Best talking point</h4>
        <p>${escapeHTML(profile.details)}</p>
      </section>
    </div>
  `;

  refreshIcons();
}

function renderActiveMessageThread() {
  const activeThread = state.messageThreads.find(thread => thread.id === state.activeMessageThreadId) || state.messageThreads[0];
  const threadBody = document.querySelector('#message-thread-body');
  const headerName = document.querySelector('#message-thread-name');
  const headerRole = document.querySelector('#message-thread-role');
  const headerStatus = document.querySelector('#message-thread-status');
  const headerAvatar = document.querySelector('#message-thread-avatar');
  const helpPanel = document.querySelector('#help-reach-out-panel');
  const suggestionList = document.querySelector('#suggestion-list');
  const flow = document.querySelector('#connection-flow');
  const summary = document.querySelector('#help-reach-out-summary');

  if (!threadBody || !headerName || !headerRole || !headerStatus || !headerAvatar) return;

  if (!activeThread) {
    threadBody.innerHTML = '<div class="empty-message-state">Pick a thread to read your messages.</div>';
    headerName.textContent = 'Select a conversation';
    headerRole.textContent = 'Choose someone from your network';
    headerStatus.textContent = 'Offline';
    headerAvatar.innerHTML = '<i data-lucide="messages-square"></i>';
    if (helpPanel) helpPanel.hidden = true;
    return;
  }

  const person = getPersonById(activeThread.personId);
  headerName.textContent = person.name;
  headerRole.textContent = person.role;
  headerStatus.textContent = 'Online';
  headerAvatar.innerHTML = `<img src="https://images.unsplash.com/${person.image}?auto=format&fit=crop&w=96&q=80" alt="${escapeHTML(person.name)}" />`;

  if (!activeThread.messages.length) {
    const profile = getConnectionProfile(activeThread.personId);
    if (helpPanel) helpPanel.hidden = false;
    if (summary) summary.textContent = profile.summary;
    if (flow) flow.innerHTML = profile.path.map((step, index) => `
      <span class="connection-flow-step">${escapeHTML(step)}${index < profile.path.length - 1 ? '<i data-lucide="arrow-right"></i>' : ''}</span>
    `).join('');
    const suggestions = generateOpeners(activeThread.personId);
    if (suggestionList) suggestionList.innerHTML = suggestions.map((text, index) => `
      <article class="suggestion-card">
        <p>${escapeHTML(text)}</p>
        <div class="suggestion-actions">
          <button type="button" class="primary" data-suggestion-action="use" data-suggestion-index="${index}">Use</button>
          <button type="button" data-suggestion-action="edit" data-suggestion-index="${index}">Edit</button>
          <button type="button" data-suggestion-action="regenerate" data-suggestion-index="${index}">Regenerate</button>
        </div>
      </article>
    `).join('');
    threadBody.innerHTML = '<div class="empty-message-state">No previous messages yet. Use a Pipeline starter to reach out naturally.</div>';
    renderConnectionPanel(activeThread.personId);
    refreshIcons();
    return;
  }

  if (helpPanel) helpPanel.hidden = true;
  threadBody.innerHTML = activeThread.messages.map(message => `
    <div class="message-bubble ${message.sender === 'me' ? 'message-me' : ''}">
      <p>${escapeHTML(message.text)}</p>
      <small>${escapeHTML(message.time || 'now')}</small>
    </div>
  `).join('');
  renderConnectionPanel(activeThread.personId);
}

function ensureMessageThread(personId) {
  let thread = state.messageThreads.find(candidate => candidate.personId === personId);
  if (!thread) {
    thread = { id: `thread-${personId}`, personId, messages: [] };
    state.messageThreads.unshift(thread);
  }
  state.activeMessageThreadId = thread.id;
  state.messagePickerOpen = false;
  persistMessageThreads();
  syncMessagePickerState();
  renderMessages();
}

function renderMessages() {
  syncMessagePickerState();
  renderMessageThreads();
  renderActiveMessageThread();
}

const reviewList = document.querySelector('#review-list');
const modal = document.querySelector('#upload-modal');
const uploadStatus = document.querySelector('#upload-status');
const toast = document.querySelector('#toast');

function loadItems() {
  try {
    const saved = JSON.parse(localStorage.getItem('orbit-items') || 'null');
    return Array.isArray(saved) ? saved : defaultItems.map(item => ({ ...item }));
  } catch {
    return defaultItems.map(item => ({ ...item }));
  }
}

function loadProfile() {
  try {
    return { ...defaultProfile, ...JSON.parse(localStorage.getItem('orbit-profile') || '{}') };
  } catch {
    return { ...defaultProfile };
  }
}

function loadResumeData() {
  try {
    const saved = JSON.parse(localStorage.getItem('orbit-resume-data') || 'null');
    return saved && Array.isArray(saved.sections) ? saved : { version: 1, sections: [], lines: [] };
  } catch {
    return { version: 1, sections: [], lines: [] };
  }
}

function loadGroupMemberships() {
  const defaults = Object.fromEntries(groupCatalog.filter(group => group.membership).map(group => [group.id, group.membership]));
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('orbit-group-memberships') || '{}') };
  } catch {
    return defaults;
  }
}

function loadCreatedGroups() {
  try {
    const saved = JSON.parse(localStorage.getItem('orbit-created-groups') || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function loadOpportunityPosts() {
  try {
    const saved = JSON.parse(localStorage.getItem('orbit-opportunity-posts') || '[]');
    return Array.isArray(saved) ? saved.filter(post => post && post.id && post.title && post.organization) : [];
  } catch {
    return [];
  }
}

function loadOpportunityIds(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? new Set(saved.filter(value => typeof value === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function persist() {
  localStorage.setItem('orbit-items', JSON.stringify(state.items));
  localStorage.setItem('orbit-connected', JSON.stringify([...state.connected]));
  localStorage.setItem('orbit-saved', JSON.stringify([...state.saved]));
  localStorage.setItem('orbit-profile', JSON.stringify(state.profile));
  localStorage.setItem('orbit-resume-data', JSON.stringify(state.resumeData));
  localStorage.setItem('orbit-group-memberships', JSON.stringify(state.groupMemberships));
  localStorage.setItem('orbit-created-groups', JSON.stringify(state.createdGroups));
  localStorage.setItem('orbit-opportunity-posts', JSON.stringify(state.opportunityPosts));
  localStorage.setItem('orbit-saved-opportunities', JSON.stringify([...state.savedOpportunities]));
  localStorage.setItem('orbit-interested-opportunities', JSON.stringify([...state.interestedOpportunities]));
}

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function resumeEntryTitle(section, entry) {
  return entry.organization || entry.school || entry.name || entry.skill || entry.rawText?.[0] || 'Entry to review';
}

function resumeEntryFields(section, entry) {
  if (section.type === 'experience') return [['organization', 'Organization'], ['role', 'Role'], ['location', 'Location'], ['startDate', 'Start date'], ['endDate', 'End date']];
  if (section.type === 'education') return [['school', 'School'], ['degree', 'Degree'], ['field', 'Field of study'], ['graduationDate', 'Graduation date'], ['gpa', 'GPA']];
  if (section.type === 'skills') return [['skill', 'Skill']];
  return [['name', 'Name'], ['organization', 'Organization'], ['role', 'Role'], ['location', 'Location'], ['startDate', 'Start date'], ['endDate', 'End date']];
}

function renderResumeEntry(section, entry) {
  const article = document.createElement('article');
  article.className = `resume-entry ${entry.state || 'pending'} ${entry.state === 'editing' ? 'is-editing' : ''}`;
  article.dataset.resumeSection = section.type;
  article.dataset.entryId = entry.id;
  const fields = resumeEntryFields(section, entry);
  const title = resumeEntryTitle(section, entry);
  const displayFields = fields.filter(([key]) => !['name', 'organization', 'school', 'skill'].includes(key) && entry[key]);
  const actionMarkup = entry.state === 'editing'
    ? `<button class="review-action resume-action save-structured" type="button" aria-label="Save entry" title="Save entry">${icon('check')}</button>`
    : `<button class="review-action resume-action edit-structured" type="button" aria-label="Edit ${escapeHTML(title)}" title="Edit entry">${icon('pencil')}</button><button class="review-action resume-action approve-structured" type="button" aria-label="${entry.state === 'approved' ? 'Undo confirmation' : 'Confirm entry'}" title="${entry.state === 'approved' ? 'Undo confirmation' : 'Looks right'}">${icon('check')}</button><button class="review-action resume-action reject-structured" type="button" aria-label="Remove ${escapeHTML(title)}" title="Remove entry">${icon('x')}</button>`;
  const summary = entry.state === 'editing'
    ? `<div class="resume-edit-fields">${fields.map(([key, label]) => `<label>${label}<input data-entry-field="${key}" value="${escapeHTML(entry[key] || '')}" /></label>`).join('')}</div><label class="resume-description-edit">Description details<textarea data-entry-field="description" rows="3">${escapeHTML((entry.description || []).join('\n'))}</textarea></label>${entry.coursework ? `<label class="resume-description-edit">Coursework<textarea data-entry-field="coursework" rows="2">${escapeHTML(entry.coursework.join('\n'))}</textarea></label>` : ''}${entry.rawText?.length ? `<label class="resume-description-edit uncertain-edit">Unassigned resume text<textarea data-entry-field="rawText" rows="2">${escapeHTML(entry.rawText.join('\n'))}</textarea></label>` : ''}`
    : `<div class="resume-entry-facts">${displayFields.map(([key, label]) => `<span><small>${label}</small>${escapeHTML(entry[key])}</span>`).join('')}${entry.coursework?.length ? `<span class="coursework-fact"><small>Coursework</small>${escapeHTML(entry.coursework.join(', '))}</span>` : ''}</div>${entry.description?.length ? `<ul class="resume-entry-description">${entry.description.map(detail => `<li>${escapeHTML(detail)}</li>`).join('')}</ul>` : ''}${entry.needsConfirmation?.length && entry.state !== 'approved' ? `<div class="resume-uncertain"><strong>Needs confirmation</strong><span>${escapeHTML(entry.rawText?.join(' · ') || 'Some details could not be confidently assigned.')}</span></div>` : ''}`;
  article.innerHTML = `<div class="resume-entry-header"><div><span class="resume-entry-section">${escapeHTML(section.title)}</span><h4>${escapeHTML(title)}</h4></div><div class="review-actions">${actionMarkup}</div></div>${summary}`;
  return article;
}

function renderSkillsSection(section) {
  const group = document.createElement('div');
  group.className = 'resume-skills-review';
  group.dataset.resumeSection = 'skills';
  const allApproved = section.entries.length > 0 && section.entries.every(entry => entry.state === 'approved');
  const actions = state.editingSkills
    ? `<button class="review-action resume-action save-skills" type="button" aria-label="Save skills" title="Save skills">${icon('check')}</button><button class="review-action resume-action cancel-skills" type="button" aria-label="Cancel skill editing" title="Cancel">${icon('x')}</button>`
    : `<button class="review-action resume-action edit-skills" type="button" aria-label="Edit skills" title="Edit skills">${icon('pencil')}</button><button class="review-action resume-action approve-skills" type="button" aria-label="${allApproved ? 'Undo skills confirmation' : 'Confirm skills'}" title="${allApproved ? 'Undo confirmation' : 'Confirm skills'}">${icon('check')}</button>`;
  const skills = state.editingSkills
    ? `<div class="resume-skill-editor">${section.entries.map((entry, index) => `<label class="resume-skill-edit-item"><span class="sr-only">Skill ${index + 1}</span><input class="resume-skill-input" data-skill-id="${escapeHTML(entry.id)}" value="${escapeHTML(entry.skill || '')}" /><button class="review-action resume-action remove-skill" type="button" data-skill-id="${escapeHTML(entry.id)}" aria-label="Remove ${escapeHTML(entry.skill || `skill ${index + 1}`)}" title="Remove skill">${icon('x')}</button></label>`).join('')}<button class="skill-add" type="button">${icon('plus')} Add skill</button></div>`
    : `<div class="resume-skill-cloud">${section.entries.map(entry => `<span class="resume-skill-chip ${entry.state === 'approved' ? 'approved' : ''}">${escapeHTML(entry.skill)}</span>`).join('')}</div>`;
  group.innerHTML = `<div class="resume-skills-top"><small>${section.entries.length} ${section.entries.length === 1 ? 'skill' : 'skills'}</small><div class="review-actions">${actions}</div></div>${skills}`;
  return group;
}

function renderItems() {
  reviewList.innerHTML = '';
  const resumeEntries = state.resumeData.sections.flatMap(section => section.entries || []);
  const pendingResumeCount = state.resumeData.sections.reduce((total, section) => total + (section.type === 'skills'
    ? (section.entries.some(entry => !entry.state || entry.state === 'pending') ? 1 : 0)
    : section.entries.filter(entry => !entry.state || entry.state === 'pending').length), 0);
  const pendingCount = state.items.filter(item => item.state === 'pending').length + pendingResumeCount;
  const pill = document.querySelector('#review-count');
  pill.textContent = pendingCount ? `${pendingCount} to review` : 'All caught up';
  pill.classList.toggle('complete', pendingCount === 0);

  state.items.forEach(item => {
    const row = document.createElement('div');
    row.className = `review-item ${item.state}`;
    row.dataset.id = item.id;
    row.innerHTML = `<span class="review-label">${escapeHTML(item.label)}</span><span class="review-value">${escapeHTML(item.value)}</span><span class="review-actions">${item.state === 'editing' ? `<button class="review-action save-edit" aria-label="Save changes" title="Save changes">${icon('check')}</button>` : `<button class="review-action edit" aria-label="Edit ${escapeHTML(item.label)}" title="Edit">${icon('pencil')}</button><button class="review-action approve" aria-label="Approve ${escapeHTML(item.label)}" title="Looks right">${icon('check')}</button><button class="review-action reject" aria-label="Reject ${escapeHTML(item.label)}" title="Remove from profile">${icon('x')}</button>`}</span>`;
    reviewList.append(row);
  });

  state.resumeData.sections.forEach(section => {
    if (!section.entries?.length) return;
    const sectionHeading = document.createElement('div');
    sectionHeading.className = 'resume-review-heading';
    const entryLabel = section.type === 'skills' ? 'skills' : section.entries.length === 1 ? 'entry' : 'entries';
    sectionHeading.innerHTML = `<span>${escapeHTML(section.title)}</span><small>${section.entries.length} ${entryLabel}</small>`;
    reviewList.append(sectionHeading);
    if (section.type === 'skills') reviewList.append(renderSkillsSection(section));
    else section.entries.forEach(entry => reviewList.append(renderResumeEntry(section, entry)));
  });

  if (!state.items.length && !resumeEntries.length) reviewList.innerHTML = '<div class="empty-review">No details yet. Upload a resume or add a detail to get started.</div>';
  persist();
  refreshIcons();
}

function renderPeople() {
  const container = document.querySelector('#people-list');
  container.innerHTML = people.map(person => {
    const connected = state.connected.has(person.id);
    return `<article class="person-card" data-person="${person.id}"><img src="https://images.unsplash.com/${person.image}?auto=format&fit=crop&w=96&q=80" alt="" style="background:#${person.color}" /><div class="person-detail"><strong>${person.name}</strong><span>${person.role}</span><small>${person.context}</small></div><button class="connect-button ${connected ? 'connected' : ''}" aria-label="${connected ? 'Connected to' : 'Connect with'} ${person.name}" title="${connected ? 'Connected' : 'Connect'}">${icon(connected ? 'check' : 'plus')}</button></article>`;
  }).join('');
  document.querySelector('#connection-count').textContent = 128 + state.connected.size;
  document.querySelector('#overview-connection-count').textContent = 128 + state.connected.size;
  refreshIcons();
}

function renderNetworkExample() {
  const nodeLayer = document.querySelector('#example-grid-nodes');
  const edgeLayer = document.querySelector('#example-edge-layer');
  nodeLayer.innerHTML = gridNodes.map(node => {
    const nodeImage = node.id === 'truman' ? state.profile.photo : '';
    const nodeIcon = nodeImage
      ? `<img src="${escapeHTML(nodeImage)}" alt="" />`
      : node.image
        ? `<img src="https://images.unsplash.com/${node.image}?auto=format&fit=crop&w=96&q=80" alt="" />`
        : icon(node.icon);
    const nodeName = node.id === 'truman' ? state.profile.name : node.name;
    const nodeMeta = node.id === 'truman' ? `You · ${state.profile.headline}` : node.meta;
    return `<div class="grid-node node-${node.category} example-grid-node" style="--node-x:${node.x}%;--node-y:${node.y}%"><span class="node-avatar">${nodeIcon}</span><span class="node-copy"><strong>${escapeHTML(nodeName)}</strong><small>${escapeHTML(nodeMeta)}</small></span></div>`;
  }).join('');
  edgeLayer.innerHTML = gridEdges.map(([from, to, relation]) => {
    const start = gridNodes.find(node => node.id === from);
    const end = gridNodes.find(node => node.id === to);
    return `<line class="grid-edge" x1="${start.x * 10}" y1="${start.y * 6.8}" x2="${end.x * 10}" y2="${end.y * 6.8}"><title>${escapeHTML(relation)}</title></line>`;
  }).join('');
  refreshIcons();
}

function allGroups() {
    return [...groupCatalog, ...state.createdGroups];
  }

  function groupCardMarkup(group, isDiscovery) {
    const status = state.groupMemberships[group.id];
    const statusClass = status ? status.toLowerCase().replace(/\s+/g, '-') : 'suggested';
    const actionMarkup = isDiscovery
      ? `<button class="group-join-button" type="button" data-group-action="${escapeHTML(group.id)}">${group.access === 'open' ? 'Join' : 'Request to Join'}</button>`
      : `<span class="group-status status-${statusClass}">${escapeHTML(status)}</span>`;
    return `<article class="group-card"><div class="group-card-main"><span class="group-logo" aria-hidden="true">${icon(group.icon || groupTypeIcons[group.type] || 'users')}</span><div class="group-card-copy"><span class="group-type">${escapeHTML(group.type)}</span><button class="group-card-title" type="button" data-group-open="${escapeHTML(group.id)}">${escapeHTML(group.name)}</button><span class="group-member-count">${new Intl.NumberFormat('en-US').format(group.memberCount)} members</span></div></div><div class="group-card-footer">${actionMarkup}<button class="group-view-button" type="button" data-group-open="${escapeHTML(group.id)}">View Group ${icon('arrow-up-right')}</button></div></article>`;
  }

  function renderGroups() {
    const search = document.querySelector('#groups-search').value.trim().toLowerCase();
    const matches = group => (!search || `${group.name} ${group.type} ${group.description}`.toLowerCase().includes(search));
    const groups = allGroups();
    const yours = groups.filter(group => state.groupMemberships[group.id] && matches(group));
    const discover = groups.filter(group => !state.groupMemberships[group.id] && matches(group)
      && (state.activeGroupFilter === 'all' || group.type.toLowerCase() === state.activeGroupFilter));
    document.querySelector('#your-groups-count').textContent = yours.length;
    document.querySelector('#your-groups-list').innerHTML = yours.map(group => groupCardMarkup(group, false)).join('');
    document.querySelector('#discover-groups-list').innerHTML = discover.map(group => groupCardMarkup(group, true)).join('');
    document.querySelector('#your-groups-empty').hidden = yours.length > 0;
    document.querySelector('#discover-groups-empty').hidden = discover.length > 0;
    refreshIcons();
  }

const legacyOpportunityTags = ['Job opening', 'Community'];

function normalizeOpportunity(raw) {
  const enrichment = opportunityEnrichment[raw.id] || {};
  const category = raw.category || enrichment.category || (raw.kind === 'job' ? 'Job' : 'Collaboration');
  const arrangement = raw.arrangement || enrichment.arrangement || 'In person';
  const rawLocation = raw.location || enrichment.location || '';
  return {
    id: raw.id,
    category,
    kind: jobCategories.includes(category) ? 'job' : 'group',
    title: raw.title,
    organization: raw.organization,
    location: arrangement === 'Remote' ? 'Remote' : (rawLocation || 'Location flexible'),
    arrangement,
    industry: raw.industry || enrichment.industry || 'Other',
    description: raw.description,
    skills: (raw.skills || enrichment.skills || raw.tags || []).filter(tag => !legacyOpportunityTags.includes(tag)),
    responsibilities: raw.responsibilities || enrichment.responsibilities || [],
    qualifications: raw.qualifications || enrichment.qualifications || [],
    about: raw.about || enrichment.about || '',
    nodeId: raw.nodeId || enrichment.nodeId || null,
    groupId: raw.groupId || enrichment.groupId || null,
    author: raw.author || raw.organization,
    url: raw.url || '',
    createdAt: raw.createdAt,
    posted: Boolean(raw.id && String(raw.id).startsWith('posted-'))
  };
}

function opportunityList() {
  return [...state.opportunityPosts, ...defaultOpportunities, ...additionalOpportunities].map(normalizeOpportunity);
}

function userSkillSet() {
  const skills = new Set();
  const add = text => String(text || '').split(/[,;]/).map(part => part.trim().toLowerCase()).filter(Boolean).forEach(part => skills.add(part));
  state.items.filter(item => item.label === 'Skills' && item.state !== 'rejected').forEach(item => add(item.value));
  state.resumeData.sections.filter(section => section.type === 'skills').forEach(section => {
    (section.entries || []).filter(entry => entry.state !== 'rejected').forEach(entry => add(entry.skill));
  });
  return skills;
}

// Sample data only: connections are derived from the prototype Grid and group data, not from real accounts.
function opportunityNetwork(opportunity) {
  const ids = new Set();
  if (opportunity.nodeId) {
    gridEdges.forEach(([from, to]) => {
      if (from === opportunity.nodeId) ids.add(to);
      if (to === opportunity.nodeId) ids.add(from);
    });
  }
  const group = opportunity.groupId && allGroups().find(candidate => candidate.id === opportunity.groupId);
  (group?.memberIds || []).forEach(id => ids.add(id));
  const connections = people.filter(person => ids.has(person.id));
  const sharedGroups = allGroups().filter(candidate => state.groupMemberships[candidate.id] && state.groupMemberships[candidate.id] !== 'Pending'
    && (candidate.memberIds || []).some(id => connections.some(person => person.id === id)));
  return { connections, sharedGroups };
}

function networkSummaryLines(opportunity, network) {
  const lines = [];
  const count = network.connections.length;
  if (count) lines.push(`${count} ${count === 1 ? 'person' : 'people'} in your Grid ${count === 1 ? 'is' : 'are'} connected to ${opportunity.organization}`);
  const groupCount = network.sharedGroups.length;
  if (groupCount) lines.push(`${groupCount} shared ${groupCount === 1 ? 'group' : 'groups'} with people at this organization`);
  return lines;
}

function opportunityDateLabel(createdAt) {
  const date = new Date(`${createdAt}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 'Recently posted';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 14) return `Posted ${days} days ago`;
  return `Posted ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)}`;
}

function opportunityAvatar(opportunity) {
  return `<span class="opp-avatar ${opportunity.kind === 'job' ? 'opp-avatar-job' : 'opp-avatar-group'}" aria-hidden="true">${escapeHTML((opportunity.organization || '?').trim().charAt(0).toUpperCase())}</span>`;
}

function filteredOpportunities() {
  const filters = state.opportunityFilters;
  const mySkills = userSkillSet();
  const search = filters.search.trim().toLowerCase();
  const enriched = opportunityList().map(opportunity => {
    const network = opportunityNetwork(opportunity);
    const matchedSkills = opportunity.skills.filter(skill => mySkills.has(skill.toLowerCase()));
    return { opportunity, network, matchedSkills, score: matchedSkills.length + network.connections.length };
  });
  const results = enriched.filter(({ opportunity, score }) => {
    if (filters.tab === 'job' && opportunity.kind !== 'job') return false;
    if (filters.tab === 'group' && opportunity.kind !== 'group') return false;
    if (filters.tab === 'for-you' && score === 0) return false;
    if (filters.savedOnly && !state.savedOpportunities.has(opportunity.id)) return false;
    if (filters.location !== 'all' && opportunity.location !== filters.location) return false;
    if (filters.type !== 'all' && opportunity.category !== filters.type) return false;
    if (filters.industry !== 'all' && opportunity.industry !== filters.industry) return false;
    if (!search) return true;
    return [opportunity.title, opportunity.organization, opportunity.location, opportunity.arrangement, opportunity.category, opportunity.industry, opportunity.description, ...opportunity.skills]
      .join(' ').toLowerCase().includes(search);
  });
  const byDate = (a, b) => String(b.opportunity.createdAt).localeCompare(String(a.opportunity.createdAt));
  if (filters.sort === 'recent') results.sort(byDate);
  else if (filters.sort === 'network') results.sort((a, b) => b.network.connections.length - a.network.connections.length || byDate(a, b));
  else results.sort((a, b) => b.score - a.score || byDate(a, b));
  return results;
}

function populateOpportunityFilters() {
  const all = opportunityList();
  const fill = (selector, key, values, allLabel) => {
    const select = document.querySelector(selector);
    const current = state.opportunityFilters[key];
    const options = [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b));
    select.innerHTML = `<option value="all">${allLabel}</option>${options.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('')}`;
    if (!options.includes(current)) state.opportunityFilters[key] = 'all';
    select.value = state.opportunityFilters[key];
  };
  fill('#opp-filter-location', 'location', all.map(item => item.location), 'All locations');
  fill('#opp-filter-type', 'type', all.map(item => item.category), 'All types');
  fill('#opp-filter-industry', 'industry', all.map(item => item.industry), 'All industries');
}

function opportunityNetworkMarkup(opportunity, network) {
  const lines = networkSummaryLines(opportunity, network);
  const faces = network.connections.slice(0, 3).map(person => `<img src="https://images.unsplash.com/${escapeHTML(person.image)}?auto=format&fit=crop&w=48&q=80" alt="" loading="lazy">`).join('');
  return `<div class="opp-network">
    <div class="opp-network-head"><strong>${icon('network')} Your Network</strong><span class="opp-prototype-badge" title="Sample Grid data for the prototype. Not verified.">Prototype · unverified</span></div>
    ${lines.length
      ? `<div class="opp-network-body">${faces ? `<span class="opp-faces">${faces}</span>` : ''}<ul>${lines.map(line => `<li>${escapeHTML(line)}</li>`).join('')}</ul></div>`
      : '<p class="opp-network-empty">No connections found in your sample Grid yet.</p>'}
  </div>`;
}

function renderOpportunities() {
  populateOpportunityFilters();
  const filters = state.opportunityFilters;
  const results = filteredOpportunities();
  const savedCount = [...state.savedOpportunities].filter(id => opportunityList().some(item => item.id === id)).length;
  document.querySelectorAll('[data-opportunity-tab]').forEach(button => {
    const active = button.dataset.opportunityTab === filters.tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const savedToggle = document.querySelector('#opp-saved-toggle');
  savedToggle.classList.toggle('active', filters.savedOnly);
  savedToggle.setAttribute('aria-pressed', String(filters.savedOnly));
  document.querySelector('#opp-saved-count').textContent = savedCount;
  document.querySelector('#opp-filter-sort').value = filters.sort;
  const filtersActive = filters.search || filters.location !== 'all' || filters.type !== 'all' || filters.industry !== 'all' || filters.savedOnly || filters.tab !== 'for-you';
  document.querySelector('#opp-clear-filters').hidden = !filtersActive;
  document.querySelector('#opp-results-count').textContent = `${results.length} ${results.length === 1 ? 'opportunity' : 'opportunities'}`;

  document.querySelector('#opportunities-list').innerHTML = results.map(({ opportunity, network, matchedSkills }) => {
    const saved = state.savedOpportunities.has(opportunity.id);
    const id = escapeHTML(opportunity.id);
    const skills = opportunity.skills.slice(0, 4).map(skill => `<span class="opportunity-tag${matchedSkills.includes(skill) ? ' match' : ''}">${escapeHTML(skill)}</span>`).join('');
    return `<article class="opp-card">
      <div class="opp-card-top">${opportunityAvatar(opportunity)}
        <div class="opp-card-title"><h2><button type="button" data-opportunity-view="${id}">${escapeHTML(opportunity.title)}</button></h2><p>${escapeHTML(opportunity.organization)}</p></div>
        <button class="icon-button opp-bookmark${saved ? ' saved' : ''}" type="button" aria-label="${saved ? 'Remove from saved' : 'Save opportunity'}" aria-pressed="${saved}" data-opportunity-save="${id}">${icon('bookmark')}</button>
      </div>
      <div class="opp-meta"><span class="opp-chip type">${escapeHTML(opportunity.category)}</span><span class="opp-chip">${icon('map-pin')}${escapeHTML(opportunity.location)}</span>${opportunity.arrangement === opportunity.location ? '' : `<span class="opp-chip">${icon('laptop')}${escapeHTML(opportunity.arrangement)}</span>`}</div>
      <p class="opp-description">${escapeHTML(opportunity.description)}</p>
      <div class="opportunity-card-tags">${skills}</div>
      ${matchedSkills.length && filters.tab === 'for-you' ? `<p class="opp-match">${icon('sparkles')}${matchedSkills.length} ${matchedSkills.length === 1 ? 'skill matches' : 'skills match'} your profile</p>` : ''}
      ${opportunityNetworkMarkup(opportunity, network)}
      <footer class="opp-card-footer"><span class="opportunity-date">${escapeHTML(opportunityDateLabel(opportunity.createdAt))}</span>
        <div class="opp-actions"><button class="opp-secondary" type="button" data-opportunity-explore="${id}">Explore Connections</button><button class="button opportunity-primary-action" type="button" data-opportunity-view="${id}">View Opportunity</button></div>
      </footer>
    </article>`;
  }).join('');

  const empty = document.querySelector('#opportunities-empty');
  empty.hidden = results.length > 0;
  if (!results.length) {
    document.querySelector('#opp-empty-title').textContent = filters.savedOnly ? 'No saved opportunities match' : 'No opportunities match';
    document.querySelector('#opp-empty-copy').textContent = filters.tab === 'for-you' && !filters.search && !filters.savedOnly
      ? 'Add skills to your profile or browse All Opportunities to see more.'
      : 'Try adjusting your search or clearing some filters.';
  }
  refreshIcons();
}

function toggleOpportunityCollection(collection, key, id) {
  const wasActive = collection.has(id);
  if (wasActive) collection.delete(id);
  else collection.add(id);
  try {
    localStorage.setItem(key, JSON.stringify([...collection]));
  } catch {
    if (wasActive) collection.add(id);
    else collection.delete(id);
    showToast('That change could not be saved. Free up browser storage and try again.');
    return null;
  }
  return !wasActive;
}

function exploreOpportunityConnections(opportunityId) {
  const opportunity = opportunityList().find(item => item.id === opportunityId);
  if (!opportunity) return;
  const { connections, sharedGroups } = opportunityNetwork(opportunity);
  closeOpportunityDetail();
  setView('surf-grid');
  appendGuideMessage('user', `Who in my network can connect me to “${opportunity.title}” at ${opportunity.organization}?`);
  const lines = networkSummaryLines(opportunity, { connections, sharedGroups });
  const names = connections.map(person => person.name).join(', ');
  const text = opportunity.nodeId && connections.length
    ? `Sample Grid data (prototype, not verified): ${lines.join('; ')}. People nearby: ${names}. I’ve highlighted ${opportunity.organization} on the map.`
    : `There is no sample Grid connection for ${opportunity.organization} yet, so I’ve centered the map on you. In a full version, this is where real mutual connections would appear.`;
  window.setTimeout(() => {
    appendGuideMessage('assistant', text);
    selectGridNode(opportunity.nodeId && connections.length ? opportunity.nodeId : 'truman');
  }, 220);
}

function listMarkup(items) {
  return items.length
    ? `<ul class="opp-detail-list">${items.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`
    : '<p class="opp-muted">Not provided by the poster.</p>';
}

function renderOpportunityDetail(opportunityId) {
  const opportunity = opportunityList().find(item => item.id === opportunityId);
  if (!opportunity) return;
  const network = opportunityNetwork(opportunity);
  const mySkills = userSkillSet();
  const saved = state.savedOpportunities.has(opportunity.id);
  const interested = state.interestedOpportunities.has(opportunity.id);
  const id = escapeHTML(opportunity.id);
  const skills = opportunity.skills.length
    ? opportunity.skills.map(skill => `<span class="opportunity-tag${mySkills.has(skill.toLowerCase()) ? ' match' : ''}">${escapeHTML(skill)}</span>`).join('')
    : '<span class="opp-muted">No skills listed.</span>';
  const people_ = network.connections.map(person => `<li><img src="https://images.unsplash.com/${escapeHTML(person.image)}?auto=format&fit=crop&w=64&q=80" alt=""><span><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(person.role)}</small></span></li>`).join('');
  const groups = network.sharedGroups.map(group => `<span class="opp-chip">${escapeHTML(group.name)}</span>`).join('');
  document.querySelector('#opportunity-detail-content').innerHTML = `
    <header class="opp-detail-head">${opportunityAvatar(opportunity)}
      <div><span class="opp-chip type">${escapeHTML(opportunity.category)}</span><h2 id="opp-detail-title">${escapeHTML(opportunity.title)}</h2><p>${escapeHTML(opportunity.organization)}</p></div>
    </header>
    <dl class="opp-detail-facts">
      <div><dt>Type</dt><dd>${escapeHTML(opportunity.category)}</dd></div>
      <div><dt>Location</dt><dd>${escapeHTML(opportunity.location)}</dd></div>
      <div><dt>Work style</dt><dd>${escapeHTML(opportunity.arrangement)}</dd></div>
      <div><dt>Industry</dt><dd>${escapeHTML(opportunity.industry)}</dd></div>
      <div><dt>Posted</dt><dd>${escapeHTML(opportunityDateLabel(opportunity.createdAt).replace('Posted ', ''))}</dd></div>
      <div><dt>Posted by</dt><dd>${escapeHTML(opportunity.author)}</dd></div>
    </dl>
    <section><h3>About this opportunity</h3><p>${escapeHTML(opportunity.description)}</p></section>
    <section><h3>About ${escapeHTML(opportunity.organization)}</h3><p>${opportunity.about ? escapeHTML(opportunity.about) : '<span class="opp-muted">No organization details were provided.</span>'}</p></section>
    <section><h3>Responsibilities</h3>${listMarkup(opportunity.responsibilities)}</section>
    <section><h3>Qualifications</h3>${listMarkup(opportunity.qualifications)}</section>
    <section><h3>Skills</h3><div class="opportunity-card-tags">${skills}</div></section>
    <section class="opp-network"><div class="opp-network-head"><strong>${icon('network')} Your Network</strong><span class="opp-prototype-badge">Prototype · unverified</span></div>
      ${network.connections.length ? `<ul class="opp-people">${people_}</ul>` : '<p class="opp-network-empty">No connections found in your sample Grid yet.</p>'}
      ${groups ? `<p class="opp-shared-label">Shared groups</p><div class="opp-meta">${groups}</div>` : ''}
      <p class="opp-fineprint">These connections come from sample Grid data and are not verified.</p>
    </section>
    <footer class="opp-detail-actions">
      <button class="icon-button opp-bookmark${saved ? ' saved' : ''}" type="button" aria-label="${saved ? 'Remove from saved' : 'Save opportunity'}" aria-pressed="${saved}" data-opportunity-save="${id}">${icon('bookmark')}</button>
      <button class="opp-secondary" type="button" data-opportunity-explore="${id}">Explore My Network</button>
      <button class="opp-secondary${interested ? ' active' : ''}" type="button" data-opportunity-interest="${id}">${interested ? 'Interest noted' : 'I’m Interested'}</button>
      ${opportunity.url ? `<a class="button opportunity-primary-action" href="${escapeHTML(opportunity.url)}" target="_blank" rel="noopener noreferrer">Apply ${icon('arrow-up-right')}</a>` : ''}
    </footer>
    <p class="opp-fineprint">“I’m Interested” is saved on this device only. Pipeline does not send it to the poster in this prototype.</p>`;
  refreshIcons();
}

const opportunityDetailModal = document.querySelector('#opportunity-detail-modal');
function openOpportunityDetail(opportunityId) {
  state.openOpportunityId = opportunityId;
  renderOpportunityDetail(opportunityId);
  opportunityDetailModal.classList.add('open');
  opportunityDetailModal.setAttribute('aria-hidden', 'false');
  document.querySelector('#opportunity-detail-close').focus();
}
function closeOpportunityDetail() {
  state.openOpportunityId = null;
  opportunityDetailModal.classList.remove('open');
  opportunityDetailModal.setAttribute('aria-hidden', 'true');
}

  function renderGroupDetail(groupId) {
    const group = allGroups().find(candidate => candidate.id === groupId);
    if (!group) return;
    const members = (group.memberIds || []).map(id => people.find(person => person.id === id)).filter(Boolean);
    const memberMarkup = members.length
      ? members.map(person => `<div class="group-member"><img src="https://images.unsplash.com/${person.image}?auto=format&fit=crop&w=80&q=80" alt="" /><span><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(person.role)}</small></span></div>`).join('')
      : '<p class="group-detail-muted">Member previews will appear here as this group grows.</p>';
    const related = (group.relatedGroupIds || []).map(id => allGroups().find(candidate => candidate.id === id)).filter(Boolean);
    const relatedMarkup = related.length
      ? related.map(item => `<button class="related-group-chip" type="button" data-group-open="${escapeHTML(item.id)}">${icon(groupTypeIcons[item.type] || 'users')} ${escapeHTML(item.name)}</button>`).join('')
      : '<p class="group-detail-muted">No connected groups yet.</p>';
    const nodes = (group.gridNodeIds || []).map(id => gridNodes.find(node => node.id === id)).filter(Boolean).slice(0, 4);
    const nodeMarkup = nodes.length
      ? nodes.map(node => `<span class="group-grid-node"><i data-lucide="${escapeHTML(node.icon || (node.category === 'person' ? 'user-round' : 'circle-dot'))}"></i>${escapeHTML(node.id === 'truman' ? state.profile.name : node.name)}</span>`).join('')
      : '<span class="group-detail-muted">This group has not been mapped to the Grid yet.</span>';
    const status = state.groupMemberships[group.id];
    document.querySelector('#groups-list-view').hidden = true;
    const detail = document.querySelector('#group-detail-view');
    detail.hidden = false;
    detail.innerHTML = `<button class="group-back-button" type="button" data-groups-back>${icon('arrow-left')} Back to groups</button><div class="group-detail-heading"><span class="group-logo group-logo-large">${icon(group.icon || groupTypeIcons[group.type] || 'users')}</span><div class="group-detail-title"><span class="group-type">${escapeHTML(group.type)}</span><h2>${escapeHTML(group.name)}</h2><div class="group-detail-badges">${status ? `<span class="group-status status-${status.toLowerCase().replace(/\s+/g, '-')}">${escapeHTML(status)}</span>` : ''}<span class="verification-badge ${group.verified ? 'is-verified' : ''}">${icon(group.verified ? 'badge-check' : 'badge-help')}${group.verified ? 'Verified group' : 'Not yet verified'}</span></div></div></div><p class="group-description">${escapeHTML(group.description)}</p><div class="group-detail-stats"><span><strong>${new Intl.NumberFormat('en-US').format(group.memberCount)}</strong><small>Members</small></span><span><strong>${escapeHTML(group.type)}</strong><small>Group type</small></span><span><strong>${group.verified ? 'Verified' : 'Unverified'}</strong><small>Affiliation status</small></span></div><div class="group-detail-columns"><section class="group-detail-section"><h3>Members</h3><div class="group-member-list">${memberMarkup}</div></section><section class="group-detail-section"><h3>Connections to other groups</h3><div class="related-group-list">${relatedMarkup}</div></section></div><section class="group-detail-section group-grid-section"><div class="group-detail-section-heading"><div><h3>On your Grid</h3><p>This group connects to people and paths in your network.</p></div></div><div class="group-grid-preview"><span class="group-grid-root">${icon(group.icon || groupTypeIcons[group.type] || 'users')} ${escapeHTML(group.name)}</span><div class="group-grid-links">${nodeMarkup}</div></div></section>`;
    refreshIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderNetworkMap() {
  const category = document.querySelector('#map-filter').value;
  const query = document.querySelector('#map-search').value.trim().toLowerCase();
  const nodeLayer = document.querySelector('#grid-nodes');
  const edgeLayer = document.querySelector('#edge-layer');
  const visibleIds = new Set(gridNodes.filter(node => category === 'all' || node.category === category).map(node => node.id));
  const matchingIds = new Set(gridNodes.filter(node => visibleIds.has(node.id) && (!query || `${node.name} ${node.meta} ${node.description}`.toLowerCase().includes(query))).map(node => node.id));

  if (state.selectedGridNode && !visibleIds.has(state.selectedGridNode)) selectGridNode(null);

  nodeLayer.innerHTML = gridNodes.map(node => {
    const nodeImage = node.id === 'truman' ? state.profile.photo : '';
    const nodeIcon = nodeImage
      ? `<img src="${escapeHTML(nodeImage)}" alt="" />`
      : node.image
        ? `<img src="https://images.unsplash.com/${node.image}?auto=format&fit=crop&w=96&q=80" alt="" />`
      : icon(node.icon);
    const matchesSearch = matchingIds.has(node.id);
    const nodeName = node.id === 'truman' ? state.profile.name : node.name;
    const nodeMeta = node.id === 'truman' ? `You · ${state.profile.headline}` : node.meta;
    return `<button type="button" class="grid-node node-${node.category} ${matchesSearch ? '' : 'search-dimmed'}" data-node-id="${node.id}" style="--node-x:${node.x}%;--node-y:${node.y}%" aria-label="${escapeHTML(nodeName)}, ${escapeHTML(nodeMeta)}" title="${escapeHTML(nodeName)}"><span class="node-avatar">${nodeIcon}</span><span class="node-copy"><strong>${escapeHTML(nodeName)}</strong><small>${escapeHTML(nodeMeta)}</small></span></button>`;
  }).join('');
  nodeLayer.querySelectorAll('.grid-node').forEach(button => { button.hidden = !visibleIds.has(button.dataset.nodeId); });

  edgeLayer.innerHTML = gridEdges.filter(([from, to]) => visibleIds.has(from) && visibleIds.has(to)).map(([from, to, relation]) => {
    const start = gridNodes.find(node => node.id === from);
    const end = gridNodes.find(node => node.id === to);
    return `<line class="grid-edge" data-from="${from}" data-to="${to}" x1="${start.x * 10}" y1="${start.y * 6.8}" x2="${end.x * 10}" y2="${end.y * 6.8}"><title>${escapeHTML(relation)}</title></line>`;
  }).join('');
  document.querySelector('#map-node-count').textContent = `${visibleIds.size} nodes`;
  const emptyState = document.querySelector('#map-empty-state');
  emptyState.hidden = matchingIds.size > 0;
  emptyState.textContent = query ? 'No matches on this grid.' : 'No paths match that filter.';
  document.querySelector('#map-plane').style.transform = `scale(${state.gridZoom})`;
  document.querySelector('#zoom-reset').textContent = `${Math.round(state.gridZoom * 100)}%`;
  updateGridHighlights();
  refreshIcons();
}

function updateGridHighlights() {
  const selectedId = state.selectedGridNode;
  const relatedIds = new Set(gridEdges.filter(([from, to]) => from === selectedId || to === selectedId).flatMap(([from, to]) => [from, to]));
  document.querySelectorAll('#grid-nodes .grid-node').forEach(button => {
    const selected = button.dataset.nodeId === selectedId;
    const related = relatedIds.has(button.dataset.nodeId);
    button.classList.toggle('is-selected', selected);
    button.classList.toggle('is-related', related && !selected);
    button.classList.toggle('is-dimmed', Boolean(selectedId) && !selected && !related);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('#edge-layer .grid-edge').forEach(edge => {
    edge.classList.toggle('is-active', edge.dataset.from === selectedId || edge.dataset.to === selectedId);
  });
}

function selectGridNode(nodeId) {
  const drawer = document.querySelector('#node-drawer');
  const node = gridNodes.find(candidate => candidate.id === nodeId);
  state.selectedGridNode = node ? node.id : null;
  if (!node) {
    drawer.hidden = true;
    updateGridHighlights();
    return;
  }
  const filter = document.querySelector('#map-filter');
  if (filter.value !== 'all' && filter.value !== node.category) {
    filter.value = 'all';
    renderNetworkMap();
  }

  document.querySelector('#drawer-category').textContent = node.category === 'role' ? 'CAREER PATH' : node.category.toUpperCase();
  document.querySelector('#drawer-symbol').innerHTML = node.id === 'truman'
    ? `<img src="${escapeHTML(state.profile.photo)}" alt="" />`
    : node.image
      ? `<img src="https://images.unsplash.com/${node.image}?auto=format&fit=crop&w=96&q=80" alt="" />`
    : icon(node.icon);
  document.querySelector('#drawer-title').textContent = node.id === 'truman' ? state.profile.name : node.name;
  document.querySelector('#drawer-subtitle').textContent = node.id === 'truman' ? `You · ${state.profile.headline}` : node.meta;
  document.querySelector('#drawer-description').textContent = node.description;
  document.querySelector('#drawer-connection').textContent = node.connection;
  document.querySelector('#drawer-guide-button').dataset.nodeId = node.id;

  const relatedNodes = gridEdges.filter(([from, to]) => from === node.id || to === node.id).map(([from, to, relation]) => {
    const related = gridNodes.find(candidate => candidate.id === (from === node.id ? to : from));
    return { ...related, relation };
  });
  document.querySelector('#drawer-related-list').innerHTML = relatedNodes.map(related => `<button type="button" class="related-node" data-related-node="${related.id}"><span><strong>${escapeHTML(related.name)}</strong><small>${escapeHTML(related.relation)}</small></span><i data-lucide="arrow-up-right"></i></button>`).join('');
  drawer.hidden = false;
  updateGridHighlights();
  refreshIcons();
}

function appendGuideMessage(role, text) {
  const message = document.createElement('article');
  message.className = `guide-message ${role === 'assistant' ? 'assistant-message' : 'user-message'}`;
  if (role === 'assistant') {
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.innerHTML = icon('git-branch');
    message.append(avatar);
  }
  const body = document.createElement('p');
  body.textContent = text;
  message.append(body);
  document.querySelector('#guide-messages').append(message);
  document.querySelector('#guide-messages').scrollTop = document.querySelector('#guide-messages').scrollHeight;
  refreshIcons();
}

function guideResponse(query) {
  const normalized = query.toLowerCase();
  if (/career|role|product|job|next step/.test(normalized)) {
    return {
      nodeId: 'product-engineer',
      text: 'Product engineering looks like a promising next step. Your React experience connects directly to the role, while Alex Rivera can share a product perspective and Maya Chen can speak to engineering at Stripe.'
    };
  }
  if (/connection|people|alum|intro|stripe|find someone|who should/.test(normalized)) {
    return {
      nodeId: 'maya',
      text: 'Maya Chen is a relevant warm connection: you share a Harvard background, and she works in software engineering at Stripe. Select her node to see how that connection fits your path.'
    };
  }
  if (/background|skill|experience|from where|my path/.test(normalized)) {
    return {
      nodeId: 'truman',
      text: 'Your Harvard education, Northstar Labs internship, and hands-on skills create several starting points. Follow React toward product engineering, or explore Java through your internship experience.'
    };
  }
  const mentionedNode = gridNodes.find(node => normalized.includes(node.name.toLowerCase()));
  if (mentionedNode) {
    return { nodeId: mentionedNode.id, text: `${mentionedNode.description} ${mentionedNode.connection}` };
  }
  return {
    nodeId: 'truman',
    text: 'I can help trace career paths from your skills, find people connected through school or work, or explore how your projects open new doors. Try asking about product engineering, Stripe, or your background.'
  };
}

function sendGuideQuery(query) {
  const message = query.trim();
  if (!message) return;
  appendGuideMessage('user', message);
  const response = guideResponse(message);
  window.setTimeout(() => {
    appendGuideMessage('assistant', response.text);
    selectGridNode(response.nodeId);
  }, 220);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function openUpload() {
  uploadStatus.textContent = '';
  uploadStatus.classList.remove('error');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.querySelector('#modal-close').focus();
}

function closeUpload() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function applyProfile() {
  const { name, headline, location, school, bio, photo } = state.profile;
  document.querySelector('#sidebar-profile-name').textContent = name;
  document.querySelector('#sidebar-profile-meta').textContent = `${headline || 'Pipeline member'} · ${location || 'Location not set'}`;
  document.querySelector('#sidebar-avatar').src = photo;
  document.querySelector('#top-avatar-img').src = photo;
  document.querySelector('#profile-avatar').src = photo;
  document.querySelector('#profile-avatar').alt = name;
  document.querySelector('#welcome-name').textContent = name.split(/\s+/)[0] || name;
  document.querySelector('#profile-name').textContent = name;
  document.querySelector('#profile-headline').textContent = headline;
  document.querySelector('#profile-location').textContent = location;
  document.querySelector('#profile-school').textContent = school;
  document.querySelector('#profile-bio').textContent = bio;
  document.querySelector('#overview-profile-avatar').src = photo;
  document.querySelector('#overview-profile-avatar').alt = name;
  document.querySelector('#overview-profile-name').textContent = name;
  document.querySelector('#overview-profile-headline').textContent = headline;
  document.querySelector('#overview-profile-location').textContent = location;
  document.querySelector('#overview-profile-school').textContent = school;
  document.querySelector('#overview-profile-bio').textContent = bio;
  renderNetworkExample();
}

function openProfileEditor() {
  const form = document.querySelector('#profile-form');
  for (const field of ['name', 'headline', 'location', 'school', 'bio']) {
    form.elements[field].value = state.profile[field];
  }
  document.querySelector('#photo-file-status').textContent = state.profile.photo === defaultProfile.photo
    ? 'JPG or PNG, up to 8 MB.'
    : 'Current photo saved. Choose another image to update it.';
  document.querySelector('#photo-file-status').classList.remove('error');
  document.querySelector('#crop-controls').hidden = true;
  document.querySelector('#profile-modal').classList.add('open');
  document.querySelector('#profile-modal').setAttribute('aria-hidden', 'false');
  form.elements.name.focus();
}

function closeProfileEditor() {
  document.querySelector('#profile-modal').classList.remove('open');
  document.querySelector('#profile-modal').setAttribute('aria-hidden', 'true');
  document.querySelector('#profile-photo-file').value = '';
  document.querySelector('#crop-controls').hidden = true;
  if (state.cropObjectUrl) URL.revokeObjectURL(state.cropObjectUrl);
  state.cropObjectUrl = null;
}

function clampCropPosition() {
  const viewportSize = document.querySelector('#crop-viewport').clientWidth;
  const image = document.querySelector('#crop-image');
  state.cropLeft = Math.min(0, Math.max(viewportSize - image.clientWidth, state.cropLeft));
  state.cropTop = Math.min(0, Math.max(viewportSize - image.clientHeight, state.cropTop));
  image.style.left = `${state.cropLeft}px`;
  image.style.top = `${state.cropTop}px`;
}

function setCropZoom(zoom, preserveCenter = true) {
  const viewportSize = document.querySelector('#crop-viewport').clientWidth;
  const image = document.querySelector('#crop-image');
  const previousScale = state.cropScale;
  const sourceCenterX = (viewportSize / 2 - state.cropLeft) / previousScale;
  const sourceCenterY = (viewportSize / 2 - state.cropTop) / previousScale;
  state.cropScale = state.cropBaseScale * zoom;
  image.style.width = `${image.naturalWidth * state.cropScale}px`;
  image.style.height = `${image.naturalHeight * state.cropScale}px`;
  if (preserveCenter) {
    state.cropLeft = viewportSize / 2 - sourceCenterX * state.cropScale;
    state.cropTop = viewportSize / 2 - sourceCenterY * state.cropScale;
  } else {
    state.cropLeft = (viewportSize - image.clientWidth) / 2;
    state.cropTop = (viewportSize - image.clientHeight) / 2;
  }
  clampCropPosition();
  document.querySelector('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
}

function loadProfilePhoto(file) {
  const status = document.querySelector('#photo-file-status');
  if (!file) return;
  const supportedMime = ['image/jpeg', 'image/png'].includes(file.type);
  const supportedExtension = /\.(jpe?g|png)$/i.test(file.name);
  if ((file.type && !supportedMime) || (!file.type && !supportedExtension)) {
    status.textContent = 'Choose a JPG or PNG image.';
    status.classList.add('error');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    status.textContent = 'That image is over 8 MB. Choose a smaller photo.';
    status.classList.add('error');
    return;
  }
  if (state.cropObjectUrl) URL.revokeObjectURL(state.cropObjectUrl);
  state.cropObjectUrl = URL.createObjectURL(file);
  const image = document.querySelector('#crop-image');
  image.onload = () => {
    document.querySelector('#crop-controls').hidden = false;
    state.cropBaseScale = document.querySelector('#crop-viewport').clientWidth / Math.min(image.naturalWidth, image.naturalHeight);
    document.querySelector('#crop-zoom').value = '1';
    setCropZoom(1, false);
    status.textContent = `${file.name} · drag the photo to position it.`;
    status.classList.remove('error');
  };
  image.onerror = () => {
    status.textContent = 'This image could not be opened. Choose another JPG or PNG.';
    status.classList.add('error');
  };
  image.src = state.cropObjectUrl;
}

function getCroppedProfilePhoto() {
  const image = document.querySelector('#crop-image');
  const viewportSize = document.querySelector('#crop-viewport').clientWidth;
  const sourceSize = viewportSize / state.cropScale;
  const sourceX = Math.max(0, -state.cropLeft / state.cropScale);
  const sourceY = Math.max(0, -state.cropTop / state.cropScale);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

const resumeSectionAliases = [
  { type: 'experience', title: 'Experience', aliases: ['experience', 'work experience', 'professional experience', 'relevant experience', 'employment', 'employment history'] },
  { type: 'education', title: 'Education', aliases: ['education', 'academic background', 'academics'] },
  { type: 'skills', title: 'Skills', aliases: ['skills', 'technical skills', 'technologies', 'core competencies'] },
  { type: 'projects', title: 'Projects', aliases: ['projects', 'selected projects', 'personal projects'] },
  { type: 'leadership', title: 'Leadership', aliases: ['leadership', 'leadership experience', 'leadership and activities'] },
  { type: 'activities', title: 'Activities', aliases: ['activities', 'extracurricular activities', 'involvement'] },
  { type: 'certifications', title: 'Certifications', aliases: ['certifications', 'certificates'] },
  { type: 'awards', title: 'Awards', aliases: ['awards', 'honors', 'honors & awards'] }
];

const roleTerms = /\b(engineer|developer|manager|director|analyst|intern|assistant|associate|president|chair|lead|coordinator|designer|researcher|consultant|volunteer|teaching|instructor|founder|fellow|captain|editor|tutor|SWE|SDE|QA|UX|TA)\b/i;
const dateToken = '(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+)?(?:19|20)\\d{2}|(?:Present|Current|Now)';
const dateRangePattern = new RegExp(`\\b(${dateToken})\\s*(?:[-–—]|to)\\s*(${dateToken})?\\b`, 'i');
const datePointPattern = /\b(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+)?(?:19|20)\d{2}\b/i;

function normalizeHeading(line) {
  return line.text.toLowerCase().replace(/[&]/g, ' and ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sectionForLine(line) {
  const text = normalizeHeading(line);
  return resumeSectionAliases.find(section => section.aliases.includes(text)) || null;
}

function dateFields(text) {
  const match = text.match(dateRangePattern);
  return match ? { startDate: match[1].trim(), endDate: (match[2] || '').trim() } : null;
}

function cleanResumeText(text) {
  return String(text || '').replace(/^[\s•●▪◦*–—-]+/, '').replace(/\s+/g, ' ').trim();
}

function makeResumeEntry(section, rawText = '') {
  const entry = {
    id: `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    rawText: rawText ? [rawText] : [],
    description: [],
    needsConfirmation: [],
    state: 'pending'
  };
  if (section === 'experience') Object.assign(entry, { organization: '', role: '', location: '', startDate: '', endDate: '' });
  else if (section === 'education') Object.assign(entry, { school: '', degree: '', field: '', graduationDate: '', gpa: '', coursework: [] });
  else if (section === 'skills') Object.assign(entry, { skill: '' });
  else Object.assign(entry, { name: '', organization: '', role: '', location: '', startDate: '', endDate: '' });
  return entry;
}

function addNeedsConfirmation(entry, field) {
  if (!entry.needsConfirmation.includes(field)) entry.needsConfirmation.push(field);
}

function parseHeaderText(entry, section, text) {
  const dates = dateFields(text);
  if (dates) {
    entry.startDate = dates.startDate;
    entry.endDate = dates.endDate;
    text = text.replace(dateRangePattern, '').trim();
  }
  const pieces = text.split(/\s+[|·]\s+|\s{2,}|\s+[–—-]\s+/).map(piece => piece.replace(/^[|·\s]+|[|·\s]+$/g, '').trim()).filter(Boolean);
  for (const piece of pieces) {
    const roleAtOrganization = piece.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (roleAtOrganization && roleTerms.test(roleAtOrganization[1])) {
      entry.role ||= roleAtOrganization[1].trim();
      entry.organization ||= roleAtOrganization[2].trim();
      continue;
    }
    const dates = dateFields(piece);
    if (dates) {
      entry.startDate = dates.startDate;
      entry.endDate = dates.endDate;
      continue;
    }
    const gpa = piece.match(/\bGPA\s*:?\s*([\d.]+(?:\s*\/\s*[\d.]+)?)/i);
    if (gpa && section === 'education') {
      entry.gpa = gpa[1];
      continue;
    }
    if (/\b(remote|hybrid|on[- ]site)\b|,\s*[A-Z]{2}\b/i.test(piece)) {
      entry.location ||= piece;
      continue;
    }
    if (roleTerms.test(piece)) {
      if (section === 'education') entry.degree ||= piece;
      else entry.role ||= piece;
      continue;
    }
    if (section === 'education') entry.school ||= piece;
    else if (section === 'experience') entry.organization ||= piece;
    else entry.name ||= piece;
  }
}

function parseResume(lines) {
  const normalizedLines = lines.map(line => typeof line === 'string' ? { text: line } : line);
  const sizes = normalizedLines.map(line => Number(line.fontSize) || 0).filter(size => size > 0).sort((a, b) => a - b);
  const typicalSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const sections = [];
  const byType = new Map();
  let activeSection = null;
  let currentEntry = null;
  let sectionHeadingSize = 0;

  for (let index = 0; index < normalizedLines.length; index += 1) {
    const line = normalizedLines[index];
    const text = cleanResumeText(line.text);
    if (!text) continue;
    const heading = sectionForLine({ ...line, text });
    const visuallyProminent = Boolean(line.heading || line.bold || (line.fontSize && typicalSize && line.fontSize >= typicalSize * 1.12));
    if (heading && (visuallyProminent || /^[A-Z\s&]+$/.test(text) || line.heading || !line.bold)) {
      activeSection = heading;
      if (!byType.has(heading.type)) {
        const section = { type: heading.type, title: heading.title, entries: [] };
        sections.push(section);
        byType.set(heading.type, section);
      }
      currentEntry = null;
      sectionHeadingSize = Number(line.fontSize) || 0;
      continue;
    }
    if (!activeSection) {
      let otherSection = byType.get('other');
      if (!otherSection) {
        otherSection = { type: 'other', title: 'Other details', entries: [] };
        sections.push(otherSection);
        byType.set('other', otherSection);
      }
      const entry = makeResumeEntry('other', line.text);
      entry.name = text;
      entry.source = { text: line.text, fontSize: line.fontSize || 0, bold: Boolean(line.bold), indent: line.indent || 0, x: line.x || 0 };
      addNeedsConfirmation(entry, 'section');
      otherSection.entries.push(entry);
      continue;
    }
    const section = byType.get(activeSection.type);

    if (activeSection.type === 'skills') {
      const skills = text.replace(/^[A-Za-z &/]{2,28}:\s*/, '').split(/[,;|•·]/).map(skill => skill.trim()).filter(Boolean);
      for (const skill of skills) {
        const entry = makeResumeEntry('skills', skill);
        entry.skill = skill;
        entry.source = { text: line.text, fontSize: line.fontSize || 0, bold: Boolean(line.bold), indent: line.indent || 0 };
        section.entries.push(entry);
      }
      currentEntry = null;
      continue;
    }

    const isBullet = Boolean(line.bullet) || /^[•●▪◦*–—-]\s/.test(String(line.text).trim());
    const withoutBullet = cleanResumeText(text);
    const dates = dateFields(withoutBullet);
    const hasRole = roleTerms.test(withoutBullet);
    const roleAndOrganization = hasRole && /\b(?:at)\s+|@|\s+[|·–—-]\s+/i.test(withoutBullet);
    const isRoleOnly = hasRole && withoutBullet.length < 90 && !/[.!?]$/.test(withoutBullet) && !roleAndOrganization;
    const locationLine = /\b(?:Remote|Hybrid|On[- ]site)\b|\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/i.test(withoutBullet);
    const educationDegree = activeSection.type === 'education' && /\b(?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|Ph\.?D\.?|Bachelor|Master|Doctor|Associate)\b/i.test(withoutBullet);
    const educationMetadata = activeSection.type === 'education' && (dates || datePointPattern.test(withoutBullet) || /\bGPA\b|^\s*(?:relevant )?coursework\s*:/i.test(withoutBullet) || educationDegree || /\b(?:Remote|Hybrid|On[- ]site)\b|,\s*[A-Z]{2}\b/.test(withoutBullet));
    const experienceMetadata = ['experience', 'leadership', 'activities'].includes(activeSection.type) && (dates || locationLine || (isRoleOnly && currentEntry && !currentEntry.role));
    const nextLine = normalizedLines[index + 1] ? cleanResumeText(normalizedLines[index + 1].text) : '';
    const nextHasMetadata = Boolean(dateFields(nextLine) || roleTerms.test(nextLine) || /\b(remote|hybrid|on[- ]site)\b|,\s*[A-Z]{2}\b/i.test(nextLine));
    const smallerBoldEntry = Boolean(line.bold && (!sectionHeadingSize || !line.fontSize || line.fontSize < sectionHeadingSize * 0.98));
    const formattedEntry = Boolean(line.heading || smallerBoldEntry || (line.fontSize && typicalSize && line.fontSize >= typicalSize * 1.12 && !line.bullet));
    const inlineEntry = Boolean(withoutBullet.length < 140 && ((dates && (hasRole || /\b(at|@)\b/i.test(withoutBullet))) || roleAndOrganization));
    const separatedEntry = Boolean(line.blankBefore && withoutBullet.length < 100 && nextHasMetadata);
    const startsEntry = !currentEntry || (!isBullet && !isRoleOnly && !educationMetadata && !experienceMetadata && (formattedEntry || inlineEntry || separatedEntry));

    if (startsEntry && !isBullet) {
      currentEntry = makeResumeEntry(activeSection.type, line.text);
      currentEntry.source = { text: line.text, fontSize: line.fontSize || 0, bold: Boolean(line.bold), indent: line.indent || 0, x: line.x || 0 };
      currentEntry.rawText = [line.text];
      parseHeaderText(currentEntry, activeSection.type, withoutBullet);
      if (activeSection.type === 'experience' && currentEntry.organization === '') addNeedsConfirmation(currentEntry, 'organization');
      if (activeSection.type === 'education' && currentEntry.school === '') addNeedsConfirmation(currentEntry, 'school');
      section.entries.push(currentEntry);
      continue;
    }

    if (!currentEntry) {
      currentEntry = makeResumeEntry(activeSection.type, line.text);
      currentEntry.rawText = [line.text];
      section.entries.push(currentEntry);
      addNeedsConfirmation(currentEntry, 'rawText');
    }
    if (!currentEntry.rawText.includes(line.text)) currentEntry.rawText.push(line.text);

    if (dates) {
      currentEntry.startDate ||= dates.startDate;
      currentEntry.endDate ||= dates.endDate;
    }
    if (activeSection.type === 'education') {
      const gpa = withoutBullet.match(/\bGPA\s*:?\s*([\d.]+(?:\s*\/\s*[\d.]+)?)/i);
      const coursework = withoutBullet.match(/^(?:relevant )?coursework\s*:?\s*(.+)$/i);
      const graduationDate = withoutBullet.match(datePointPattern);
      const fieldMatch = withoutBullet.match(/\b(?:major(?:ing)? in|in)\s+([^,|]+)/i);
      let recognizedEducationField = false;
      if (gpa) {
        currentEntry.gpa ||= gpa[1];
        recognizedEducationField = true;
      }
      if (coursework) {
        currentEntry.coursework.push(...coursework[1].split(/[,;|]/).map(item => item.trim()).filter(Boolean));
        recognizedEducationField = true;
      }
      if (educationDegree) {
        const degreeMarker = withoutBullet.match(/\b(?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|Ph\.?D\.?|Bachelor(?:'s)?(?: of [A-Za-z ]+)?|Master(?:'s)?(?: of [A-Za-z ]+)?|Doctor(?:ate|al)?|Associate(?:'s)?)\b/i);
        currentEntry.degree ||= fieldMatch ? withoutBullet.slice(0, fieldMatch.index).trim() : degreeMarker?.[0] || withoutBullet;
        if (fieldMatch) currentEntry.field ||= fieldMatch[1].trim();
        else if (degreeMarker) currentEntry.field ||= withoutBullet.slice(degreeMarker.index + degreeMarker[0].length).replace(/^[,\s-]+/, '').trim();
        recognizedEducationField = true;
      }
      if (dates || graduationDate) {
        currentEntry.graduationDate ||= dates?.endDate || dates?.startDate || graduationDate[0];
        recognizedEducationField = true;
      }
      if (!recognizedEducationField) {
        currentEntry.rawText.push(line.text);
        addNeedsConfirmation(currentEntry, 'rawText');
      }
    } else if (activeSection.type === 'experience' || activeSection.type === 'leadership' || activeSection.type === 'activities') {
      const location = withoutBullet.match(/\b(?:Remote|Hybrid|On[- ]site)\b|\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/);
      if (location) currentEntry.location ||= location[0];
      if (isRoleOnly && !currentEntry.role) currentEntry.role = withoutBullet;
      else if (isBullet || /[.!?]$/.test(withoutBullet) || withoutBullet.length > 90) currentEntry.description.push(withoutBullet);
      else if (!dates && !location) {
        currentEntry.rawText.push(line.text);
        addNeedsConfirmation(currentEntry, 'rawText');
      }
    } else if (isBullet || withoutBullet.length > 35) {
      currentEntry.description.push(withoutBullet);
    } else {
      currentEntry.rawText.push(line.text);
      addNeedsConfirmation(currentEntry, 'rawText');
    }
  }

  for (const section of sections) {
    for (const entry of section.entries) {
      if (section.type === 'education' && !entry.graduationDate && entry.endDate) entry.graduationDate = entry.endDate;
      if (section.type === 'projects' || section.type === 'certifications' || section.type === 'awards') {
        entry.name ||= entry.organization || entry.rawText[0] || '';
      }
    }
  }
  return {
    version: 1,
    sections,
    lines: normalizedLines.map(line => ({
      text: line.text,
      runs: (line.runs || []).map(run => ({ text: run.text, fontSize: run.fontSize || 0, bold: Boolean(run.bold), x: run.x || 0, gapBefore: run.gapBefore || 0 })),
      page: line.page || 0,
      x: line.x || 0,
      y: line.y || 0,
      fontSize: line.fontSize || 0,
      bold: Boolean(line.bold),
      heading: Boolean(line.heading),
      bullet: Boolean(line.bullet),
      indent: line.indent || 0,
      spacingBefore: line.spacingBefore || 0,
      spacingAfter: line.spacingAfter || 0,
      blankBefore: Boolean(line.blankBefore),
      tableRow: line.tableRow || ''
    }))
  };
}

const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docxChildren(element, localName) {
  return Array.from(element?.children || []).filter(child => child.namespaceURI === DOCX_NS && (!localName || child.localName === localName));
}

function docxValue(element, localName) {
  const child = docxChildren(element, localName)[0];
  return child?.getAttributeNS(DOCX_NS, 'val') || child?.getAttribute('w:val') || '';
}

function docxAttribute(element, localName) {
  return element?.getAttributeNS(DOCX_NS, localName) || element?.getAttribute(`w:${localName}`) || '';
}

function docxBoolean(element, localName) {
  const flag = docxChildren(element, localName)[0];
  if (!flag) return false;
  const value = docxAttribute(flag, 'val').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

function parseDocxParagraph(paragraph, context, styleNames, styleFormatting) {
  const paragraphProperties = docxChildren(paragraph, 'pPr')[0];
  const paragraphStyle = docxValue(paragraphProperties || document.createElement('div'), 'pStyle');
  const styleName = styleNames.get(paragraphStyle) || '';
  const styleFormat = styleFormatting.get(paragraphStyle) || {};
  const indentation = Number(docxAttribute(docxChildren(paragraphProperties || document.createElement('div'), 'ind')[0], 'left')) / 20 || 0;
  const spacing = docxChildren(paragraphProperties || document.createElement('div'), 'spacing')[0];
  const spacingBefore = Number(spacing?.getAttributeNS(DOCX_NS, 'before') || spacing?.getAttribute('w:before') || 0) / 20;
  const runs = [];
  const walk = (node, inherited = {}) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.namespaceURI === DOCX_NS && child.localName === 'r') {
        const properties = docxChildren(child, 'rPr')[0];
        const size = Number(docxValue(properties || document.createElement('div'), 'sz')) / 2 || inherited.fontSize || 0;
        const boldFlag = docxChildren(properties || document.createElement('div'), 'b')[0];
        const bold = boldFlag ? docxBoolean(properties, 'b') : Boolean(inherited.bold);
        walk(child, { fontSize: size, bold });
      } else if (child.namespaceURI === DOCX_NS && child.localName === 't') {
        if (child.textContent) runs.push({ text: child.textContent, ...inherited });
      } else if (child.namespaceURI === DOCX_NS && child.localName === 'tab') {
        runs.push({ text: '    ', ...inherited });
      } else if (child.namespaceURI === DOCX_NS && child.localName === 'br') {
        runs.push({ text: '\n', ...inherited });
      } else {
        walk(child, inherited);
      }
    }
  };
  walk(paragraph, { fontSize: styleFormat.fontSize || 0, bold: Boolean(styleFormat.bold) });
  const text = runs.map(run => run.text).join('').trim();
  if (!text) return [];
  const fontSize = Math.max(styleFormat.fontSize || 0, ...runs.map(run => run.fontSize || 0));
  const bold = runs.some(run => run.bold) || styleFormat.bold || /heading|title/i.test(styleName);
  const bullet = Boolean(docxChildren(paragraphProperties || document.createElement('div'), 'numPr').length);
  const fragments = text.split('\n').map(value => value.trim()).filter(Boolean);
  return fragments.map((fragment, index) => ({
    text: fragment,
    runs,
    fontSize,
    bold,
    heading: /heading|title/i.test(styleName) || Boolean(docxChildren(paragraphProperties || document.createElement('div'), 'outlineLvl').length),
    bullet,
    indent: indentation + (context.column || 0) * 120,
    x: (context.column || 0) * 120,
    spacingBefore: index === 0 ? spacingBefore : 0,
    spacingAfter: Number(spacing?.getAttributeNS(DOCX_NS, 'after') || spacing?.getAttribute('w:after') || 0) / 20,
    spacingBefore: spacingBefore,
    blankBefore: spacingBefore >= 8 || index > 0,
    tableRow: context.tableRow || '',
    page: 0
  }));
}

function parseDocxLayout(documentXml, stylesXml) {
  const xmlParser = new DOMParser();
  const wordDocument = xmlParser.parseFromString(documentXml, 'application/xml');
  const stylesDocument = xmlParser.parseFromString(stylesXml || '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'application/xml');
  if (wordDocument.querySelector('parsererror')) throw new Error('The DOCX document could not be read.');
  const styleNames = new Map();
  const styleFormatting = new Map();
  for (const style of Array.from(stylesDocument.getElementsByTagNameNS(DOCX_NS, 'style'))) {
    const id = style.getAttributeNS(DOCX_NS, 'styleId') || style.getAttribute('w:styleId');
    const name = docxChildren(style, 'name')[0]?.getAttributeNS(DOCX_NS, 'val') || '';
    const properties = docxChildren(style, 'rPr')[0];
    if (id) {
      styleNames.set(id, name);
      styleFormatting.set(id, {
        fontSize: Number(docxValue(properties || document.createElement('div'), 'sz')) / 2 || 0,
        bold: docxBoolean(properties, 'b'),
        basedOn: docxValue(style, 'basedOn')
      });
    }
  }
  const resolveStyle = (id, seen = new Set()) => {
    if (!id || seen.has(id)) return {};
    seen.add(id);
    const style = styleFormatting.get(id) || {};
    const inherited = resolveStyle(style.basedOn, seen);
    return { ...inherited, ...style, fontSize: style.fontSize || inherited.fontSize || 0, bold: style.bold || inherited.bold || false };
  };
  for (const id of styleFormatting.keys()) styleFormatting.set(id, resolveStyle(id));
  const body = wordDocument.getElementsByTagNameNS(DOCX_NS, 'body')[0];
  if (!body) throw new Error('The DOCX document has no readable body.');
  const lines = [];
  let rowIndex = 0;
  const walkBlocks = (container, context = {}) => {
    for (const child of docxChildren(container)) {
      if (child.localName === 'p') {
        lines.push(...parseDocxParagraph(child, context, styleNames, styleFormatting));
      } else if (child.localName === 'tbl') {
        const rows = docxChildren(child, 'tr');
        rows.forEach(row => {
          rowIndex += 1;
          docxChildren(row, 'tc').forEach((cell, column) => walkBlocks(cell, { column, tableRow: `table-${rowIndex}` }));
        });
      } else if (child.localName === 'sdt' || child.localName === 'customXml') {
        const content = docxChildren(child, 'sdtContent')[0] || child;
        walkBlocks(content, context);
      }
    }
  };
  walkBlocks(body);
  return lines;
}

async function extractPdfLayout(file) {
  if (!window.pdfjsLib) throw new Error('PDF support could not load. Try a DOCX or TXT file instead.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, pageIndex) => {
    const page = await pdf.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const styles = content.styles || {};
    const positioned = content.items.filter(item => item.str?.trim()).map(item => {
      const transform = item.transform || [];
      const fontSize = Math.hypot(transform[0] || 0, transform[1] || 0) || Math.abs(transform[3] || 0);
      const styleName = `${item.fontName || ''} ${styles[item.fontName]?.fontFamily || ''}`;
      return { text: item.str, x: transform[4] || 0, y: transform[5] || 0, width: item.width || 0, fontSize, bold: /bold|black|heavy|demi|semibold/i.test(styleName) };
    }).sort((a, b) => b.y - a.y || a.x - b.x);
    const groups = [];
    for (const token of positioned) {
      const threshold = Math.max(2, token.fontSize * 0.24);
      let group = groups.find(candidate => Math.abs(candidate.y - token.y) <= Math.max(threshold, candidate.threshold));
      if (!group) {
        group = { y: token.y, threshold, tokens: [] };
        groups.push(group);
      }
      group.tokens.push(token);
    }
    groups.sort((a, b) => b.y - a.y);
    const pageMinX = positioned.length ? Math.min(...positioned.map(token => token.x)) : 0;
    return groups.map((group, index) => {
      const tokens = group.tokens.sort((a, b) => a.x - b.x);
      let text = '';
      let previousRight = null;
      for (const token of tokens) {
        const gap = previousRight === null ? 0 : token.x - previousRight;
        if (text && gap > Math.max(1, token.fontSize * 3)) text += ' | ';
        else if (text && gap > token.fontSize * 0.12 && !/\s$/.test(text)) text += ' ';
        text += token.text;
        previousRight = token.x + token.width;
      }
      const fontSize = Math.max(0, ...tokens.map(token => token.fontSize));
      return {
        text: text.trim(),
        runs: tokens.map((token, tokenIndex) => ({ text: token.text, fontSize: token.fontSize, bold: token.bold, x: token.x, gapBefore: tokenIndex ? token.x - (tokens[tokenIndex - 1].x + tokens[tokenIndex - 1].width) : 0 })),
        fontSize,
        bold: tokens.some(token => token.bold),
        x: tokens[0]?.x || 0,
        y: group.y,
        indent: (tokens[0]?.x || pageMinX) - pageMinX,
        spacingBefore: index > 0 ? Math.abs(groups[index - 1].y - group.y) : 0,
        blankBefore: index > 0 && Math.abs(groups[index - 1].y - group.y) > fontSize * 1.5,
        page: pageIndex + 1
      };
    });
  }));
  return pages.flat();
}

async function extractResumeLayout(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt') {
    return (await file.text()).split(/\r?\n/).map((text, index, lines) => ({
      text,
      fontSize: 0,
      bold: false,
      indent: (text.match(/^\s*/) || [''])[0].length,
      bullet: /^\s*[•●▪◦*-]\s/.test(text),
      blankBefore: index > 0 && !lines[index - 1].trim(),
      page: 0
    }));
  }
  if (extension === 'pdf') return extractPdfLayout(file);
  if (extension === 'docx') {
    if (!window.JSZip) throw new Error('DOCX structure support could not load. Try a PDF or TXT file instead.');
    const archive = await window.JSZip.loadAsync(await file.arrayBuffer());
    const documentFile = archive.file('word/document.xml');
    if (!documentFile) throw new Error('The DOCX document body could not be found.');
    const documentXml = await documentFile.async('text');
    const stylesFile = archive.file('word/styles.xml');
    const stylesXml = stylesFile ? await stylesFile.async('text') : '';
    return parseDocxLayout(documentXml, stylesXml);
  }
  throw new Error('Choose a PDF, DOCX, or TXT resume.');
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    uploadStatus.textContent = 'That file is over 10 MB. Choose a smaller resume.';
    uploadStatus.classList.add('error');
    return;
  }
  uploadStatus.classList.remove('error');
  uploadStatus.textContent = 'Reading your resume...';
  try {
    const layout = await extractResumeLayout(file);
    const parsed = parseResume(layout);
    const entryCount = parsed.sections.reduce((total, section) => total + section.entries.length, 0);
    if (!entryCount) throw new Error('We could not identify resume sections. Try a text-based resume or add details manually.');
    state.resumeData = parsed;
    const sectionLabels = new Set(parsed.sections.map(section => section.title.toLowerCase()));
    state.items = state.items.filter(item => !sectionLabels.has(item.label.toLowerCase()));
    renderItems();
    closeUpload();
    showToast(`Found ${entryCount} structured entries. Review them before they appear on your profile.`);
  } catch (error) {
    uploadStatus.textContent = error.message || 'Could not read that file. Try another format.';
    uploadStatus.classList.add('error');
  }
}

function setView(view) {
  const target = view || 'home';
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === target);
  });

  const showingSurfGrid = target === 'surf-grid';
  const showingNetwork = target === 'network';
  const showingProfile = target === 'profile';
  const showingGroups = target === 'groups';
  const showingOpportunities = target === 'opportunities';
  const showingMessages = target === 'messages';

  document.querySelector('#dashboard-content').hidden = showingSurfGrid || showingProfile || showingNetwork || showingGroups || showingOpportunities || showingMessages;
  document.querySelector('#network-view').hidden = !showingNetwork;
  document.querySelector('#profile-view').hidden = !showingProfile;
  document.querySelector('#groups-view').hidden = !showingGroups;
  document.querySelector('#opportunities-view').hidden = !showingOpportunities;
  document.querySelector('#messages-view').hidden = !showingMessages;
  document.querySelector('#surf-grid-view').hidden = !showingSurfGrid;

  const labels = { home: 'Overview', profile: 'My profile', network: 'My Grid', groups: 'Groups', 'surf-grid': 'Surf the Grid', opportunities: 'Opportunities', messages: 'Messages' };
  document.querySelector('#breadcrumb-current').textContent = labels[target] || 'Overview';

  if (target === 'profile') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (target === 'network') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (target === 'groups') {
    document.querySelector('#groups-list-view').hidden = false;
    document.querySelector('#group-detail-view').hidden = true;
    renderGroups();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (target === 'opportunities') {
    renderOpportunities();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (target === 'messages') {
    renderMessages();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (target === 'home') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (target === 'surf-grid') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

reviewList.addEventListener('click', event => {
  const action = event.target.closest('button');
  const skillsGroup = event.target.closest('.resume-skills-review');
  if (skillsGroup && (action?.classList.contains('resume-action') || action?.classList.contains('skill-add'))) {
    const section = state.resumeData.sections.find(candidate => candidate.type === 'skills');
    if (!section) return;
    if (action.classList.contains('edit-skills')) {
      state.editingSkills = true;
      renderItems();
      reviewList.querySelector('.resume-skill-input')?.focus();
      return;
    }
    if (action.classList.contains('skill-add')) {
      section.entries.push(makeResumeEntry('skills'));
      state.editingSkills = true;
      renderItems();
      reviewList.querySelectorAll('.resume-skill-input')[section.entries.length - 1]?.focus();
      return;
    }
    if (action.classList.contains('remove-skill')) {
      section.entries = section.entries.filter(entry => entry.id !== action.dataset.skillId);
      renderItems();
      return;
    }
    if (action.classList.contains('save-skills')) {
      skillsGroup.querySelectorAll('.resume-skill-input').forEach(input => {
        const entry = section.entries.find(candidate => candidate.id === input.dataset.skillId);
        const skill = input.value.trim();
        if (!entry) return;
        if (!skill) {
          section.entries = section.entries.filter(candidate => candidate.id !== entry.id);
        } else {
          if (entry.skill !== skill) entry.state = 'pending';
          entry.skill = skill;
        }
      });
      section.entries = section.entries.filter(entry => entry.skill.trim());
      state.editingSkills = false;
    } else if (action.classList.contains('cancel-skills')) {
      section.entries = section.entries.filter(entry => entry.skill.trim());
      state.editingSkills = false;
    } else if (action.classList.contains('approve-skills')) {
      const allApproved = section.entries.every(entry => entry.state === 'approved');
      section.entries.forEach(entry => { entry.state = allApproved ? 'pending' : 'approved'; });
    }
    renderItems();
    return;
  }
  const resumeCard = event.target.closest('.resume-entry');
  if (action?.classList.contains('resume-action') && resumeCard) {
    const section = state.resumeData.sections.find(candidate => candidate.type === resumeCard.dataset.resumeSection);
    const entry = section?.entries.find(candidate => candidate.id === resumeCard.dataset.entryId);
    if (!entry) return;
    if (action.classList.contains('edit-structured')) {
      entry.state = 'editing';
      renderItems();
      reviewList.querySelector(`[data-entry-id="${CSS.escape(entry.id)}"] [data-entry-field]`)?.focus();
      return;
    }
    if (action.classList.contains('save-structured')) {
      resumeCard.querySelectorAll('[data-entry-field]').forEach(field => {
        if (field.dataset.entryField === 'description') entry.description = field.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        else if (field.dataset.entryField === 'coursework') entry.coursework = field.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        else if (field.dataset.entryField === 'rawText') entry.rawText = field.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        else entry[field.dataset.entryField] = field.value.trim();
      });
      entry.needsConfirmation = (entry.needsConfirmation || []).filter(field => !resumeEntryFields(section, entry).some(([key]) => key === field));
      entry.state = 'pending';
      showToast('Entry changes saved. Confirm it when the details look right.');
    } else if (action.classList.contains('approve-structured')) {
      entry.state = entry.state === 'approved' ? 'pending' : 'approved';
    } else if (action.classList.contains('reject-structured')) {
      section.entries = section.entries.filter(candidate => candidate.id !== entry.id);
    }
    renderItems();
    return;
  }
  const row = event.target.closest('.review-item');
  if (!action || !row) return;
  const item = state.items.find(candidate => candidate.id === row.dataset.id);
  if (!item) return;
  if (action.classList.contains('approve')) item.state = item.state === 'approved' ? 'pending' : 'approved';
  if (action.classList.contains('reject')) state.items = state.items.filter(candidate => candidate.id !== item.id);
  if (action.classList.contains('edit')) {
    item.state = 'editing';
    renderItems();
    const input = reviewList.querySelector(`[data-id="${CSS.escape(item.id)}"] .review-value`);
    input.innerHTML = `<input class="edit-input" aria-label="Edit ${escapeHTML(item.label)}" value="${escapeHTML(item.value)}" />`;
    input.querySelector('input').focus();
    return;
  }
  if (action.classList.contains('save-edit')) {
    const input = row.querySelector('input');
    item.value = input.value.trim() || item.value;
    item.state = 'pending';
    showToast('Your changes are saved. Approve the detail when it looks right.');
  }
  renderItems();
});

reviewList.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('.resume-skill-input')) {
    event.preventDefault();
    event.target.closest('.resume-skills-review').querySelector('.save-skills').click();
  }
  if (event.key === 'Escape' && event.target.matches('.resume-skill-input')) {
    event.target.closest('.resume-skills-review').querySelector('.cancel-skills').click();
    return;
  }
  if (event.key === 'Enter' && event.target.matches('.resume-edit-fields input')) event.target.closest('.resume-entry').querySelector('.save-structured').click();
  if (event.key === 'Escape' && event.target.closest('.resume-entry.is-editing')) {
    const entry = event.target.closest('.resume-entry');
    const section = state.resumeData.sections.find(candidate => candidate.type === entry.dataset.resumeSection);
    const savedEntry = section?.entries.find(candidate => candidate.id === entry.dataset.entryId);
    if (savedEntry) savedEntry.state = 'pending';
    renderItems();
    return;
  }
  if (event.key === 'Enter' && event.target.matches('.edit-input')) event.target.closest('.review-item').querySelector('.save-edit').click();
  if (event.key === 'Escape' && event.target.matches('.edit-input')) {
    const item = state.items.find(candidate => candidate.id === event.target.closest('.review-item').dataset.id);
    item.state = 'pending';
    renderItems();
  }
});

document.querySelector('#add-item').addEventListener('click', () => {
  const id = `added-${Date.now()}`;
  state.items.push({ id, label: 'New detail', value: 'Add something you want people to know', state: 'editing' });
  renderItems();
  const row = reviewList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const label = row.querySelector('.review-label');
  const value = row.querySelector('.review-value');
  label.innerHTML = '<input class="edit-input label-input" aria-label="Detail type" value="New detail" />';
  value.innerHTML = '<input class="edit-input value-input" aria-label="Detail" placeholder="Type a detail" />';
  row.querySelector('.review-actions').innerHTML = `<button class="review-action save-new" aria-label="Save detail">${icon('check')}</button>`;
  row.querySelector('.label-input').focus();
  refreshIcons();
});

reviewList.addEventListener('click', event => {
  if (!event.target.closest('.save-new')) return;
  const row = event.target.closest('.review-item');
  const item = state.items.find(candidate => candidate.id === row.dataset.id);
  const label = row.querySelector('.label-input').value.trim() || 'Detail';
  const value = row.querySelector('.value-input').value.trim();
  if (!value) { showToast('Add a detail before saving.'); return; }
  item.label = label;
  item.value = value;
  item.state = 'pending';
  renderItems();
});

document.querySelector('#people-list').addEventListener('click', event => {
  const button = event.target.closest('.connect-button');
  if (!button) return;
  const id = button.closest('[data-person]').dataset.person;
  if (state.connected.has(id)) {
    state.connected.delete(id);
    showToast('Connection request withdrawn.');
  } else {
    state.connected.add(id);
    showToast('Connection request sent. Your network is growing.');
  }
  persist();
  renderPeople();
});

document.querySelector('#new-message-trigger').addEventListener('click', () => {
  state.messagePickerOpen = !state.messagePickerOpen;
  syncMessagePickerState();
  renderMessages();
});
document.querySelector('#message-picker-close').addEventListener('click', () => {
  state.messagePickerOpen = false;
  syncMessagePickerState();
  renderMessages();
});
document.querySelector('#message-picker-list').addEventListener('click', event => {
  const button = event.target.closest('[data-start-person]');
  if (!button) return;
  ensureMessageThread(button.dataset.startPerson);
});
document.querySelector('#message-thread-list').addEventListener('click', event => {
  const button = event.target.closest('[data-message-thread]');
  if (!button) return;
  state.activeMessageThreadId = button.dataset.messageThread;
  renderMessages();
});
document.querySelector('#suggestion-list').addEventListener('click', event => {
  const button = event.target.closest('[data-suggestion-action]');
  if (!button) return;
  const activeThread = state.messageThreads.find(thread => thread.id === state.activeMessageThreadId) || state.messageThreads[0];
  if (!activeThread) return;
  const index = Number(button.dataset.suggestionIndex);
  const messages = generateOpeners(activeThread.personId);
  const suggestion = messages[index] || messages[0];
  if (button.dataset.suggestionAction === 'use') {
    activeThread.messages.push({ sender: 'me', text: suggestion, time: 'just now' });
    persistMessageThreads();
    renderMessages();
    return;
  }
  if (button.dataset.suggestionAction === 'edit') {
    document.querySelector('#message-input').value = suggestion;
    document.querySelector('#message-input').focus();
    return;
  }
  const replacement = generateOpeners(activeThread.personId)[(index + 1) % messages.length];
  const cards = document.querySelectorAll('.suggestion-card p');
  if (cards[index]) cards[index].textContent = replacement;
});
document.querySelector('#message-compose-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#message-input');
  const text = input.value.trim();
  if (!text) return;
  const activeThread = state.messageThreads.find(thread => thread.id === state.activeMessageThreadId) || state.messageThreads[0];
  if (!activeThread) return;
  activeThread.messages.push({ sender: 'me', text, time: 'just now' });
  input.value = '';
  persistMessageThreads();
  renderMessages();
});
document.querySelector('#messages-search').addEventListener('input', renderMessages);

document.querySelectorAll('.save-opportunity').forEach(button => {
  const id = button.closest('.opportunity-item').querySelector('strong').textContent;
  if (state.saved.has(id)) button.classList.add('saved');
  button.addEventListener('click', () => {
    if (state.saved.has(id)) {
      state.saved.delete(id);
      button.classList.remove('saved');
      showToast('Opportunity removed from saved.');
    } else {
      state.saved.add(id);
      button.classList.add('saved');
      showToast('Opportunity saved for later.');
    }
    persist();
  });
});

const groupsView = document.querySelector('#groups-view');
groupsView.addEventListener('click', event => {
  const filter = event.target.closest('[data-group-filter]');
  if (filter) {
    state.activeGroupFilter = filter.dataset.groupFilter;
    groupsView.querySelectorAll('.group-filter').forEach(button => {
      const active = button === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderGroups();
    return;
  }

  const joinButton = event.target.closest('[data-group-action]');
  if (joinButton) {
    const group = allGroups().find(candidate => candidate.id === joinButton.dataset.groupAction);
    if (!group) return;
    state.groupMemberships[group.id] = group.access === 'open' ? 'Member' : 'Pending';
    persist();
    renderGroups();
    showToast(group.access === 'open' ? 'You joined the group.' : 'Your request to join was sent.');
    return;
  }

  const groupLink = event.target.closest('[data-group-open]');
  if (groupLink) {
    renderGroupDetail(groupLink.dataset.groupOpen);
    return;
  }

  if (event.target.closest('[data-groups-back]')) {
    document.querySelector('#group-detail-view').hidden = true;
    document.querySelector('#groups-list-view').hidden = false;
    renderGroups();
  }
});

document.querySelector('#groups-search').addEventListener('input', renderGroups);
const groupCreateModal = document.querySelector('#group-create-modal');
function closeGroupCreate() {
  groupCreateModal.classList.remove('open');
  groupCreateModal.setAttribute('aria-hidden', 'true');
}
document.querySelector('#groups-create-open').addEventListener('click', () => {
  groupCreateModal.classList.add('open');
  groupCreateModal.setAttribute('aria-hidden', 'false');
  document.querySelector('#group-create-form').elements.name.focus();
});
document.querySelector('#group-create-close').addEventListener('click', closeGroupCreate);
document.querySelector('#group-create-cancel').addEventListener('click', closeGroupCreate);
groupCreateModal.addEventListener('click', event => {
  if (event.target === groupCreateModal) closeGroupCreate();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && groupCreateModal.classList.contains('open')) closeGroupCreate();
});
document.querySelector('#group-create-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const type = form.elements.type.value;
  const group = {
    id: `created-${Date.now()}`,
    name: form.elements.name.value.trim(),
    type,
    memberCount: 1,
    verified: false,
    access: form.elements.access.value,
    icon: groupTypeIcons[type] || 'users',
    description: form.elements.description.value.trim() || 'A community connected through Pipeline.',
    memberIds: [],
    relatedGroupIds: [],
    gridNodeIds: []
  };
  state.createdGroups.unshift(group);
  state.groupMemberships[group.id] = 'Admin';
  persist();
  form.reset();
  closeGroupCreate();
  renderGroups();
  showToast('Your group has been created.');
});

const opportunitiesView = document.querySelector('#opportunities-view');
function handleOpportunityClick(event) {
  const viewButton = event.target.closest('[data-opportunity-view]');
  if (viewButton) {
    openOpportunityDetail(viewButton.dataset.opportunityView);
    return;
  }
  const exploreButton = event.target.closest('[data-opportunity-explore]');
  if (exploreButton) {
    exploreOpportunityConnections(exploreButton.dataset.opportunityExplore);
    return;
  }
  const saveButton = event.target.closest('[data-opportunity-save]');
  if (saveButton) {
    const nowSaved = toggleOpportunityCollection(state.savedOpportunities, 'orbit-saved-opportunities', saveButton.dataset.opportunitySave);
    if (nowSaved === null) return;
    renderOpportunities();
    if (state.openOpportunityId) renderOpportunityDetail(state.openOpportunityId);
    showToast(nowSaved ? 'Opportunity saved for later.' : 'Opportunity removed from saved.');
    return;
  }
  const interestButton = event.target.closest('[data-opportunity-interest]');
  if (interestButton) {
    const nowInterested = toggleOpportunityCollection(state.interestedOpportunities, 'orbit-interested-opportunities', interestButton.dataset.opportunityInterest);
    if (nowInterested === null) return;
    renderOpportunityDetail(state.openOpportunityId);
    showToast(nowInterested ? 'Interest noted on this device. It is not sent to the poster in this prototype.' : 'Interest removed.');
  }
}
opportunitiesView.addEventListener('click', event => {
  const tab = event.target.closest('[data-opportunity-tab]');
  if (tab) {
    state.opportunityFilters.tab = tab.dataset.opportunityTab;
    renderOpportunities();
    return;
  }
  if (event.target.closest('#opp-saved-toggle')) {
    state.opportunityFilters.savedOnly = !state.opportunityFilters.savedOnly;
    renderOpportunities();
    return;
  }
  if (event.target.closest('#opp-clear-filters')) {
    state.opportunityFilters = { tab: 'for-you', search: '', location: 'all', type: 'all', industry: 'all', sort: state.opportunityFilters.sort, savedOnly: false };
    document.querySelector('#opportunities-search').value = '';
    renderOpportunities();
    return;
  }
  handleOpportunityClick(event);
});
opportunityDetailModal.addEventListener('click', event => {
  if (event.target === opportunityDetailModal) closeOpportunityDetail();
  else handleOpportunityClick(event);
});
document.querySelector('#opportunity-detail-close').addEventListener('click', closeOpportunityDetail);
document.querySelectorAll('[data-opportunity-select]').forEach(select => {
  select.addEventListener('change', () => {
    state.opportunityFilters[select.dataset.opportunitySelect] = select.value;
    renderOpportunities();
  });
});
document.querySelector('#opportunities-search').addEventListener('input', event => {
  state.opportunityFilters.search = event.target.value;
  renderOpportunities();
});

const opportunityCreateModal = document.querySelector('#opportunity-create-modal');
function closeOpportunityCreate() {
  opportunityCreateModal.classList.remove('open');
  opportunityCreateModal.setAttribute('aria-hidden', 'true');
}
document.querySelector('#opportunity-create-open').addEventListener('click', () => {
  opportunityCreateModal.classList.add('open');
  opportunityCreateModal.setAttribute('aria-hidden', 'false');
  document.querySelector('#opportunity-create-form').elements.title.focus();
});
document.querySelector('#opportunity-create-close').addEventListener('click', closeOpportunityCreate);
document.querySelector('#opportunity-create-cancel').addEventListener('click', closeOpportunityCreate);
opportunityCreateModal.addEventListener('click', event => {
  if (event.target === opportunityCreateModal) closeOpportunityCreate();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (opportunityCreateModal.classList.contains('open')) closeOpportunityCreate();
  else if (opportunityDetailModal.classList.contains('open')) closeOpportunityDetail();
});
document.querySelector('#opportunity-create-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const rawUrl = form.elements.url.value.trim();
  let url = '';
  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported link protocol.');
      url = parsedUrl.href;
    } catch {
      showToast('Enter a valid web link beginning with http:// or https://.');
      form.elements.url.focus();
      return;
    }
  }
  const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 10);
  const category = form.elements.category.value;
  const organization = form.elements.organization.value.trim();
  const post = {
    id: `posted-${Date.now()}`,
    kind: jobCategories.includes(category) ? 'job' : 'group',
    category,
    title: form.elements.title.value.trim(),
    organization,
    location: form.elements.location.value.trim(),
    arrangement: form.elements.arrangement.value,
    industry: form.elements.industry.value,
    description: form.elements.description.value.trim(),
    skills: form.elements.skills.value.split(/[,;]/).map(skill => skill.trim().slice(0, 30)).filter(Boolean).slice(0, 8),
    responsibilities: lines(form.elements.responsibilities.value),
    qualifications: lines(form.elements.qualifications.value),
    author: state.profile.name || organization,
    url,
    createdAt: new Date().toISOString().slice(0, 10)
  };
  state.opportunityPosts.unshift(post);
  try {
    localStorage.setItem('orbit-opportunity-posts', JSON.stringify(state.opportunityPosts));
  } catch {
    state.opportunityPosts.shift();
    showToast('Your opportunity could not be published. Free up browser storage and try again.');
    return;
  }
  form.reset();
  closeOpportunityCreate();
  state.opportunityFilters = { tab: 'all', search: '', location: 'all', type: 'all', industry: 'all', sort: 'recent', savedOnly: false };
  document.querySelector('#opportunities-search').value = '';
  setView('opportunities');
  showToast('Your opportunity has been published.');
});

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    const view = button.dataset.view;
    if (view) setView(view);
  });
});
document.querySelector('#guide-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#guide-input');
  sendGuideQuery(input.value);
  input.value = '';
});
document.querySelectorAll('[data-guide-prompt]').forEach(button => {
  button.addEventListener('click', () => sendGuideQuery(button.dataset.guidePrompt));
});
document.querySelector('#map-filter').addEventListener('change', renderNetworkMap);
document.querySelector('#map-search').addEventListener('input', renderNetworkMap);
document.querySelector('#map-search').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const query = event.currentTarget.value.trim().toLowerCase();
  if (!query) return;
  const node = gridNodes.find(candidate => `${candidate.name} ${candidate.meta}`.toLowerCase().includes(query));
  if (node) selectGridNode(node.id);
});
document.querySelector('#grid-nodes').addEventListener('click', event => {
  const button = event.target.closest('.grid-node');
  if (button) selectGridNode(button.dataset.nodeId);
});
document.querySelector('#drawer-close').addEventListener('click', () => {
  const previousNode = state.selectedGridNode;
  selectGridNode(null);
  document.querySelector(`[data-node-id="${CSS.escape(previousNode)}"]`)?.focus();
});
document.querySelector('#drawer-related-list').addEventListener('click', event => {
  const button = event.target.closest('[data-related-node]');
  if (button) selectGridNode(button.dataset.relatedNode);
});
document.querySelector('#drawer-guide-button').addEventListener('click', () => {
  const node = gridNodes.find(candidate => candidate.id === state.selectedGridNode);
  if (node) sendGuideQuery(`Tell me more about ${node.name}`);
});
document.querySelector('#zoom-in').addEventListener('click', () => {
  state.gridZoom = Math.min(1.45, Math.round((state.gridZoom + 0.15) * 100) / 100);
  renderNetworkMap();
});
document.querySelector('#zoom-out').addEventListener('click', () => {
  state.gridZoom = Math.max(0.75, Math.round((state.gridZoom - 0.15) * 100) / 100);
  renderNetworkMap();
});
document.querySelector('#zoom-reset').addEventListener('click', () => {
  state.gridZoom = 1;
  renderNetworkMap();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.selectedGridNode && !modal.classList.contains('open')) selectGridNode(null);
});
document.querySelector('#upload-open').addEventListener('click', openUpload);
document.querySelector('#upload-inline').addEventListener('click', openUpload);
document.querySelector('#profile-edit').addEventListener('click', openProfileEditor);
document.querySelector('#profile-modal-close').addEventListener('click', closeProfileEditor);
document.querySelector('#profile-cancel').addEventListener('click', closeProfileEditor);
document.querySelector('#profile-modal').addEventListener('click', event => {
  if (event.target === event.currentTarget) closeProfileEditor();
});
document.querySelector('#profile-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  if (!name) {
    showToast('Enter your name before saving your profile.');
    form.elements.name.focus();
    return;
  }
  const previousProfile = state.profile;
  state.profile = {
    ...state.profile,
    name,
    headline: form.elements.headline.value.trim(),
    location: form.elements.location.value.trim(),
    school: form.elements.school.value.trim(),
    bio: form.elements.bio.value.trim()
  };
  try {
    if (!document.querySelector('#crop-controls').hidden) state.profile.photo = getCroppedProfilePhoto();
    persist();
  } catch {
    state.profile = previousProfile;
    showToast('Your profile could not be saved. Free up browser storage and try again.');
    return;
  }
  applyProfile();
  if (state.selectedGridNode === 'truman') selectGridNode('truman');
  renderNetworkMap();
  closeProfileEditor();
  showToast('Your profile has been updated.');
});
document.querySelector('#profile-photo-file').addEventListener('change', event => loadProfilePhoto(event.target.files[0]));
document.querySelector('.photo-select').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  document.querySelector('#profile-photo-file').click();
});
document.querySelector('#crop-zoom').addEventListener('input', event => setCropZoom(Number(event.target.value)));
document.querySelector('#crop-viewport').addEventListener('pointerdown', event => {
  if (document.querySelector('#crop-controls').hidden) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  state.cropPointer = { x: event.clientX, y: event.clientY, left: state.cropLeft, top: state.cropTop };
});
document.querySelector('#crop-viewport').addEventListener('pointermove', event => {
  if (!state.cropPointer) return;
  state.cropLeft = state.cropPointer.left + event.clientX - state.cropPointer.x;
  state.cropTop = state.cropPointer.top + event.clientY - state.cropPointer.y;
  clampCropPosition();
});
document.querySelector('#crop-viewport').addEventListener('pointerup', () => { state.cropPointer = null; });
document.querySelector('#crop-viewport').addEventListener('pointercancel', () => { state.cropPointer = null; });
document.querySelector('#modal-close').addEventListener('click', closeUpload);
modal.addEventListener('click', event => { if (event.target === modal) closeUpload(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) closeUpload(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.querySelector('#profile-modal').classList.contains('open')) closeProfileEditor();
});
document.querySelector('#resume-file').addEventListener('change', event => handleFile(event.target.files[0]));

document.querySelector('#drop-zone').addEventListener('dragover', event => { event.preventDefault(); event.currentTarget.classList.add('dragging'); });
document.querySelector('#drop-zone').addEventListener('dragleave', event => event.currentTarget.classList.remove('dragging'));
document.querySelector('#drop-zone').addEventListener('drop', event => {
  event.preventDefault();
  event.currentTarget.classList.remove('dragging');
  handleFile(event.dataTransfer.files[0]);
});

document.querySelector('#global-search').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const query = event.target.value.trim().toLowerCase();
  if (!query) return;
  const match = people.find(person => `${person.name} ${person.role} ${person.context}`.toLowerCase().includes(query));
  if (match) {
    setView('network');
    showToast(`${match.name} is in your suggested network.`);
  } else {
    showToast('No matches yet. Try a name, company, or role.');
  }
});

document.querySelector('.notification-button').addEventListener('click', () => showToast('You are all caught up on notifications.'));
document.querySelector('.sidebar-user').addEventListener('click', () => showToast('Account settings are coming soon.'));
document.querySelector('.top-avatar').addEventListener('click', () => setView('profile'));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); setView('home'); });

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.querySelector('#global-search').focus();
  }
});

renderItems();
renderPeople();
renderGroups();
applyProfile();
renderNetworkMap();
refreshIcons();
