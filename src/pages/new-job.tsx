import { useEffect, useRef, useState } from "react";
import type { BookResponse, Capabilities, CastingRequest, JobRequest, PreflightResponse, VoiceResponse } from "../api/generated/v1";
import { KenkuiServerClient } from "../api/client";
import { Casting } from "../components/casting";
import type { CastingValue } from "../components/casting";
import { ChapterSelection } from "../components/chapter-selection";
import { ErrorMessage } from "../components/error-message";
import { FileUpload } from "../components/file-upload";
import { OutputSettings } from "../components/output-settings";
import { TtsSettings } from "../components/tts-settings";
import { VoiceSelect } from "../components/voice-select";

interface NewJobPageProps { client: KenkuiServerClient; capabilities: Capabilities; onCreated(jobId: string): void }
const steps = ["Source", "Chapters", "Casting", "Synthesis", "Output", "Review"];

export function NewJobPage({ client, capabilities, onCreated }: NewJobPageProps) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File>();
  const [book, setBook] = useState<BookResponse>();
  const [chapters, setChapters] = useState<string[]>([]);
  const [voices, setVoices] = useState<VoiceResponse[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [casting_, setCasting] = useState<CastingValue>({});
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sourceCover, setSourceCover] = useState(true);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<string>(capabilities.outputFormats?.[0] ?? "m4b");
  const [preflight, setPreflight] = useState<PreflightResponse>();
  const [error, setError] = useState<unknown>();
  const key = useRef(crypto.randomUUID());

  useEffect(() => { void client.voices().then(({ items }) => { setVoices(items); setVoiceId((current) => current || items[0]?.id || ""); }).catch(setError); }, [client]);
  // A model id is what makes this character casting; without one the server
  // reads it as a single narrator, exactly as before.
  const casting = (): CastingRequest => casting_.modelId
    ? { narratorVoiceId: casting_.narratorVoiceId ?? voiceId, unknownVoiceId: casting_.unknownVoiceId, method: casting_.method ?? "gendered", modelId: casting_.modelId }
    : { voiceId: voiceId! };
  const chosen = () => casting_.modelId ? (casting_.narratorVoiceId ?? voiceId) : voiceId;
  const payload = (): JobRequest | undefined => book && chosen() ? { sourceId: book.sourceId, chapters, casting: casting(), tts: { normalizeText: true }, output: { format, title: title.trim() || null, author: author.trim() || null, sourceCover } } : undefined;
  const inspect = async () => {
    if (!file) { setError(new Error("Choose an EPUB source first.")); return; }
    if (busy) return;
    if (file.size > (capabilities.maxUploadBytes ?? 50 * 1024 * 1024)) { setError(new Error("This EPUB exceeds the server upload limit.")); return; }
    setBusy(true);
    try { const asset = await client.upload(file); const nextBook = await client.inspectBook(asset.id); setBook(nextBook); setTitle(nextBook.title); setAuthor(nextBook.author); setChapters(nextBook.chapters.map((chapter) => chapter.id)); setStep(1); setError(undefined); } catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  const review = async () => {
    const request = payload();
    if (!request || request.chapters.length === 0) { setError(new Error("Select at least one chapter and one voice.")); return; }
    if (busy) return;
    setBusy(true);
    try {
      const result = await client.preflight(request);
      setPreflight(result);
      setStep(5);
      setError(undefined);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  const submit = async () => {
    const request = payload();
    if (!request || !preflight || preflight.valid === false || busy) return;
    setBusy(true);
    try { const job = await client.createJob(request, key.current); onCreated(job.id); } catch (cause) { setError(cause); } finally { setBusy(false); }
  };

  return <main><h1>New job</h1><ol>{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}>{label}</li>)}</ol><ErrorMessage error={error} />{busy && <p role="status">Working…</p>}<fieldset disabled={busy} style={{ border: 0, padding: 0 }}><legend>Job configuration</legend>{step > 0 && <button type="button" onClick={() => { setStep(step - 1); setPreflight(undefined); key.current = crypto.randomUUID(); }}>Back</button>}
    {step === 0 && <section><h2>Source</h2><FileUpload file={file} formats={capabilities.sourceFormats ?? ["epub"]} onChange={setFile} /><button type="button" onClick={inspect}>Inspect source</button></section>}
    {step === 1 && <section><h2>Chapters</h2>{book && <ChapterSelection chapters={book.chapters} selected={chapters} onChange={setChapters} />}<button type="button" onClick={() => setStep(2)} disabled={chapters.length === 0}>Continue to casting</button></section>}
    {step === 2 && <section><h2>Casting</h2><Casting modes={capabilities.casting?.modes ?? ["single"]} voices={voices} value={casting_} onChange={setCasting} />{!capabilities.casting?.modes?.includes("characters") && <VoiceSelect voices={voices} selected={voiceId} onChange={setVoiceId} />}<button type="button" onClick={() => setStep(3)} disabled={!chosen()}>Continue to synthesis</button></section>}
    {step === 3 && <section><h2>Synthesis</h2><TtsSettings /><button type="button" onClick={() => setStep(4)}>Continue to output</button></section>}
    {step === 4 && <section><h2>Output</h2><OutputSettings formats={capabilities.outputFormats ?? ["m4b"]} format={format} onChange={setFormat} /><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} /></label><label>Author<input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={500} /></label><label><input type="checkbox" checked={sourceCover} onChange={(event) => setSourceCover(event.target.checked)} />Use book cover</label><button type="button" onClick={review}>Review job</button></section>}
    {step === 5 && <section><h2>Review</h2><p>{chapters.length} chapter(s), {voices.find((voice) => voice.id === voiceId)?.name ?? "no voice"}, {format.toUpperCase()}</p>{preflight && <p>{preflight.normalizedCharacters} normalized characters</p>}{preflight?.estimatedCredits != null && <p>Estimated usage: {preflight.estimatedCredits} credits. Available: {preflight.availableCredits} credits.</p>}{preflight?.valid === false && <p role="alert">The server rejected this job configuration.</p>}<button type="button" onClick={submit} disabled={!preflight || preflight.valid === false}>Start job</button></section>}
  </fieldset></main>;
}
