import { useState } from "react";
import type { KenkuiServerClient } from "../api/client";
import { KenkuiApiError } from "../api/errors";
import { ErrorMessage } from "./error-message";

export function RecoverAccount({
  client,
  linked,
}: {
  client: KenkuiServerClient;
  linked(): void;
}) {
  const [step, setStep] = useState<"choice" | "email" | "code" | "create">(
    "choice",
  );
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (step === "email") {
        const result = await client.challenge(email);
        setChallenge(result.challengeId);
        setCode("");
        setStep("code");
      } else {
        try {
          if (step === "create") await client.onboard();
          else await client.verify(challenge, code);
        } catch (cause) {
          // A committed binding can outlive a lost response. Only retry lookup.
          if (!(cause instanceof KenkuiApiError) || cause.status >= 500) {
            try {
              await client.session();
              linked();
              return;
            } catch {
              /* show original error */
            }
          }
          throw cause;
        }
        linked();
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="connection-screen">
      <section>
        <h1>Connect your Kenkui account</h1>
        <p>
          Recover your previous account to keep its books, purchases and
          credits, even if your new sign-in uses a different email.
        </p>
        {step === "choice" ? (
          <>
            <button className="primary" onClick={() => setStep("email")}>
              Recover existing account
            </button>
            <button className="secondary" onClick={() => setStep("create")}>
              Create new account
            </button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {step === "email" && (
              <label>
                Previous account email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {step === "code" && (
              <>
                <p>If this address is eligible, check your inbox.</p>
                <label>
                  Recovery code
                  <input
                    required
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep("email")}
                >
                  Request another code
                </button>
              </>
            )}
            {step === "create" && (
              <p>
                A separate account starts with an empty library. Your previous
                books and credits stay with your previous account.
              </p>
            )}
            <button disabled={busy} className="primary">
              {step === "create"
                ? "Create separate account"
                : step === "email"
                  ? "Send recovery code"
                  : "Verify recovery code"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep("choice");
                setError(undefined);
              }}
            >
              Back
            </button>
          </form>
        )}
        <ErrorMessage error={error} />
      </section>
    </main>
  );
}
