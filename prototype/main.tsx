import {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import voices from './voices.json';
import {useAudioPlayer, Wave} from './audio-player';
import {bookPrice, defaultCast, dollars, freshStudio, quote, readStudio, seed, speechCharacters, uid, type Book, type Narration} from './model';
import './style.css';

function Cover({book}: {book: Book}) {
  return <div className={'cover ' + book.style}>{book.cover
    ? <img src={book.cover} alt={`Uploaded cover for ${book.title}`} />
    : <><div className="cover-rule"/><span className="cover-edition">KENKUI · LIBRARY EDITION</span>
      <strong>{book.title}</strong><span className="cover-ornament" aria-hidden="true">{book.style === 'garden' ? '❧' : book.style === 'pride' ? '✳' : book.style === 'time' ? '◉' : '—'}</span>
      <span className="cover-author">{book.author || 'Untitled author'}</span><div className="cover-rule bottom"/></>}</div>;
}

function App() {
  const [studio, setStudio] = useState(readStudio);
  const {books, balance, ledger} = studio;
  const [active, setActive] = useState<string | null>(null);
  const [page, setPage] = useState<'books' | 'billing'>('books');
  const [menu, setMenu] = useState<string | null>(null);
  const [browser, setBrowser] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState('Narrator');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All accents');
  const [candidate, setCandidate] = useState('Clara');
  const [pack, setPack] = useState<number | null>(null);
  const [scene, setScene] = useState<Narration>('single');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('kenkui-prototype-theme') || 'system');
  const player = useAudioPlayer();
  const dialog = useRef<HTMLDialogElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const book = books.find(b => b.id === active);
  const menuBook = books.find(b => b.id === menu);
  const playing = player.playing;
  const stop = player.stop;

  function patch(id: string, change: Partial<Book>) {
    setStudio(s => ({...s, books: s.books.map(b => b.id === id ? {...b, ...change} : b)}));
  }
  useEffect(() => {
    try {localStorage.setItem('kenkui-prototype-v2', JSON.stringify(studio));}
    catch {setNotice('Your browser could not save this draft. Try a smaller cover image.');}
  }, [studio]);
  useEffect(() => {document.documentElement.dataset.theme = theme; localStorage.setItem('kenkui-prototype-theme', theme);}, [theme]);
  useEffect(() => {
    const timer = setInterval(() => setStudio(s => s.books.some(b => b.status === 'Creating') ? {
      ...s, books: s.books.map(b => b.status === 'Creating' ? {...b, progress: Math.min(100, b.progress + 2), status: b.progress >= 98 ? 'Ready' : 'Creating'} : b),
    } : s), 1200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (menu || browser || pack !== null) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [menu, browser, pack]);

  function home() {stop(); setActive(null); setPage('books');}
  function open(id: string) {stop(); setActive(id); setPage('books'); setMenu(null); setError(''); window.scrollTo({top: 0, behavior: 'smooth'});}
  function closeDialog() {stop(); setMenu(null); setBrowser(false); setPack(null);}
  function billing() {stop(); setPage('billing'); window.scrollTo({top: 0, behavior: 'smooth'});}
  function newBook(file?: File) {
    stop();
    if (file && !file.name.toLowerCase().endsWith('.epub')) {setError('Choose an EPUB file. You can also try the sample book.'); return;}
    const fresh: Book = {...structuredClone(seed[0]), id: uid(), title: file ? file.name.replace(/\.epub$/i, '').replace(/[_-]/g, ' ') : 'The Secret Garden', author: file ? '' : 'Frances Hodgson Burnett', style: file ? 'jane' : 'garden'};
    setStudio(s => ({...s, books: [fresh, ...s.books]})); setActive(fresh.id); setPage('books'); setError('');
    setNotice(file ? 'Prototype: the filename is used as the title. EPUB contents are not uploaded or parsed; credit estimates use illustrative text lengths.' : '');
  }
  function coverFile(file?: File) {
    if (!file || !book) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {setError('Choose a JPG, PNG, or WebP cover smaller than 2 MB.'); return;}
    const id = book.id, reader = new FileReader();
    reader.onload = () => {patch(id, {cover: String(reader.result)}); setError('');}; reader.readAsDataURL(file);
  }
  function advance() {if (book) {stop(); patch(book.id, {step: book.step + 1}); window.scrollTo({top: 0, behavior: 'smooth'});}}
  function start() {
    if (!book) return;
    stop();
    setStudio(s => {
      const current = s.books.find(b => b.id === book.id);
      if (!current || current.status !== 'Draft') return s;
      const credits = bookPrice(current);
      if (s.balance < credits) return s;
      return {...s, balance: s.balance - credits,
        books: s.books.map(b => b.id === current.id ? {...b, step: 3, status: 'Creating', progress: 0, reserved: credits} : b),
        ledger: [{id: uid(), label: `${current.title} · conversion reserved`, credits: -credits}, ...s.ledger]};
    });
  }
  function cancel() {
    if (!book) return;
    setStudio(s => {
      const current = s.books.find(b => b.id === book.id);
      if (!current || current.status !== 'Creating') return s;
      return {...s, balance: s.balance + current.reserved,
        books: s.books.map(b => b.id === current.id ? {...b, status: 'Draft', step: 3, progress: 0, reserved: 0} : b),
        ledger: [{id: uid(), label: `${current.title} · cancellation released`, credits: current.reserved}, ...s.ledger]};
    });
  }
  function reset() {stop(); setStudio(freshStudio()); setActive(null); setMenu(null); setBrowser(false); setPack(null); setPage('books'); setNotice('Sample books and demo balance reset.');}
  function chooseVoice(role: string, name: string) {stop(); setVoiceTarget(role); setCandidate(name); setQuery(''); setFilter('All accents'); setBrowser(true);}
  function applyVoice() {
    if (book) {
      if (voiceTarget === 'Narrator') patch(book.id, {voice: candidate});
      else if (voiceTarget === 'Unidentified speaker') patch(book.id, {unknown: candidate});
      else patch(book.id, {cast: book.cast.map(role => role.name === voiceTarget ? {...role, voice: candidate} : role)});
    }
    closeDialog();
  }
  function narration(mode: Narration) {if (book) {stop(); setScene(mode); patch(book.id, {narration: mode});}}
  function audition(name: string) {const v = voices.find(v => v.name === name); if (v) player.toggle(name, v.audio);}
  function sampleUrl(mode: Narration) {return `./audio/samples/${mode === 'cast' ? 'full-cast' : 'narrator'}.wav`;}
  function sceneMode(mode: Narration) {setScene(mode); if (playing?.startsWith('scene:')) player.switchClip(`scene:${mode}`, sampleUrl(mode));}
  function CreditEstimate({b}: {b: Book}) {
    const single = quote(speechCharacters(b), 'single'), total = bookPrice(b);
    return <div className="credit-estimate" aria-live="polite" aria-atomic="true">
      <div className="estimate-top"><span>Estimated conversion</span><strong data-testid="quote">{total} credits <small>{dollars(total)}</small></strong></div>
      <div className="estimate-details"><span>{speechCharacters(b).toLocaleString()} speech characters · {single} credits</span>{b.narration === 'cast' && <span>Full cast · 50% premium before rounding</span>}</div>
      <p>Demo estimate · illustrative text length. Final price is confirmed before creation.</p>
    </div>;
  }
  function ScenePreview() {
    return <section className="scene-preview" aria-label="Example scene preview">
      <div className="section-top"><h3>Hear the difference</h3><span className="free-badge">Free · 0 credits</span></div>
      <div className="scene-modes" role="group" aria-label="Example scene narration">
        <button aria-pressed={scene === 'single'} onClick={() => sceneMode('single')}>Single narrator</button>
        <button aria-pressed={scene === 'cast'} onClick={() => sceneMode('cast')}>Full cast</button>
      </div>
      <button className="preview-wide" aria-label={playing === `scene:${scene}` ? 'Pause example scene' : 'Play example scene'} onClick={() => player.toggle(`scene:${scene}`, sampleUrl(scene))}>
        <span className="play-circle">{playing === `scene:${scene}` ? 'Ⅱ' : '▶'}</span><span>{playing === `scene:${scene}` ? 'Playing example' : 'Play example'}</span><Wave active={playing === `scene:${scene}`} analyser={player.analyser}/>
      </button>
      <p className="quiet"><cite>Pride and Prejudice</cite>, chapter 1. Existing site recording; it does not reflect your book or cast choices.</p>
    </section>;
  }
  const voice = voices.find(v => v.name === book?.voice) || voices[0];
  const price = book ? bookPrice(book) : 0;
  const shownVoices = voices.filter(v => (v.name + ' ' + v.accent).toLowerCase().includes(query.toLowerCase()) && (filter === 'All accents' || v.accent === filter));

  return <>
    <header className="app-header"><button className="brand" onClick={home} aria-label="Kenkui Studio home"><span className="brand-mark" aria-hidden="true">◖</span>Kenkui <span>Studio</span></button>
      <div className="header-actions"><button className="text-button" onClick={() => {home(); setTimeout(() => document.getElementById('books')?.scrollIntoView({behavior: 'smooth'}), 30);}}>Your books</button>
        <button className="balance-button" onClick={billing} aria-label={`Billing, ${balance} demo credits`}><span aria-hidden="true">◈</span> {balance}<span className="balance-word"> credits</span></button>
        <label className="theme-label"><span className="sr-only">Appearance</span><select aria-label="Appearance" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">◐ System</option><option value="dark">☾ Dark</option><option value="light">☼ Light</option></select></label>
      </div></header>
    <div className="prototype-bar"><span className="small-dot"/>Interactive prototype <span className="bar-detail">· Real audio. Demo credits and conversions.</span><button onClick={reset}>Reset demo</button></div>
    <main>
      {(error || player.error) && <div className="message error" role="alert">{error || player.error}<button aria-label="Dismiss error" onClick={() => {setError(''); player.clearError();}}>×</button></div>}
      {notice && <div className="message" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
      {page === 'billing' ? <section className="billing-page">
        <button className="text-button" onClick={() => {setPage('books'); stop();}}>← {book ? 'Back to your book' : 'Your books'}</button>
        <div className="section-top"><div><div className="eyebrow">ACCOUNT</div><h1>Credits & billing</h1></div><span className="free-badge">Demo account</span></div>
        <div className="balance-panel"><div><span className="quiet">Available balance</span><strong>{balance.toLocaleString()} <span>credits</span></strong><p>{dollars(balance)} · 100 credits = $1 USD</p></div><span className="balance-art" aria-hidden="true">◈</span></div>
        <h2>Add credits</h2><p className="muted">Choose a pack. This prototype never takes payment.</p>
        <div className="credit-packs">{[500, 1000, 2000].map(n => <button key={n} className="credit-pack" onClick={() => setPack(n)}><strong>{n.toLocaleString()}</strong><span>credits</span><b>{dollars(n)}</b><span className="accent">Preview checkout →</span></button>)}</div>
        <p className="quiet">Production checkout uses Stripe. Applicable tax is shown before payment.</p>
        <div className="billing-columns"><section><h2>How estimates work</h2><ul className="pricing-rules"><li>Selected speech text determines the base cost.</li><li>Full cast adds 50% before rounding to whole credits.</li><li>Voice choice, cover and title do not add a surcharge.</li><li>Catalog auditions and these recorded example scenes use no credits.</li><li>Credits are reserved when creation starts. Cancellation or failure releases the reservation.</li></ul><p className="quiet">Custom book previews will show their price before generation. They are not connected in this prototype.</p></section>
          <section><h2>Credit activity</h2><div className="ledger">{ledger.map(t => <div key={t.id}><span>{t.label}</span><strong>{t.credits > 0 ? '+' : ''}{t.credits}</strong></div>)}</div></section></div>
      </section> : !book ? <>
        <section className="new-book"><div className="section-top"><h1>New audiobook</h1><span className="quiet">EPUB → Audio</span></div>
          <div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault(); if (e.dataTransfer.files[0]) newBook(e.dataTransfer.files[0]);}}><div className="upload-icon" aria-hidden="true">↥</div><div><h2>Add your book</h2><p>Choose an EPUB or drop it here.</p></div><button className="primary" onClick={() => upload.current?.click()}>Choose file <span aria-hidden="true">↗</span></button><input ref={upload} type="file" accept=".epub" hidden onChange={e => {if (e.target.files?.[0]) newBook(e.target.files[0]); e.target.value = '';}}/></div>
          <div className="sample-row"><span>Just exploring?</span><button className="text-button accent" onClick={() => newBook()}>Try a sample book <span aria-hidden="true">→</span></button></div>
        </section>
        <section id="books" className="library"><div className="section-top"><h2>Your books</h2><span className="quiet">{books.length} books</span></div><div className="book-grid">{books.map(b => <article key={b.id}><button className="book-tile" onClick={() => setMenu(b.id)} aria-label={`${b.title} — ${b.status}, open actions`}><Cover book={b}/><span className={'status-badge ' + b.status.toLowerCase()}><span className="status-dot"/>{b.status === 'Creating' ? `Creating · ${b.progress}%` : b.status}</span>{b.status === 'Creating' && <span className="cover-progress" style={{width: `${b.progress}%`}}/>}</button><p className="book-title" title={b.title}>{b.title}</p></article>)}</div></section>
      </> : <>
        <div className="workspace-top"><button className="text-button" onClick={home}>← Your books</button><span className="saved">✓ Saved on this browser</span></div>
        <ol className="steps" aria-label="Conversion steps">{['Book', 'Voices', 'Create'].map((name, i) => <li key={name} aria-current={book.step === i + 1 ? 'step' : undefined}><button disabled={book.status !== 'Draft' || i + 1 > book.step} onClick={() => {stop(); patch(book.id, {step: i + 1});}}><span>{book.step > i + 1 ? '✓' : i + 1}</span>{name}</button></li>)}</ol>
        <div className="workspace"><aside className="book-identity"><Cover book={book}/><div className="identity-copy"><h1>{book.title}</h1><p>{book.author || 'Author not provided'}</p><span className="quiet">{book.chapters} · {book.narration === 'cast' ? 'Full cast' : 'Single narrator'}</span></div></aside>
          <section className="editor" key={`${book.id}-${book.step}-${book.status}`}>
            {book.status !== 'Draft' ? <>
              <div className="eyebrow">{book.status === 'Ready' ? 'READY TO LISTEN' : 'CREATING YOUR AUDIOBOOK'}</div><h2>{book.status === 'Ready' ? 'Your audiobook is ready' : 'Bringing your book to life'}</h2><p className="muted">{book.voice}{book.narration === 'cast' ? ' + cast' : ''} · {book.format}</p>
              {book.status === 'Creating' ? <><div className="progress-heading"><span>Converting chapters</span><strong>{book.progress}%</strong></div><progress max="100" value={book.progress}/><p className="quiet">About {Math.max(1, Math.ceil((100 - book.progress) * .6))} seconds left in this demo</p><p className="quiet">{book.reserved} demo credits reserved. Cancellation returns them.</p><details><summary>Chapter details</summary><div className="chapter-list">{['The beginning', 'A new arrival', 'An unexpected discovery', 'The story continues'].map((c, i) => <div key={c}><span>{i + 1}. {c}</span><span>{book.progress >= (i + 1) * 25 ? '✓ Complete' : book.progress >= i * 25 ? 'Creating…' : 'Waiting'}</span></div>)}</div></details><button className="text-button" onClick={cancel}>Cancel conversion</button></>
              : <><div className="ready-symbol" aria-hidden="true">✓</div><p>The conversion is simulated. This demo result plays the existing site’s {book.narration === 'cast' ? 'full-cast' : 'single-narrator'} recording.</p><button className="preview-wide" aria-label="Play demo result" onClick={() => player.toggle('result', sampleUrl(book.narration))}><span className="play-circle">{playing === 'result' ? 'Ⅱ' : '▶'}</span><span>{playing === 'result' ? 'Pause result' : 'Play result'}</span><Wave active={playing === 'result'} analyser={player.analyser}/></button><a className="primary download" href={sampleUrl(book.narration)} download="kenkui-example-scene.wav">Download example <span aria-hidden="true">↓</span></a><p className="quiet">Example scene only · WAV · {book.reserved} demo credits used</p></>}
              <div className="editor-footer"><button className="secondary" onClick={home}>Back to your books</button></div>
            </> : book.step === 1 ? <>
              <div className="eyebrow">01 / BOOK</div><h2>Book details</h2><p className="muted">A quick check before choosing voices.</p>
              <label>Title<input value={book.title} maxLength={500} onChange={e => patch(book.id, {title: e.target.value})}/></label><label>Author<input value={book.author} maxLength={500} placeholder="Author name" onChange={e => patch(book.id, {author: e.target.value})}/></label>
              <div className="cover-controls"><label className="secondary file-button">Upload cover<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => coverFile(e.target.files?.[0])}/></label>{book.cover && <button className="text-button" onClick={() => patch(book.id, {cover: undefined})}>Remove cover</button>}</div>
              <details><summary>Advanced</summary><div className="settings-grid"><label>Chapters<select aria-label="Chapters" value={book.chapters} onChange={e => patch(book.id, {chapters: e.target.value})}><option>All chapters</option><option>First chapter only</option></select><small>Fewer speech characters lowers the estimate.</small></label><p className="quiet">Text is always prepared for speech. Cover and metadata changes do not change the credit estimate.</p></div></details>
              <CreditEstimate b={book}/><div className="editor-footer"><button className="text-button" onClick={home}>Save and close</button><button className="primary" disabled={!book.title.trim()} onClick={advance}>Continue <span aria-hidden="true">→</span></button></div>
            </> : book.step === 2 ? <>
              <div className="eyebrow">02 / VOICES</div><h2>Narration</h2><p className="muted">One voice for the whole book, or a voice for each character.</p>
              <div className="narration-options" role="group" aria-label="Narration style"><button aria-pressed={book.narration === 'single'} onClick={() => narration('single')}><strong>Single narrator</strong><span>One voice throughout</span><small>{quote(speechCharacters(book), 'single')} credits</small></button><button aria-pressed={book.narration === 'cast'} onClick={() => narration('cast')}><strong>Full cast</strong><span>Narrator + characters</span><small>{quote(speechCharacters(book), 'cast')} credits · +50%</small></button></div>
              <div className="cast-list"><div className="cast-row"><div><span className="quiet">Narrator</span><strong>{book.voice}</strong><span className="quiet">{voice.accent}</span></div><button className="secondary" onClick={() => chooseVoice('Narrator', book.voice)}>Change voice</button></div>
                {book.narration === 'cast' && <><div className="cast-note">Example cast · <cite>Pride and Prejudice</cite><p>These sample characters demonstrate assignment. Your book’s characters will appear after analysis.</p></div>{book.cast.map(role => <div className="cast-row" key={role.name}><div><span className="quiet">{role.name}</span><strong>{role.voice}</strong></div><button className="secondary" aria-label={`Change voice for ${role.name}`} onClick={() => chooseVoice(role.name, role.voice)}>Change voice</button></div>)}</>}
              </div>
              <p className="quiet audition-note">Listen to free samples in the voice picker. Changing a voice does not change the price.</p>
              <details><summary>Advanced</summary>{book.narration === 'cast' ? <div className="settings-grid"><label>Automatic assignment<select aria-label="Automatic assignment" value={book.method} onChange={e => patch(book.id, {method: e.target.value})}><option>Match character voices</option><option>Any available voice</option></select><small>Same price for either assignment method.</small></label><label>Unidentified speaker<select aria-label="Unidentified speaker" value={book.unknown} onChange={e => patch(book.id, {unknown: e.target.value})}><option>Narrator</option>{voices.map(v => <option key={v.name}>{v.name}</option>)}</select><small>Used when a line cannot be attributed.</small></label><button className="text-button" onClick={() => patch(book.id, {cast: structuredClone(defaultCast), unknown: 'Narrator'})}>Reset example cast</button></div> : <p className="quiet">The narrator reads all dialogue and narration. Full cast adds character attribution; choosing the same voice for every role still uses full-cast processing.</p>}</details>
              <CreditEstimate b={book}/><div className="editor-footer"><button className="secondary" onClick={() => {stop(); patch(book.id, {step: 1});}}>Back</button><button className="primary" onClick={() => {setScene(book.narration); advance();}}>Continue <span aria-hidden="true">→</span></button></div>
            </> : <>
              <div className="eyebrow">03 / CREATE</div><h2>Preview & create</h2><p className="muted">Check the narration and the estimate before starting.</p>
              {ScenePreview()}
              <details><summary>Preview your own book</summary><p className="quiet">Personalized excerpts will use your text and chosen voices. Custom book previews are not connected in this prototype.</p><button className="secondary" disabled>Custom preview unavailable</button><p className="quiet">A price must be shown before generating a custom preview. Existing samples above are free.</p></details>
              <dl className="review"><div><dt>Narration</dt><dd>{book.narration === 'cast' ? 'Full cast' : 'Single narrator'}<button className="text-button" onClick={() => {stop(); patch(book.id, {step: 2});}}>Change</button></dd></div><div><dt>Narrator</dt><dd>{book.voice}</dd></div><div><dt>Chapters</dt><dd>{book.chapters}<button className="text-button" onClick={() => {stop(); patch(book.id, {step: 1});}}>Change</button></dd></div><div><dt>Format</dt><dd>M4B</dd></div></dl>
              <CreditEstimate b={book}/><div className="balance-check"><span>Available: {balance} credits</span><button className="text-button accent" onClick={billing}>Add credits</button></div>
              {balance < price ? <p className="insufficient" role="status">You need {price - balance} more credits. Add credits or adjust narration or chapters.</p> : <p className="quiet">{balance - price} credits remaining after reservation. Cancelled or failed conversions return the reservation.</p>}
              <div className="editor-footer"><button className="secondary" onClick={() => {stop(); patch(book.id, {step: 2});}}>Back</button><button className="primary" disabled={balance < price} onClick={start}>Create · {price} credits <span aria-hidden="true">→</span></button></div><p className="quiet demo-footnote">Demo balance only. No payment or real conversion.</p>
            </>}
          </section></div>
      </>}
    </main>
    <footer className="site-footer"><span>Kenkui Studio</span><span>Design prototype · Saved in this browser</span></footer>
    <dialog ref={dialog} className={browser ? 'voice-dialog' : 'book-dialog'} onCancel={closeDialog} onClick={e => {if (e.target === e.currentTarget) closeDialog();}} aria-labelledby="dialog-title">
      <div className="dialog-top"><h2 id="dialog-title">{browser ? 'Find your voice' : pack !== null ? 'Checkout preview' : menuBook?.title}</h2><button className="icon-button" aria-label="Close dialog" onClick={closeDialog}>×</button></div>
      {browser ? <>
        <p className="muted">For {voiceTarget} · Auditions are free.</p><div className="voice-filters"><label><span className="sr-only">Search voices</span><input autoFocus placeholder="Search by name or accent" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Filter by accent" value={filter} onChange={e => setFilter(e.target.value)}><option>All accents</option>{[...new Set(voices.map(v => v.accent))].map(a => <option key={a}>{a}</option>)}</select></div>
        <div className="voice-list">{shownVoices.map(v => <div className={'voice-row ' + (candidate === v.name ? 'chosen' : '')} key={v.name}><button className="audition" aria-label={`${playing === v.name ? 'Pause' : 'Preview'} ${v.name}`} onClick={() => audition(v.name)}>{playing === v.name ? 'Ⅱ' : '▶'}</button><button className="voice-choice" onClick={() => setCandidate(v.name)} aria-pressed={candidate === v.name}><strong>{v.name}</strong><span>{v.accent} · {v.gender}</span></button>{playing === v.name ? <Wave active analyser={player.analyser}/> : <span className="selection-dot" aria-hidden="true">{candidate === v.name ? '✓' : ''}</span>}</div>)}{!shownVoices.length && <p className="empty">No voices match. Try another name or accent.</p>}</div>
        {player.error && <p role="alert">{player.error}</p>}<div className="dialog-footer"><span className="quiet">{candidate} selected</span><button className="primary" onClick={applyVoice}>Use {candidate}</button></div>
      </> : pack !== null ? <><div className="checkout-summary"><strong>{pack.toLocaleString()} credits</strong><span>{dollars(pack)} USD before tax</span></div><p>This is a simulated checkout. No card details or payment are collected.</p><p className="quiet">The real site will open Stripe checkout and credit your account after payment confirmation.</p><button className="primary full" onClick={() => {const amount = pack; setStudio(s => ({...s, balance: s.balance + amount, ledger: [{id: uid(), label: 'Simulated credit pack', credits: amount}, ...s.ledger]})); closeDialog();}}>Add {pack.toLocaleString()} demo credits</button></>
      : menuBook && <><div className="menu-book"><Cover book={menuBook}/><div><span className="menu-status">{menuBook.status === 'Creating' ? `Creating · ${menuBook.progress}%` : menuBook.status}</span><p>{menuBook.author}</p><span className="quiet">{menuBook.narration === 'cast' ? 'Full cast' : menuBook.voice} · {menuBook.format}</span></div></div><button className="primary full" onClick={() => open(menuBook.id)}>{menuBook.status === 'Draft' ? 'Continue setup' : menuBook.status === 'Creating' ? 'View progress' : 'Listen & download'} <span aria-hidden="true">→</span></button><p className="quiet">{menuBook.status === 'Ready' ? 'Demo result uses an existing example scene.' : 'Your choices are saved in this browser.'}</p></>}
    </dialog>
  </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
