import { useEffect, useState } from "react";
import { readLibrary, saveLibrary } from "./draft-storage";

/** Studio is keyed by account/server scope; this hook owns only that library. */
export function useLibrary(key: string) {
  const [library, setLibrary] = useState(() => readLibrary(key));
  const [savingError, setSavingError] = useState("");
  useEffect(() => {
    try { saveLibrary(key, library); setSavingError(""); }
    catch { setSavingError("This browser could not save your draft. Keep this tab open until you finish."); }
  }, [key, library]);
  return { library, setLibrary, savingError };
}
