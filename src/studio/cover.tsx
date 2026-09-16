import { useEffect, useState } from "react";
import type { KenkuiServerClient } from "../api/client";
export function BookCover({
  title,
  author,
  sourceId,
  client,
  enabled,
}: {
  title: string;
  author: string;
  sourceId?: string;
  client: KenkuiServerClient;
  enabled: boolean;
}) {
  const [image, setImage] = useState<{ source: string; url: string }>();
  useEffect(() => {
    if (!sourceId || !enabled) return;
    let live = true,
      url: string | undefined;
    void client
      .cover(sourceId)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setImage({ source: sourceId, url });
      })
      .catch(() => {
        if (live) setImage(undefined);
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sourceId, client, enabled]);
  const color = ["garden", "pride", "time", "jane"][
    [...title].reduce((n, c) => n + c.charCodeAt(0), 0) % 4
  ];
  const actual = enabled && image?.source === sourceId ? image?.url : undefined;
  return (
    <div className={`cover ${color}`} aria-hidden="true">
      {actual ? (
        <img src={actual} alt="" onError={() => setImage(undefined)} />
      ) : (
        <>
          <div className="cover-rule" />
          <span className="cover-edition">KENKUI STUDIO</span>
          <strong>{title || "Untitled book"}</strong>
          <span className="cover-ornament">—</span>
          <span className="cover-author">{author}</span>
          <div className="cover-rule bottom" />
        </>
      )}
    </div>
  );
}
