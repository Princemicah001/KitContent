document.addEventListener('DOMContentLoaded', () => {
    fetchHealth();
    fetchStats();
    fetchPosts();
    fetchSchedule();

    document.getElementById('generate-btn').addEventListener('click', generatePosts);
    document.getElementById('schedule-time').addEventListener('change', updateSchedule);
    document.getElementById('count-select').addEventListener('change', syncDialWithSelect);
    document.getElementById('close-modal').addEventListener('click', closeModal);
    
    // Mobile Sidebar Toggle
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', () => {
            sidebar.classList.toggle('hidden');
            sidebar.classList.toggle('flex');
            sidebar.classList.toggle('absolute');
            sidebar.classList.toggle('inset-x-0');
            sidebar.classList.toggle('top-16');
            sidebar.classList.toggle('h-[calc(100vh-4rem)]');
        });
    }

    // Dial controls
    document.getElementById('dial-minus').addEventListener('click', () => adjustDial(-1));
    document.getElementById('dial-plus').addEventListener('click', () => adjustDial(1));
    
    // Live Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterPosts(e.target.value));
    }
    
    // Auto-refresh posts & progress every 2 seconds
    setInterval(() => {
        fetchStats();
        fetchPosts();
        pollProgress();
    }, 2000);
});

let allPostsCache = [];
let currentPostInModal = null;

function showPage(pageId) {
    document.querySelectorAll('.page-view').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`page-${pageId}`);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.className = 'nav-btn w-full flex items-center py-2.5 px-3.5 rounded-xl text-gray-600 hover:bg-purple-50 hover:text-purple-700 transition duration-150 text-xs font-medium';
    });

    const activeNav = document.getElementById(`nav-${pageId}`);
    if (activeNav) {
        activeNav.className = 'nav-btn w-full flex items-center py-2.5 px-3.5 rounded-xl bg-purple-600 text-white font-semibold transition duration-150 text-xs shadow-sm';
    }

    if (pageId === 'feed') {
        renderTikTokFeed(allPostsCache);
    } else if (pageId === 'quality') {
        renderQualityList(allPostsCache);
    } else if (pageId === 'analytics') {
        fetchStats();
        fetchGroqInsights();
    }
}

function adjustDial(delta) {
    const select = document.getElementById('count-select');
    const options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let current = parseInt(select.value, 10) || 5;
    
    let currentIndex = options.indexOf(current);
    if (currentIndex === -1) currentIndex = 4;
    
    let newIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta));
    select.value = options[newIndex];
    syncDialWithSelect();
}

function syncDialWithSelect() {
    const val = document.getElementById('count-select').value;
    document.getElementById('dial-count-display').textContent = val;
}

async function fetchHealth() {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        
        const geminiBadge = document.getElementById('gemini-status');
        if (data.gemini) {
            geminiBadge.textContent = 'CONNECTED';
            geminiBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700';
        } else {
            geminiBadge.textContent = 'DISCONNECTED';
            geminiBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700';
        }

        const groqBadge = document.getElementById('groq-status');
        if (data.groq) {
            groqBadge.textContent = data.groqModel || 'CONNECTED';
            groqBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700 truncate max-w-[85px]';
        } else {
            groqBadge.textContent = 'DISCONNECTED';
            groqBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700';
        }

        const imgBadge = document.getElementById('image-status');
        if (data.imageProvider) {
            imgBadge.textContent = 'CONNECTED';
            imgBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700';
        } else {
            imgBadge.textContent = 'DISCONNECTED';
            imgBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700';
        }
    } catch (err) {
        console.error('Health check failed', err);
    }
}

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('stat-ready').textContent = data.ready || 0;
        document.getElementById('stat-total-count').textContent = `${data.generated || 0} Total`;
        document.getElementById('stat-approved-count').textContent = `${data.approved || 0} Approved`;
        document.getElementById('stat-pooled-count').textContent = `${data.pooled_topics || 0} Available in Pool`;

        const successRate = data.success_rate || 100;
        document.getElementById('stat-success-rate').textContent = `${successRate}%`;
        document.getElementById('bar-success-rate').style.width = `${successRate}%`;

        const authScore = data.authenticity_score || 95;
        document.getElementById('stat-avg-authenticity').textContent = `${authScore}/100`;
        document.getElementById('bar-avg-authenticity').style.width = `${authScore}%`;

        const elTotal = document.getElementById('analytics-total-attempts');
        if (elTotal) elTotal.textContent = data.total_attempts || data.generated || 0;
        const elRate = document.getElementById('analytics-success-rate');
        if (elRate) elRate.textContent = `${successRate}%`;
        const elApi = document.getElementById('analytics-api-failures');
        if (elApi) elApi.textContent = data.api_failures || 0;
        const elRep = document.getElementById('analytics-repetition-blocked');
        if (elRep) elRep.textContent = data.repetition_blocked || 0;
        const elAuth = document.getElementById('analytics-authenticity');
        if (elAuth) elAuth.textContent = `${authScore}/100`;

        const tApi = document.getElementById('table-api-429');
        if (tApi) tApi.textContent = `${data.api_failures || 0} Cooldown Events`;
        const tRep = document.getElementById('table-rep-blocked');
        if (tRep) tRep.textContent = `${data.repetition_blocked || 0} Duplicate Topics Blocked`;
        const tLow = document.getElementById('table-low-quality');
        if (tLow) tLow.textContent = `${data.low_quality_rejected || 0} Low-Score Rejected`;

    } catch (err) {
        console.error(err);
    }
}

async function fetchGroqInsights() {
    const summaryBox = document.getElementById('groq-human-summary');
    try {
        const res = await fetch('/api/groq/insights');
        const data = await res.json();
        
        if (summaryBox) {
            summaryBox.innerHTML = `<strong>Health Status: ${data.system_health || 'OPTIMAL'}</strong><br>${data.human_summary || 'System running cleanly.'}<br><em class="text-purple-300">Recommendation: ${data.recommendation || 'No action needed.'}</em>`;
        }
        
        if (data.system_health === 'CRITICAL' || data.system_health === 'ERROR' || (data.human_summary && data.human_summary.toLowerCase().includes('failed'))) {
            const errorMsg = `Groq Alert!\nHealth: ${data.system_health}\n${data.human_summary}\n\nRecommendation: ${data.recommendation}`;
            console.error(errorMsg);
            // Show alert only if we haven't shown it recently to avoid spam
            if (!window.lastAlertTime || (Date.now() - window.lastAlertTime > 60000)) {
                alert(errorMsg);
                window.lastAlertTime = Date.now();
            }
        }
    } catch (err) {
        if (summaryBox) summaryBox.textContent = "Groq insights unavailable.";
    }
}

async function fetchSchedule() {
    try {
        const res = await fetch('/api/schedule');
        const data = await res.json();
        
        const input = document.getElementById('schedule-time');
        if (input) input.value = data.time || '';
        
        const scheduleStat = document.getElementById('stat-schedule');
        if (scheduleStat) scheduleStat.textContent = data.time ? data.time : 'OFF';
    } catch (err) {
        console.error(err);
    }
}

async function updateSchedule() {
    const timeInput = document.getElementById('schedule-time');
    const time = timeInput ? timeInput.value : '';
    const count = parseInt(document.getElementById('count-select').value, 10);
    
    try {
        const res = await fetch('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ time, count })
        });
        const data = await res.json();
        
        const scheduleStat = document.getElementById('stat-schedule');
        if (scheduleStat) scheduleStat.textContent = data.time ? data.time : 'OFF';
    } catch (err) {
        console.error("Schedule update error:", err);
    }
}

async function pollProgress() {
    try {
        const res = await fetch('/api/progress');
        const data = await res.json();
        
        const logBox = document.getElementById('progress-log');
        const badge = document.getElementById('progress-status-badge');
        const dialText = document.getElementById('dial-status-text');
        
        if (data.isGenerating) {
            badge.textContent = 'Generating...';
            badge.className = 'px-3.5 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-700 animate-pulse';
            if (dialText) dialText.textContent = 'Processing post generation batch...';
        } else {
            badge.textContent = 'Idle';
            badge.className = 'px-3.5 py-1 rounded-full text-xs font-extrabold bg-purple-100 text-purple-700';
            if (dialText) dialText.textContent = 'Ready to generate non-repetitive posts';
        }
        
        if (data.logs && data.logs.length > 0) {
            if (logBox) {
                logBox.innerHTML = data.logs.map(log => {
                    let color = '#6d28d9'; // default purple
                    if (log.toLowerCase().includes('failed') || log.toLowerCase().includes('error') || log.toLowerCase().includes('rejected')) color = '#e11d48'; // red
                    else if (log.toLowerCase().includes('success') || log.toLowerCase().includes('completed') || log.toLowerCase().includes('approved')) color = '#059669'; // green
                    
                    return `<div style="margin-bottom:6px; color:${color}; padding-left:4px; border-left: 2px solid ${color}40;">${escapeHtml(log)}</div>`;
                }).join('');
                logBox.scrollTop = logBox.scrollHeight;
            }
            
            // Check for new failures in the last 3 logs
            const recentLogs = data.logs.slice(-3);
            const hasError = recentLogs.some(log => log.toLowerCase().includes('failed') || log.toLowerCase().includes('error'));
            if (hasError) {
                if (!window.lastErrorFetch || (Date.now() - window.lastErrorFetch > 30000)) {
                    window.lastErrorFetch = Date.now();
                    fetchGroqInsights();
                }
            }
        }
    } catch (err) {
        console.error("Progress polling error:", err);
    }
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fetchPosts() {
    try {
        const res = await fetch('/api/posts');
        allPostsCache = await res.json();
        renderPostsGrid(allPostsCache);
        
        const feedView = document.getElementById('page-feed');
        if (feedView && !feedView.classList.contains('hidden')) {
            renderTikTokFeed(allPostsCache);
        }
    } catch (err) {
        console.error(err);
    }
}

function filterPosts(query) {
    if (!query) {
        renderPostsGrid(allPostsCache);
        return;
    }
    const q = query.toLowerCase();
    const filtered = allPostsCache.filter(p => 
        (p.topic && p.topic.toLowerCase().includes(q)) || 
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.hook && p.hook.toLowerCase().includes(q))
    );
    renderPostsGrid(filtered);
}

function renderPostsGrid(posts) {
    const grid = document.getElementById('posts-grid');
    if (!grid) return;
    
    if (posts.length === 0) {
        grid.innerHTML = '<div class="col-span-2 text-center py-8 text-gray-400 text-xs font-medium">No posts generated yet. Click START GENERATION BATCH above!</div>';
        return;
    }
    
    const currentPostIds = new Set(posts.map(p => p.id));
    // Remove old items
    Array.from(grid.children).forEach(child => {
        if (child.dataset.id && !currentPostIds.has(child.dataset.id)) {
            grid.removeChild(child);
        }
    });

    posts.forEach(post => {
        let card = grid.querySelector(`[data-id="${post.id}"]`);
        
        if (!card) {
            card = document.createElement('div');
            card.dataset.id = post.id;
            card.className = 'bg-white p-2.5 rounded-2xl card-shadow border border-purple-100/60 flex flex-col justify-between hover:border-purple-300 transition duration-200 cursor-pointer group';
            card.onclick = () => openModal(post);
            grid.appendChild(card);
        } else {
            // Update onclick reference
            card.onclick = () => openModal(post);
        }
        
        const statusClass = post.status === 'READY' ? 'bg-emerald-500 text-white' : post.status === 'APPROVED' ? 'bg-purple-600 text-white' : 'bg-amber-500 text-white';
        const imgSrc = post.final_image_path ? `/${post.final_image_path}` : 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221080%22%20height%3D%221920%22%20viewBox%3D%220%200%201080%201920%22%3E%3Crect%20fill%3D%22%23242424%22%20width%3D%221080%22%20height%3D%221920%22%2F%3E%3Ctext%20fill%3D%22%23888%22%20font-family%3D%22sans-serif%22%20font-size%3D%2260%22%20dy%3D%2221%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3E' + encodeURIComponent(post.status) + '%3C%2Ftext%3E%3C%2Fsvg%3E';
        
        const html = `
            <div class="relative w-full aspect-[9/16] rounded-xl overflow-hidden bg-gray-950 mb-2 shadow-sm">
                <img class="w-full h-full object-cover group-hover:scale-105 transition duration-300" src="${imgSrc}">
                <span class="absolute top-2 left-2 text-[9px] font-extrabold px-2 py-0.5 rounded-full shadow-sm ${statusClass}">${post.status}</span>
            </div>
            <div class="space-y-1">
                <div class="text-xs font-bold text-gray-900 truncate">${escapeHtml(post.topic || 'Generating...')}</div>
                <div class="flex justify-between items-center text-[10px] text-gray-400 font-medium">
                    <span>${escapeHtml(post.category || 'Psychology')}</span>
                    <span class="font-extrabold text-purple-600">${post.quality_score ? post.quality_score + '/100' : ''}</span>
                </div>
            </div>
        `;
        
        // Update DOM only if changed to avoid unnecessary repaints
        if (card.innerHTML !== html) {
            card.innerHTML = html;
        }
    });
}

function renderTikTokFeed(posts) {
    const container = document.getElementById('tiktok-feed-container');
    if (!container) return;
    container.innerHTML = '';

    const validPosts = posts.filter(p => p.final_image_path || p.topic);
    if (validPosts.length === 0) {
        container.innerHTML = '<div class="h-full flex items-center justify-center text-white text-sm">No posts available for reel playback yet.</div>';
        return;
    }

    validPosts.forEach(post => {
        const slide = document.createElement('div');
        slide.className = 'tiktok-slide relative bg-slate-950 flex items-center justify-center overflow-hidden';
        
        const imgPath = post.final_image_path ? `/${post.final_image_path}` : '';
        const hashtagsStr = (post.hashtags || []).join(' ');

        slide.innerHTML = `
            <!-- Background Image -->
            <div class="relative w-full max-w-[480px] h-full aspect-[9/16] overflow-hidden flex items-center justify-center shadow-2xl">
                <img src="${imgPath}" alt="${post.topic}" class="w-full h-full object-cover">
                
                <!-- Bottom Gradient Overlay -->
                <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none"></div>

                <!-- Content Info Box (Bottom Left) -->
                <div class="absolute bottom-6 left-5 right-16 text-white space-y-2.5 z-10 drop-shadow-md">
                    <span class="inline-block bg-purple-600 text-white font-extrabold text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider">${post.category || 'Psychology'}</span>
                    <h2 class="text-lg font-black leading-tight tracking-tight">${post.topic}</h2>
                    <p class="text-xs font-semibold text-purple-200 italic line-clamp-2">"${post.hook}"</p>
                    <p class="text-[11px] text-gray-300 line-clamp-3 font-normal">${post.body}</p>
                    <div class="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-[10px] text-emerald-300 font-medium">
                        💡 <strong>Takeaway:</strong> ${post.takeaway}
                    </div>
                    <p class="text-[10px] text-purple-300 font-semibold truncate">${hashtagsStr}</p>
                </div>

                <!-- Floating Right Action Bar -->
                <div class="absolute right-4 bottom-10 flex flex-col items-center space-y-4 z-20">
                    <button onclick="openModalById('${post.id}')" class="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md text-white flex items-center justify-center text-sm shadow transition">
                        <i class="fas fa-edit"></i>
                    </button>
                    <span class="text-[9px] text-white font-bold">Inspect</span>

                    <a download href="${imgPath}" class="w-11 h-11 rounded-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center text-sm shadow transition">
                        <i class="fas fa-download"></i>
                    </a>
                    <span class="text-[9px] text-white font-bold">Save</span>

                    <div class="w-11 h-11 rounded-full bg-emerald-500/80 backdrop-blur-md text-white flex flex-col items-center justify-center text-[10px] font-black shadow">
                        <span>⭐</span>
                        <span class="text-[8px]">${post.quality_score || 100}</span>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(slide);
    });
}

function renderQualityList(posts) {
    const container = document.getElementById('quality-posts-list');
    if (!container) return;
    container.innerHTML = '';

    posts.forEach(post => {
        const item = document.createElement('div');
        item.className = 'bg-white rounded-2xl p-5 card-shadow border border-purple-100 flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0';
        
        item.innerHTML = `
            <div class="space-y-1 max-w-xl">
                <div class="flex items-center space-x-2">
                    <span class="bg-purple-100 text-purple-700 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase">${post.category || 'Psychology'}</span>
                    <span class="text-xs font-bold text-emerald-600">Audit Score: ${post.quality_score || 100}/100</span>
                    <span class="text-xs text-gray-400">• Uniqueness: ${((1 - (post.similarity_score || 0)) * 100).toFixed(0)}%</span>
                </div>
                <h3 class="text-base font-bold text-gray-900">${post.topic}</h3>
                <p class="text-xs text-gray-600 italic font-medium">"${post.hook}"</p>
            </div>
            <div class="flex space-x-2 shrink-0">
                <button onclick="openModalById('${post.id}')" class="bg-purple-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-purple-700 transition">
                    <i class="fas fa-magic mr-1"></i> AI Refine & Edit
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

async function fetchTrendingTopics() {
    const modal = document.getElementById('trending-modal');
    const container = document.getElementById('trending-topics-container');
    modal.classList.remove('hidden');
    container.innerHTML = '<div class="text-center py-8 text-gray-400 text-xs font-medium"><i class="fas fa-spinner fa-spin text-purple-600 text-lg mb-2"></i><br>Executing Google Search Grounding for live trending research...</div>';

    try {
        const res = await fetch('/api/trending');
        const data = await res.json();
        
        container.innerHTML = '';
        if (data.trends && data.trends.length > 0) {
            data.trends.forEach(trend => {
                const card = document.createElement('div');
                card.className = 'bg-purple-50/70 p-4 rounded-2xl border border-purple-100 space-y-2 hover:border-purple-300 transition';
                card.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="bg-purple-600 text-white text-[9px] font-extrabold px-2.5 py-0.5 rounded-full uppercase">${trend.category || 'Trending Topic'}</span>
                        <span class="text-xs font-bold text-emerald-600">Relevance: ${trend.relevance_score || 95}%</span>
                    </div>
                    <h4 class="text-sm font-black text-gray-900">${trend.topic}</h4>
                    <p class="text-xs text-purple-800 font-semibold italic">Angle: "${trend.viral_hook_angle}"</p>
                    <p class="text-[11px] text-gray-600">${trend.background_insight}</p>
                    <button onclick="generateFromTrend('${trend.topic.replace(/'/g, "\\'")}')" class="mt-2 w-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-2 rounded-xl transition">
                        ⚡ Generate Post From This Trend
                    </button>
                `;
                container.appendChild(card);
            });
        } else {
            container.innerHTML = '<div class="text-center py-4 text-gray-500 text-xs">No trend data retrieved.</div>';
        }
    } catch (err) {
        container.innerHTML = `<div class="text-red-500 text-xs p-4">Error loading trends: ${err.message}</div>`;
    }
}

function closeTrendingModal() {
    document.getElementById('trending-modal').classList.add('hidden');
}

async function generateFromTrend(topic) {
    closeTrendingModal();
    showPage('dashboard');
    
    const logBox = document.getElementById('progress-log');
    logBox.innerHTML = `<div>Initiating post generation for trend "${topic}"...</div>`;
    
    try {
        await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: 1, topic })
        });
        pollProgress();
    } catch (err) {
        logBox.innerHTML += `<div style="color:#ef4444">Error: ${err.message}</div>`;
    }
}

async function generatePosts() {
    const countSelect = document.getElementById('count-select');
    const count = parseInt(countSelect.value || 5, 10);
    
    const logBox = document.getElementById('progress-log');
    logBox.innerHTML = '<div>Initiating generation process...</div>';
    
    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count })
        });
        const data = await res.json();
        
        if (!res.ok) {
            logBox.innerHTML += `<div style="color:#ef4444">Error: ${data.error}</div>`;
            return;
        }
        
        pollProgress();
    } catch (err) {
        logBox.innerHTML += `<div style="color:#ef4444">Network error: ${err.message}</div>`;
    }
}

function openModalById(id) {
    const post = allPostsCache.find(p => p.id === id);
    if (post) openModal(post);
}

function openModal(post) {
    currentPostInModal = post;
    const modal = document.getElementById('post-modal');
    
    document.getElementById('modal-topic').textContent = post.topic || 'No topic';
    document.getElementById('modal-category').textContent = post.category || 'Psychology';
    document.getElementById('modal-quality').textContent = `Quality: ${post.quality_score || 0}/100 | Sim: ${(post.similarity_score || 0).toFixed(2)}`;
    
    document.getElementById('modal-hook').value = post.hook || '';
    document.getElementById('modal-body').value = post.body || '';
    document.getElementById('modal-takeaway').value = post.takeaway || '';
    document.getElementById('modal-caption').value = post.caption || '';
    document.getElementById('refine-instruction').value = '';
    
    const img = document.getElementById('modal-img');
    if (post.final_image_path) {
        img.src = `/${post.final_image_path}`;
    } else {
        img.src = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221080%22%20height%3D%221920%22%20viewBox%3D%220%200%201080%201920%22%3E%3Crect%20fill%3D%22%23242424%22%20width%3D%221080%22%20height%3D%221920%22%2F%3E%3C%2Fsvg%3E';
    }
    
    const downloadBtn = document.getElementById('modal-download');
    if (post.final_image_path) {
        downloadBtn.href = `/${post.final_image_path}`;
        downloadBtn.style.display = 'flex';
    } else {
        downloadBtn.style.display = 'none';
    }
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('post-modal').classList.add('hidden');
    currentPostInModal = null;
}

async function approveCurrentPost() {
    if (!currentPostInModal) return;
    try {
        await fetch(`/api/posts/${currentPostInModal.id}/approve`, { method: 'POST' });
        closeModal();
        fetchPosts();
        fetchStats();
    } catch (err) {
        console.error(err);
    }
}

async function rejectCurrentPost() {
    if (!currentPostInModal) return;
    try {
        await fetch(`/api/posts/${currentPostInModal.id}/reject`, { method: 'POST' });
        closeModal();
        fetchPosts();
        fetchStats();
    } catch (err) {
        console.error(err);
    }
}

async function deleteCurrentPost() {
    if (!currentPostInModal) return;
    if (!confirm('Are you sure you want to completely delete this post? This cannot be undone.')) return;
    
    try {
        await fetch(`/api/posts/${currentPostInModal.id}`, { method: 'DELETE' });
        closeModal();
        fetchPosts();
        fetchStats();
    } catch (err) {
        console.error(err);
    }
}

async function triggerRefinePost() {
    if (!currentPostInModal) return;
    const btn = document.getElementById('btn-refine');
    const instruction = document.getElementById('refine-instruction').value;
    btn.textContent = 'Refining...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/posts/${currentPostInModal.id}/refine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instruction })
        });
        const updated = await res.json();
        openModal(updated);
        fetchPosts();
    } catch (err) {
        alert("Refinement failed: " + err.message);
    } finally {
        btn.textContent = 'Refine';
        btn.disabled = false;
    }
}
