import { useEffect, useMemo, useRef, useState } from "react";
import type { KenkuiServerClient } from "../api/client";
import type {
  Capabilities,
  JobResponse,
  PreflightResponse,
  VoiceResponse,
} from "../api/generated/v1";
import { ErrorMessage } from "../components/error-message";
import { BookCover } from "./cover";
import { requestFor, type Draft } from "./store";
import { VoicePicker, voiceInfo } from "./voice-picker";
import { ScenePreview } from "./scene-preview";

export function Composer({
  draft: d,
  client,
  capabilities: cap,
  voices,
  update,
  onHome,
  onBilling,
  onCreated,
}: {
  draft: Draft;
  client: KenkuiServerClient;
  capabilities: Capabilities;
  voices: VoiceResponse[];
  update(patch: Partial<Draft>): void;
  onHome(): void;
  onBilling(): void;
  onCreated(job: JobResponse, draft: Draft): void;
}) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false),
    [picker, setPicker] = useState<"narrator" | "unknown" | null>(null);
  const [quote, setQuote] = useState<{
    key: string;
    value: PreflightResponse;
  }>();
  const [quoteError, setQuoteError] = useState<unknown>(),
    [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    if (!d.narrator && voices[0]) update({ narrator: voices[0].id });
  }, [d.narrator, voices]);
  const payload = useMemo(() => requestFor(d), [d]);
  const fingerprint = JSON.stringify(payload);
  const latest = useRef(fingerprint);
  latest.current = fingerprint;
  const supportsCast =
    cap.casting?.modes?.includes("characters") &&
    Boolean(cap.casting.models?.length);
  const valid = Boolean(
    d.title.trim() &&
    d.chapters.length &&
    voices.some((v) => v.id === d.narrator) &&
    (d.mode === "single" ||
      (supportsCast && cap.casting?.models?.includes(d.model))) &&
    cap.outputFormats?.some((format) => format === d.format),
  );
  useEffect(() => {
    if (!valid) return;
    let live = true;
    setQuoteError(undefined);
    const timeout = setTimeout(() => {
      void client
        .preflight(JSON.parse(fingerprint))
        .then((value) => {
          if (live) setQuote({ key: fingerprint, value });
        })
        .catch((cause) => {
          if (live) {
            setQuote(undefined);
            setQuoteError(cause);
          }
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [client, fingerprint, valid, retry]);
  const current = quote?.key === fingerprint && valid ? quote.value : undefined;
  const priced = cap.billing?.mode === "credits";
  const enough =
    current?.estimatedCredits == null ||
    current.availableCredits == null ||
    current.availableCredits >= current.estimatedCredits;
  const eligible = Boolean(
    current &&
    current.valid !== false &&
    enough &&
    (!priced ||
      (current.estimatedCredits != null && current.availableCredits != null)),
  );
  const name = (id: string) =>
    voices.find((v) => v.id === id)?.name || "Choose a voice";
  const step = (value: number) => {
    update({ step: value });
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  async function submit() {
    if (!eligible || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    setNotice("");
    const submitted = { ...d },
      submittedKey = fingerprint;
    try {
      // Never charge from an old estimate after checkout or a settings change.
      const confirmed = await client.preflight(payload);
      if (latest.current !== submittedKey) return;
      setQuote({ key: submittedKey, value: confirmed });
      if (
        confirmed.valid === false ||
        (priced &&
          (confirmed.estimatedCredits == null ||
            confirmed.availableCredits == null))
      )
        return;
      if (confirmed.estimatedCredits !== current?.estimatedCredits) {
        setNotice(
          "The price has changed. Review the updated estimate and confirm again.",
        );
        return;
      }
      if (
        confirmed.estimatedCredits != null &&
        confirmed.availableCredits != null &&
        confirmed.availableCredits < confirmed.estimatedCredits
      )
        return;
      const job = await client.createJob(payload, submitted.key);
      onCreated(job, submitted);
    } catch (cause) {
      setError(cause);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function cover(file?: File) {
    if (!file || pending.current) return;
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > (cap.covers?.maxUploadBytes ?? 8 * 1024 * 1024)
    ) {
      setError(new Error("Choose a PNG or JPEG cover up to 8 MB."));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const asset = await client.uploadCover(d.book.sourceId, file);
      const book = await client.inspectBook(asset.id);
      update({
        book,
        chapters: d.chapters.filter((id) =>
          book.chapters.some((c) => c.id === id),
        ),
        sourceCover: true,
      });
    } catch (cause) {
      setError(cause);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const estimate = (
    <div className="credit-estimate" aria-live="polite" aria-atomic="true">
      <div className="estimate-top">
        <span>Estimated conversion</span>
        <strong>
          {current
            ? priced
              ? current.estimatedCredits == null
                ? "Price unavailable"
                : `${current.estimatedCredits.toLocaleString()} credits`
              : "Unmetered"
            : valid
              ? quoteError
                ? "Estimate unavailable"
                : "Updating estimate…"
              : "Complete your choices"}
          {priced && current?.estimatedCredits != null && (
            <small>${(current.estimatedCredits / 100).toFixed(2)} USD at the standard credit rate</small>
          )}
        </strong>
      </div>
      {current && (
        <div className="estimate-details">
          <span>
            {current.normalizedCharacters.toLocaleString()} speech characters ·{" "}
            {d.chapters.length} chapter{d.chapters.length === 1 ? "" : "s"}
          </span>
          <span>
            {d.mode === "characters"
              ? "Full cast · includes character attribution"
              : "Single narrator"}
          </span>
        </div>
      )}
      <ErrorMessage error={quoteError} />
      {Boolean(quoteError) && (
        <button className="text-button" onClick={() => setRetry((v) => v + 1)}>
          Retry estimate
        </button>
      )}
      {current?.valid === false && (
        <p role="alert">
          {!enough
            ? "You do not have enough credits for this book conversion."
            : "The server rejected these choices. Adjust the settings and try again."}
        </p>
      )}
      {priced && current?.availableCredits != null && (
        <div className="balance-check">
          <span>
            Available: {current.availableCredits.toLocaleString()} credits
          </span>
          <button className="text-button accent" onClick={onBilling}>
            Add credits
          </button>
        </div>
      )}
      {priced && (
        <p>
          Updated from the server when your settings change. Credits are
          reserved only when you start. Download completed audio within 30 days.
          Keep your original EPUB; hosted source files are cleaned up after use.
        </p>
      )}
    </div>
  );
  return (
    <>
      <div className="workspace-top">
        <button disabled={busy} className="text-button" onClick={onHome}>
          ← Your books
        </button>
        <span className="saved">Draft saved on this device</span>
      </div>
      <ol className="steps" aria-label="Conversion steps">
        {["Book", "Voices", "Create"].map((label, i) => (
          <li key={label} aria-current={d.step === i + 1 ? "step" : undefined}>
            <button
              disabled={busy || i + 1 > d.step}
              onClick={() => step(i + 1)}
            >
              <span>{d.step > i + 1 ? "✓" : i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      <div className="workspace">
        <aside className="book-identity">
          <BookCover
            title={d.title}
            author={d.author}
            sourceId={d.book.sourceId}
            client={client}
            enabled={Boolean(cap.covers?.read && d.sourceCover)}
          />
          <div className="identity-copy">
            <h1>{d.title || "Untitled book"}</h1>
            <p>{d.author}</p>
            <span className="quiet">
              {d.chapters.length} chapter{d.chapters.length === 1 ? "" : "s"} ·{" "}
              {d.mode === "characters" ? "Full cast" : "Single narrator"}
            </span>
          </div>
        </aside>
        <section className="editor" key={d.step}>
          <ErrorMessage error={error} />
          {notice && <p role="status">{notice}</p>}
          <fieldset disabled={busy} className="editor-controls">
            <legend className="sr-only">Audiobook settings</legend>
            {d.step === 1 ? (
              <>
                <div className="eyebrow">01 / BOOK</div>
                <h2>Book details</h2>
                <p className="muted">
                  Check the title and cover before choosing voices.
                </p>
                <label>
                  Title
                  <input
                    maxLength={500}
                    value={d.title}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
                <label>
                  Author
                  <input
                    maxLength={500}
                    value={d.author}
                    onChange={(e) => update({ author: e.target.value })}
                  />
                </label>
                {cap.covers?.upload && (
                  <div className="cover-controls">
                    <label className="secondary file-button">
                      Upload cover
                      <input
                        aria-label="Upload cover"
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => {
                          void cover(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {d.book.sourceId !== d.originalSourceId && (
                      <button
                        className="text-button"
                        onClick={() =>
                          update({
                            book: { ...d.book, sourceId: d.originalSourceId },
                            sourceCover: true,
                          })
                        }
                      >
                        Restore original cover
                      </button>
                    )}
                  </div>
                )}
                <details>
                  <summary>Advanced</summary>
                  <div className="settings-grid">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={d.sourceCover}
                        onChange={(e) =>
                          update({ sourceCover: e.target.checked })
                        }
                      />
                      Include book cover
                    </label>
                    <p className="quiet">
                      Cover and metadata edits do not add a surcharge.
                    </p>
                  </div>
                  <div className="chapter-selection">
                    <div className="section-top">
                      <span>
                        {d.chapters.length} of {d.book.chapters.length} chapters
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          update({ chapters: d.book.chapters.map((c) => c.id) })
                        }
                      >
                        Select all
                      </button>
                    </div>
                    {d.book.chapters.map((c) => (
                      <label className="checkbox" key={c.id}>
                        <input
                          type="checkbox"
                          checked={d.chapters.includes(c.id)}
                          onChange={(e) =>
                            update({
                              chapters: e.target.checked
                                ? d.book.chapters
                                    .filter(
                                      (item) =>
                                        item.id === c.id ||
                                        d.chapters.includes(item.id),
                                    )
                                    .map((item) => item.id)
                                : d.chapters.filter((id) => id !== c.id),
                            })
                          }
                        />
                        {c.title}
                      </label>
                    ))}
                  </div>
                  <p className="quiet">
                    Selecting fewer chapters can lower the estimate. Text is
                    automatically prepared for speech.
                  </p>
                </details>
                {estimate}
                <div className="editor-footer">
                  <button className="text-button" onClick={onHome}>
                    Save and close
                  </button>
                  <button
                    className="primary"
                    disabled={!d.title.trim() || !d.chapters.length}
                    onClick={() => step(2)}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : d.step === 2 ? (
              <>
                <div className="eyebrow">02 / VOICES</div>
                <h2>Narration</h2>
                <p className="muted">
                  One voice throughout, or a voice for each character.
                </p>
                {supportsCast ? (
                  <div
                    className="narration-options"
                    role="group"
                    aria-label="Narration style"
                  >
                    <button
                      aria-pressed={d.mode === "single"}
                      onClick={() => update({ mode: "single" })}
                    >
                      <strong>Single narrator</strong>
                      <span>One voice for the whole book</span>
                    </button>
                    <button
                      aria-pressed={d.mode === "characters"}
                      onClick={() =>
                        update({
                          mode: "characters",
                          model: d.model || cap.casting?.models?.[0] || "",
                        })
                      }
                    >
                      <strong>Full cast</strong>
                      <span>Narrator + character voices</span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="quiet">
                      This server supports single-narrator books.
                    </p>
                    {d.mode !== "single" && (
                      <button
                        className="secondary"
                        onClick={() => update({ mode: "single" })}
                      >
                        Use single narrator
                      </button>
                    )}
                  </div>
                )}
                <div className="cast-list">
                  <div className="cast-row">
                    <div>
                      <span className="quiet">Narrator</span>
                      <strong>{name(d.narrator)}</strong>
                      <span className="quiet">
                        {voiceInfo(d.narrator)?.accent}
                      </span>
                    </div>
                    <button
                      className="secondary"
                      disabled={!voices.length}
                      onClick={() => setPicker("narrator")}
                    >
                      Change voice
                    </button>
                  </div>
                  {d.mode === "characters" && (
                    <>
                      <div className="cast-note">
                        Automatic character casting
                        <p>
                          Characters and dialogue are identified during
                          conversion. Each character keeps their assigned voice
                          throughout the book.
                        </p>
                      </div>
                      <div className="cast-row">
                        <div>
                          <span className="quiet">Unidentified speaker</span>
                          <strong>
                            {d.unknown ? name(d.unknown) : "Same as narrator"}
                          </strong>
                        </div>
                        <button
                          className="secondary"
                          onClick={() => setPicker("unknown")}
                        >
                          Choose fallback voice
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <p className="quiet audition-note">
                  Listen to free samples in the voice picker. Voice choice does
                  not add a surcharge.
                </p>
                {!voices.length && (
                  <p role="alert">
                    No enabled voices are available on this server.
                  </p>
                )}
                {d.mode === "characters" && (
                  <details>
                    <summary>Advanced</summary>
                    <div className="settings-grid">
                      <label>
                        Voice assignment
                        <select
                          aria-label="Voice assignment"
                          value={d.method}
                          onChange={(e) => update({ method: e.target.value })}
                        >
                          <option value="gendered">
                            Match character voices
                          </option>
                          <option value="random">Any available voice</option>
                        </select>
                      </label>
                      <label>
                        Character analysis model
                        <select
                          aria-label="Character analysis model"
                          value={d.model}
                          onChange={(e) => update({ model: e.target.value })}
                        >
                          {cap.casting?.models?.map((model) => (
                            <option key={model}>{model}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="text-button"
                        onClick={() => update({ unknown: "" })}
                      >
                        Use narrator for unidentified speakers
                      </button>
                    </div>
                    <p className="quiet">
                      Full cast includes character analysis, even when multiple
                      roles share a voice. The estimate reflects the selected
                      settings.
                    </p>
                  </details>
                )}
                {estimate}
                <div className="editor-footer">
                  <button className="secondary" onClick={() => step(1)}>
                    Back
                  </button>
                  <button
                    className="primary"
                    disabled={!valid}
                    onClick={() => step(3)}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="eyebrow">03 / CREATE</div>
                <h2>Preview & create</h2>
                <p className="muted">Review your choices before starting.</p>
                <ScenePreview fullCast={d.mode === "characters"} />
                <dl className="review">
                  <div>
                    <dt>Narration</dt>
                    <dd>
                      {d.mode === "characters"
                        ? "Full cast"
                        : "Single narrator"}
                      <button className="text-button" onClick={() => step(2)}>
                        Change
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Narrator</dt>
                    <dd>{name(d.narrator)}</dd>
                  </div>
                  <div>
                    <dt>Chapters</dt>
                    <dd>
                      {d.chapters.length}
                      <button className="text-button" onClick={() => step(1)}>
                        Change
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Format</dt>
                    <dd>{d.format.toUpperCase()}</dd>
                  </div>
                </dl>
                {(cap.outputFormats?.length ?? 0) > 1 && (
                  <details>
                    <summary>Advanced</summary>
                    <label>
                      Audio format
                      <select
                        value={d.format}
                        onChange={(e) => update({ format: e.target.value })}
                      >
                        {cap.outputFormats?.map((f) => (
                          <option key={f} value={f}>
                            {f.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                  </details>
                )}
                {estimate}
                {priced && eligible && (
                  <p className="quiet">
                    Cancelled or failed conversions release their reserved
                    credits.
                  </p>
                )}
                <div className="editor-footer">
                  <button className="secondary" onClick={() => step(2)}>
                    Back
                  </button>
                  <button
                    className="primary"
                    disabled={!eligible}
                    onClick={() => void submit()}
                  >
                    {busy
                      ? "Starting…"
                      : priced && current?.estimatedCredits != null
                        ? `Create · ${current.estimatedCredits} credits`
                        : "Create audiobook"}
                  </button>
                </div>
              </>
            )}
          </fieldset>
          {busy && (
            <p role="status">
              {d.step === 3
                ? "Confirming your estimate and starting conversion…"
                : "Updating the cover…"}
            </p>
          )}
        </section>
      </div>
      {picker && (
        <VoicePicker
          voices={voices}
          selected={
            picker === "narrator" ? d.narrator : d.unknown || d.narrator
          }
          role={picker === "narrator" ? "Narrator" : "Unidentified speaker"}
          onClose={() => setPicker(null)}
          onSelect={(id) => {
            update(picker === "narrator" ? { narrator: id } : { unknown: id });
            setPicker(null);
          }}
        />
      )}
    </>
  );
}
