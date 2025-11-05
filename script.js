document.addEventListener('DOMContentLoaded', () => {

    // Dark Mode 

    const modeButton = document.querySelector('.mode_button');
    const modeText = document.querySelector('.mode_text');
    const body = document.body;

    if (!modeButton || !modeText) {
        console.error("Dark Mode elements not found.");
    } else {
        function applyTheme(isDark) {
            if (isDark) {
                body.classList.add('dark-mode');
                modeText.textContent = 'Dark Mode';
                localStorage.setItem('theme', 'dark');
            } else {
                body.classList.remove('dark-mode');
                modeText.textContent = 'Light Mode';
                localStorage.setItem('theme', 'light');
            }
        }

        const savedTheme = localStorage.getItem('theme');
        applyTheme(savedTheme === 'dark');

        modeButton.addEventListener('click', () => {
            const isDark = body.classList.contains('dark-mode');
            applyTheme(!isDark);
        });
    }

    // 2. File Upload Setup
   
    const fileInput = document.getElementById('fileInput');
    const fileText = document.querySelector('.add_file_text');
    const questionsContainer = document.getElementById('questionsContainer');
    const questionsList = document.getElementById('questionsList');
    const pdfBoxSelector = document.querySelector('.pdf_box');
    const addFileBoxSelector = document.querySelector('.add_file_box');
    const mainBarSelector = document.querySelector('.main_bar');

    if (!fileInput || !questionsContainer || !questionsList) {
        console.error("File or question display elements missing in HTML.");
        
    }

    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        // extract text and generate questions
        const text = await extractText(file);
        const questions = await generateQuestions(text);

        // show local preview and open in new tab
        displayQuestions(questions);

        // hide upload area visually 
        hideUploadArea();
    });

    // 3. Extract Text (PDF or TXT)
    async function extractText(file) {
        try {
            if (file.type === "application/pdf") {
                // use pdf.js 
                const pdfjsLib = window['pdfjs-dist/build/pdf'] || window['pdfjs-dist/build/pdf.js'] || window.pdfjsLib;
                if (!pdfjsLib) throw new Error('pdfjs not found');

                if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc =
                        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }

                const loadingTask = pdfjsLib.getDocument(URL.createObjectURL(file));
                const pdf = await loadingTask.promise;
                let text = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += content.items.map(item => item.str).join(" ") + " ";
                }
                return text.trim();
            } else {
                return await file.text();
            }
        } catch (err) {
            console.warn("extractText failed:", err);
            return "";
        }
    }

    // 4. Grammar Correction 

    async function correctGrammar(sentence) {
        try {
            const response = await fetch("https://api.languagetool.org/v2/check", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    text: sentence,
                    language: "en-US"
                })
            });

            const data = await response.json();
            let corrected = sentence;

            if (Array.isArray(data.matches) && data.matches.length) {
                const edits = [];
                data.matches.forEach(match => {
                    const replacement = match.replacements?.[0]?.value;
                    if (replacement && match.context && typeof match.context.offset === 'number') {
                        edits.push({
                            start: match.context.offset,
                            length: match.context.length,
                            replacement
                        });
                    } else if (replacement && typeof match.offset === 'number' && typeof match.length === 'number') {
                        edits.push({
                            start: match.offset,
                            length: match.length,
                            replacement
                        });
                    }
                });
                edits.sort((a, b) => b.start - a.start);
                edits.forEach(e => {
                    corrected = corrected.slice(0, e.start) + e.replacement + corrected.slice(e.start + e.length);
                });
            }

            return corrected;
        } catch (err) {
            console.warn("Grammar correction failed:", err);
            return sentence;
        }
    }

    // 5. Improved Question Generator 

    async function generateQuestions(text) {
        if (!text || text.trim().length < 30) {
            return ["File seems empty or unreadable."];
        }

        // Basic cleaning
        const cleaned = text
            .replace(/\s+/g, " ")
            .replace(/\b(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Professor|Assistant Professor)\b/gi, "")
            .replace(/\b(University|Department|Overview|Introduction|KJSCE|College|Page|Lecture|Roll|Email|Contact)\b/gi, "")
            .replace(/[•*]/g, " ")
            .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, "")
            .replace(/[^\w\s\.\-,()/]/g, "")
            .trim();

        if (cleaned.length < 50) return ["Not enough readable text found."];

        const parts = cleaned
            .split(/[\n;]+|(?<=[.?!])\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 6 && /\b[a-zA-Z]{3,}\b/.test(s));

        if (parts.length === 0) return ["No readable content found to generate questions."];

        const phraseCounts = new Map();

        parts.forEach(part => {
            const candidates = new Set();

            // capitalized multi-word sequences
            const capSeqs = part.match(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,4})\b/g);
            if (capSeqs) capSeqs.forEach(c => candidates.add(c.trim()));

            // technical tokens & acronyms
            const tech = part.match(/\b([A-Z]{2,}|[a-zA-Z]+[A-Z][a-zA-Z0-9]+)\b/g);
            if (tech) tech.forEach(t => candidates.add(t.trim()));

            // sliding window phrases (1-4 words)
            const words = part.split(/\s+/);
            for (let i = 0; i < words.length; i++) {
                let window = [];
                for (let k = 0; k < 4 && i + k < words.length; k++) {
                    const w = words[i + k].replace(/[^\w-]/g, '');
                    if (!w) break;
                    window.push(w);
                    const phrase = window.join(' ');
                    if (/\b[a-zA-Z]{3,}\b/.test(phrase) && phrase.length > 3) candidates.add(phrase);
                }
            }

            // long single words
            const longWords = part.match(/\b[a-zA-Z]{6,}\b/g);
            if (longWords) longWords.forEach(w => candidates.add(w));

            // weight and count
            candidates.forEach(c => {
                const key = c.trim();
                const weight = Math.min(5, key.split(' ').length); // prefer multi-word
                phraseCounts.set(key, (phraseCounts.get(key) || 0) + weight);
            });
        });

        // score, normalize and filter
        let phrases = Array.from(phraseCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(p => p[0])
            .map(s => s.replace(/[.,;:]$/g, '').trim())
            .filter(s => /[a-zA-Z]{3,}/.test(s));

        const stopCommon = new Set(['Introduction', 'Overview', 'Chapter', 'Section', 'Summary', 'Conclusion']);
        phrases = phrases.filter(p => !stopCommon.has(p));

        // pick top topics 
        const topics = phrases.slice(0, Math.min(12, Math.max(3, phrases.length)));

        if (topics.length === 0) {
            const fallback = parts
                .map(p => p.split(/\s+/).filter(w => w.length > 5)[0])
                .filter(Boolean);
            if (fallback.length === 0) return ["Could not identify meaningful topics for question generation."];
            topics.push(...fallback.slice(0, 5));
        }

        // Template
        const templates = [
            t => `Define ${t}.`,
            t => `What is ${t}?`,
            t => `Explain the concept of ${t}.`,
            t => `How does ${t} work?`,
            t => `Why is ${t} important?`,
            t => `Describe the main features or characteristics of ${t}.`,
            t => `Give an example where ${t} is applied in the real world.`,
            t => `What are the main challenges associated with ${t}?`,
            t => `Compare ${t} with a related concept and highlight the differences.`,
            t => `How would you evaluate the effectiveness of ${t} in practice?`
        ];

        function makeMCQ(target, allTopics) {
            const pool = allTopics.filter(x => x.toLowerCase() !== target.toLowerCase());
            const distractors = [];
            const targetWords = new Set(target.toLowerCase().split(/\s+/));

            const scored = pool.map(p => {
                const overlap = p.toLowerCase().split(/\s+/).filter(w => targetWords.has(w)).length;
                return {p, score: overlap};
            }).sort((a,b) => b.score - a.score);

            for (let i = 0; i < scored.length && distractors.length < 3; i++) {
                distractors.push(scored[i].p);
            }
            while (distractors.length < 3) {
                distractors.push(target + (Math.random() < 0.5 ? "s" : "ing"));
            }
            const options = [target, ...distractors].sort(() => Math.random() - 0.5);
            return {question: `Which of the following best describes ${target}?`, options, answer: target};
        }

        // generate candidate questions 
        const candidates = [];
        const used = new Set();

        for (let i = 0; i < topics.length && candidates.length < 20; i++) {
            const t = topics[i];
        
            candidates.push(templates[i % templates.length](t));
            candidates.push(i % 2 === 0 ? `How is ${t} applied in practice?` : `Why might ${t} fail in certain situations?`);

       
            if (i % 3 === 0) {
                const mcq = makeMCQ(t, topics);
                const mcqText = `${mcq.question}\nOptions: ${mcq.options.map((o,idx)=> String.fromCharCode(65+idx) + '. ' + o).join(' | ')}\nAnswer: ${mcq.answer}`;
                candidates.push(mcqText);
            } else if (i % 3 === 1) {
                const found = parts.find(p => new RegExp(`\\b${escapeForRegex(t)}\\b`, 'i').test(p));
                if (found) {
                    const q = found.replace(new RegExp(`\\b${escapeForRegex(t)}\\b`, 'i'), '______');
                    candidates.push(`Fill in the blank: ${q}`);
                } else {
                    candidates.push(`Explain the term: ${t}`);
                }
            }

      
            if (candidates.length >= 18) break;
        }

        const deduped = [];
        candidates.forEach(c => {
            const s = c.replace(/\s+/g, ' ').trim();
            if (!used.has(s) && s.length > 10) {
                used.add(s);
                deduped.push(s);
            }
        });

        function scoreQuestion(q) {
            const low = q.toLowerCase();
            let score = 0;
            if (/define|what is|explain|describe|how does|how is/.test(low)) score += 5;
            if (/example|real world|applied|apply/.test(low)) score += 3;
            if (/compare|advantages|disadvantages|challenges|fail/.test(low)) score += 2;
            const len = q.length;
            score += Math.max(0, 6 - Math.floor(len / 60));
            return score;
        }

        const scored = deduped.map(q => ({q, score: scoreQuestion(q)}))
            .sort((a,b) => b.score - a.score)
            .map(x => x.q);

        const pick = scored.slice(0, 10);

        if (pick.length < 10) {
            const alt = parts.slice(0, 10).map((p, idx) => {
                return idx % 2 === 0 ? `Summarize the following: ${p}` : `What is the main idea of: ${p}`;
            });
            alt.forEach(a => {
                if (pick.length < 10 && !pick.includes(a)) pick.push(a);
            });
        }

        const final = [];
        for (let q of pick.slice(0, 10)) {
            try {
                const fixed = await correctGrammar(q);
                if (fixed && fixed.split(/\s+/).length >= 3) final.push(fixed.trim());
                else final.push(q);
            } catch (err) {
                final.push(q);
            }
        }

    
        let idx = 0;
        while (final.length < 10 && idx < parts.length) {
            const extra = `What is the main point of: ${parts[idx].slice(0,120)}${parts[idx].length > 120 ? '...' : ''}`;
            try {
                const fixed = await correctGrammar(extra);
                final.push(fixed);
            } catch {
                final.push(extra);
            }
            idx++;
        }

        return final.length ? final.slice(0, 10) : ["No suitable content found to generate questions."];
    }

    function escapeForRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Display Questions
    function displayQuestions(questions) {
        try {
            if (questionsContainer) questionsContainer.classList.remove('hidden');
            if (questionsList) {
                questionsList.innerHTML = "";
                if (!Array.isArray(questions)) {
                    const li = document.createElement('li');
                    li.textContent = String(questions);
                    questionsList.appendChild(li);
                } else {
                    questions.forEach(q => {
                        const li = document.createElement('li');
                        li.textContent = q;
                        questionsList.appendChild(li);
                    });
                }
            }
        } catch (err) {
            console.warn('Local display failed:', err);
        }

        // Open new tab
        const newWin = window.open('', '_blank');
        if (!newWin) {
            return;
        }

        const list = Array.isArray(questions) ? questions : [String(questions)];
        const count = list.length;

        const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Generated Questions - Questly</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: "Courier New", monospace; background: #f0f7ff; color: #0b1b33; margin: 20px; }
  .wrap { max-width:900px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 22px; box-shadow: 0 8px 28px rgba(8,30,65,0.08); }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  h1 { font-size:22px; margin:0; }
  .meta { color:#51607a; font-size:13px; margin:0; }
  ol { margin-top:18px; padding-left: 1.2em; }
  li { margin: 10px 0; line-height:1.5; white-space: pre-wrap; }
  .controls { margin-top:18px; text-align:right; }
  .btn { display:inline-block; padding:8px 12px; border-radius:8px; text-decoration:none; color:#fff; background:#3b82f6; font-weight:600; }
  .btn.secondary { background:#06b6d4; margin-left:8px; }
  @media (max-width:600px){ .wrap{ padding:14px } h1{font-size:18px} }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Generated Questions</h1>
        <p class="meta">From Questly — ${count} question${count !== 1 ? 's' : ''} generated</p>
      </div>
      <div class="controls">
        <a href="#" id="printBtn" class="btn">Print</a>
        <a href="#" id="downloadBtn" class="btn secondary">Download HTML</a>
      </div>
    </header>

    <ol>
      ${ list.map(q => `<li>${escapeHtml(q)}</li>`).join('') }
    </ol>
  </div>

  <script>
    document.getElementById('printBtn').addEventListener('click', function(e){ e.preventDefault(); window.print(); });
    document.getElementById('downloadBtn').addEventListener('click', function(e){
        e.preventDefault();
        const html = '<!doctype html>' + document.documentElement.outerHTML;
        const blob = new Blob([html], {type: 'text/html'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'questly_generated_questions.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
    function escapeHtml2(s){
        return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;').replaceAll(\"'\",'&#39;');
    }
  </script>
</body>
</html>
        `;

        newWin.document.open();
        newWin.document.write(html);
        newWin.document.close();
    }

    // small helper to escape HTML when inserting content
    function escapeHtml(str) {
        if (str === undefined || str === null) return '';
        return String(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    // 7. Utilities: hide upload area visually and adjust main_bar
    function hideUploadArea() {
        const pdfBox = document.querySelector('.pdf_box');
        const addFileBox = document.querySelector('.add_file_box');
        const addFileText = document.querySelector('.add_file_text');
        const mainBar = document.querySelector('.main_bar');

        // Fade & remove pdfBox and addFileBox gracefully
        [pdfBox, addFileBox].forEach(el => {
            if (!el) return;
            el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            el.style.opacity = '0';
            el.style.transform = 'translateY(-8px)';
            setTimeout(() => {
                if (el && el.parentNode) el.parentNode.removeChild(el);
            }, 520);
        });

        if (addFileText) {
            addFileText.style.transition = 'opacity 0.45s ease';
            addFileText.style.opacity = '0';
        }

        if (mainBar) {
            setTimeout(() => {
                mainBar.classList.add('uploaded');
            }, 540);
        }
    }

    

});
