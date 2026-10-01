/* ==========================================================================
   אופן ספייס — שאלון אישיות | לוגיקת האפליקציה
   --------------------------------------------------------------------------
   אין צורך לגעת בקובץ הזה כדי לשנות תוכן.
   כל הטקסטים, השאלות, הדמויות והקישורים נמצאים ב-js/config.js
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------------- */
  /* עזרים                                                                   */
  /* ---------------------------------------------------------------------- */

  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  /**
   * הדגשת מילים בכותרת. כל טקסט שעטוף בכוכביות בקובץ הקונפיג
   * מקבל את צבע החתימה של הסדרה. לדוגמה: "מי אתה ב*אופן ספייס*?"
   */
  function highlight(text, color) {
    return esc(text).replace(
      /\*([^*]+)\*/g,
      `<span style="color:${color}">$1</span>`
    );
  }

  /** בריחה מתווים מסוכנים לפני הזרקה ל-HTML */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** הצגת הודעת חיווי קצרה בתחתית המסך */
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove('opacity-0', 'translate-y-3');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add('opacity-0', 'translate-y-3');
    }, 2200);
  }

  /** הכתובת שתשותף */
  function shareLink() {
    return SITE.shareUrl && SITE.shareUrl.trim()
      ? SITE.shareUrl.trim()
      : window.location.href.split('#')[0];
  }

  /** החלפת מסך עם אנימציית יציאה/כניסה */
  function showScreen(html, onMounted) {
    const current = app.firstElementChild;

    const mount = () => {
      app.innerHTML = html;
      const next = app.firstElementChild;
      if (next) next.classList.add('screen-enter');
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      if (typeof onMounted === 'function') onMounted();
    };

    if (current) {
      current.classList.remove('screen-enter');
      current.classList.add('screen-leave');
      setTimeout(mount, 170);
    } else {
      mount();
    }
  }


  /* ---------------------------------------------------------------------- */
  /* מצב המבחן                                                               */
  /* ---------------------------------------------------------------------- */

  const state = {
    index: 0,
    scores: {},
    order: [],      // סדר התשובות לכל שאלה במבחן הנוכחי
    picks: [],      // מה נבחר בכל שאלה, כדי שאפשר יהיה לחזור אחורה ולבטל
    locked: false   // מונע לחיצה כפולה בזמן מעבר בין שאלות
  };

  /** ערבוב Fisher-Yates */
  function shuffled(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function resetState() {
    state.index = 0;
    state.locked = false;
    state.picks = [];
    state.scores = {};
    Object.keys(CHARACTERS).forEach(key => { state.scores[key] = 0; });

    // סדר תצוגה חדש בכל מבחן, כדי שאף דמות לא תהיה תמיד באותו מקום
    state.order = QUESTIONS.map(q =>
      SITE.shuffleAnswers === false
        ? q.answers.map((_, i) => i)
        : shuffled(q.answers.length)
    );
  }

  /** התשובות של השאלה הנוכחית בסדר התצוגה, יחד עם המיקום המקורי בקונפיג */
  function currentAnswers() {
    const q = QUESTIONS[state.index];
    return state.order[state.index].map(originalIndex => ({
      answer: q.answers[originalIndex],
      originalIndex
    }));
  }


  /* ---------------------------------------------------------------------- */
  /* חישוב התוצאה                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * מחזיר את מפתח הדמות המנצחת.
   * במקרה של תיקו — מכריע לפי ההגדרה ב-SITE.tieBreak
   */
  function resolveWinner() {
    const keys = Object.keys(state.scores);
    const max = Math.max(...keys.map(k => state.scores[k]));
    const leaders = keys.filter(k => state.scores[k] === max);

    if (leaders.length === 1) return leaders[0];

    const rule = SITE.tieBreak || { mode: 'priority', order: keys };

    if (rule.mode === 'random') {
      return leaders[Math.floor(Math.random() * leaders.length)];
    }

    // priority — הראשון ברשימה מבין המובילים
    const ordered = (rule.order || []).filter(k => leaders.includes(k));
    return ordered.length ? ordered[0] : leaders[0];
  }

  /**
   * התמונה הגדולה של מסך התוצאה וכרטיס הסטורי.
   * אם לא הוגדרה resultImage לדמות — נופלים לדיוקן הרגיל,
   * כך שהמבחן עובד גם לפני שכל תמונות התוצאה הוכנסו.
   */
  function resultImageOf(character) {
    const r = character.resultImage;
    return (r && String(r).trim()) ? r : character.image;
  }

  /** דירוג כל הדמויות מהגבוה לנמוך, לצורך פס האחוזים במסך התוצאה */
  function ranking() {
    const total = QUESTIONS.length || 1;
    return Object.keys(state.scores)
      .sort((a, b) => state.scores[b] - state.scores[a])
      .map(key => ({
        key,
        character: CHARACTERS[key],
        score: state.scores[key],
        percent: Math.round((state.scores[key] / total) * 100)
      }));
  }


  /* ---------------------------------------------------------------------- */
  /* מסך 1 — פתיחה                                                           */
  /* ---------------------------------------------------------------------- */

  function renderIntro() {
    resetState();

    const faces = Object.keys(CHARACTERS).map(key => `
      <img src="${esc(CHARACTERS[key].image)}" alt="${esc(CHARACTERS[key].name)}"
           class="h-20 w-20 rounded-full border-[3px] border-ink object-cover sm:h-24 sm:w-24">
    `).join('');

    showScreen(`
      <section class="rounded-2xl border-[3px] border-ink bg-card p-7 shadow-hard sm:p-9">
        <h1 class="text-4xl font-black leading-tight sm:text-5xl">${highlight(SITE.title, '#E18B13')}</h1>
        <p class="mt-4 text-lg leading-relaxed text-ink/80 sm:text-xl">${esc(SITE.intro)}</p>

        <div class="mt-7 flex justify-center gap-3 sm:gap-4">${faces}</div>

        <button id="btn-start"
                class="cta-btn mt-8 w-full rounded-xl border-[3px] border-ink bg-brand px-5 py-5 text-xl font-black text-ink shadow-hard-sm">
          ${esc(SITE.startButton)}
        </button>

        <p class="mt-5 text-center text-base font-medium text-ink/60 sm:text-lg">
          ${QUESTIONS.length} שאלות · פחות מדקה
        </p>
      </section>
    `, () => {
      document.getElementById('btn-start').addEventListener('click', renderQuestion);
    });
  }


  /* ---------------------------------------------------------------------- */
  /* מסך 2 — שאלה                                                            */
  /* ---------------------------------------------------------------------- */

  function renderQuestion() {
    const q = QUESTIONS[state.index];
    state.locked = false;

    const pips = QUESTIONS.map((_, i) => `
      <i class="pip h-2 flex-1 rounded-full ${i <= state.index ? 'bg-ink' : 'bg-ink/15'}"></i>
    `).join('');

    const answers = currentAnswers().map(({ answer, originalIndex }) => `
      <button class="answer-btn w-full rounded-xl border-[3px] border-ink bg-white px-5 py-5
                     text-right text-base font-medium leading-snug shadow-hard-sm sm:text-[19px]"
              data-answer="${originalIndex}">
        ${esc(answer.text)}
      </button>
    `).join('');

    showScreen(`
      <section>
        <div class="mb-4 flex gap-1.5">${pips}</div>

        <div class="mb-4 flex items-center justify-between">
          <span class="font-mono text-sm text-ink/55">
            שאלה ${state.index + 1} מתוך ${QUESTIONS.length}
          </span>
          <button id="btn-back" ${state.index === 0 ? 'disabled' : ''}
                  class="flex items-center gap-1.5 rounded-lg border-2 px-4 py-2 text-base font-bold transition
                         ${state.index === 0
                            ? 'cursor-not-allowed border-ink/15 text-ink/25'
                            : 'border-ink/30 text-ink/70 hover:border-ink hover:text-ink'}">
            <span aria-hidden="true">→</span> חזרה
          </button>
        </div>

        <div class="rounded-2xl border-[3px] border-ink bg-card p-6 shadow-hard sm:p-8">
          <h2 class="text-2xl font-black leading-snug sm:text-[34px] sm:leading-[1.25]">${esc(q.text)}</h2>
          <div class="stagger mt-6 flex flex-col gap-3">${answers}</div>
        </div>
      </section>
    `, () => {
      app.querySelectorAll('[data-answer]').forEach(btn => {
        btn.addEventListener('click', () => selectAnswer(btn, Number(btn.dataset.answer)));
      });

      const back = document.getElementById('btn-back');
      if (back) back.addEventListener('click', goBack);
    });
  }

  function selectAnswer(button, answerIndex) {
    if (state.locked) return;
    state.locked = true;

    const answer = QUESTIONS[state.index].answers[answerIndex];
    if (answer && Object.prototype.hasOwnProperty.call(state.scores, answer.character)) {
      state.scores[answer.character]++;
      state.picks[state.index] = answer.character;
    }

    button.classList.add('picked');

    setTimeout(() => {
      state.index++;
      if (state.index < QUESTIONS.length) renderQuestion();
      else renderResult();
    }, 190);
  }

  /** חזרה לשאלה הקודמת, כולל ביטול הניקוד שניתן בה */
  function goBack() {
    if (state.locked || state.index === 0) return;
    state.locked = true;

    state.index--;
    const previous = state.picks[state.index];
    if (previous && state.scores[previous] > 0) state.scores[previous]--;
    state.picks[state.index] = undefined;

    renderQuestion();
  }


  /* ---------------------------------------------------------------------- */
  /* מסך 3 — תוצאה                                                           */
  /* ---------------------------------------------------------------------- */

  function renderResult() {
    const winnerKey = resolveWinner();
    const winner = CHARACTERS[winnerKey];

    showScreen(`
      <section class="flex flex-col gap-4">

        <!-- כרטיס התוצאה -->
        <div class="rounded-2xl border-[3px] border-ink bg-card p-7 text-center shadow-hard sm:p-10">
          <span class="inline-block rounded-lg bg-ink px-3 py-1.5 font-mono text-sm text-card">
            התוצאה שלך
          </span>

          <img src="${esc(resultImageOf(winner))}" alt="${esc(winner.name)}"
               class="mx-auto mt-6 aspect-[4/3] w-full rounded-2xl border-[3px] border-ink object-cover shadow-hard">

          <h2 class="mt-7 text-5xl font-black leading-tight sm:text-6xl"
              style="color:${esc(winner.accent)}">${esc(winner.name)}</h2>

          <p class="mt-6 rounded-xl border-2 border-ink bg-white p-6 text-right text-lg leading-relaxed sm:text-xl">
            ${esc(winner.desc)}
          </p>

        </div>

        <!-- כרטיס הסטורי עצמו — מחוץ למסך, משמש רק לשמירת התמונה -->
        <div id="story-frame" style="position:fixed; left:-99999px; top:0; pointer-events:none;"
             aria-hidden="true">
          ${storyCardHTML(winner)}
        </div>

        <!-- פעולות משניות -->
        <div class="flex flex-col gap-2.5 sm:flex-row">
          <button id="btn-copy"
                  class="cta-btn w-full rounded-xl border-[3px] border-ink bg-white px-5 py-3.5 text-base font-black shadow-hard-sm">
            ${esc(SITE.inviteButton || 'שלח את המבחן לחברים')}
          </button>
          <button id="btn-save"
                  class="cta-btn w-full rounded-xl border-[3px] border-ink bg-white px-5 py-3.5 text-base font-bold shadow-hard-sm">
            שמור תמונה
          </button>
        </div>

        <!-- שיתוף — הפעולה המרכזית -->
        <div class="rounded-2xl border-[3px] border-ink bg-brand p-6 shadow-hard sm:p-7">
          <p class="mb-1 text-center text-2xl font-black">שתף את התוצאה שלך</p>
          <p class="mb-5 text-center text-sm font-medium text-ink/70">
            בחר רשת — הטקסט והקישור כבר מוכנים
          </p>

          <div class="grid grid-cols-2 gap-3">
            ${sharePlatformButtons()}
          </div>
        </div>

        <!-- הנעה לפעולה -->
        <div class="flex flex-col gap-2.5">
          <a href="${esc(SITE.episodesUrl)}" target="_blank" rel="noopener"
             class="cta-btn block w-full rounded-xl border-[3px] border-ink bg-brand px-5 py-4 text-center text-lg font-black text-ink shadow-hard-sm">
            ${esc(SITE.episodesButton)}
          </a>

          <button id="btn-restart"
                  class="cta-btn w-full rounded-xl border-[3px] border-ink bg-white px-5 py-3.5 text-base font-bold shadow-hard-sm">
            בצע את המבחן שוב
          </button>
        </div>

      </section>
    `, () => {
      document.getElementById('btn-save').addEventListener('click', saveStoryImage);
      document.getElementById('btn-copy').addEventListener('click', copyResultLink);
      document.getElementById('btn-restart').addEventListener('click', renderIntro);

      app.querySelectorAll('[data-platform]').forEach(btn => {
        btn.addEventListener('click', () => shareTo(btn.dataset.platform, winner));
      });
    });
  }


  /* ---------------------------------------------------------------------- */
  /* כרטיס הסטורי 9:16                                                       */
  /* ---------------------------------------------------------------------- */

  const STORY_W = 1080;
  const STORY_H = 1920;

  /**
   * הכרטיס נבנה תמיד בגודל מלא 1080×1920 עם סגנונות inline,
   * כדי שהתמונה שנשמרת תהיה זהה בדיוק לתצוגה המקדימה.
   * התצוגה על המסך מוקטנת בעזרת transform בלבד.
   */
  function storyCardHTML(character) {
    const accent = character.accent;

    return `
      <div id="story-card" style="
            width:${STORY_W}px; height:${STORY_H}px;
            position:relative; overflow:hidden;
            background:#E7CAA6;
            font-family:Heebo, Assistant, system-ui, sans-serif;
            color:#2C292E; direction:rtl; text-align:center;">

        <!-- רצועת צבע עליונה -->
        <div style="position:absolute; top:0; right:0; left:0; height:26px; background:${accent};"></div>

        <!-- כתם צבע רקע -->
        <div style="position:absolute; top:330px; left:50%; width:860px; height:860px;
                    margin-left:-430px; border-radius:50%; background:${accent}; opacity:.16;"></div>

        <!-- תוכן -->
        <div style="position:absolute; inset:0; display:flex; flex-direction:column;
                    align-items:center; justify-content:space-between;
                    padding:90px 80px 80px;">

          <!-- ראש -->
          <div>
            <div style="display:inline-block; background:#2C292E; color:#FFF8EE;
                        font-family:'Courier New', monospace; font-size:34px;
                        padding:12px 26px; border-radius:14px; letter-spacing:1px;">
              ${esc(SITE.brandTag)}
            </div>
            <div style="margin-top:40px; font-size:40px; font-weight:500; opacity:.7;">
              יצא לי
            </div>
          </div>

          <!-- מרכז -->
          <div style="display:flex; flex-direction:column; align-items:center; margin-top:-40px;">

            <!-- התמונה. שני דברים שנעשים כאן בכוונה בגלל html2canvas:
                 הצל נבנה כאלמנט ולא כ-box-shadow, והתמונה מוצגת כרקע CSS
                 ולא כתגית img, כי הספרייה מתעלמת מ-object-fit ומותחת את התמונה. -->
            <div style="position:relative; width:820px; height:615px;">
              <div style="position:absolute; top:24px; right:-24px; width:820px; height:615px;
                          border-radius:40px; background:${accent};"></div>
              <div style="position:absolute; top:0; right:0; width:820px; height:615px;
                          border-radius:40px; border:14px solid #2C292E; box-sizing:border-box;
                          background-image:url('${esc(resultImageOf(character))}');
                          background-size:cover; background-position:center center;
                          background-repeat:no-repeat;"></div>
            </div>

            <div style="margin-top:56px; font-size:140px; font-weight:900; line-height:1; color:${accent};">
              ${esc(character.name)}
            </div>
          </div>

          <!-- תחתית -->
          <div style="width:100%; border-top:5px solid #2C292E; padding-top:38px;
                      font-size:38px; font-weight:700;">
            ${esc(SITE.storyFooter)}
          </div>

        </div>
      </div>
    `;
  }



  /* ---------------------------------------------------------------------- */
  /* שמירת הכרטיס כתמונה                                                     */
  /* ---------------------------------------------------------------------- */

  async function saveStoryImage() {
    const card = document.getElementById('story-card');
    const button = document.getElementById('btn-save');
    if (!card) return;

    const originalLabel = button ? button.textContent : '';
    if (button) {
      button.textContent = 'מכין…';
      button.disabled = true;
    }

    try {
      const canvas = await html2canvas(card, {
        width: STORY_W,
        height: STORY_H,
        windowWidth: STORY_W,
        windowHeight: STORY_H,
        scale: 1,
        useCORS: true,
        backgroundColor: '#E7CAA6',
        logging: false,
        onclone: (clonedDoc) => {
          const frame = clonedDoc.getElementById('story-frame');
          if (frame) { frame.style.position = 'static'; frame.style.left = '0'; }
        }
      });

      const link = document.createElement('a');
      link.download = 'open-space-story.png';
      link.href = canvas.toDataURL('image/png');
      link.click();

      toast('התמונה נשמרה');
    } catch (err) {
      console.error(err);
      toast('לא הצלחתי לשמור. נסה שוב');
    } finally {
      if (button) {
        button.textContent = originalLabel;
        button.disabled = false;
      }
    }
  }


  /* ---------------------------------------------------------------------- */
  /* שיתוף                                                                   */
  /* ---------------------------------------------------------------------- */

  /** העתקה ללוח עם נפילה ל-execCommand לדפדפנים ישנים ולהקשרים לא מאובטחים */
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) { /* הקשר לא מאובטח או הרשאה נדחתה — ממשיכים לנפילה */ }
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.top = '0';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    helper.setSelectionRange(0, text.length);

    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(helper);
    return ok;
  }

  /** האם הדף רץ מכתובת אמיתית באינטרנט (ולא כקובץ מקומי במחשב) */
  function isLive() {
    return /^https?:\/\//i.test(shareLink());
  }

  /** נוסח ההודעה עבור דמות מסוימת */
  function messageFor(character) {
    return SITE.shareText.replace('{name}', character.name);
  }

  /* --- הגדרות הפלטפורמות -------------------------------------------------
     icon = צורה גנרית פשוטה. אלה אינם הלוגואים הרשמיים של הפלטפורמות,
            אלא אייקונים ניטרליים — הזיהוי מגיע מהצבע ומהשם.
     ---------------------------------------------------------------------- */

  /* הרשתות שאפשר לעקוב אחריהן. האייקונים שמורים מקומית ב-images/social
     כדי שלא יהיו תלויים בשירות חיצוני. */
  const FOLLOW = {
    linkedin:  { label: 'לינקדאין',  slug: 'linkedin',  color: '#0A66C2' },
    instagram: { label: 'אינסטגרם',  slug: 'instagram', color: 'linear-gradient(45deg,#F9A03F,#E4405F,#833AB4)' },
    tiktok:    { label: 'טיקטוק',    slug: 'tiktok',    color: '#111111' },
    youtube:   { label: 'יוטיוב',    slug: 'youtube',   color: '#FF0000' },
    facebook:  { label: 'פייסבוק',   slug: 'facebook',  color: '#1877F2' }
  };

  function iconUrl(slug) {
    return `images/social/${slug}.svg`;
  }

  const PLATFORMS = {
    whatsapp:  { label: 'וואטסאפ',   slug: 'whatsapp',  style: 'background:#25D366;' },
    facebook:  { label: 'פייסבוק',   slug: 'facebook',  style: 'background:#1877F2;' },
    linkedin:  { label: 'לינקדאין',  slug: 'linkedin',  style: 'background:#0A66C2;' },
    instagram: { label: 'אינסטגרם',  slug: 'instagram', style: 'background:linear-gradient(45deg,#F9A03F,#E4405F,#833AB4);' }
  };

  function sharePlatformButtons() {
    const list = (SITE.sharePlatforms && SITE.sharePlatforms.length)
      ? SITE.sharePlatforms
      : Object.keys(PLATFORMS);

    return list.filter(key => PLATFORMS[key]).map(key => {
      const p = PLATFORMS[key];
      return `
        <button data-platform="${key}"
                class="cta-btn flex items-center justify-center gap-2.5 rounded-xl border-[3px] border-ink
                       px-3 py-4 text-base font-black text-white shadow-hard-sm"
                style="${p.style}">
          <img src="${iconUrl(p.slug)}" alt="" class="h-6 w-6 shrink-0">
          <span>${esc(p.label)}</span>
        </button>`;
    }).join('');
  }


  /* --- פעולות השיתוף ------------------------------------------------------ */

  function openShareWindow(url) {
    window.open(url, '_blank', 'noopener,noreferrer,width=640,height=640');
  }

  async function shareTo(platform, character) {
    const message = messageFor(character);
    const url = shareLink();
    const live = isLive();

    if (platform === 'instagram') {
      return shareToInstagram(character);
    }

    // וואטסאפ עובד גם בלי קישור אמיתי — פשוט שולח את הטקסט
    if (platform === 'whatsapp') {
      const text = live ? `${message} ${url}` : message;
      openShareWindow('https://wa.me/?text=' + encodeURIComponent(text));
      if (!live) toast('רץ מקומית — הקישור יתווסף אחרי ההעלאה לאוויר');
      return;
    }

    // פייסבוק ולינקדאין מקבלים כתובת בלבד, וחייבים כתובת אמיתית
    if (!live) {
      const copied = await copyToClipboard(message);
      toast(copied
        ? 'הטקסט הועתק. שיתוף לרשת הזאת יעבוד רק אחרי ההעלאה לאוויר'
        : 'שיתוף לרשת הזאת יעבוד רק אחרי ההעלאה לאוויר');
      return;
    }

    if (platform === 'facebook') {
      openShareWindow('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url));
    } else if (platform === 'linkedin') {
      openShareWindow('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url));
    }
  }

  /**
   * אינסטגרם לא מאפשרת לאתרים להכין פוסט או סטורי מראש — אין לה קישור שיתוף.
   * הזרימה היחידה שעובדת: שומרים את התמונה, מעתיקים את הקישור,
   * והמשתמש מעלה לסטורי ומדביק קישור בסטיקר או בביו.
   */
  async function shareToInstagram(character) {
    const message = messageFor(character);
    const url = shareLink();
    const live = isLive();

    await saveStoryImage();
    await copyToClipboard(live ? `${message} ${url}` : message);

    toast(live
      ? 'התמונה נשמרה והקישור הועתק — העלה לאינסטגרם והדבק את הקישור'
      : 'התמונה נשמרה. הקישור יהיה זמין אחרי ההעלאה לאוויר');
  }

  async function copyResultLink() {
    const message = SITE.inviteText || 'בואו תגלו איזו דמות אתם:';
    const url = shareLink();
    const live = isLive();

    // בנייד יש תפריט שיתוף מובנה — הוא הדבר שהמשתמש באמת מצפה לו:
    // נפתחת רשימת האפליקציות והוא בוחר לאן לשלוח.
    if (live && navigator.share) {
      try {
        await navigator.share({ title: SITE.title || '', text: message, url });
        return;
      } catch (err) {
        // המשתמש ביטל — לא מציגים שגיאה, ולא ממשיכים להעתקה
        if (err && err.name === 'AbortError') return;
        // כל שגיאה אחרת: ממשיכים לנתיב ההעתקה שלמטה
      }
    }

    const copied = await copyToClipboard(live ? `${message} ${url}` : message);

    if (!live) {
      toast(copied
        ? 'הטקסט הועתק. הקישור יתווסף אחרי ההעלאה לאוויר'
        : 'רץ מקומית — השיתוף יעבוד אחרי ההעלאה לאוויר');
      return;
    }

    if (copied) {
      toast('הקישור למבחן הועתק!');
      return;
    }

    // ההעתקה נחסמה (הרשאה, דפדפן מוטמע, הקשר לא מאובטח).
    // טוסט שנעלם אחרי שתי שניות לא עוזר — מציגים את הקישור בחלון
    // שאפשר לסמן ממנו ולהעתיק ידנית.
    window.prompt('העתק את הקישור למבחן:', `${message} ${url}`);
  }


  /* ---------------------------------------------------------------------- */
  /* פוטר קבוע — מוצג בכל מסכי המבחן                                         */
  /* ---------------------------------------------------------------------- */

  /** אייקוני הרשתות בלבד, בלי טקסט */
  function followIcons(sizeClass = 'h-14 w-14', imgClass = 'h-7 w-7') {
    const links = SITE.followLinks || {};
    return Object.keys(FOLLOW)
      .filter(k => links[k] && String(links[k]).trim())
      .map(k => {
        const p = FOLLOW[k];
        return `
          <a href="${esc(String(links[k]).trim())}" target="_blank" rel="noopener"
             aria-label="${esc(p.label)}" title="${esc(p.label)}"
             class="cta-btn flex ${sizeClass} items-center justify-center rounded-full border-[3px] border-ink shadow-hard-sm"
             style="background:${p.color};">
            <img src="${iconUrl(p.slug)}" alt="" class="${imgClass}" loading="lazy">
          </a>`;
      }).join('');
  }

  /** הלוגו הקבוע מעל הכרטיס */
  function renderHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;
    header.innerHTML = `
      <span class="flex h-14 items-center rounded-xl border-[3px] border-ink px-5
                   font-mono text-xl font-bold text-card shadow-hard sm:text-2xl"
            style="background:#4A4551;">
        ${esc(SITE.brandTag)}
      </span>`;
  }

  /** אייקוני מעקב וכפתור הפרקים — הכל בשורה אחת מתחת לכרטיס */
  function renderFooter() {
    const footer = document.getElementById('site-footer');
    if (!footer) return;

    footer.innerHTML = `
      <div class="flex flex-wrap items-center justify-center gap-3">
        ${followIcons()}
        <a href="${esc(SITE.episodesUrl)}" target="_blank" rel="noopener"
           class="cta-btn flex h-14 items-center rounded-full border-[3px] border-ink bg-white px-6
                  text-lg font-black shadow-hard-sm">
          ${esc(SITE.episodesButton)}
        </a>
      </div>
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* הפעלה                                                                   */
  /* ---------------------------------------------------------------------- */

  renderHeader();
  renderFooter();
  renderIntro();

})();
