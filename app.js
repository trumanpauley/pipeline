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

const state = {
  items: loadItems(),
  connected: new Set(JSON.parse(localStorage.getItem('orbit-connected') || '[]')),
  saved: new Set(JSON.parse(localStorage.getItem('orbit-saved') || '[]')),
  toastTimer: null,
  selectedGridNode: null,
  gridZoom: 1
};

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

function persist() {
  localStorage.setItem('orbit-items', JSON.stringify(state.items));
  localStorage.setItem('orbit-connected', JSON.stringify([...state.connected]));
  localStorage.setItem('orbit-saved', JSON.stringify([...state.saved]));
}

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function renderItems() {
  reviewList.innerHTML = '';
  const pendingCount = state.items.filter(item => item.state === 'pending').length;
  const pill = document.querySelector('#review-count');
  pill.textContent = pendingCount ? `${pendingCount} to review` : 'All caught up';
  pill.classList.toggle('complete', pendingCount === 0);

  if (!state.items.length) {
    reviewList.innerHTML = '<div class="empty-review">No details yet. Upload a resume or add a detail to get started.</div>';
    persist();
    refreshIcons();
    return;
  }

  state.items.forEach(item => {
    const row = document.createElement('div');
    row.className = `review-item ${item.state}`;
    row.dataset.id = item.id;
    row.innerHTML = `<span class="review-label">${escapeHTML(item.label)}</span><span class="review-value">${escapeHTML(item.value)}</span><span class="review-actions">${item.state === 'editing' ? `<button class="review-action save-edit" aria-label="Save changes" title="Save changes">${icon('check')}</button>` : `<button class="review-action edit" aria-label="Edit ${escapeHTML(item.label)}" title="Edit">${icon('pencil')}</button><button class="review-action approve" aria-label="Approve ${escapeHTML(item.label)}" title="Looks right">${icon('check')}</button><button class="review-action reject" aria-label="Reject ${escapeHTML(item.label)}" title="Remove from profile">${icon('x')}</button>`}</span>`;
    reviewList.append(row);
  });
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
  refreshIcons();
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
    const nodeIcon = node.image
      ? `<img src="https://images.unsplash.com/${node.image}?auto=format&fit=crop&w=96&q=80" alt="" />`
      : icon(node.icon);
    const matchesSearch = matchingIds.has(node.id);
    return `<button type="button" class="grid-node node-${node.category} ${matchesSearch ? '' : 'search-dimmed'}" data-node-id="${node.id}" style="--node-x:${node.x}%;--node-y:${node.y}%" aria-label="${escapeHTML(node.name)}, ${escapeHTML(node.meta)}" title="${escapeHTML(node.name)}"><span class="node-avatar">${nodeIcon}</span><span class="node-copy"><strong>${escapeHTML(node.name)}</strong><small>${escapeHTML(node.meta)}</small></span></button>`;
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
  document.querySelectorAll('.grid-node').forEach(button => {
    const selected = button.dataset.nodeId === selectedId;
    const related = relatedIds.has(button.dataset.nodeId);
    button.classList.toggle('is-selected', selected);
    button.classList.toggle('is-related', related && !selected);
    button.classList.toggle('is-dimmed', Boolean(selectedId) && !selected && !related);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('.grid-edge').forEach(edge => {
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
  document.querySelector('#drawer-symbol').innerHTML = node.image
    ? `<img src="https://images.unsplash.com/${node.image}?auto=format&fit=crop&w=96&q=80" alt="" />`
    : icon(node.icon);
  document.querySelector('#drawer-title').textContent = node.name;
  document.querySelector('#drawer-subtitle').textContent = node.meta;
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

function sectionForLine(line) {
  const lower = line.toLowerCase();
  if (/^(education|academic background|academics)\b/.test(lower)) return 'Education';
  if (/^(skills|technical skills|technologies|core competencies)\b/.test(lower)) return 'Skills';
  if (/^(experience|work experience|employment|professional experience)\b/.test(lower)) return 'Experience';
  if (/^(projects|selected projects)\b/.test(lower)) return 'Projects';
  return null;
}

function parseResume(text) {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found = [];
  const nameLine = lines.find(line => /^[A-Za-z][A-Za-z .'-]{2,45}$/.test(line) && !sectionForLine(line) && !/@|linkedin|github|resume/i.test(line));
  if (nameLine) found.push({ label: 'Name', value: nameLine });

  let activeSection = '';
  const grouped = new Map();
  for (const line of lines) {
    const section = sectionForLine(line.replace(/[:|].*$/, '').trim());
    if (section) {
      activeSection = section;
      if (!grouped.has(section)) grouped.set(section, []);
      const suffix = line.replace(/^[^:|]+[:|]?\s*/, '').trim();
      if (suffix) grouped.get(section).push(suffix);
    } else if (activeSection && !/@|linkedin\.com|github\.com|\+?\d[\d ().-]{7,}/i.test(line)) {
      grouped.get(activeSection).push(line);
    }
  }

  for (const [label, values] of grouped) {
    const value = label === 'Skills'
      ? values.join(', ').split(/[,;|•]/).map(part => part.trim()).filter(Boolean).join(', ')
      : values.join(' · ');
    if (value) found.push({ label, value });
  }

  if (!found.some(item => item.label === 'Skills')) {
    const skillsLine = lines.find(line => /\b(java|python|javascript|typescript|react|sql|c\+\+|machine learning|leadership)\b/i.test(line) && line.includes(','));
    if (skillsLine) found.push({ label: 'Skills', value: skillsLine });
  }
  if (found.length < 2) {
    const email = lines.find(line => /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line));
    const education = lines.find(line => /university|college|institute|school/i.test(line));
    const skills = lines.find(line => /\b(java|python|javascript|typescript|react|sql|c\+\+)\b/i.test(line));
    if (!found.some(item => item.label === 'Education') && education) found.push({ label: 'Education', value: education });
    if (!found.some(item => item.label === 'Skills') && skills) found.push({ label: 'Skills', value: skills });
    if (!found.some(item => item.label === 'Contact') && email) found.push({ label: 'Contact', value: email });
  }
  return found.slice(0, 12);
}

async function extractText(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt') return file.text();
  if (extension === 'docx') {
    if (!window.mammoth) throw new Error('DOCX support could not load. Try a TXT file instead.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (extension === 'pdf') {
    if (!window.pdfjsLib) throw new Error('PDF support could not load. Try a TXT file instead.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      const lines = [];
      let previousY;
      for (const item of content.items) {
        const value = item.str?.trim();
        if (!value) continue;
        const y = item.transform?.[5];
        if (lines.length && Number.isFinite(y) && Number.isFinite(previousY) && Math.abs(y - previousY) > 2) {
          lines.push(value);
        } else if (lines.length) {
          lines[lines.length - 1] += ` ${value}`;
        } else {
          lines.push(value);
        }
        if (Number.isFinite(y)) previousY = y;
      }
      return lines.join('\n');
    }));
    return pages.join('\n');
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
    const text = await extractText(file);
    const parsed = parseResume(text);
    if (!parsed.length) throw new Error('We could not find readable details. Try a text-based resume or add details manually.');
    const additions = parsed.map((item, index) => ({ ...item, id: `upload-${Date.now()}-${index}`, state: 'pending' }));
    const existingLabels = new Set(state.items.map(item => item.label.toLowerCase()));
    state.items = [...state.items.filter(item => !existingLabels.has(item.label.toLowerCase()) || item.state === 'approved'), ...additions];
    renderItems();
    closeUpload();
    showToast(`Found ${additions.length} details. Review them before they appear on your profile.`);
  } catch (error) {
    uploadStatus.textContent = error.message || 'Could not read that file. Try another format.';
    uploadStatus.classList.add('error');
  }
}

function setView(view) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  const showingSurfGrid = view === 'surf-grid';
  document.querySelector('#dashboard-content').hidden = showingSurfGrid;
  document.querySelector('#surf-grid-view').hidden = !showingSurfGrid;
  const labels = { home: 'Overview', profile: 'My profile', network: 'My Grid', 'surf-grid': 'Surf the Grid', opportunities: 'Opportunities', messages: 'Messages' };
  document.querySelector('#breadcrumb-current').textContent = labels[view] || 'Overview';
  if (view === 'profile') {
    document.querySelector('#profile-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Your profile details are ready to review and update.');
  } else if (view === 'network') {
    document.querySelector('#network-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (view === 'home') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (view === 'surf-grid') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    showToast(view === 'messages' ? 'You have 2 unread messages. Messaging is coming soon.' : 'Opportunity discovery is coming soon. Your matches are below.');
  }
}

reviewList.addEventListener('click', event => {
  const action = event.target.closest('button');
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

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
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
document.querySelector('#modal-close').addEventListener('click', closeUpload);
modal.addEventListener('click', event => { if (event.target === modal) closeUpload(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) closeUpload(); });
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

document.querySelector('#goal-button').addEventListener('click', () => showToast('Your weekly goal is 6 meaningful networking actions.'));
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
renderNetworkMap();
refreshIcons();
